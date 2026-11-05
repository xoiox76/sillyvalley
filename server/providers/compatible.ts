// Anbieter mit OpenAI-kompatibler Schnittstelle: OpenAI, Gemini, Mistral, OpenRouter, Ollama, LM Studio.
// Der Agent bekommt genau die Werkzeuge unten. Es gibt kein Bash und kein Netz; jeder Pfad wird hier geprüft,
// nicht per Prompt erbeten. Das Limit setzt dieser Code durch, gerechnet aus den gemeldeten Tokens.

import fs from 'node:fs';
import path from 'node:path';
import { costFromUsage } from '../../shared/catalog.ts';
import type { LiveKind, ProviderInfo, Usage } from '../../shared/types.ts';
import { emptyUsage } from '../../shared/types.ts';
import type { ResolvedModel } from '../settings.ts';
import type { Provider, ProviderEvent, RunHandle, RunSpec, StopReason } from './types.ts';

const MAX_TURNS = 40;
const MAX_READ = 200_000;
const MAX_WRITE = 2_000_000;
const MAX_LIST = 500;
const OUTPUT_DEFAULT = 16_000;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const FINISH_TOOL = 'antwort_abgeben';

type Message = { role: string; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

const fn = (name: string, description: string, properties: object, required: string[]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const PATH = { type: 'string', description: 'Pfad relativ zum Arbeitsbereich' };
const READ_TOOLS = [
  fn('read_file', 'Liest eine Textdatei.', { path: PATH }, ['path']),
  fn('list_files', 'Listet Dateien, optional unter einem Ordner.', { path: PATH }, []),
  fn('search_files', 'Sucht einen Text in Dateien.', { query: { type: 'string' }, path: PATH }, ['query']),
];
const WRITE_TOOLS = [
  fn('write_file', 'Schreibt eine Datei neu.', { path: PATH, content: { type: 'string' } }, ['path', 'content']),
  fn('edit_file', 'Ersetzt in einer Datei einen Text, der genau einmal vorkommt.', { path: PATH, old: { type: 'string' }, new: { type: 'string' } }, ['path', 'old', 'new']),
];

const STATE: Record<string, { kind: LiveKind; verb: string }> = {
  read_file: { kind: 'reading', verb: 'liest' },
  list_files: { kind: 'reading', verb: 'sucht Dateien' },
  search_files: { kind: 'reading', verb: 'durchsucht Dateien' },
  write_file: { kind: 'writing', verb: 'schreibt' },
  edit_file: { kind: 'writing', verb: 'überarbeitet' },
};

export class Denied extends Error {}

/** Führt ein Werkzeug aus. Jeder Pfad muss nach dem Auflösen von Links in einem erlaubten Ordner liegen. */
export class Workspace {
  private readonly roots: string[];
  private readonly cwd: string;
  private readonly readOnly: boolean;

  constructor(cwd: string, extraDirs: string[], readOnly: boolean) {
    this.cwd = fs.realpathSync(cwd);
    this.roots = [this.cwd, ...extraDirs.filter((d) => fs.existsSync(d)).map((d) => fs.realpathSync(d))];
    this.readOnly = readOnly;
  }

  /** Auch eine neue Datei prüft den nächsten vorhandenen Elternordner. So führt kein Link hinaus. */
  private inside(rel: string): string {
    if (typeof rel !== 'string') throw new Denied('Pfad fehlt.');
    const target = path.resolve(this.cwd, rel);
    let existing = target;
    while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
    const real = path.join(fs.realpathSync(existing), path.relative(existing, target));
    if (!this.roots.some((root) => real === root || real.startsWith(`${root}${path.sep}`))) throw new Denied(`${rel} liegt ausserhalb des Arbeitsbereichs.`);
    return real;
  }

  private walk(start: string, out: string[]): void {
    for (const entry of fs.readdirSync(start, { withFileTypes: true })) {
      if (out.length >= MAX_LIST) return;
      if (SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(start, entry.name);
      if (entry.isDirectory()) this.walk(full, out);
      else if (entry.isFile()) out.push(full);
    }
  }

  private show = (full: string) => path.relative(this.cwd, full);

  run(name: string, args: Record<string, unknown>): string {
    if (name === 'read_file') {
      const file = this.inside(String(args.path));
      const text = fs.readFileSync(file, 'utf8');
      return text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n[gekürzt]` : text;
    }
    if (name === 'list_files') {
      const out: string[] = [];
      this.walk(this.inside(String(args.path ?? '.')), out);
      return out.map(this.show).join('\n') || '(leer)';
    }
    if (name === 'search_files') {
      const query = String(args.query ?? '');
      if (!query) throw new Denied('Suchtext fehlt.');
      const files: string[] = [];
      this.walk(this.inside(String(args.path ?? '.')), files);
      const hits: string[] = [];
      for (const file of files) {
        if (fs.statSync(file).size > MAX_READ) continue;
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
          if (hits.length < 200 && line.includes(query)) hits.push(`${this.show(file)}:${index + 1}: ${line.slice(0, 200)}`);
        });
      }
      return hits.join('\n') || '(nichts gefunden)';
    }
    if (name === 'write_file' || name === 'edit_file') {
      if (this.readOnly) throw new Denied('In diesem Lauf darfst du nur lesen.');
      const file = this.inside(String(args.path));
      if (name === 'write_file') {
        const content = String(args.content ?? '');
        if (content.length > MAX_WRITE) throw new Denied('Die Datei ist zu gross.');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        return 'Geschrieben.';
      }
      const before = fs.readFileSync(file, 'utf8');
      const old = String(args.old ?? '');
      if (!old || before.split(old).length !== 2) throw new Error('Der Text muss genau einmal vorkommen.');
      fs.writeFileSync(file, before.replace(old, () => String(args.new ?? '')));
      return 'Geändert.';
    }
    throw new Denied(`Das Werkzeug ${name} gibt es nicht.`);
  }
}

const historyFile = (spec: RunSpec) => path.join(path.dirname(spec.rawLogPath), `${spec.sessionId}.verlauf.json`);

export function createCompatibleProvider(resolve: (modelId: string) => ResolvedModel | null): Provider {
  return {
    id: 'compatible',
    async detect(): Promise<ProviderInfo> {
      return { id: 'compatible', label: 'API', available: true, version: null, billing: 'api', account: null, error: null, testDouble: false };
    },
    start(spec, on): RunHandle {
      const controller = new AbortController();
      let reason: StopReason | null = null;
      const stop = (why: StopReason) => {
        reason = why;
        controller.abort();
      };
      const timer = setTimeout(() => stop('timeout'), spec.timeoutMs);
      timer.unref();
      runLoop(spec, resolve(spec.model), on, controller.signal, () => reason).finally(() => clearTimeout(timer));
      return { pid: null, stop };
    },
  };
}

async function runLoop(spec: RunSpec, target: ResolvedModel | null, on: (event: ProviderEvent) => void, signal: AbortSignal, stopReason: () => StopReason | null): Promise<void> {
  const started = Date.now();
  const usage: Usage = emptyUsage();
  let costUsd = 0;
  let text = '';
  let turns = 0;
  let denied = 0;
  let structured: unknown = null;
  const end = (status: Extract<ProviderEvent, { type: 'end' }>['status'], error: string | null) => {
    on({ type: 'end', status, text, structured, usage, costUsd, costSource: 'berechnet', sessionCostUsd: spec.sessionCostBefore + costUsd, modelUsed: target?.remote ?? spec.model, durationMs: Date.now() - started, turns, denied, error });
  };
  if (!target) return end('error', 'Dieses Modell ist nicht mehr verbunden. Prüfe die Einstellungen.');

  const tools = [...READ_TOOLS, ...(spec.readOnly ? [] : WRITE_TOOLS)];
  if (spec.jsonSchema) tools.push({ type: 'function', function: { name: FINISH_TOOL, description: 'Gibt die fertige Antwort in der verlangten Form ab.', parameters: spec.jsonSchema as never } });
  let workspace: Workspace;
  let messages: Message[] = [];
  try {
    workspace = new Workspace(spec.cwd, spec.extraDirs ?? [], spec.readOnly);
    if (spec.resume && fs.existsSync(historyFile(spec))) messages = JSON.parse(fs.readFileSync(historyFile(spec), 'utf8'));
  } catch (err) {
    return end('error', (err as Error).message);
  }
  if (!messages.length) {
    messages.push({ role: 'system', content: `${spec.systemPrompt}\n\nDateien bearbeitest du nur über deine Werkzeuge. Ein Pfad ist relativ zum Arbeitsbereich.` });
  }
  messages.push({ role: 'user', content: spec.prompt + (spec.jsonSchema ? `\n\nGib deine Antwort zum Schluss über das Werkzeug ${FINISH_TOOL} ab.` : '') });
  on({ type: 'init', sessionId: spec.sessionId, model: target.remote, tools: tools.map((t) => t.function.name), connectors: [], billing: 'api' });

  const price = target.model.price;
  const save = () => fs.writeFileSync(historyFile(spec), JSON.stringify(messages), { mode: 0o600 });
  let nudged = false;
  try {
    while (turns < MAX_TURNS) {
      const left = spec.limitUsd - costUsd;
      if (left <= 0) return end('limit', null);
      // Mehr Ausgabe als das Restlimit deckt, wird gar nicht erst bestellt.
      const affordable = price.output > 0 ? Math.floor((left / price.output) * 1_000_000) : OUTPUT_DEFAULT;
      const maxOutput = Math.max(16, Math.min(OUTPUT_DEFAULT, affordable));
      on({ type: 'state', kind: 'thinking', detail: 'denkt nach' });
      const res = await fetch(`${target.baseUrl}/chat/completions`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}) },
        body: JSON.stringify({ model: target.remote, messages, tools, [target.kind === 'openai' ? 'max_completion_tokens' : 'max_tokens']: maxOutput }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        return end('error', `Der Anbieter antwortet mit Status ${res.status}${body?.error?.message ? `: ${String(body.error.message).slice(0, 300)}` : ''}`);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } };
      fs.appendFileSync(spec.rawLogPath, `${JSON.stringify(data)}\n`);
      turns += 1;
      const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const prompt = data.usage?.prompt_tokens ?? 0;
      usage.input += Math.max(0, prompt - cached);
      usage.cacheRead += cached;
      usage.output += data.usage?.completion_tokens ?? 0;
      costUsd = costFromUsage(price, usage);
      on({ type: 'usage', usage: { ...usage }, costUsd, contextTokens: prompt });
      const message = data.choices?.[0]?.message;
      if (!message) return end('error', 'Der Anbieter hat keine Antwort geliefert.');
      if (message.content) {
        text = message.content;
        on({ type: 'text', text });
      }
      const calls = message.tool_calls ?? [];
      messages.push({ role: 'assistant', content: message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
      if (!calls.length) {
        // Ein Modell, das die verlangte Form vergisst, bekommt genau eine Erinnerung.
        if (spec.jsonSchema && !nudged) {
          nudged = true;
          messages.push({ role: 'user', content: `Gib deine Antwort jetzt über das Werkzeug ${FINISH_TOOL} ab.` });
          continue;
        }
        save();
        return end('success', null);
      }
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'Die Argumente waren kein gültiges JSON.' });
          continue;
        }
        if (call.function.name === FINISH_TOOL) {
          structured = args;
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'Angekommen.' });
          save();
          return end('success', null);
        }
        const state = STATE[call.function.name];
        const shown = String(args.path ?? args.query ?? '');
        if (state) {
          on({ type: 'state', kind: state.kind, detail: `${state.verb} ${shown}`.trim() });
          on({ type: 'activity', entry: { kind: 'tool', label: `${state.verb} ${shown}`.trim() } });
        }
        let result: string;
        try {
          result = workspace.run(call.function.name, args);
        } catch (err) {
          result = `Fehler: ${(err as Error).message}`;
          if (err instanceof Denied) {
            denied += 1;
            on({ type: 'activity', entry: { kind: 'denied', label: (err as Error).message } });
          }
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      save();
      if (signal.aborted) break;
    }
    if (!signal.aborted) return end('error', `Nach ${MAX_TURNS} Schritten abgebrochen.`);
  } catch (err) {
    if (!signal.aborted) return end('error', `Verbindung zum Anbieter fehlgeschlagen: ${(err as Error).message}`);
  }
  const why = stopReason();
  end(why === 'limit' ? 'limit' : why === 'timeout' ? 'timeout' : 'stopped', null);
}

/** Leitet jeden Lauf an den Anbieter seines Modells. */
export function createRouter(main: Provider, compatible: Provider, isCompatible: (modelId: string) => boolean): Provider {
  return {
    id: main.id,
    detect: () => main.detect(),
    start: (spec, on) => (isCompatible(spec.model) ? compatible : main).start(spec, on),
  };
}
