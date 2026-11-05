// Der Adapter für OpenAI-kompatible Anbieter, gegen einen lokalen Testserver. Ein echter Anbieter steckt hier nicht dahinter.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { MODELS, modelById } from '../shared/catalog.ts';
import { Settings, SettingsError } from '../server/settings.ts';
import { Workspace, Denied, createCompatibleProvider } from '../server/providers/compatible.ts';
import type { ProviderEvent, RunSpec } from '../server/providers/types.ts';

let dir: string;
let server: Server;
let base: string;
let script: unknown[] = [];
let requests: { auth: string | undefined; body: any }[] = [];

const call = (name: string, args: object, id = 't1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (message: object, usage = { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 400 } }) => ({ choices: [{ message }], usage });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-compat-'));
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url?.endsWith('/models')) {
        if (req.headers.authorization === 'Bearer falsch') {
          res.statusCode = 401;
          return res.end('{}');
        }
        return res.end(JSON.stringify({ data: [{ id: 'modell-a' }, { id: 'gpt-6-luna' }] }));
      }
      requests.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      const next = script.shift();
      if (next === 'kaputt') {
        res.statusCode = 500;
        return res.end(JSON.stringify({ error: { message: 'Überlastet' } }));
      }
      res.end(JSON.stringify(next ?? reply({ content: 'Fertig.' })));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const setup = async () => {
  const data = fs.mkdtempSync(path.join(dir, 'daten-'));
  const settings = new Settings(data);
  const view = await settings.addConnection({ kind: 'custom', baseUrl: base, apiKey: 'geheim-1234', label: 'Test' });
  settings.addModel(view.id, { remote: 'modell-a', input: 10, cached: 1, output: 100 });
  const work = path.join(data, 'arbeit');
  fs.mkdirSync(work);
  return { settings, data, work, modelId: `${view.id}:modell-a`, view };
};

const runIt = (settings: Settings, spec: Partial<RunSpec> & Pick<RunSpec, 'cwd' | 'model'>) =>
  new Promise<{ events: ProviderEvent[]; end: Extract<ProviderEvent, { type: 'end' }> }>((resolve) => {
    const events: ProviderEvent[] = [];
    createCompatibleProvider((id) => settings.resolve(id)).start({
      prompt: 'Tu etwas', systemPrompt: 'Profil', sessionId: 'sitzung', resume: false, limitUsd: 1, sessionCostBefore: 0, webAccess: false, readOnly: false, jsonSchema: null,
      rawLogPath: path.join(spec.cwd, '..', 'lauf.jsonl'), timeoutMs: 5000, ...spec,
    }, (event) => {
      events.push(event);
      if (event.type === 'end') resolve({ events, end: event });
    });
  });

test('Ein Lauf schreibt eine echte Datei und rechnet aus den gemeldeten Tokens', async () => {
  const { settings, work, modelId } = await setup();
  requests = [];
  script = [reply({ content: null, tool_calls: [call('write_file', { path: 'ergebnisse/a.md', content: '# Hallo' })] }), reply({ content: 'Fertig.' })];
  const { end, events } = await runIt(settings, { cwd: work, model: modelId });
  assert.equal(end.status, 'success');
  assert.equal(fs.readFileSync(path.join(work, 'ergebnisse/a.md'), 'utf8'), '# Hallo');
  assert.equal(end.text, 'Fertig.');
  assert.deepEqual([end.usage.input, end.usage.cacheRead, end.usage.output], [1200, 800, 200]);
  assert.ok(Math.abs(end.costUsd - (1200 * 10 + 800 * 1 + 200 * 100) / 1e6) < 1e-12);
  assert.equal(end.costSource, 'berechnet');
  assert.equal(requests[0].auth, 'Bearer geheim-1234');
  assert.equal(requests[0].body.model, 'modell-a');
  const init = events.find((e) => e.type === 'init') as Extract<ProviderEvent, { type: 'init' }>;
  assert.ok(!init.tools.some((t) => /bash|shell|exec/i.test(t)), 'Kein Befehlswerkzeug');
  assert.ok(events.some((e) => e.type === 'state' && e.kind === 'writing'), 'Die Figur zeigt den echten Zustand');
  assert.ok(!fs.readFileSync(path.join(work, '..', 'lauf.jsonl'), 'utf8').includes('geheim'), 'Der Schlüssel steht in keinem Protokoll');
});

test('Grenzen: nichts ausserhalb, auch nicht über Links, und Nur-Lesen gilt', async () => {
  const { work, data } = await setup();
  fs.writeFileSync(path.join(data, 'geheim.txt'), 'x');
  fs.symlinkSync(data, path.join(work, 'link'));
  const space = new Workspace(work, [], false);
  assert.throws(() => space.run('read_file', { path: '../geheim.txt' }), Denied);
  assert.throws(() => space.run('read_file', { path: '/etc/passwd' }), Denied);
  assert.throws(() => space.run('read_file', { path: 'link/geheim.txt' }), Denied);
  assert.throws(() => space.run('write_file', { path: 'link/neu/b.txt', content: 'x' }), Denied);
  assert.throws(() => space.run('run_shell', { command: 'ls' }), Denied);
  assert.equal(fs.existsSync(path.join(data, 'neu')), false);
  assert.throws(() => new Workspace(work, [], true).run('write_file', { path: 'a.txt', content: 'x' }), Denied);
  space.run('write_file', { path: 'a.txt', content: 'eins zwei' });
  space.run('edit_file', { path: 'a.txt', old: 'zwei', new: 'drei' });
  assert.equal(space.run('read_file', { path: 'a.txt' }), 'eins drei');
  assert.match(space.run('search_files', { query: 'drei' }), /a\.txt:1/);
  assert.throws(() => space.run('edit_file', { path: 'a.txt', old: 'fehlt', new: 'x' }), /genau einmal/);
});

test('Das Limit stoppt, und ein abgewiesener Pfad zählt', async () => {
  const { settings, work, modelId } = await setup();
  requests = [];
  script = [reply({ content: null, tool_calls: [call('read_file', { path: '/etc/passwd' })] }), reply({ content: 'Weiter' })];
  const { end } = await runIt(settings, { cwd: work, model: modelId, limitUsd: 0.00001 });
  assert.equal(end.status, 'limit');
  assert.equal(requests.length, 1, 'Nach dem Limit geht keine Anfrage mehr raus');
  assert.equal(end.denied, 1);
  assert.ok(requests[0].body.max_tokens <= 16);
});

test('Strukturierte Antwort, Fehler des Anbieters, Fortsetzung der Sitzung', async () => {
  const { settings, work, modelId } = await setup();
  const schema = { type: 'object', properties: { ziel: { type: 'string' } } };
  script = [reply({ content: 'Moment' }), reply({ content: null, tool_calls: [call('antwort_abgeben', { ziel: 'Z' })] })];
  const first = await runIt(settings, { cwd: work, model: modelId, jsonSchema: schema });
  assert.deepEqual(first.end.structured, { ziel: 'Z' });

  script = ['kaputt'];
  const broken = await runIt(settings, { cwd: work, model: modelId, sessionId: 'andere' });
  assert.equal(broken.end.status, 'error');
  assert.match(broken.end.error ?? '', /500.*Überlastet/);

  requests = [];
  script = [reply({ content: 'Weiter' })];
  await runIt(settings, { cwd: work, model: modelId, resume: true });
  assert.ok(requests[0].body.messages.some((m: { content: string }) => m.content === 'Moment'), 'Das Gedächtnis kommt mit');
  const missing = await runIt(settings, { cwd: work, model: 'cweg:modell' });
  assert.match(missing.end.error ?? '', /nicht mehr verbunden/);
});

test('Einstellungen: Schlüssel bleibt verborgen, Datei nur für den Benutzer, Prüfungen greifen', async () => {
  const { settings, data, view, modelId } = await setup();
  assert.equal(view.keyEnd, '1234');
  assert.ok(!JSON.stringify(settings.views()).includes('geheim'), 'Die Oberfläche sieht den Schlüssel nicht');
  const file = path.join(data, 'verbindungen.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(modelById(modelId)?.label, 'modell-a');
  assert.equal(modelById(modelId)?.price.output, 100);

  await assert.rejects(settings.addConnection({ kind: 'custom', baseUrl: 'http://example.com/v1', apiKey: 'x' }), /https/);
  await assert.rejects(settings.addConnection({ kind: 'custom', baseUrl: base, apiKey: 'falsch' }), /abgelehnt/);
  await assert.rejects(settings.addConnection({ kind: 'openai' }), /API-Schlüssel/);
  await assert.rejects(settings.addConnection({ kind: 'gibtsnicht' }), SettingsError);
  assert.throws(() => settings.addModel(view.id, { remote: 'x', input: 0, output: 0 }), /Preise/);

  const reloaded = new Settings(data);
  assert.equal(reloaded.resolve(modelId)?.apiKey, 'geheim-1234', 'Die Verbindung übersteht den Neustart');
  reloaded.removeConnection(view.id);
  assert.equal(modelById(modelId), undefined);
  assert.equal(MODELS.filter((m) => m.providerId === 'anthropic').length, 4, 'Die Anthropic-Modelle bleiben');
});
