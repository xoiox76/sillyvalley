// Ein Team aus verschiedenen Anbietern: Eine Person arbeitet über die API, die andere über die Anthropic-CLI (hier die Test-Attrappe).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Engine } from '../server/engine.ts';
import { FxSource } from '../server/fx.ts';
import { createAnthropicProvider } from '../server/providers/anthropic.ts';
import { createCompatibleProvider, createRouter } from '../server/providers/compatible.ts';
import { Settings } from '../server/settings.ts';

const FAKE = path.join(import.meta.dirname, 'fake-agent.mjs');
const ECB = '<Cube time="2026-10-30"><Cube currency="USD" rate="1.25"/></Cube>';
const LOOK = { hair: 'kurz', hairColor: '#333333', skin: '#f2c9a0', top: '#2fa58f', bottom: '#223344', glasses: false } as never;

let dir: string;
let server: Server;
let engine: Engine;
let modelId = '';
const seen: string[] = [];

const until = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Zeitüberschreitung: ${label}`);
};

before(async () => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sv-team-')));
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
      const body = JSON.parse(raw);
      const prompt = [...body.messages].reverse().find((m: { role: string }) => m.role === 'user').content as string;
      seen.push(prompt);
      const target = prompt.match(/ergebnisse\/[\w-]+/)?.[0];
      const last = body.messages.at(-1);
      const usage = { prompt_tokens: 100, completion_tokens: 10 };
      const message = last.role === 'user' && target
        ? { content: null, tool_calls: [{ id: 't', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: `${target}/ergebnis.md`, content: '# Von der API\n' }) } }] }
        : { content: 'Fertig.' };
      res.end(JSON.stringify({ choices: [{ message }], usage }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const data = path.join(dir, 'daten');
  const settings = new Settings(data);
  const view = await settings.addConnection({ kind: 'custom', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, label: 'API' });
  settings.addModel(view.id, { remote: 'gpt-test', input: 1, cached: 1, output: 2 });
  modelId = `${view.id}:gpt-test`;
  engine = new Engine(data, createRouter(createAnthropicProvider(FAKE), [{ handles: (id) => id.includes(':'), provider: createCompatibleProvider((id) => settings.resolve(id)) }]), new FxSource(data, async () => ECB));
  engine.tourStepMs = 0;
  engine.settings = settings;
  await engine.init();
});
after(() => {
  engine.shutdown();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Beide Anbieter in einem Team und an einem Auftrag', async () => {
  const company = engine.createCompany({ name: 'Gemischt', idea: 'Idee', locationId: 'garage', budgetEur: 10 });
  company.placed.push({ id: 'platz2', kind: 'desk', i: 3, j: 3, rot: 0 });
  const api = await engine.hire(company.id, { name: 'Ada', roleId: 'text', skillIds: ['text'], modelId, look: LOOK });
  const cli = await engine.hire(company.id, { name: 'Sam', roleId: 'pruefung', skillIds: ['pruefung'], modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => api.hired && cli.hired, 'Einstellung');
  assert.notEqual(api.providerId, cli.providerId, 'Zwei verschiedene Anbieter');

  const team = engine.createTeam(company.id, { name: 'Gemischt', memberIds: [api.id, cli.id], leadId: cli.id });
  assert.deepEqual(team.memberIds, [api.id, cli.id]);

  const order = await engine.startOrder(company.id, { team: { work: api.id, plan: null, check: cli.id }, title: 'Text schreiben', criteria: ['Liegt vor'], limitEur: 1, maxRevisions: 0 });
  await until(() => order.status === 'review', 'Abnahme');
  const runs = company.runs.filter((r) => r.orderId === order.id);
  assert.deepEqual([...new Set(runs.map((r) => r.agentName))], ['Ada', 'Sam'], 'Beide haben gearbeitet');
  assert.ok(runs.find((r) => r.agentName === 'Ada')!.costEur > 0);
  assert.ok(runs.find((r) => r.agentName === 'Sam')!.costEur > 0);
  assert.ok(order.files.some((f) => f.endsWith('ergebnis.md')), 'Die Prüfung sieht die Datei der anderen Person');
  assert.ok(runs.find((r) => r.agentName === 'Sam')!.prompt.includes('ergebnis.md'));
  assert.equal(order.stages.find((s) => s.kind === 'check')!.verdict?.passed, true);
});
