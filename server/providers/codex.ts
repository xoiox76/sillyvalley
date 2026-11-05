// Anbieter "OpenAI über das eigene Abo": startet die lokale Codex-CLI als Prozess pro Lauf.
// Wer das Spiel nutzt, arbeitet mit dem eigenen Login. Die Grenzen werden technisch erzwungen:
//   Shell und alle Zusatzfunktionen aus; es bleibt nur, was unten ausdrücklich erlaubt ist
//   Dateien nur über files-mcp.ts, dort wird jeder Pfad geprüft
//   keine fremde Konfiguration, keine Projektregeln, Umgebung nur aus der Whitelist

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { costFromUsage, modelById } from '../../shared/catalog.ts';
import type { LiveKind, ProviderInfo, Usage } from '../../shared/types.ts';
import { emptyUsage } from '../../shared/types.ts';
import type { Provider, ProviderEvent, RunSpec, StopReason } from './types.ts';

/** Ohne diese Funktionen laufen Werkzeuge oder die Anmeldung nicht. Alles andere bleibt aus, auch was ein Update neu mitbringt. */
const KEEP_FEATURES = new Set(['code_mode_host', 'code_mode_interrupt', 'sqlite', 'item_ids', 'content_item_kinds', 'enable_request_compression', 'incremental_tools', 'steer', 'instant_interrupt']);
const ENV_WHITELIST = ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'CODEX_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'];
const TOOLS_MCP = fileURLToPath(new URL('./files-mcp.ts', import.meta.url));
const FINISH_TOOL = 'antwort_abgeben';

const STATE: Record<string, { kind: LiveKind; verb: string }> = {
  read_file: { kind: 'reading', verb: 'liest' },
  list_files: { kind: 'reading', verb: 'sucht Dateien' },
  search_files: { kind: 'reading', verb: 'durchsucht Dateien' },
  write_file: { kind: 'writing', verb: 'schreibt' },
  edit_file: { kind: 'writing', verb: 'überarbeitet' },
};

function findBinary(): string | null {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin'];
  for (const dir of dirs) {
    const candidate = path.join(dir, 'codex');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // nächster Ordner
    }
  }
  return null;
}

function env(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' };
  for (const name of ENV_WHITELIST) if (process.env[name]) out[name] = process.env[name];
  return out;
}

const run = (bin: string, args: string[]) =>
  new Promise<string>((resolve, reject) => execFile(bin, args, { env: env(), timeout: 15000 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(`${stdout}${stderr}`))));

const toml = (value: string) => JSON.stringify(value);

export interface CodexOptions {
  disabled: string[];
  mcpCommand: string;
  threadId: string | null;
  remoteModel: string;
  schemaFile: string;
  resultFile: string;
}

export function buildCodexArgs(spec: RunSpec, o: CodexOptions): string[] {
  const mcpArgs = ['--experimental-strip-types', TOOLS_MCP, spec.cwd, spec.readOnly ? 'nurlesen' : 'schreiben', o.schemaFile, o.resultFile];
  return [
    'exec', ...(o.threadId ? ['resume', o.threadId] : []),
    '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
    '-m', o.remoteModel,
    '-c', 'sandbox_mode="read-only"',
    '-c', 'project_doc_max_bytes=0',
    '-c', `mcp_servers.dateien.command=${toml(o.mcpCommand)}`,
    '-c', `mcp_servers.dateien.args=[${mcpArgs.map(toml).join(',')}]`,
    '-c', 'mcp_servers.dateien.default_tools_approval_mode="approve"',
    ...o.disabled.flatMap((name) => ['--disable', name]),
    promptOf(spec, Boolean(o.threadId)),
  ];
}

/** Die CLI kennt kein eigenes Profilfeld. Das Profil steht darum am Anfang der ersten Nachricht. */
function promptOf(spec: RunSpec, resumed: boolean): string {
  const rules = 'Dateien liest und schreibst du nur über die Werkzeuge des Servers "dateien". Ein Pfad ist relativ zum Arbeitsbereich. Befehle kannst du nicht ausführen.';
  const finish = spec.jsonSchema ? `\n\nGib deine Antwort zum Schluss über das Werkzeug ${FINISH_TOOL} ab.` : '';
  return `${resumed ? '' : `${spec.systemPrompt}\n\n${rules}\n\n`}${spec.prompt}${finish}`;
}

export function createCodexProvider(remoteOf: (modelId: string) => string, overrideBin?: string): Provider {
  const bin = overrideBin ?? findBinary();
  let disabled: string[] | null = null;
  const features = async () => {
    if (disabled) return disabled;
    const list = await run(bin!, ['features', 'list']);
    disabled = list.split('\n').map((line) => line.trim().split(/\s+/)).filter((c) => c.at(-1) === 'true' && !KEEP_FEATURES.has(c[0])).map((c) => c[0]);
    return disabled;
  };
  return {
    id: 'codex',
    async detect(): Promise<ProviderInfo> {
      const base: ProviderInfo = { id: 'codex', label: 'OpenAI', available: false, version: null, billing: null, account: null, error: null, testDouble: Boolean(overrideBin) };
      if (!bin) return base;
      try {
        const version = (await run(bin, ['--version'])).trim().split(' ').pop() ?? null;
        const login = await run(bin, ['login', 'status']);
        if (!/logged in/i.test(login)) return { ...base, version, error: 'Nicht angemeldet.' };
        await features();
        return { ...base, available: true, version, billing: /api key/i.test(login) ? 'api' : 'abo', account: /api key/i.test(login) ? 'API-Schlüssel' : 'Abo' };
      } catch (err) {
        return { ...base, error: (err as Error).message.slice(0, 200) };
      }
    },
    start(spec, on) {
      const dir = path.dirname(spec.rawLogPath);
      const threadFile = path.join(dir, `${spec.sessionId}.thread`);
      const schemaFile = path.join(dir, `${spec.sessionId}.schema.json`);
      const resultFile = path.join(dir, `${spec.sessionId}.antwort.json`);
      fs.rmSync(resultFile, { force: true });
      if (spec.jsonSchema) fs.writeFileSync(schemaFile, JSON.stringify(spec.jsonSchema));
      const threadId = spec.resume && fs.existsSync(threadFile) ? fs.readFileSync(threadFile, 'utf8').trim() : null;
      const model = modelById(spec.model);
      const remote = remoteOf(spec.model);
      const started = Date.now();
      const usage: Usage = emptyUsage();
      let costUsd = 0;
      let text = '';
      let turns = 0;
      let denied = 0;
      let error: string | null = null;
      let reason: StopReason | null = null;
      let ended = false;
      const end = (status: Extract<ProviderEvent, { type: 'end' }>['status']) => {
        if (ended) return;
        ended = true;
        let structured: unknown = null;
        try {
          if (spec.jsonSchema) structured = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        } catch {
          // Das Modell hat nichts abgegeben.
        }
        on({ type: 'end', status, text, structured, usage, costUsd, costSource: 'berechnet', sessionCostUsd: spec.sessionCostBefore + costUsd, modelUsed: remote, durationMs: Date.now() - started, turns, denied, error });
      };
      const handle = (e: any) => {
        if (e.type === 'thread.started') {
          fs.writeFileSync(threadFile, String(e.thread_id));
          on({ type: 'init', sessionId: spec.sessionId, model: remote, tools: spec.readOnly ? ['read_file', 'list_files', 'search_files'] : ['read_file', 'list_files', 'search_files', 'write_file', 'edit_file'], connectors: [], billing: 'abo' });
          on({ type: 'state', kind: 'thinking', detail: 'denkt nach' });
        } else if (e.type === 'item.started' && e.item?.type === 'mcp_tool_call') {
          const state = STATE[e.item.tool];
          if (!state) return;
          const shown = String(e.item.arguments?.path ?? e.item.arguments?.query ?? '');
          on({ type: 'state', kind: state.kind, detail: `${state.verb} ${shown}`.trim() });
          on({ type: 'activity', entry: { kind: 'tool', label: `${state.verb} ${shown}`.trim() } });
        } else if (e.type === 'item.completed' && e.item?.type === 'mcp_tool_call') {
          const output = JSON.stringify(e.item.result ?? '');
          if (output.includes('Verboten:')) {
            denied += 1;
            on({ type: 'activity', entry: { kind: 'denied', label: 'Zugriff ausserhalb des Arbeitsbereichs abgewiesen' } });
          }
        } else if (e.type === 'item.completed' && e.item?.type === 'agent_message') {
          text = String(e.item.text ?? '');
          on({ type: 'text', text });
          on({ type: 'state', kind: 'thinking', detail: 'denkt nach' });
        } else if (e.type === 'turn.completed') {
          turns += 1;
          const cached = Number(e.usage?.cached_input_tokens ?? 0);
          const input = Number(e.usage?.input_tokens ?? 0);
          usage.input += Math.max(0, input - cached);
          usage.cacheRead += cached;
          usage.output += Number(e.usage?.output_tokens ?? 0);
          costUsd = model ? costFromUsage(model.price, usage) : 0;
          on({ type: 'usage', usage: { ...usage }, costUsd, contextTokens: input });
        } else if (e.type === 'turn.failed' || e.type === 'error') {
          error = String(e.error?.message ?? e.message ?? 'Unbekannter Fehler').slice(0, 400);
        }
      };
      let child: ReturnType<typeof spawn> | null = null;
      const stop = (why: StopReason) => {
        reason = why;
        child?.kill('SIGTERM');
      };
      const timer = setTimeout(() => stop('timeout'), spec.timeoutMs);
      timer.unref();
      features().then((list) => {
        if (reason) return end(reason === 'limit' ? 'limit' : reason === 'timeout' ? 'timeout' : 'stopped');
        const args = buildCodexArgs(spec, { disabled: list, mcpCommand: process.execPath, threadId, remoteModel: remote, schemaFile: spec.jsonSchema ? schemaFile : '-', resultFile: spec.jsonSchema ? resultFile : '-' });
        child = spawn(bin!, args, { cwd: spec.cwd, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
        const log = fs.createWriteStream(spec.rawLogPath, { flags: 'a' });
        let buffer = '';
        child.stdout!.on('data', (chunk: Buffer) => {
          log.write(chunk);
          buffer += chunk.toString('utf8');
          let at: number;
          while ((at = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, at);
            buffer = buffer.slice(at + 1);
            try {
              handle(JSON.parse(line));
            } catch {
              // Keine JSON-Zeile
            }
          }
        });
        child.on('error', (err) => {
          error = err.message;
          end('error');
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          log.end();
          if (reason) return end(reason === 'limit' ? 'limit' : reason === 'timeout' ? 'timeout' : 'stopped');
          end(code === 0 && !error ? 'success' : 'error');
        });
      }).catch((err) => {
        error = (err as Error).message;
        end('error');
      });
      return { pid: null, stop };
    },
  };
}
