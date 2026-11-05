// Anbieter "Anthropic": startet die lokale Claude-CLI als Prozess pro Lauf.
// Die Grenzen werden technisch erzwungen, nicht per Prompt erbeten:
//   --restricted         kein Bash, keine fremden Einstellungen, Dateien nur im Arbeitsbereich
//   --strict-mcp-config  keine Konnektoren des Benutzers (Mail, Slack, ...)
//   --tools              genau die Werkzeuge, die der Auftrag erlaubt
//   Umgebung             nur die Whitelist unten, damit keine Geheimnisse mitwandern

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { costFromUsage, modelById } from '../../shared/catalog.ts';
import type { Billing, LiveKind, PlanStatus, ProviderInfo, Usage } from '../../shared/types.ts';
import { emptyUsage } from '../../shared/types.ts';
import type { Provider, ProviderEvent, RunHandle, RunSpec, StopReason } from './types.ts';

const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
const READ_TOOLS = ['Read', 'Glob', 'Grep'];
const WEB_TOOLS = ['WebSearch', 'WebFetch'];

const ENV_WHITELIST = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'TERM',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CONFIG_DIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS',
];

/** Ein hinterlegter Schlüssel geht vor. Ohne ihn arbeitet die CLI mit dem Abo, mit dem sie angemeldet ist. */
export function agentEnv(apiKey: string | null = null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ENV_WHITELIST) if (process.env[name]) env[name] = process.env[name];
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1';
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  return env;
}

export function buildArgs(spec: RunSpec): string[] {
  const base = spec.readOnly ? READ_TOOLS : FILE_TOOLS;
  const tools = spec.webAccess ? [...base, ...WEB_TOOLS] : base;
  const args = [
    '-p', spec.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--restricted',
    '--strict-mcp-config',
    '--tools', tools.join(','),
    '--permission-mode', 'acceptEdits',
    '--permission-prompts', 'none',
    '--system-prompt', spec.systemPrompt,
    '--model', spec.model,
    // Die CLI prüft ihr Limit gegen die Summe der ganzen Session, nicht gegen diesen Lauf (gemessen 2026-11-02).
    '--max-budget-usd', (spec.sessionCostBefore + spec.limitUsd).toFixed(6),
  ];
  if (spec.webAccess) args.push('--allowedTools', WEB_TOOLS.join(','));
  if (spec.jsonSchema) args.push('--json-schema', JSON.stringify(spec.jsonSchema));
  // --add-dir erweitert die Grenze von --restricted um genau diesen Ordner (gemessen 2026-11-03): alles andere bleibt abgewiesen.
  for (const dir of spec.extraDirs ?? []) args.push('--add-dir', dir);
  args.push(spec.resume ? '--resume' : '--session-id', spec.sessionId);
  return args;
}

const CHARS_PER_TOKEN = 4;

const TOOL_KIND: Record<string, { kind: LiveKind; verb: string }> = {
  Read: { kind: 'reading', verb: 'liest' },
  Glob: { kind: 'reading', verb: 'sucht Dateien' },
  Grep: { kind: 'reading', verb: 'durchsucht Dateien' },
  Write: { kind: 'writing', verb: 'schreibt' },
  Edit: { kind: 'writing', verb: 'überarbeitet' },
  WebSearch: { kind: 'searching', verb: 'sucht im Web' },
  WebFetch: { kind: 'searching', verb: 'liest im Web' },
};

function readRaw(u: any): Usage {
  const split = u?.cache_creation;
  const write = u?.cache_creation_input_tokens ?? 0;
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite5m: split ? (split.ephemeral_5m_input_tokens ?? 0) : write,
    cacheWrite1h: split ? (split.ephemeral_1h_input_tokens ?? 0) : 0,
  };
}

/** Pure Übersetzung des CLI-Ereignisstroms in Spielereignisse. Kein I/O, deshalb direkt testbar. */
export class StreamInterpreter {
  private messages = new Map<string, Usage>();
  private currentMessage = '';
  /** Empfangene Zeichen der laufenden Nachricht. Ihre Ausgabe-Tokens nennt die CLI erst am Nachrichtenende. */
  private inflightChars = 0;
  private partialJson = '';
  private currentTool = '';
  private lastDetail = '';
  private text = '';
  private toolNames = new Map<string, string>();
  sawResult = false;
  private readonly cwd: string;
  private readonly modelId: string;
  private readonly sessionCostBefore: number;
  private readonly structuredLabel: string;

  constructor(cwd: string, modelId: string, sessionCostBefore = 0, structuredLabel = 'schreibt das Urteil') {
    this.cwd = cwd;
    this.modelId = modelId;
    this.sessionCostBefore = sessionCostBefore;
    this.structuredLabel = structuredLabel;
  }

  private tool(name: string): { kind: LiveKind; verb: string } | undefined {
    return name === 'StructuredOutput' ? { kind: 'writing', verb: this.structuredLabel } : TOOL_KIND[name];
  }

  private rel(p: string): string {
    for (const root of [this.cwd, `/private${this.cwd}`, this.cwd.replace(/^\/private/, '')]) {
      if (p.startsWith(`${root}/`)) return p.slice(root.length + 1);
    }
    return p;
  }

  private describeInput(name: string, input: any): string {
    if (input?.file_path) return this.rel(String(input.file_path));
    if (name === 'Glob' || name === 'Grep') return String(input?.pattern ?? '');
    if (name === 'WebSearch') return String(input?.query ?? '');
    if (name === 'WebFetch') return String(input?.url ?? '');
    return '';
  }

  countedUsage(): Usage {
    const sum = emptyUsage();
    for (const u of this.messages.values()) {
      sum.input += u.input;
      sum.output += u.output;
      sum.cacheRead += u.cacheRead;
      sum.cacheWrite5m += u.cacheWrite5m;
      sum.cacheWrite1h += u.cacheWrite1h;
    }
    const inflight = this.messages.get(this.currentMessage);
    if (inflight) sum.output += Math.max(0, Math.ceil(this.inflightChars / CHARS_PER_TOKEN) - inflight.output);
    return sum;
  }

  countedCost(): number {
    const price = modelById(this.modelId)?.price;
    return price ? costFromUsage(price, this.countedUsage()) : 0;
  }

  partialText(): string {
    return this.text;
  }

  private usageEvent(): ProviderEvent {
    // Die letzte Nachricht liest das ganze bisherige Gespräch. Ihre Eingabe ist die Belegung des Kontextfensters.
    const now = this.messages.get(this.currentMessage);
    const contextTokens = now ? now.input + now.cacheRead + now.cacheWrite5m + now.cacheWrite1h : undefined;
    return { type: 'usage', usage: this.countedUsage(), costUsd: this.countedCost(), contextTokens };
  }

  feed(j: any): ProviderEvent[] {
    switch (j?.type) {
      case 'system':
        return this.onSystem(j);
      case 'stream_event':
        return this.onStream(j);
      case 'assistant':
        return this.onAssistant(j);
      case 'user':
        return this.onUser(j);
      case 'rate_limit_event':
        return this.onRateLimit(j);
      case 'result':
        return this.onResult(j);
      default:
        return [];
    }
  }

  private onSystem(j: any): ProviderEvent[] {
    if (j.subtype === 'init') {
      const billing: Billing = !j.apiKeySource || j.apiKeySource === 'none' ? 'abo' : 'api';
      return [
        {
          type: 'init',
          sessionId: j.session_id,
          model: j.model,
          tools: j.tools ?? [],
          connectors: (j.mcp_servers ?? []).map((s: any) => s.name),
          billing,
        },
        { type: 'state', kind: 'thinking', detail: 'denkt nach' },
      ];
    }
    if (j.subtype === 'status' && j.status === 'requesting') {
      return [{ type: 'state', kind: 'thinking', detail: 'denkt nach' }];
    }
    return [];
  }

  private onStream(j: any): ProviderEvent[] {
    const e = j.event;
    if (e?.type === 'message_start') {
      this.currentMessage = e.message?.id ?? '';
      this.inflightChars = 0;
      if (this.currentMessage) this.messages.set(this.currentMessage, readRaw(e.message?.usage));
      return [this.usageEvent()];
    }
    if (e?.type === 'message_delta') {
      const id = j.api_message_id ?? this.currentMessage;
      const known = this.messages.get(id);
      if (known && typeof e.usage?.output_tokens === 'number') {
        known.output = Math.max(known.output, e.usage.output_tokens);
        this.inflightChars = 0;
      }
      return [this.usageEvent()];
    }
    if (e?.type === 'content_block_start') {
      const block = e.content_block;
      if (block?.type === 'text') return [{ type: 'state', kind: 'answering', detail: 'formuliert die Antwort' }];
      if (block?.type === 'thinking') return [{ type: 'state', kind: 'thinking', detail: 'denkt nach' }];
      if (block?.type === 'tool_use') {
        this.currentTool = block.name;
        this.partialJson = '';
        this.lastDetail = '';
        const tool = this.tool(block.name);
        if (tool) return [{ type: 'state', kind: tool.kind, detail: tool.verb }];
      }
      return [];
    }
    if (e?.type === 'content_block_delta') {
      if (e.delta?.type === 'text_delta') {
        this.text += e.delta.text ?? '';
        this.inflightChars += e.delta.text?.length ?? 0;
        return [{ type: 'text', text: this.text }, this.usageEvent()];
      }
      if (e.delta?.type === 'input_json_delta') {
        // Der Dateiname kommt, bevor das Modell den Inhalt schreibt. So zeigt die Figur
        // schon während der eigentlichen Schreibarbeit, woran sie sitzt.
        this.partialJson += e.delta.partial_json ?? '';
        this.inflightChars += e.delta.partial_json?.length ?? 0;
        const out: ProviderEvent[] = [this.usageEvent()];
        const match = this.partialJson.match(/"(?:file_path|pattern|query|url)"\s*:\s*"([^"]+)"/);
        if (match && match[1] !== this.lastDetail) {
          this.lastDetail = match[1];
          const tool = this.tool(this.currentTool);
          if (tool) out.push({ type: 'state', kind: tool.kind, detail: `${tool.verb} ${this.rel(match[1])}` });
        }
        return out;
      }
    }
    return [];
  }

  private onAssistant(j: any): ProviderEvent[] {
    const out: ProviderEvent[] = [];
    const id = j.message?.id;
    if (id && !this.messages.has(id)) this.messages.set(id, readRaw(j.message?.usage));
    for (const block of j.message?.content ?? []) {
      if (block.type !== 'tool_use') continue;
      this.toolNames.set(block.id, block.name);
      const tool = this.tool(block.name);
      const detail = this.describeInput(block.name, block.input);
      out.push({ type: 'activity', entry: { kind: 'tool', label: `${tool?.verb ?? block.name} ${detail}`.trim() } });
    }
    return out;
  }

  private onUser(j: any): ProviderEvent[] {
    const out: ProviderEvent[] = [];
    const content = j.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_result' && block.is_error) {
          const name = this.toolNames.get(block.tool_use_id) ?? 'Werkzeug';
          out.push({ type: 'activity', entry: { kind: 'denied', label: `${name} abgewiesen` } });
        }
      }
    }
    out.push({ type: 'state', kind: 'thinking', detail: 'denkt nach' });
    return out;
  }

  private onRateLimit(j: any): ProviderEvent[] {
    const info = j.rate_limit_info;
    if (!info) return [];
    const win = (w: any) => (w ? { utilization: w.utilization ?? 0, resetsAt: (w.resetsAt ?? 0) * 1000 } : null);
    const plan: PlanStatus = {
      status: info.status ?? 'unbekannt',
      fiveHour: win(info.unifiedWindows?.five_hour),
      sevenDay: win(info.unifiedWindows?.seven_day),
      at: Date.now(),
    };
    const out: ProviderEvent[] = [{ type: 'plan', plan }];
    if (info.status === 'rejected') out.push({ type: 'state', kind: 'waiting', detail: 'wartet auf freies Kontingent' });
    return out;
  }

  private onResult(r: any): ProviderEvent[] {
    this.sawResult = true;
    const status = r.subtype === 'success' && !r.is_error ? 'success' : r.subtype === 'error_max_budget_usd' ? 'limit' : 'error';
    // usage gilt für diesen Lauf. total_cost_usd und modelUsage summieren über die ganze Session,
    // daher ist der Preis dieses Laufs die Differenz zum vorherigen Stand.
    const usage = readRaw(r.usage);
    const total = Number(r.total_cost_usd);
    const delta = total - this.sessionCostBefore;
    const price = modelById(this.modelId)?.price;
    const hasDelta = Number.isFinite(total) && delta >= 0;
    const main = Object.entries<any>(r.modelUsage ?? {}).sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0))[0];
    const errors: string[] = r.errors ?? [];
    return [
      {
        type: 'end',
        status,
        text: String(r.result ?? ''),
        structured: r.structured_output ?? null,
        usage,
        costUsd: hasDelta ? delta : price ? costFromUsage(price, usage) : 0,
        costSource: hasDelta ? 'gemeldet' : 'berechnet',
        sessionCostUsd: Number.isFinite(total) ? total : null,
        modelUsed: main?.[0] ?? null,
        durationMs: Number(r.duration_ms ?? 0),
        turns: Number(r.num_turns ?? 0),
        denied: (r.permission_denials ?? []).length,
        error: status === 'success' ? null : errors.join('; ') || String(r.result ?? 'Der Lauf ist fehlgeschlagen.'),
      },
    ];
  }
}

function findBinary(): string | null {
  const home = os.homedir();
  const dirs = [
    ...(process.env.PATH ?? '').split(path.delimiter),
    path.join(home, '.local/bin'),
    path.join(home, '.claude/local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const dir of dirs) {
    const candidate = path.join(dir, 'claude');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // nächster Ordner
    }
  }
  return null;
}

function run(bin: string, args: string[], apiKey: string | null = null): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { env: agentEnv(apiKey), timeout: 15000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

export function createAnthropicProvider(overrideBin?: string, keyOf: () => string | null = () => null): Provider {
  const testDouble = Boolean(overrideBin);
  const bin = overrideBin ?? findBinary();

  return {
    id: 'anthropic',

    async detect(): Promise<ProviderInfo> {
      const base: ProviderInfo = {
        id: 'anthropic', label: 'Anthropic', available: false, version: null,
        billing: null, account: null, error: null, testDouble,
      };
      if (!bin) {
        return { ...base, error: 'Die Claude-CLI wurde nicht gefunden. Installiere sie, melde dich an und prüfe dann erneut. Ohne sie gibt es keine echten Mitarbeiter.' };
      }
      if (testDouble) return { ...base, available: true, billing: 'test', version: 'Test-Attrappe', account: 'Test-Attrappe' };
      try {
        const version = (await run(bin, ['--version'])).trim().split(' ')[0];
        if (keyOf() || process.env.ANTHROPIC_API_KEY) {
          return { ...base, available: true, version, billing: 'api', account: 'API-Schlüssel' };
        }
        const auth = JSON.parse(await run(bin, ['auth', 'status']));
        if (!auth.loggedIn) return { ...base, version, error: 'Die Claude-CLI ist nicht angemeldet. Führe im Terminal "claude auth login" aus.' };
        const plan = auth.subscriptionType ? `${String(auth.subscriptionType).replace(/^./, (c: string) => c.toUpperCase())}-Abo` : 'Abo';
        return { ...base, available: true, version, billing: auth.authMethod === 'claude.ai' ? 'abo' : 'api', account: plan };
      } catch (err) {
        return { ...base, error: `Die Claude-CLI antwortet nicht: ${(err as Error).message}` };
      }
    },

    start(spec: RunSpec, on: (event: ProviderEvent) => void): RunHandle {
      if (!bin) throw new Error('Die Claude-CLI wurde nicht gefunden.');
      fs.mkdirSync(path.dirname(spec.rawLogPath), { recursive: true });
      const raw = fs.createWriteStream(spec.rawLogPath, { flags: 'a' });
      const interpreter = new StreamInterpreter(spec.cwd, spec.model, spec.sessionCostBefore, spec.structuredLabel);
      const startedAt = Date.now();
      let stopReason: StopReason | null = null;
      let ended = false;
      let buffer = '';
      let stderr = '';

      const proc = spawn(bin, buildArgs(spec), { cwd: spec.cwd, env: agentEnv(keyOf()), stdio: ['ignore', 'pipe', 'pipe'] });

      const stop = (reason: StopReason) => {
        if (ended) return;
        stopReason ??= reason;
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!ended) proc.kill('SIGKILL');
        }, 3000).unref();
      };
      const timer = setTimeout(() => stop('timeout'), spec.timeoutMs);
      timer.unref();

      const feedLine = (line: string) => {
        if (!line.trim()) return;
        raw.write(`${line}\n`);
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        for (const event of interpreter.feed(parsed)) {
          if (event.type === 'end') ended = true;
          on(event);
        }
      };

      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let at: number;
        while ((at = buffer.indexOf('\n')) >= 0) {
          feedLine(buffer.slice(0, at));
          buffer = buffer.slice(at + 1);
        }
      });
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-2000);
      });

      // Kein Abschluss-Ereignis (Stopp, Absturz): Der Verbrauch bleibt trotzdem real,
      // darum wird er aus den mitgezählten Tokens und den Listenpreisen berechnet.
      const finishWithoutResult = (status: StopReason | 'error', error: string | null) => {
        if (ended) return;
        ended = true;
        on({
          type: 'end',
          status,
          text: interpreter.partialText(),
          structured: null,
          usage: interpreter.countedUsage(),
          costUsd: interpreter.countedCost(),
          costSource: 'berechnet',
          sessionCostUsd: null,
          modelUsed: spec.model,
          durationMs: Date.now() - startedAt,
          turns: 0,
          denied: 0,
          error,
        });
      };

      proc.on('error', (err) => {
        clearTimeout(timer);
        raw.end();
        finishWithoutResult('error', `Der Agent ließ sich nicht starten: ${err.message}`);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        feedLine(buffer);
        raw.end();
        if (stopReason === 'timeout') finishWithoutResult('timeout', 'Zeitlimit erreicht, der Lauf wurde beendet.');
        else if (stopReason === 'limit') finishWithoutResult('limit', 'Das Limit ist erreicht, der Lauf wurde mitten im Schritt beendet.');
        else if (stopReason === 'stopped') finishWithoutResult('stopped', null);
        else finishWithoutResult('error', stderr.trim() || `Der Agent wurde unerwartet beendet (Code ${code}).`);
      });

      return { pid: proc.pid ?? null, stop };
    },
  };
}
