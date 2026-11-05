import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Engine } from '../server/engine.ts';
import { FxSource } from '../server/fx.ts';
import { createApi, createArtifactHandler } from '../server/http.ts';
import { createAnthropicProvider } from '../server/providers/anthropic.ts';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-agent.mjs');

let dir: string;
let engine: Engine;
let game: Server;
let artifacts: Server;
let gameUrl: string;
let artifactUrl: string;
let companyId: string;

const portOf = (s: Server) => (s.address() as AddressInfo).port;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-http-'));
  engine = new Engine(dir, createAnthropicProvider(FAKE), new FxSource(dir, async () => "<Cube time='2026-10-30'><Cube currency='USD' rate='1.25'/></Cube>"));
  engine.tourStepMs = 0;
  await engine.init();
  const api = createApi(engine);
  game = createServer(async (req, res) => {
    if (!(await api(req, res))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => game.listen(0, '127.0.0.1', r));
  artifacts = createServer(createArtifactHandler(engine, portOf(game)));
  await new Promise<void>((r) => artifacts.listen(0, '127.0.0.1', r));
  gameUrl = `http://localhost:${portOf(game)}`;
  artifactUrl = `http://localhost:${portOf(artifacts)}`;
  companyId = engine.createCompany({ name: 'Http', idea: 'x', locationId: 'garage', budgetEur: 1 }).id;
  fs.writeFileSync(path.join(engine.workspaceOf(companyId), 'ergebnisse', 'a.html'), '<script>1</script>');
});

after(() => {
  game.closeAllConnections();
  artifacts.closeAllConnections();
  game.close();
  artifacts.close();
  engine.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (body: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }) =>
  fetch(`${gameUrl}/api/companies`, { method: 'POST', headers, body: JSON.stringify(body) });

test('Die API nimmt nur lokale, gleichursprüngliche JSON-Anfragen an', async () => {
  const valid = { name: 'Neu', idea: 'x', locationId: 'garage', budgetEur: 1 };
  assert.equal((await post(valid, { 'Content-Type': 'text/plain' })).status, 415, 'Einfache Formular-Anfragen dürfen nichts auslösen');
  assert.equal((await post(valid, { 'Content-Type': 'application/json', Origin: artifactUrl })).status, 403, 'Ein Prototyp darf die API nicht aufrufen');
  assert.equal((await post(valid, { 'Content-Type': 'application/json', Origin: gameUrl })).status, 201);
});

test('Ergebnisse laufen abgeschottet auf eigenem Ursprung', async () => {
  const res = await fetch(`${artifactUrl}/${companyId}/ergebnisse/a.html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type')!, /text\/html/);
  const csp = res.headers.get('content-security-policy')!;
  assert.match(csp, /connect-src 'none'/, 'Kein Netzzugriff');
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, new RegExp(`frame-ancestors http://localhost:${portOf(game)}`));
  assert.notEqual(new URL(artifactUrl).origin, new URL(gameUrl).origin);
});

test('Der Ergebnis-Server liefert nichts außerhalb des Arbeitsbereichs und ändert nichts', async () => {
  for (const bad of ['..%2Fcompany.json', '..%2F..%2F..%2Fetc%2Fpasswd', '%2Fetc%2Fpasswd', 'wissen/../../company.json']) {
    const res = await fetch(`${artifactUrl}/${companyId}/${bad}`);
    assert.equal(res.status, 404, bad);
  }
  assert.equal((await fetch(`${artifactUrl}/gibtsnicht/wissen/idee.md`)).status, 404);
  assert.equal((await fetch(`${artifactUrl}/${companyId}/wissen/idee.md`, { method: 'POST' })).status, 405);
});

test('Dateien aus der Spiel-API führen keinen Code aus', async () => {
  const res = await fetch(`${gameUrl}/api/companies/${companyId}/file?path=ergebnisse/a.html`);
  assert.match(res.headers.get('content-security-policy')!, /^sandbox;/);
  assert.equal((await fetch(`${gameUrl}/api/companies/${companyId}/file?path=../company.json`)).status, 404);
});

test('Rohprotokolle sind nur über gültige Lauf-Kennungen erreichbar', async () => {
  const res = await fetch(`${gameUrl}/api/companies/${companyId}/runs/..%2F..%2Fcompany/log`);
  assert.equal(res.status, 404);
});
