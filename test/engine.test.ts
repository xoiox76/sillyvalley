import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BASE_CONTEXT_TOKENS, LOCATIONS, MODELS, RULES, agentTitle, isProp, commandRisks, costFromUsage, estimateStepUsd, locationById, modelById } from '../shared/catalog.ts';
import { blockedEdges, blockedSet, checkPlacement, findPath, footprint, meetingDoor, meetingSeats, regionOf, standingTile } from '../shared/layout.ts';
import type { Look } from '../shared/types.ts';
import { Engine } from '../server/engine.ts';
import { meetingRooms } from '../shared/zones.ts';
import { FxSource, parseEcb } from '../server/fx.ts';
import { StreamInterpreter, buildArgs, createAnthropicProvider } from '../server/providers/anthropic.ts';
import type { ProviderEvent } from '../server/providers/types.ts';
import { parseCommandRequest, parseHandover, parseNotes } from '../server/commands.ts';
import { boardNotes, noteTaker } from '../shared/board.ts';
import { html } from '../client/ui/html.ts';
import { ROLE_TEMPLATE, colorInText, parseRole, roleToMarkdown, withRoleColor } from '../shared/roleMarkdown.ts';
import { NOTE_COLORS, noteInk, noteLook, roleColor } from '../shared/board.ts';
import { baseFloorOf, buildingAt, roomOf, siteAt } from '../shared/building.ts';
import { isScrumMaster, openSprint, scrumMaster, sprintCommitted, sprintRows } from '../shared/scrum.ts';
import { parsePlanning } from '../server/prompts.ts';
import { quotaClosedUntil } from '../shared/quota.ts';
import { agentEnv } from '../server/providers/anthropic.ts';
import { roadmapRows } from '../shared/roadmap.ts';
import { listAll, resolveIn, safeResolve } from '../server/workspace.ts';
import { CITIES, PARCELS, REGION, TOWN_BLOCKED, biomeAt, cityOf, decorIn, isBlocked, parcelsIn, placesIn, settlementIn, townPath, TOWN_D, TOWN_W, firmSign, inParcel, parcelById, parcelNear, tileKind } from '../shared/town.ts';
import { DECISIONS_FILE, agentProfile, manageSchema, parseMeetingTurn, parsePlan, parseVerdict, verdictSchema } from '../server/prompts.ts';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-agent.mjs');
const LOOK: Look = { hair: 'kurz', hairColor: '#333333', top: '#2fa58f', skin: '#f3cfa9', glasses: false };
const ECB = "<Cube time='2026-10-30'><Cube currency='USD' rate='1.25'/></Cube>";

let dir: string;
let engine: Engine;

/** Die Test-Engine baut ohne Teamgrenze, damit Aufbauten schnell gehen. Die Grenzen prüft ein eigener Test. */
const makeEngine = async (data: string, free = true) => {
  const e = new Engine(data, createAnthropicProvider(FAKE), new FxSource(data, async () => ECB), 0, free);
  e.tourStepMs = 0;
  await e.init();
  return e;
};
const newCompany = (budgetEur = 10) => engine.createCompany({ name: 'Testfirma', idea: 'Eine Idee', locationId: 'garage', budgetEur });
/** Ein 4 × 4-Besprechungsraum und drei Schreibtische passen nicht in die Garage. Diese Firma zieht ins Büro. */
const bigCompany = (budgetEur = 10) => {
  const company = newCompany(budgetEur);
  const points = company.buildPoints;
  company.buildPoints = 1000;
  engine.moveCompany(company.id, 'buero');
  company.buildPoints = points;
  return company;
};
const until = async (check: () => boolean, label = 'Bedingung') => {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Zeitüberschreitung: ${label}`);
};
const hired = async (companyId: string, name = 'Mila') => {
  const agent = await engine.hire(companyId, { name, roleId: 'planung', skillIds: ['konzept'], modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => agent.hired, 'Einstellung');
  return agent;
};
const orderInput = (agentId: string, title = 'Namen finden', extra = {}) => ({
  team: { work: agentId }, title, criteria: ['Drei Namen'], limitEur: 1, maxRevisions: 1, ...extra,
});

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-test-'));
  engine = await makeEngine(dir);
});
after(() => {
  engine.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Listenpreise reproduzieren einen real gemessenen Lauf exakt', () => {
  // Echter Lauf vom 2026-11-01: total_cost_usd 0.00113272
  const cost = costFromUsage(modelById('claude-haiku-5-5')!.price, { input: 6, output: 340, cacheRead: 8052, cacheWrite5m: 0, cacheWrite1h: 4408 });
  assert.ok(Math.abs(cost - 0.00113272) < 1e-9, `berechnet ${cost}`);
});

test('EZB-Kurs wird korrekt gelesen', () => {
  assert.deepEqual(parseEcb(ECB), { eurPerUsd: 0.8, date: '2026-10-30' });
  assert.equal(parseEcb('<kaputt/>'), null);
});

test('Agenten starten mit erzwungenen Grenzen', () => {
  const args = buildArgs({ cwd: '/x', prompt: 'p', systemPrompt: 's', model: 'm', sessionId: 'u', resume: false, limitUsd: 0.5, sessionCostBefore: 0, webAccess: false, readOnly: false, jsonSchema: null, rawLogPath: '/y', timeoutMs: 1 });
  for (const flag of ['--restricted', '--strict-mcp-config', '--max-budget-usd']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Write,Edit,Glob,Grep');
  assert.ok(!args.join(' ').includes('Bash'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  const web = buildArgs({ cwd: '/x', prompt: 'p', systemPrompt: 's', model: 'm', sessionId: 'u', resume: true, limitUsd: 1, sessionCostBefore: 0.25, webAccess: true, readOnly: false, jsonSchema: null, rawLogPath: '/y', timeoutMs: 1 });
  assert.ok(web.join(' ').includes('WebSearch'));
  assert.ok(web.includes('--resume'));
  assert.equal(web[web.indexOf('--max-budget-usd') + 1], '1.250000', 'Das Limit der CLI zählt die ganze Session');
});

test('Fortgesetzte Läufe buchen nur ihren eigenen Verbrauch', () => {
  // Echte Werte vom 2026-11-02: b setzt a fort, total_cost_usd und modelUsage summieren.
  const it = new StreamInterpreter('/ws', 'claude-haiku-5-5', 0.00017158);
  const [end] = it.feed({
    type: 'result', subtype: 'success', result: 'ok', total_cost_usd: 0.00030693, num_turns: 1,
    usage: { input_tokens: 2, output_tokens: 8, cache_read_input_tokens: 3455, cache_creation_input_tokens: 483, cache_creation: { ephemeral_1h_input_tokens: 483 } },
    modelUsage: { 'claude-haiku-5-5': { inputTokens: 4, outputTokens: 15, cacheReadInputTokens: 6643 } },
  });
  assert.equal(end.type, 'end');
  if (end.type !== 'end') return;
  assert.ok(Math.abs(end.costUsd - 0.00013535) < 1e-9, `Einzelpreis ${end.costUsd}`);
  assert.equal(end.usage.input, 2);
  assert.equal(end.usage.output, 8);
  assert.equal(end.sessionCostUsd, 0.00030693);
  assert.ok(Math.abs(costFromUsage(modelById('claude-haiku-5-5')!.price, end.usage) - end.costUsd) < 1e-9);
});

test('Laufende Nachrichten werden über den empfangenen Text mitgeschätzt', () => {
  const it = new StreamInterpreter('/ws', 'claude-haiku-5-5');
  it.feed({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 2, output_tokens: 1 } } } });
  it.feed({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x'.repeat(400) } } });
  assert.equal(it.countedUsage().output, 100);
  it.feed({ type: 'stream_event', api_message_id: 'm1', event: { type: 'message_delta', usage: { output_tokens: 90 } } });
  assert.equal(it.countedUsage().output, 90, 'Sobald die CLI zählt, gilt ihre Zahl');
});

test('Ereignisse werden zu Zuständen; ein Dateiname erscheint schon beim Schreiben', () => {
  const it = new StreamInterpreter('/ws', 'claude-haiku-5-5');
  const states = (events: ProviderEvent[]) => events.filter((e) => e.type === 'state').map((e) => (e.type === 'state' ? e.kind : ''));
  assert.deepEqual(states(it.feed({ type: 'system', subtype: 'init', session_id: 's', model: 'm', mcp_servers: [] })), ['thinking']);
  assert.deepEqual(states(it.feed({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Read' } } })), ['reading']);
  assert.deepEqual(states(it.feed({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Write' } } })), ['writing']);
  const named = it.feed({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file_path":"/ws/ergebnisse/a.md","con' } } });
  const named2 = named.find((e) => e.type === 'state');
  assert.equal(named2?.type === 'state' && named2.detail, 'schreibt ergebnisse/a.md');
  assert.ok(named.some((e) => e.type === 'usage'), 'Der Wächter muss auch beim Schreiben von Dateien mitzählen');
  const denied = it.feed({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true }] } });
  assert.ok(denied.some((e) => e.type === 'activity' && e.entry.kind === 'denied'));
});

test('Ohne Abschluss bleibt der Verbrauch sichtbar', () => {
  const it = new StreamInterpreter('/ws', 'claude-haiku-5-5');
  it.feed({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 500, cache_creation: { ephemeral_1h_input_tokens: 500 } } } } });
  it.feed({ type: 'stream_event', api_message_id: 'm1', event: { type: 'message_delta', usage: { output_tokens: 40 } } });
  assert.deepEqual(it.countedUsage(), { input: 2, output: 40, cacheRead: 100, cacheWrite5m: 0, cacheWrite1h: 500 });
  assert.ok(it.countedCost() > 0);
});

test('Pfade aus dem Arbeitsbereich heraus werden abgewiesen', () => {
  const company = newCompany();
  const ws = engine.workspaceOf(company.id);
  assert.ok(safeResolve(ws, 'wissen/idee.md'));
  for (const bad of ['../company.json', '/etc/passwd', 'wissen/../../company.json', '']) assert.equal(safeResolve(ws, bad), null, bad);
  fs.symlinkSync('/etc/hosts', path.join(ws, 'dateien', 'link'));
  assert.equal(safeResolve(ws, 'dateien/link'), null);
});

test('Gründung legt einen echten Arbeitsbereich an und prüft Eingaben', () => {
  const company = newCompany();
  const ws = engine.workspaceOf(company.id);
  for (const d of ['team', 'wissen', 'dateien', 'auftraege', 'ergebnisse']) assert.ok(fs.statSync(path.join(ws, d)).isDirectory());
  assert.match(fs.readFileSync(path.join(ws, 'wissen/idee.md'), 'utf8'), /Eine Idee/);
  assert.throws(() => engine.createCompany({ name: '', idea: 'x', locationId: 'garage', budgetEur: 1 }));
  assert.throws(() => engine.createCompany({ name: 'x', idea: 'x', locationId: 'buero', budgetEur: 1 }));
  assert.throws(() => engine.createCompany({ name: 'x', idea: 'x', locationId: 'garage', budgetEur: 0 }));
});

test('Einstellen erfordert einen echten Lauf und einen freien Arbeitsplatz', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  assert.equal(agent.intro, 'Die Attrappe ist fertig.');
  assert.ok(agent.sessionStarted);
  assert.equal(company.runs[0].kind, 'interview');
  assert.ok(company.runs[0].costEur > 0);
  await assert.rejects(engine.hire(company.id, { name: 'Alex', roleId: 'text', skillIds: [], modelId: 'claude-haiku-5-5', look: LOOK }), /Kein freier Arbeitsplatz/);
});

test('Auftrag: Ergebnisdatei, Abnahme, Verbrauchsbuch', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  const order = await engine.startOrder(company.id, orderInput(agent.id));
  assert.equal(agent.live.runId, company.runs.at(-1)!.id);
  assert.ok(engine.money(company).reservedEur > 0.9, 'Limit ist reserviert');
  await until(() => order.status === 'review', 'Abnahme');
  assert.equal(agent.live.kind, 'review');
  assert.equal(order.files.length, 1);
  assert.ok(fs.existsSync(path.join(engine.workspaceOf(company.id), order.files[0])));

  const run = company.runs.at(-1)!;
  assert.equal(run.costSource, 'gemeldet');
  assert.equal(run.costEur, run.costUsd * 0.8);
  assert.ok(fs.existsSync(engine.rawLogOf(company.id, run.id)));

  engine.decide(company.id, order.id, { decision: 'accept', checked: [true] });
  assert.equal(order.status, 'accepted');
  assert.equal(agent.live.kind, 'done');
  assert.throws(() => engine.decide(company.id, order.id, { decision: 'accept' }), /schon entschieden/);

  const ledger = fs.readFileSync(path.join(dir, 'companies', company.id, 'ledger.jsonl'), 'utf8').trim().split('\n');
  assert.equal(ledger.length, 2);
  assert.equal(JSON.parse(ledger[1]).runId, run.id);
});

test('Budget und Limits sperren, statt still zu überziehen', async () => {
  const company = newCompany(0.6);
  const agent = await hired(company.id);
  await assert.rejects(engine.startOrder(company.id, orderInput(agent.id, 'Zu teuer', { limitEur: 5 })), /reicht nicht/);
  await assert.rejects(engine.startOrder(company.id, orderInput(agent.id, 'Ohne Kriterien', { criteria: [] })), /Abnahmekriterium/);
  assert.equal(company.orders.length, 0);
  assert.throws(() => engine.setBudget(company.id, 0));
  await assert.rejects(engine.startOrder(company.id, orderInput(agent.id, 'Nullimit', { limitEur: 0.00001 })), /über 0/, 'Ein auf 0 gerundetes Limit darf nicht starten');
});

test('Limits unter einem Cent bleiben erhalten', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  const order = await engine.startOrder(company.id, orderInput(agent.id, 'Winzig', { limitEur: 0.0013 }));
  assert.equal(order.limitEur, 0.0013);
  await until(() => order.status === 'review', 'Abnahme');
});

test('Limit erreicht: Zustand und Teilergebnis bleiben ehrlich', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  const order = await engine.startOrder(company.id, orderInput(agent.id, 'Grenzfall', { notes: '[szenario:limit]' }));
  await until(() => order.status === 'limit', 'Limit');
  assert.equal(agent.live.kind, 'limit');
  assert.equal(company.runs.at(-1)!.status, 'limit');
  assert.equal(order.files.length, 1, 'Was schon entstanden ist, bleibt erhalten');
});

test('Stoppen beendet den Prozess und bucht den gezählten Verbrauch', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  const order = await engine.startOrder(company.id, orderInput(agent.id, 'Hängt', { notes: '[szenario:haengt]' }));
  const run = company.runs.at(-1)!;
  await until(() => agent.live.kind === 'writing', 'Schreibzustand');
  engine.stopRun(company.id, run.id);
  await until(() => run.status === 'stopped', 'Stopp');
  assert.equal(order.status, 'stopped');
  assert.equal(run.costSource, 'berechnet');
  assert.ok(run.costEur > 0, 'Auch abgebrochene Arbeit kostet');
  assert.equal(agent.live.kind, 'idle');
});

test('Der Wächter stoppt einen Lauf mitten im Schritt, sobald das Limit erreicht ist', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  const order = await engine.startOrder(company.id, orderInput(agent.id, 'Zu lang', { notes: '[szenario:haengt]', limitEur: 0.0001 }));
  const run = company.runs.at(-1)!;
  await until(() => run.status !== 'running', 'Wächter');
  assert.equal(run.status, 'limit');
  assert.equal(order.status, 'limit');
  assert.equal(run.costSource, 'berechnet');
  assert.ok(run.costEur > 0);
});

test('Ein Absturz wird als Fehler gezeigt, nicht als Arbeit', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  const order = await engine.startOrder(company.id, orderInput(agent.id, 'Absturz', { notes: '[szenario:absturz]' }));
  await until(() => order.status === 'failed', 'Fehlerstatus');
  assert.equal(agent.live.kind, 'error');
  assert.match(company.runs.at(-1)!.error!, /Absturz/);
  assert.ok(company.notices.some((n) => n.level === 'error'));
});

test('Antwort ohne Datei wird als nutzbares Ergebnis gesichert', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  const order = await engine.startOrder(company.id, orderInput(agent.id, 'Nur Text', { notes: '[szenario:ohnedatei]' }));
  await until(() => order.status === 'review', 'Abnahme');
  assert.ok(order.savedFromText);
  assert.match(order.files[0], /antwort\.md$/);
});

test('Korrekturrunden sind begrenzt und bleiben in derselben Session', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  const order = await engine.startOrder(company.id, orderInput(agent.id));
  await until(() => order.status === 'review', 'Abnahme');
  await assert.rejects(engine.revise(company.id, order.id, { feedback: '' }), /was geändert/);
  await engine.revise(company.id, order.id, { feedback: 'Kürzer' });
  const run = company.runs.at(-1)!;
  assert.equal(run.kind, 'revision');
  assert.ok(run.resumed);
  assert.equal(run.sessionId, agent.sessionId);
  await until(() => order.status === 'review', 'zweite Abnahme');
  await assert.rejects(engine.revise(company.id, order.id, { feedback: 'Noch kürzer' }), /aufgebraucht/);
  const single = company.runs[0].costUsd;
  for (const r of company.runs) assert.ok(Math.abs(r.costUsd - single) < 1e-9, `${r.kind} kostet ${r.costUsd}, erwartet ${single}`);
  assert.ok(Math.abs(agent.sessionCostUsd - single * company.runs.length) < 1e-9, 'Session-Stand läuft mit');
});

test('Bauen kostet nichts vom KI-Budget und prüft den Platz', () => {
  const company = newCompany();
  const money = engine.money(company).remainingEur;
  engine.placeItem(company.id, { kind: 'plant', i: 6, j: 3, rot: 0 });
  assert.equal(engine.money(company).remainingEur, money);
  assert.throws(() => engine.placeItem(company.id, { kind: 'plant', i: 6, j: 3, rot: 0 }), /belegt/);
  assert.throws(() => engine.placeItem(company.id, { kind: 'plant', i: 99, j: 0, rot: 0 }), /passt nicht/);
  assert.throws(() => engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 }), /belegt/);
});

test('Umzug nimmt Möbel mit', () => {
  const company = newCompany();
  company.buildPoints = 200;
  const desks = company.placed.filter((p) => !isProp(p.kind)).length;
  engine.moveCompany(company.id, 'buero');
  assert.equal(company.locationId, 'buero');
  assert.equal(company.placed.filter((p) => !isProp(p.kind)).length, desks);
  assert.deepEqual(company.town.rented, ['postamt']);
  engine.moveCompany(company.id, 'garage');
  assert.equal(company.locationId, 'garage', 'Nach Hause kommt man immer zurück, kostenlos');
  engine.moveCompany(company.id, 'buero');
});

/* ---------- Mehrere Agenten an einem Auftrag ---------- */

/** Ein Schreibtisch auf dem gewünschten Platz, sonst auf dem nächsten freien. */
const addDeskWith = (game: Engine, companyId: string, i: number, j: number) => {
  const c = game.snapshot(companyId).company;
  c.buildPoints += 40;
  try {
    game.placeItem(companyId, { kind: 'desk', i, j, rot: 0 });
    return;
  } catch {
    // Der Platz ist belegt, es wird gesucht.
  }
  for (let a = 0; a < 12; a++) for (let b = 0; b < 10; b++) {
    try {
      game.placeItem(companyId, { kind: 'desk', i: a, j: b, rot: 0 });
      return;
    } catch {
      // Nicht hier.
    }
  }
  throw new Error('Kein Platz für einen Schreibtisch');
};
const addDesk = (companyId: string, i: number, j: number) => addDeskWith(engine, companyId, i, j);

const trio = async (companyId: string) => {
  addDesk(companyId, 4, 1);
  addDesk(companyId, 4, 3);
  const planner = await hired(companyId, 'Mila');
  const worker = await hired(companyId, 'Alex');
  const checker = await hired(companyId, 'Robin');
  return { planner, worker, checker };
};
const chain = (t: Awaited<ReturnType<typeof trio>>, extra = {}) => ({
  team: { plan: t.planner.id, work: t.worker.id, check: t.checker.id }, title: 'Vereins-App', criteria: ['Eins', 'Zwei'], limitEur: 1, maxRevisions: 2, ...extra,
});

test('Eine Kette durchläuft alle Stufen, jeder Agent in der eigenen Session', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  const order = await engine.startOrder(company.id, chain(t));
  await until(() => order.status === 'review', 'Abnahme');
  const runs = company.runs.filter((r) => r.orderId === order.id);
  assert.deepEqual(runs.map((r) => r.stageKind), ['plan', 'work', 'check']);
  assert.deepEqual(runs.map((r) => r.agentName), ['Mila', 'Alex', 'Robin']);
  assert.deepEqual(runs.map((r) => r.sessionId), [t.planner.sessionId, t.worker.sessionId, t.checker.sessionId]);
  assert.equal(new Set(runs.map((r) => r.sessionId)).size, 3);
  assert.ok(order.stages.every((s) => s.status === 'done'));
  assert.equal(order.stages[2].verdict?.passed, true);
  assert.equal(order.agentId, t.checker.id, 'Die letzte Stufe meldet sich beim Menschen');
  assert.equal(t.checker.live.kind, 'review');
  const report = fs.readFileSync(path.join(engine.workspaceOf(company.id), order.stages[2].verdict!.file), 'utf8');
  assert.match(report, /Geprüft von Robin/);
});

test('Die Prüfung kann technisch nichts ändern und liefert ein strukturiertes Urteil', () => {
  const args = buildArgs({ cwd: '/x', prompt: 'p', systemPrompt: 's', model: 'm', sessionId: 'u', resume: false, limitUsd: 1, sessionCostBefore: 0, webAccess: false, readOnly: true, jsonSchema: { type: 'object' }, rawLogPath: '/y', timeoutMs: 1 });
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep');
  assert.ok(args.includes('--json-schema'));
  const it = new StreamInterpreter('/ws', 'claude-haiku-5-5');
  const [end] = it.feed({ type: 'result', subtype: 'success', result: '{}', structured_output: { bestanden: true }, usage: {}, total_cost_usd: 0.1 });
  assert.equal(end.type === 'end' && (end.structured as { bestanden: boolean }).bestanden, true);
});

test('Prüfung im Lauf: Ein Prüflauf bekommt nur Lesewerkzeuge', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  const order = await engine.startOrder(company.id, chain(t));
  await until(() => order.status === 'review', 'Abnahme');
  const log = fs.readFileSync(engine.rawLogOf(company.id, company.runs.at(-1)!.id), 'utf8');
  assert.ok(log.length > 0);
  // Die Attrappe schreibt nur mit Write-Werkzeug. Der Prüflauf darf also keine Datei angelegt haben.
  assert.deepEqual(order.stages[2].files, [order.stages[2].verdict!.file]);
});

test('Wer arbeitet, prüft sich nicht selbst', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  await assert.rejects(engine.startOrder(company.id, chain(t, { team: { work: t.worker.id, check: t.worker.id } })), /nicht prüfen/);
  assert.equal(company.orders.length, 0);
});

test('Nicht bestanden: Rückweg an die Arbeit, danach erneute Prüfung', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  const order = await engine.startOrder(company.id, chain(t, { notes: '[szenario:urteileinmalnein]' }));
  await until(() => order.status === 'review', 'Abnahme');
  const runs = company.runs.filter((r) => r.orderId === order.id);
  assert.deepEqual(runs.map((r) => r.stageKind), ['plan', 'work', 'check', 'work', 'check']);
  assert.equal(runs[3].kind, 'revision');
  assert.ok(runs[3].resumed);
  assert.match(runs[3].prompt, /Das Kriterium fehlt noch/, 'Die Mängel erreichen den Bearbeiter');
  assert.equal(order.revisionsUsed, 1);
  assert.equal(order.stages[2].verdict?.passed, true);
  assert.equal(order.stages[2].checks, 2);
  assert.ok(order.files.some((f) => f.endsWith('pruefung-1.md')) && order.files.some((f) => f.endsWith('pruefung-2.md')), 'Beide Berichte bleiben erhalten');
});

test('Korrekturrunden aufgebraucht: Die Entscheidung liegt beim Menschen', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  const order = await engine.startOrder(company.id, chain(t, { notes: '[szenario:urteilnein]', maxRevisions: 1 }));
  await until(() => order.status === 'review', 'Abnahme');
  assert.equal(order.revisionsUsed, 1);
  assert.equal(order.stages[2].verdict?.passed, false);
  assert.equal(company.runs.filter((r) => r.orderId === order.id).length, 5);
  engine.decide(company.id, order.id, { decision: 'accept', checked: [true, true] });
  assert.equal(order.status, 'accepted', 'Der Mensch darf trotz Prüfung anders entscheiden');
});

test('Ein unbrauchbares Urteil gilt nie als bestanden', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  const order = await engine.startOrder(company.id, chain(t, { notes: '[szenario:urteilkaputt]' }));
  await until(() => order.status === 'failed', 'Fehlerstatus');
  assert.equal(order.stages[2].status, 'failed');
  assert.equal(t.checker.live.kind, 'error');
  assert.match(company.runs.at(-1)!.error!, /kein auswertbares Urteil/);
});

test('Das Urteil wird nicht blind geglaubt', () => {
  const order = { criteria: [{ text: 'A', checked: false }, { text: 'B', checked: false }] } as never;
  const yesButNo = parseVerdict(order, { bestanden: true, kriterien: [{ erfuellt: true, begruendung: 'x' }, { erfuellt: false, begruendung: 'fehlt' }], maengel: [], zusammenfassung: '' }, 1, 'f');
  assert.equal(yesButNo?.passed, false, 'Bestanden trotz nicht erfülltem Kriterium zählt nicht');
  assert.deepEqual(yesButNo?.defects, ['B: fehlt'], 'Ohne genannte Mängel zählen die offenen Kriterien');
  const tooShort = parseVerdict(order, { bestanden: true, kriterien: [{ erfuellt: true, begruendung: 'x' }] }, 1, 'f');
  assert.equal(tooShort?.passed, false, 'Ein nicht bewertetes Kriterium ist nicht erfüllt');
  const empty = parseVerdict(order, { bestanden: false, kriterien: [{ erfuellt: true, begruendung: 'x' }, { erfuellt: true, begruendung: 'y' }], maengel: [] }, 1, 'f');
  assert.ok(empty?.defects.length, 'Ein Rückweg braucht immer einen Inhalt');
  assert.equal(parseVerdict(order, null, 1, 'f'), null);
  assert.equal((verdictSchema(order) as { properties: { kriterien: { minItems: number } } }).properties.kriterien.minItems, 2);
});

test('Korrektur des Menschen läuft durch die Prüfung und zählt eine Runde', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  const order = await engine.startOrder(company.id, chain(t));
  await until(() => order.status === 'review', 'Abnahme');
  await engine.revise(company.id, order.id, { feedback: 'Kürzer bitte' });
  await until(() => order.status === 'review', 'zweite Abnahme');
  const runs = company.runs.filter((r) => r.orderId === order.id);
  assert.deepEqual(runs.map((r) => r.stageKind), ['plan', 'work', 'check', 'work', 'check']);
  assert.match(runs[3].prompt, /Kürzer bitte/);
  assert.equal(order.revisionsUsed, 1);
});

test('Das ganze Restlimit bleibt reserviert, auch zwischen zwei Stufen', async () => {
  const company = newCompany(2);
  const t = await trio(company.id);
  const order = await engine.startOrder(company.id, chain(t, { notes: '[szenario:haengt]', limitEur: 1 }));
  await until(() => t.planner.live.kind === 'writing', 'Planung läuft');
  const { reservedEur } = engine.money(company);
  assert.ok(reservedEur > 0.9, `reserviert ${reservedEur}`);
  await assert.rejects(engine.startOrder(company.id, chain(t, { limitEur: 1.5 })), /reicht nicht/);
  engine.stopOrder(company.id, order.id);
  await until(() => order.status === 'stopped', 'Stopp');
  assert.equal(engine.money(company).reservedEur, 0);
});

test('Eine frühe Stufe darf nur die Hälfte des Restlimits nutzen, die letzte den Rest', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  const order = await engine.startOrder(company.id, chain(t, { limitEur: 1 }));
  await until(() => order.status === 'review', 'Abnahme');
  const runs = company.runs.filter((r) => r.orderId === order.id);
  assert.ok(Math.abs(runs[0].limitEur - 0.5) < 1e-9, `Planung ${runs[0].limitEur}`);
  assert.ok(Math.abs(runs[1].limitEur - (1 - runs[0].costEur) / 2) < 1e-9, `Arbeit ${runs[1].limitEur}`);
  assert.ok(Math.abs(runs[2].limitEur - (1 - runs[0].costEur - runs[1].costEur)) < 1e-9, `Prüfung ${runs[2].limitEur}`);
});

test('Ist jemand beschäftigt, wartet die Stufe und startet danach von selbst', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  const blocker = await engine.startOrder(company.id, orderInput(t.worker.id, 'Blockiert Alex', { notes: '[szenario:haengt]' }));
  await until(() => t.worker.live.kind === 'writing', 'Alex arbeitet');
  const order = await engine.startOrder(company.id, chain(t));
  await until(() => order.stageIndex === 1, 'Planung fertig');
  assert.equal(order.stages[1].status, 'waiting', 'Die Arbeitsstufe wartet auf Alex');
  assert.equal(t.worker.live.kind, 'writing', 'Alex zeigt weiter seine tatsächliche Arbeit');
  engine.stopOrder(company.id, blocker.id);
  await until(() => order.status === 'review', 'Abnahme');
});

test('Stoppen wirkt auch auf eine wartende Stufe', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  const blocker = await engine.startOrder(company.id, orderInput(t.planner.id, 'Blockiert Mila', { notes: '[szenario:haengt]' }));
  await until(() => t.planner.live.kind === 'writing', 'Mila arbeitet');
  const order = await engine.startOrder(company.id, chain(t));
  assert.equal(order.stages[0].status, 'waiting');
  engine.stopOrder(company.id, order.id);
  assert.equal(order.status, 'stopped');
  engine.stopOrder(company.id, blocker.id);
  await until(() => blocker.status === 'stopped', 'Stopp');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(company.runs.filter((r) => r.orderId === order.id).length, 0, 'Ein angehaltener Auftrag startet nicht von selbst');
  await engine.revise(company.id, order.id, {});
  await until(() => order.status === 'review', 'Weitermachen');
});

test('Eine Abnahme verändert nicht den Zustand eines arbeitenden Agenten', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  const first = await engine.startOrder(company.id, orderInput(agent.id, 'Erster'));
  await until(() => first.status === 'review', 'Abnahme');
  const second = await engine.startOrder(company.id, orderInput(agent.id, 'Zweiter', { notes: '[szenario:haengt]' }));
  await until(() => agent.live.kind === 'writing', 'Arbeitet');
  engine.decide(company.id, first.id, { decision: 'accept', checked: [true] });
  assert.equal(agent.live.kind, 'writing', 'Die Figur darf nicht fälschlich Fertig zeigen');
  engine.stopOrder(company.id, second.id);
  await until(() => second.status === 'stopped', 'Stopp');
});

test('Die Übergabe wird angezeigt und endet von selbst', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  const order = await engine.startOrder(company.id, chain(t, { notes: '[szenario:urteilnein]', maxRevisions: 0 }));
  await until(() => t.planner.live.kind === 'handoff', 'Übergabe');
  assert.equal(t.planner.live.targetId, t.worker.id);
  assert.match(t.planner.live.detail, /bringt den Plan zu Alex/);
  await until(() => order.status === 'review', 'Abnahme');
});

test('Aufträge aus Meilenstein 1 werden beim Laden zu einstufigen Aufträgen', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-migration-'));
  const first = await makeEngine(data);
  const company = first.createCompany({ name: 'Alt', idea: 'x', locationId: 'garage', budgetEur: 5 });
  const agent = await first.hire(company.id, { name: 'Mila', roleId: 'planung', skillIds: [], modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => agent.hired, 'Einstellung');
  const order = await first.startOrder(company.id, orderInput(agent.id));
  await until(() => order.status === 'review', 'Abnahme');
  first.shutdown();

  const file = path.join(data, 'companies', company.id, 'company.json');
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete old.orders[0].stages;
  delete old.orders[0].stageIndex;
  fs.writeFileSync(file, JSON.stringify(old));

  const second = await makeEngine(data);
  const restored = second.snapshot(company.id).company.orders[0];
  assert.equal(restored.stages.length, 1);
  assert.equal(restored.stages[0].kind, 'work');
  assert.equal(restored.stages[0].status, 'done');
  assert.equal(restored.status, 'review');
  second.decide(company.id, restored.id, { decision: 'accept', checked: [true] });
  assert.equal(restored.status, 'accepted');
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

test('Nach einem Neustart startet ein Auftrag zwischen zwei Stufen nicht von selbst weiter', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-pause-'));
  const first = await makeEngine(data);
  const company = first.createCompany({ name: 'Pause', idea: 'x', locationId: 'garage', budgetEur: 5 });
  const agent = await first.hire(company.id, { name: 'Mila', roleId: 'planung', skillIds: [], modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => agent.hired, 'Einstellung');
  const order = await first.startOrder(company.id, orderInput(agent.id));
  await until(() => order.status === 'review', 'Abnahme');
  first.shutdown();

  const file = path.join(data, 'companies', company.id, 'company.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.orders[0].status = 'running';
  saved.orders[0].stages[0].status = 'waiting';
  fs.writeFileSync(file, JSON.stringify(saved));

  const second = await makeEngine(data);
  const restored = second.snapshot(company.id).company;
  assert.equal(restored.orders[0].status, 'stopped');
  assert.equal(restored.runs.length, 2, 'Kein neuer Lauf ohne den Menschen');
  assert.ok(restored.notices.some((n) => /Neustart angehalten/.test(n.text)));
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

test('Ein Stopp gilt auch, wenn der Lauf im selben Moment fertig wird', async () => {
  const company = newCompany();
  const t = await trio(company.id);
  const order = await engine.startOrder(company.id, chain(t, { notes: '[szenario:stoppzuspaet]' }));
  await until(() => company.runs.at(-1)?.orderId === order.id && Boolean(engine.snapshot(company.id).company.runs.at(-1)?.startedAt), 'Lauf gestartet');
  engine.stopOrder(company.id, order.id);
  await until(() => order.status !== 'running', 'Stopp');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(order.status, 'stopped', 'Der Stopp darf nicht vom Abschluss überholt werden');
  assert.equal(company.runs.filter((r) => r.orderId === order.id).length, 1, 'Keine neue Stufe nach dem Stopp');
  await engine.revise(company.id, order.id, {});
  await until(() => order.status === 'review', 'Weitermachen');
});

/* ---------- Der Besprechungsraum ---------- */

const garage = locationById('garage');
const room = { id: 'r', kind: 'meeting' as const, i: 2, j: 2, rot: 0 as const };

test('Glaswände sperren den Weg, nur die Tür führt hinein', () => {
  const blocked = blockedSet(garage, [room]);
  const edges = blockedEdges([room]);
  const seat = meetingSeats(room)[0].tile;
  const door = meetingDoor(room);
  const path = findPath(garage, blocked, { i: 0, j: 0 }, seat, edges);
  assert.ok(path.length > 0, 'Es gibt einen Weg');
  const steps = [{ i: 0, j: 0 }, ...path];
  const crossings = steps.slice(1).filter((t, n) => {
    const inside = (p: { i: number; j: number }) => p.i >= 2 && p.i <= 5 && p.j >= 2 && p.j <= 5;
    return inside(t) !== inside(steps[n]);
  });
  assert.equal(crossings.length, 1, 'Der Weg kreuzt die Wand genau einmal');
  assert.deepEqual(crossings[0], door.inside, 'und zwar an der Tür');
  assert.ok(!blocked.has(`${seat.i},${seat.j}`));
  assert.ok(blocked.has('3,3'), 'Der Tisch steht im Weg');
});

test('Der Raum passt nur, wenn die Tür erreichbar bleibt', () => {
  assert.ok(checkPlacement(garage, [], { kind: 'meeting', i: 2, j: 2, rot: 0 }).ok);
  assert.match(checkPlacement(garage, [], { kind: 'meeting', i: 4, j: 2, rot: 0 }).reason, /Tür/, 'Die Tür zeigt auf die Wand');
  assert.ok(checkPlacement(garage, [], { kind: 'meeting', i: 4, j: 2, rot: 2 }).ok, 'Gedreht geht es');
  assert.ok(!checkPlacement(garage, [], { kind: 'meeting', i: 5, j: 2, rot: 2 }).ok, 'Außerhalb des Raums');
});

test('Der Platz an der Tür wird zuletzt besetzt', () => {
  for (const rot of [0, 1, 2, 3] as const) {
    const seats = meetingSeats({ i: 2, j: 2, rot });
    const door = meetingDoor({ i: 2, j: 2, rot }).inside;
    assert.deepEqual(seats[3].tile, door, `Drehung ${rot}`);
  }
});

/* ---------- Besprechungen ---------- */

/** Den Besprechungsraum dort hinstellen, wo gerade Platz ist. Die Agenten bekommen ihre Schreibtische selbst. */
const placeRoomWith = (game: Engine, companyId: string) => {
  for (let i = 0; i < 12; i++) for (let j = 0; j < 10; j++) for (const rot of [0, 1, 2, 3] as const) {
    try {
      return game.placeItem(companyId, { kind: 'meeting', i, j, rot });
    } catch {
      // Dieser Platz passt nicht, der nächste.
    }
  }
  throw new Error('Kein Platz für den Besprechungsraum');
};
const placeRoom = (companyId: string) => placeRoomWith(engine, companyId);

const withRoom = (companyId: string) => {
  const c = engine.snapshot(companyId).company;
  c.buildPoints += 80;
  return placeRoom(companyId);
};
const meetingOf = (t: Awaited<ReturnType<typeof trio>>, extra = {}) => ({
  topic: 'Was bauen wir zuerst?', participantIds: [t.planner.id, t.worker.id, t.checker.id], moderatorId: t.planner.id, maxRounds: 2, limitEur: 1, ...extra,
});
const meetingCompany = async () => {
  const company = bigCompany();
  // Der Raum kommt vor den Agenten, sonst nehmen deren Schreibtische den Platz weg.
  withRoom(company.id);
  const t = await trio(company.id);
  return { company, t };
};

test('Eine Besprechung braucht Raum, Leute und Moderation', async () => {
  const bare = newCompany();
  const tb = await trio(bare.id);
  await assert.rejects(engine.startMeeting(bare.id, meetingOf(tb)), /Besprechungsraum/);

  const company = bigCompany();
  withRoom(company.id);
  const t = await trio(company.id);
  await assert.rejects(engine.startMeeting(company.id, meetingOf(t, { participantIds: [t.worker.id], moderatorId: t.worker.id })), /mindestens zwei/);
  await assert.rejects(engine.startMeeting(company.id, meetingOf(t, { participantIds: [t.worker.id, t.checker.id] })), /Moderation/);
  await assert.rejects(engine.startMeeting(company.id, meetingOf(t, { topic: ' ' })), /Worum/);
  await assert.rejects(engine.startMeeting(company.id, meetingOf(t, { limitEur: 500 })), /reicht nicht/);
  assert.equal(company.meetings.length, 0);
});

test('Alle sprechen nacheinander, die Moderation zuletzt, und niemand kann schreiben', async () => {
  const { company, t } = await meetingCompany();
  const meeting = await engine.startMeeting(company.id, meetingOf(t));
  await until(() => meeting.status === 'decision', 'Vorschlag');
  const runs = company.runs.filter((r) => r.meetingId === meeting.id);
  assert.deepEqual(runs.map((r) => r.agentName), ['Alex', 'Robin', 'Mila']);
  assert.deepEqual(runs.map((r) => r.sessionId), [t.worker.sessionId, t.checker.sessionId, t.planner.sessionId], 'Jeder in der eigenen Session');
  assert.ok(runs.every((r) => r.kind === 'meeting'));
  assert.ok(meeting.turns.every((turn) => turn.text && turn.short));
  assert.equal(meeting.outcome?.proposal, 'Wir bauen zuerst die Helferliste.');
  assert.equal(meeting.round, 1, 'Einigkeit beendet die Besprechung früh');
  assert.ok(runs.every((r) => r.files.every((f) => f.startsWith('besprechungen/'))), 'Niemand hat etwas außerhalb geschrieben');
  assert.equal(t.planner.live.kind, 'review', 'Die Moderation wartet auf den Menschen');
  assert.equal(t.worker.live.kind, 'idle');
});

test('Wer spricht, sieht die Beiträge der anderen', async () => {
  const { company, t } = await meetingCompany();
  const meeting = await engine.startMeeting(company.id, meetingOf(t));
  await until(() => meeting.status === 'decision', 'Vorschlag');
  const runs = company.runs.filter((r) => r.meetingId === meeting.id);
  assert.match(runs[0].prompt, /Du beginnst/);
  assert.ok(runs[1].prompt.includes(meeting.turns[0].text), 'Der Zweite sieht den Ersten');
  assert.ok(runs[2].prompt.includes(meeting.turns[1].text), 'Die Moderation sieht alle');
});

test('Ohne Einigung folgt eine weitere Runde, die letzte erzwingt einen Vorschlag', async () => {
  const { company, t } = await meetingCompany();
  const meeting = await engine.startMeeting(company.id, meetingOf(t, { notes: '[szenario:uneinig]', maxRounds: 2 }));
  await until(() => meeting.status === 'decision', 'Vorschlag');
  assert.equal(meeting.turns.length, 6, 'Zwei volle Runden');
  assert.deepEqual([...new Set(meeting.turns.map((turn) => turn.round))], [1, 2]);
  assert.equal(meeting.outcome?.agreed, false);
  assert.ok(meeting.outcome?.proposal, 'Auch ohne Einigung gibt es einen Vorschlag');
  const protocol = fs.readFileSync(path.join(engine.workspaceOf(company.id), meeting.protocolFile), 'utf8');
  assert.match(protocol, /## Runde 2/);
  assert.match(protocol, /ohne Einigung/);
  for (const turn of meeting.turns) assert.ok(protocol.includes(turn.text), 'Jeder Beitrag steht im Protokoll');
});

test('Das Limit verteilt sich gleichmäßig, und alles bleibt reserviert', async () => {
  const { company, t } = await meetingCompany();
  const meeting = await engine.startMeeting(company.id, meetingOf(t, { notes: '[szenario:uneinig]', maxRounds: 2, limitEur: 0.6 }));
  assert.ok(engine.money(company).reservedEur > 0.59, 'Das ganze Limit ist reserviert');
  await until(() => meeting.status === 'decision', 'Vorschlag');
  const runs = company.runs.filter((r) => r.meetingId === meeting.id);
  assert.ok(Math.abs(runs[0].limitEur - 0.1) < 1e-9, `Erster Beitrag ${runs[0].limitEur}`);
  assert.ok(runs[5].limitEur > 0.5, 'Der Rest bleibt für den letzten Beitrag');
  assert.equal(engine.money(company).reservedEur, 0, 'Nach dem Ende ist nichts mehr reserviert');
});

test('Ein Beschluss wird Firmenwissen und erreicht spätere Aufträge', async () => {
  const { company, t } = await meetingCompany();
  const file = path.join(engine.workspaceOf(company.id), DECISIONS_FILE);
  const meeting = await engine.startMeeting(company.id, meetingOf(t));
  await until(() => meeting.status === 'decision', 'Vorschlag');
  assert.ok(!fs.existsSync(file), 'Ohne Entscheidung des Menschen wird nichts Firmenwissen');
  engine.decideMeeting(company.id, meeting.id, { decision: 'accept' });
  assert.equal(meeting.status, 'closed');
  assert.equal(meeting.decision, 'accepted');
  const saved = fs.readFileSync(file, 'utf8');
  assert.match(saved, /Wir bauen zuerst die Helferliste/);
  assert.match(saved, /Helferliste bauen/);
  assert.equal(t.planner.live.kind, 'idle');
  assert.throws(() => engine.decideMeeting(company.id, meeting.id, { decision: 'accept' }), /schon entschieden/);
  const order = await engine.startOrder(company.id, orderInput(t.worker.id));
  await until(() => order.status === 'review', 'Abnahme');
  assert.match(company.runs.at(-1)!.prompt, /wissen\/beschluesse\.md/, 'Spätere Aufträge kennen den Beschluss');
});

test('Verwerfen hinterlässt nichts im Firmenwissen', async () => {
  const { company, t } = await meetingCompany();
  const meeting = await engine.startMeeting(company.id, meetingOf(t));
  await until(() => meeting.status === 'decision', 'Vorschlag');
  engine.decideMeeting(company.id, meeting.id, { decision: 'reject' });
  assert.equal(meeting.decision, 'rejected');
  assert.ok(!fs.existsSync(path.join(engine.workspaceOf(company.id), DECISIONS_FILE)));
  const protocol = fs.readFileSync(path.join(engine.workspaceOf(company.id), meeting.protocolFile), 'utf8');
  assert.match(protocol, /Verworfen/);
});

test('Nach dem Vorschlag lässt sich eine weitere Runde anhängen', async () => {
  const { company, t } = await meetingCompany();
  const meeting = await engine.startMeeting(company.id, meetingOf(t, { maxRounds: 1 }));
  await until(() => meeting.status === 'decision', 'Vorschlag');
  await assert.rejects(engine.resumeMeeting(company.id, meeting.id, {}), /weitere Runde/);
  await engine.resumeMeeting(company.id, meeting.id, { addRound: true });
  assert.equal(meeting.outcome, null);
  await until(() => meeting.status === 'decision', 'zweiter Vorschlag');
  assert.equal(meeting.turns.length, 6);
  assert.equal(meeting.maxRounds, 2);
});

test('Stoppen hält eine Besprechung an, und sie lässt sich fortsetzen', async () => {
  const { company, t } = await meetingCompany();
  const meeting = await engine.startMeeting(company.id, meetingOf(t, { notes: '[szenario:haengt]' }));
  const run = company.runs.at(-1)!;
  await until(() => t.worker.live.kind === 'writing', 'Beitrag läuft');
  engine.stopMeeting(company.id, meeting.id);
  await until(() => meeting.status === 'stopped', 'Stopp');
  assert.equal(run.status, 'stopped');
  assert.equal(run.costSource, 'berechnet');
  assert.ok(run.costEur > 0, 'Auch ein abgebrochener Beitrag kostet');
  assert.equal(t.worker.live.kind, 'idle');
  assert.equal(engine.money(company).reservedEur, 0);
  meeting.notes = '';
  await engine.resumeMeeting(company.id, meeting.id, {});
  await until(() => meeting.status === 'decision', 'Vorschlag');
  assert.equal(meeting.turns.length, 3);
});

test('Ein Stopp gilt auch, wenn der Beitrag im selben Moment fertig wird', async () => {
  const { company, t } = await meetingCompany();
  const meeting = await engine.startMeeting(company.id, meetingOf(t, { notes: '[szenario:stoppzuspaet]' }));
  await until(() => company.runs.some((r) => r.meetingId === meeting.id), 'Beitrag läuft');
  engine.stopMeeting(company.id, meeting.id);
  await until(() => meeting.status !== 'running', 'Stopp');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(meeting.status, 'stopped');
  assert.equal(company.runs.filter((r) => r.meetingId === meeting.id).length, 1, 'Kein weiterer Beitrag nach dem Stopp');
});

test('Das Limit hält eine Besprechung an, mehr Budget setzt sie fort', async () => {
  const { company, t } = await meetingCompany();
  const meeting = await engine.startMeeting(company.id, meetingOf(t, { notes: '[szenario:haengt]', limitEur: 0.0003, maxRounds: 1 }));
  await until(() => meeting.status === 'limit', 'Limit');
  assert.equal(company.runs.at(-1)!.status, 'limit');
  meeting.notes = '';
  await engine.resumeMeeting(company.id, meeting.id, { addLimitEur: 1 });
  await until(() => meeting.status === 'decision', 'Vorschlag');
});

test('Ein unbrauchbarer Beitrag hält die Besprechung an, statt etwas zu erfinden', async () => {
  const { company, t } = await meetingCompany();
  const meeting = await engine.startMeeting(company.id, meetingOf(t, { notes: '[szenario:beitragkaputt]' }));
  await until(() => meeting.status === 'failed', 'Fehlerstatus');
  assert.equal(meeting.turns.length, 0);
  assert.match(company.runs.at(-1)!.error!, /nicht auswertbar/);
  assert.ok(company.notices.some((n) => /nicht auswertbar/.test(n.text)));
});

test('Beiträge werden nicht blind übernommen', () => {
  assert.equal(parseMeetingTurn(null, false), null);
  assert.equal(parseMeetingTurn({ kurz: 'x', beitrag: '  ' }, false), null);
  const long = parseMeetingTurn({ kurz: 'x'.repeat(200), beitrag: 'Text.' }, false);
  assert.ok(long!.short.length <= 60, 'Eine Sprechblase bleibt kurz');
  assert.equal(parseMeetingTurn({ beitrag: 'Erster Satz. Zweiter Satz.' }, false)?.short, 'Erster Satz');
  const moderated = parseMeetingTurn({ kurz: 'k', beitrag: 'b', einig: 'ja', vorschlag: ' v ', naechste_schritte: [{ aufgabe: 'a', rolle: 'r' }, { aufgabe: ' ' }, 'kaputt'], offene_punkte: ['o', 3] }, true);
  assert.equal(moderated?.agreed, false, 'Nur ein echtes true zählt als Einigung');
  assert.deepEqual(moderated?.outcome, { proposal: 'v', steps: [{ task: 'a', role: 'r' }], openPoints: ['o'] });
});

test('Ist jemand beschäftigt, wartet die Besprechung auf den Sprecher', async () => {
  const { company, t } = await meetingCompany();
  const blocker = await engine.startOrder(company.id, orderInput(t.worker.id, 'Blockiert Alex', { notes: '[szenario:haengt]' }));
  await until(() => t.worker.live.kind === 'writing', 'Alex arbeitet');
  const meeting = await engine.startMeeting(company.id, meetingOf(t));
  assert.equal(company.runs.filter((r) => r.meetingId === meeting.id).length, 0, 'Alex spricht zuerst und ist beschäftigt');
  assert.equal(t.worker.live.kind, 'writing', 'Alex zeigt weiter seine echte Arbeit');
  assert.equal(t.checker.live.kind, 'meeting', 'Die anderen sitzen schon im Raum');
  engine.stopOrder(company.id, blocker.id);
  await until(() => meeting.status === 'decision', 'Vorschlag');
});

test('Ein Raum fasst nur eine Besprechung, und ein laufender Raum bleibt stehen', async () => {
  const { company, t } = await meetingCompany();
  const roomId = company.placed.find((p) => p.kind === 'meeting')!.id;
  const meeting = await engine.startMeeting(company.id, meetingOf(t, { notes: '[szenario:haengt]' }));
  await assert.rejects(engine.startMeeting(company.id, meetingOf(t, { topic: 'Zweite' })), /belegt/);
  assert.throws(() => engine.moveItem(company.id, roomId, { i: 1, j: 3, rot: 3 }), /läuft gerade/);
  assert.throws(() => { company.buildPoints = 500; engine.moveCompany(company.id, 'garage'); }, /Mitten in der Arbeit/);
  engine.stopMeeting(company.id, meeting.id);
  await until(() => meeting.status === 'stopped', 'Stopp');
});

test('Eine Besprechung übersteht einen Neustart nur als angehaltene', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-besprechung-'));
  const first = await makeEngine(data);
  const company = first.createCompany({ name: 'Runde', idea: 'x', locationId: 'garage', budgetEur: 5 });
  company.buildPoints = 1000;
  first.moveCompany(company.id, 'buero');
  company.buildPoints = 500;
  placeRoomWith(first, company.id);
  // Beim Umzug ist der Startschreibtisch ins Inventar gewandert.
  addDeskWith(first, company.id, 7, 1);
  addDeskWith(first, company.id, 7, 4);
  const a = await first.hire(company.id, { name: 'Mila', roleId: 'planung', skillIds: [], modelId: 'claude-haiku-5-5', look: LOOK });
  const b = await first.hire(company.id, { name: 'Alex', roleId: 'text', skillIds: [], modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => a.hired && b.hired, 'Einstellungen');
  await first.startMeeting(company.id, { topic: 'Thema', notes: '[szenario:haengt]', participantIds: [a.id, b.id], moderatorId: a.id, maxRounds: 1, limitEur: 1 });
  await until(() => b.live.kind === 'writing', 'Beitrag läuft');

  const file = path.join(data, 'companies', company.id, 'company.json');
  fs.writeFileSync(file, JSON.stringify(company));
  const second = await makeEngine(data);
  const restored = second.snapshot(company.id).company;
  assert.equal(restored.meetings[0].status, 'stopped');
  assert.equal(restored.meetings[0].turnActive, false);
  assert.equal(restored.runs.at(-1)!.status, 'interrupted');
  assert.equal(restored.agents.find((x) => x.name === 'Alex')!.live.kind, 'idle');
  assert.equal(second.money(restored).reservedEur, 0);

  first.stopMeeting(company.id, company.meetings[0].id);
  await until(() => company.meetings[0].status !== 'running', 'Aufräumen');
  first.shutdown();
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

test('Firmen aus früheren Meilensteinen laden ohne Besprechungen', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-altfirma-'));
  const first = await makeEngine(data);
  const company = first.createCompany({ name: 'Alt', idea: 'x', locationId: 'garage', budgetEur: 5 });
  first.shutdown();
  const file = path.join(data, 'companies', company.id, 'company.json');
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete old.meetings;
  fs.writeFileSync(file, JSON.stringify(old));
  const second = await makeEngine(data);
  assert.deepEqual(second.snapshot(company.id).company.meetings, []);
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

test('Nach einem Neustart zeigt keine Figur mehr Arbeit an', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-neustart-'));
  const first = await makeEngine(data);
  const company = first.createCompany({ name: 'Neustart', idea: 'x', locationId: 'garage', budgetEur: 5 });
  const agent = await first.hire(company.id, { name: 'Mila', roleId: 'planung', skillIds: [], modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => agent.hired, 'Einstellung');
  const order = await first.startOrder(company.id, orderInput(agent.id, 'Hängt', { notes: '[szenario:haengt]' }));
  await until(() => agent.live.kind === 'writing', 'Schreibzustand');

  // Harter Abbruch: Die zweite Instanz sieht nur den gespeicherten Stand.
  const file = path.join(data, 'companies', company.id, 'company.json');
  fs.writeFileSync(file, JSON.stringify(company));
  const second = await makeEngine(data);
  const restored = second.snapshot(company.id).company;
  const run = restored.runs.at(-1)!;
  assert.equal(run.status, 'interrupted');
  assert.equal(run.costSource, 'berechnet');
  assert.equal(restored.orders.find((o) => o.id === order.id)!.status, 'stopped');
  assert.equal(restored.agents[0].live.kind, 'idle');

  first.stopRun(company.id, company.runs.at(-1)!.id);
  await until(() => company.runs.at(-1)!.status !== 'running', 'Aufräumen');
  first.shutdown();
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

/* ---------- Meilenstein 4: Abteilungen und Manager ---------- */

/** Garage mit einer Abteilung rechts: Mila sitzt außerhalb, Alex und Robin innerhalb. */
async function departmentCompany() {
  const company = newCompany(10);
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  engine.placeItem(company.id, { kind: 'desk', i: 6, j: 1, rot: 0 });
  const dept = engine.createDepartment(company.id, { name: 'Produkt', i: 4, j: 1, w: 4, d: 4, budgetEur: 2 });
  const mila = await hired(company.id, 'Mila');
  const alex = await hired(company.id, 'Alex');
  const robin = await hired(company.id, 'Robin');
  return { company, dept, mila, alex, robin };
}
const mandateInput = (managerId: string, extra = {}) => ({ goal: 'Eine Landingpage', managerId, budgetEur: 1, selfStartUpToEur: 0.1, ...extra });
const poolOf = (companyId: string, id: string | null) => engine.snapshot(companyId).pools.find((p) => p.id === id)!;

test('Abteilungen sind Bereiche mit eigenem Team, Budget und Wissen', async () => {
  const { company, dept, mila, alex, robin } = await departmentCompany();
  assert.match(fs.readFileSync(path.join(engine.workspaceOf(company.id), dept.knowledgeDir, 'abteilung.md'), 'utf8'), /Produkt/);
  assert.equal(engine.departmentOfAgent(company, mila), null, 'Der Starttisch liegt außerhalb');
  assert.equal(engine.departmentOfAgent(company, alex)?.id, dept.id);
  assert.equal(engine.departmentOfAgent(company, robin)?.id, dept.id);
  assert.equal(poolOf(company.id, null).budgetEur, 8, 'Das allgemeine Budget ist der Rest');
  assert.equal(poolOf(company.id, dept.id).budgetEur, 2);
  assert.ok(poolOf(company.id, dept.id).spentEur > 0, 'Die Vorstellungsgespräche der Abteilung zahlt die Abteilung');
  assert.throws(() => engine.createDepartment(company.id, { name: 'Zweite', i: 4, j: 2, w: 2, d: 2, budgetEur: 0 }), /schon die Abteilung/);
  assert.throws(() => engine.createDepartment(company.id, { name: 'Zweite', i: 7, j: 4, w: 3, d: 2, budgetEur: 0 }), /passt nicht/);
  assert.throws(() => engine.createDepartment(company.id, { name: 'Zweite', i: 0, j: 2, w: 1, d: 2, budgetEur: 0 }), /mindestens/);
  assert.throws(() => engine.createDepartment(company.id, { name: 'produkt', i: 0, j: 2, w: 2, d: 2, budgetEur: 0 }), /gibt es schon/);
  assert.throws(() => engine.createDepartment(company.id, { name: 'Teuer', i: 0, j: 2, w: 2, d: 2, budgetEur: 9 }), /allgemeinen Budget/);
  // Ein Schreibtisch rücken heißt umorganisieren: Robin wechselt aus der Abteilung heraus.
  engine.moveItem(company.id, robin.deskId, { i: 2, j: 3, rot: 0 });
  assert.equal(engine.departmentOfAgent(company, robin), null);
});

test('Das Budget einer Abteilung ist eine harte Grenze, und das allgemeine Budget enthält es nicht', async () => {
  const { company, dept, mila, alex } = await departmentCompany();
  await assert.rejects(engine.startOrder(company.id, orderInput(alex.id, 'Zu teuer', { limitEur: 3 })), /Abteilung "Produkt"/);
  await assert.rejects(engine.startOrder(company.id, orderInput(mila.id, 'Zu teuer', { limitEur: 8.5 })), /allgemeine KI-Budget/);
  const inside = await engine.startOrder(company.id, orderInput(alex.id, 'Im Budget', { limitEur: 1.5, notes: '[szenario:haengt]' }));
  assert.equal(inside.departmentId, dept.id);
  assert.equal(inside.startedBy, 'leitung');
  await until(() => alex.live.kind === 'writing', 'Alex arbeitet');
  assert.ok(Math.abs(poolOf(company.id, dept.id).reservedEur - (1.5 - company.runs.at(-1)!.costEur)) < 1e-9, 'Die Abteilung hält das Restlimit');
  assert.equal(poolOf(company.id, null).reservedEur, 0, 'Das allgemeine Budget ist nicht betroffen');
  assert.equal(company.runs.at(-1)!.departmentId, dept.id);
  assert.throws(() => engine.updateDepartment(company.id, dept.id, { budgetEur: 1 }), /verbraucht und reserviert/);
  assert.throws(() => engine.updateDepartment(company.id, dept.id, { budgetEur: 10.5 }), /allgemeinen Budget/);
  assert.throws(() => engine.setBudget(company.id, 1.5), /Abteilungen zugeteilt/);
  assert.throws(() => engine.dissolveDepartment(company.id, dept.id), /läuft noch/);
  engine.stopOrder(company.id, inside.id);
  await until(() => inside.status === 'stopped', 'Stopp');
  engine.updateDepartment(company.id, dept.id, { budgetEur: 3, name: 'Produkt und Design' });
  assert.equal(poolOf(company.id, null).budgetEur, 7);
  assert.equal(dept.name, 'Produkt und Design');
  engine.dissolveDepartment(company.id, dept.id);
  assert.equal(company.departments.length, 0);
  assert.equal(poolOf(company.id, null).budgetEur, 10, 'Das Budget kommt zurück');
  assert.ok(fs.existsSync(path.join(engine.workspaceOf(company.id), dept.knowledgeDir)), 'Das Wissen bleibt');
});

test('Ein Manager plant im Budget, und die Freigabe-Stufe entscheidet, was er selbst startet', async () => {
  const { company, dept, alex, robin } = await departmentCompany();
  const mandate = await engine.startMandate(company.id, mandateInput(alex.id));
  assert.equal(mandate.status, 'planning');
  assert.equal(mandate.departmentId, dept.id);
  const planning = company.runs.at(-1)!;
  assert.equal(planning.kind, 'manage');
  assert.equal(planning.mandateId, mandate.id);
  assert.ok(!planning.prompt.includes('Mila'), 'Mila sitzt nicht in der Abteilung und steht dem Manager nicht zur Verfügung');
  assert.match(planning.prompt, /Robin/);
  await until(() => mandate.status === 'active', 'Planung');
  assert.equal(mandate.rounds.length, 1);
  assert.match(mandate.rounds[0].summary, /Planung der Attrappe/);
  assert.equal(mandate.proposals.length, 2);
  const [small, big] = mandate.proposals;
  assert.equal(small.status, 'started', 'Unter der Freigabe-Stufe startet der Manager selbst');
  assert.equal(big.status, 'pending', 'Darüber braucht es den Menschen');
  const order = company.orders.find((o) => o.id === small.orderId)!;
  assert.equal(order.mandateId, mandate.id);
  assert.equal(order.departmentId, dept.id);
  assert.equal(order.startedBy, 'manager');
  assert.match(order.notes, /Geplant von Alex/);
  assert.ok(company.notices.some((n) => /Alex hat einen Auftrag gestartet/.test(n.text)));
  assert.ok(company.notices.some((n) => /wartet auf deine Freigabe/.test(n.text)));
  await until(() => order.status === 'review', 'Auftrag des Managers');
  assert.equal(alex.live.kind, 'review');
  const mandateSpent = () => company.runs.filter((r) => r.mandateId === mandate.id).reduce((sum, r) => sum + r.costEur, 0);
  assert.ok(Math.abs(engine.money(company).reservedEur - (1 - mandateSpent())) < 1e-9, 'Das Projekt hält sein ganzes Restbudget');
  assert.ok(Math.abs(poolOf(company.id, dept.id).reservedEur - (1 - mandateSpent())) < 1e-9, 'Es kommt aus dem Budget der Abteilung');
  await assert.rejects(engine.planMandate(company.id, mandate.id), /offenen Vorschläge/);

  await engine.decideProposal(company.id, mandate.id, big.id, { decision: 'approve' });
  assert.equal(big.status, 'started');
  const approved = company.orders.find((o) => o.id === big.orderId)!;
  assert.equal(approved.startedBy, 'leitung');
  assert.deepEqual(approved.stages.map((s) => s.agentId), [alex.id, robin.id], 'Der Manager darf eine Prüfung aus seinem Team einplanen');
  await until(() => approved.status === 'review', 'Freigegebener Auftrag');
  assert.match(fs.readFileSync(path.join(engine.workspaceOf(company.id), mandate.file), 'utf8'), /Großer Auftrag[\s\S]*gestartet/);

  await engine.planMandate(company.id, mandate.id);
  await until(() => mandate.rounds.length === 2, 'Zweite Runde');
  assert.match(company.runs.filter((r) => r.kind === 'manage').at(-1)!.prompt, /Stand der bisherigen Aufträge[\s\S]*Kleiner Auftrag[\s\S]*wartet auf Abnahme/);
  const again = mandate.proposals.filter((p) => p.round === 2);
  assert.deepEqual(again.map((p) => p.status), ['started', 'pending']);
  await engine.decideProposal(company.id, mandate.id, again[1].id, { decision: 'decline' });
  assert.equal(again[1].status, 'declined');
  await until(() => company.orders.every((o) => o.status !== 'running'), 'Alles fertig');
  engine.closeMandate(company.id, mandate.id);
  assert.equal(mandate.status, 'closed');
  assert.ok(Math.abs(engine.money(company).reservedEur) < 1e-9, 'Abschließen gibt den Rest frei');
  await assert.rejects(engine.planMandate(company.id, mandate.id), /abgeschlossen/);
  await assert.rejects(engine.decideProposal(company.id, mandate.id, again[1].id, { decision: 'approve' }), /schon entschieden/);
});

test('Vorschläge außerhalb von Team und Budget lässt der Server nicht zu', async () => {
  const { company, alex, mila } = await departmentCompany();
  const zoe = await engine.startMandate(company.id, mandateInput(alex.id, { notes: '[szenario:managerzoe]', selfStartUpToEur: 0 }));
  await until(() => zoe.status === 'active', 'Planung');
  assert.equal(zoe.proposals[0].status, 'invalid');
  assert.match(zoe.proposals[0].invalidReason, /Zoe gehört nicht zum Team/);
  assert.equal(zoe.proposals[1].status, 'pending', 'Ohne Freigabe-Stufe startet nichts von selbst');
  assert.equal(company.orders.length, 0);
  assert.equal(alex.live.kind, 'review');
  engine.closeMandate(company.id, zoe.id);
  assert.equal(zoe.proposals[1].status, 'declined', 'Abschließen lehnt offene Vorschläge ab');
  assert.equal(alex.live.kind, 'idle');

  const dear = await engine.startMandate(company.id, mandateInput(alex.id, { notes: '[szenario:managerteuer]' }));
  await until(() => dear.status === 'active', 'Planung');
  assert.deepEqual(dear.proposals.map((p) => p.status), ['invalid', 'invalid']);
  assert.match(dear.proposals[0].invalidReason, /Übersteigt das verbleibende Budget/);
  await assert.rejects(engine.startMandate(company.id, mandateInput(alex.id, { budgetEur: 5 })), /Abteilung "Produkt"/);
  // Ohne Abteilung führt ein Manager die ganze Firma, aus dem allgemeinen Budget.
  const whole = await engine.startMandate(company.id, mandateInput(mila.id, { selfStartUpToEur: 0 }));
  assert.equal(whole.departmentId, null);
  assert.match(company.runs.at(-1)!.prompt, /Alex[\s\S]*Robin/);
  await until(() => whole.status === 'active', 'Planung');
  assert.ok(poolOf(company.id, null).reservedEur >= 0.99, 'Das allgemeine Budget hält das Projekt');
});

test('Eine unbrauchbare oder unterbrochene Planung hält das Projekt offen, statt etwas zu erfinden', async () => {
  const { company, alex } = await departmentCompany();
  const broken = await engine.startMandate(company.id, mandateInput(alex.id, { notes: '[szenario:managerkaputt]' }));
  await until(() => broken.status === 'active', 'Planung');
  assert.match(broken.lastError!, /nicht auswertbar/);
  assert.equal(broken.proposals.length, 0);
  assert.ok(company.notices.some((n) => /nicht auswertbar/.test(n.text)));
  assert.ok(engine.money(company).reservedEur >= 0.99, 'Das Budget bleibt reserviert, bis der Mensch entscheidet');
  engine.closeMandate(company.id, broken.id);
  const done = await engine.startMandate(company.id, mandateInput(alex.id, { notes: '[szenario:managerfertig]' }));
  await until(() => done.status === 'active', 'Planung');
  assert.equal(done.rounds[0].done, true);
  assert.ok(company.notices.some((n) => /als erreicht/.test(n.text)));
  assert.equal(done.status, 'active', 'Ob das Ziel erreicht ist, entscheidet der Mensch');
});

test('Eine Planung übersteht einen Neustart nur als offenes Projekt', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-vorhaben-'));
  const first = await makeEngine(data);
  const company = first.createCompany({ name: 'Plan', idea: 'x', locationId: 'garage', budgetEur: 5 });
  const a = await first.hire(company.id, { name: 'Mila', roleId: 'fuehrung', skillIds: ['fuehrung'], modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => a.hired, 'Einstellung');
  const mandate = await first.startMandate(company.id, mandateInput(a.id, { notes: '[szenario:haengt]' }));
  await until(() => a.live.kind === 'writing', 'Planung läuft');
  const file = path.join(data, 'companies', company.id, 'company.json');
  fs.writeFileSync(file, JSON.stringify(company));
  const second = await makeEngine(data);
  const restored = second.snapshot(company.id).company;
  assert.equal(restored.mandates[0].status, 'active');
  assert.match(restored.mandates[0].lastError!, /unterbrochen/);
  assert.equal(restored.runs.at(-1)!.status, 'interrupted');
  assert.equal(restored.agents[0].live.kind, 'idle');
  assert.ok(Math.abs(second.money(restored).reservedEur - (1 - restored.runs.at(-1)!.costEur)) < 1e-9, 'Das Budget des Projekts bleibt reserviert');
  first.stopRun(company.id, company.runs.at(-1)!.id);
  await until(() => mandate.status === 'active', 'Aufräumen');
  first.shutdown();
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

test('Firmen aus früheren Meilensteinen laden ohne Abteilungen und Projekt', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-altfirma4-'));
  const first = await makeEngine(data);
  const company = first.createCompany({ name: 'Alt', idea: 'x', locationId: 'garage', budgetEur: 5 });
  first.shutdown();
  const file = path.join(data, 'companies', company.id, 'company.json');
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete old.departments;
  delete old.mandates;
  fs.writeFileSync(file, JSON.stringify(old));
  const second = await makeEngine(data);
  const snap = second.snapshot(company.id);
  assert.deepEqual(snap.company.departments, []);
  assert.deepEqual(snap.company.mandates, []);
  assert.equal(snap.pools.length, 1);
  assert.equal(snap.pools[0].budgetEur, 5);
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

test('Das Schema des Managers lässt nur Teamnamen zu, und die Planung wird nicht blind übernommen', () => {
  const schema = manageSchema(['Alex', 'Robin']) as { properties: { auftraege: { items: { properties: Record<string, { enum?: string[] }> } } } };
  assert.deepEqual(schema.properties.auftraege.items.properties.arbeit.enum, ['Alex', 'Robin']);
  assert.deepEqual(schema.properties.auftraege.items.properties.pruefung.enum, ['', 'Alex', 'Robin']);
  assert.equal(parsePlan(null), null);
  assert.equal(parsePlan({ zusammenfassung: 'x' }), null);
  const plan = parsePlan({ zusammenfassung: ' Plan. ', fertig: 'ja', offen: 3, auftraege: [{ titel: ' T ', kriterien: ['a', ' ', 'b'], arbeit: 'Alex', limit_eur: 'viel' }, 'kaputt'] });
  assert.equal(plan?.summary, 'Plan.');
  assert.equal(plan?.done, false, 'Nur ein echtes true gilt');
  assert.equal(plan?.open, '');
  assert.deepEqual(plan?.proposals, [{ title: 'T', notes: '', criteria: ['a', 'b'], planName: '', workName: 'Alex', checkName: '', limitEur: 0, reason: '' }]);
});

/* ---------- Zwischenschritt: bestehendes Projekt einbinden ---------- */

test('Ein Projektordner wird geprüft, als "projekt/" gelistet und bleibt die einzige zweite Grenze', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-projekt-'));
  fs.writeFileSync(path.join(project, 'README.md'), '# Mein Projekt\n');
  fs.mkdirSync(path.join(project, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(project, 'node_modules', 'x', 'index.js'), '');
  const found = (input: unknown) => engine.createCompany({ name: 'Projektfirma', idea: 'x', locationId: 'garage', budgetEur: 5, projectDir: input as string });
  assert.throws(() => found('relativ/pfad'), /vollständigen Pfad/);
  assert.throws(() => found(path.join(project, 'gibt-es-nicht')), /gibt es nicht/);
  assert.throws(() => found(path.join(project, 'README.md')), /keine Datei/);
  assert.throws(() => found(dir), /Daten von Silly Valley/);
  assert.throws(() => found(os.homedir()), /Zuhause/);
  const company = found(project);
  assert.equal(company.projectDir, fs.realpathSync(project));
  assert.match(fs.readFileSync(path.join(engine.workspaceOf(company.id), 'wissen', 'idee.md'), 'utf8'), /bestehenden Projekt/);
  const files = engine.files(company.id).map((f) => f.path);
  assert.ok(files.includes('projekt/README.md'), files.join(', '));
  assert.ok(!files.some((f) => f.includes('node_modules')), 'Abhängigkeiten gehören nicht in die Liste');
  assert.equal(engine.resolvePath(company.id, 'projekt/README.md'), path.join(fs.realpathSync(project), 'README.md'));
  assert.equal(engine.resolvePath(company.id, 'projekt'), fs.realpathSync(project));
  for (const bad of ['projekt/../README.md', 'projekt/../../etc/passwd', '../company.json']) assert.equal(engine.resolvePath(company.id, bad), null, bad);
  const plain = newCompany();
  assert.equal(engine.resolvePath(plain.id, 'projekt/README.md'), null, 'Ohne Projekt gibt es kein projekt/');
  assert.deepEqual(listAll({ workspace: engine.workspaceOf(plain.id), projectDir: null }).filter((f) => f.path.startsWith('projekt/')), []);
  assert.equal(resolveIn({ workspace: engine.workspaceOf(plain.id), projectDir: null }, 'projekt'), null);
  const args = buildArgs({ cwd: '/x', prompt: 'p', systemPrompt: 's', model: 'm', sessionId: 'u', resume: false, limitUsd: 0.5, sessionCostBefore: 0, webAccess: false, readOnly: false, extraDirs: [project], jsonSchema: null, rawLogPath: '/y', timeoutMs: 1 });
  assert.equal(args[args.indexOf('--add-dir') + 1], project);
  assert.ok(args.includes('--restricted'), 'Das Projekt erweitert die Grenze, hebt sie aber nicht auf');
  fs.rmSync(project, { recursive: true, force: true });
});

test('Ohne seinen Projektordner startet eine Firma keinen Lauf', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-projekt-weg-'));
  const company = engine.createCompany({ name: 'Verloren', idea: 'x', locationId: 'garage', budgetEur: 5, projectDir: project });
  const agent = await hired(company.id);
  assert.match(company.runs.at(-1)!.prompt, /./);
  fs.rmSync(project, { recursive: true, force: true });
  await assert.rejects(engine.startOrder(company.id, orderInput(agent.id)), /nicht mehr da/);
  assert.equal(company.orders.length, 0);
});

/* ---------- Verträge: Einstellungen des Managers brauchen die Unterschrift des Menschen ---------- */

test('Eine vom Manager vorgeschlagene Einstellung wird erst mit dem unterzeichneten Vertrag wirksam', async () => {
  const { company, dept, alex } = await departmentCompany();
  const mandate = await engine.startMandate(company.id, mandateInput(alex.id, { notes: '[szenario:managervertrag]', selfStartUpToEur: 1 }));
  await until(() => mandate.status === 'active', 'Planung');
  assert.equal(mandate.contracts.length, 1);
  const contract = mandate.contracts[0];
  assert.equal(contract.status, 'pending', 'Auch bei voller Freigabe-Stufe stellt der Manager nie selbst ein');
  assert.deepEqual([contract.name, contract.roleId, contract.modelId, contract.skillIds], ['Sam', 'text', 'claude-haiku-5-5', ['text']]);
  assert.equal(company.agents.length, 3, 'Niemand wurde eingestellt');
  assert.ok(company.notices.some((n) => /Sam.*Unterschrift/.test(n.text)));
  const { text } = engine.contractOf(company.id, mandate.id, contract.id);
  assert.match(text, /Arbeitsvertrag: Sam[\s\S]*Text und Marke[\s\S]*Haiku 5\.5[\s\S]*Gehalt[\s\S]*je Million Tokens[\s\S]*Abteilung Produkt[\s\S]*Noch nicht unterzeichnet/);
  await until(() => company.orders.every((o) => o.status !== 'running'), 'Aufträge der Runde');
  await assert.rejects(engine.planMandate(company.id, mandate.id), /Verträge/);
  // Ohne freien Platz in der Abteilung gibt es keine Unterschrift. Ein Platz außerhalb zählt nicht.
  engine.placeItem(company.id, { kind: 'desk', i: 1, j: 3, rot: 0 });
  await assert.rejects(engine.signContract(company.id, mandate.id, contract.id, { decision: 'sign' }), /in der Abteilung/);
  engine.moveItem(company.id, company.placed.at(-1)!.id, { i: 4, j: 1, rot: 0 });
  const sam = (await engine.signContract(company.id, mandate.id, contract.id, { decision: 'sign', name: 'Samira' }))!;
  assert.equal(contract.status, 'signed');
  assert.equal(sam.name, 'Samira', 'Den Namen legt die Geschäftsführung fest');
  assert.equal(contract.name, 'Samira');
  assert.equal(contract.agentId, sam.id);
  await until(() => sam.hired, 'Vorstellungsgespräch');
  assert.equal(engine.departmentOfAgent(company, sam)?.id, dept.id);
  assert.equal(sam.roleId, 'text');
  assert.equal(company.runs.find((r) => r.agentId === sam.id)!.departmentId, dept.id, 'Das Gespräch zahlt die Abteilung');
  assert.match(fs.readFileSync(path.join(engine.workspaceOf(company.id), mandate.file), 'utf8'), /Einstellung: Sam[\s\S]*unterzeichnet/);
  await assert.rejects(engine.signContract(company.id, mandate.id, contract.id, { decision: 'sign' }), /schon entschieden/);
  await engine.planMandate(company.id, mandate.id);
  assert.match(company.runs.at(-1)!.prompt, /Samira: Text und Marke/, 'In der nächsten Runde gehört Samira zum Team');
  await until(() => mandate.rounds.length === 2, 'Zweite Runde');
  assert.equal(mandate.contracts.at(-1)!.status, 'pending', 'Ein neuer Name ist ein neuer Vertrag, der wieder auf die Unterschrift wartet');
});

test('Verträge mit unbekannter Rolle oder ohne Unterschrift stellen niemanden ein', async () => {
  const { company, alex } = await departmentCompany();
  const broken = await engine.startMandate(company.id, mandateInput(alex.id, { notes: '[szenario:managervertragkaputt]', selfStartUpToEur: 0 }));
  await until(() => broken.status === 'active', 'Planung');
  assert.equal(broken.contracts[0].status, 'invalid');
  assert.match(broken.contracts[0].invalidReason, /Rolle "Zauberei"/);
  engine.closeMandate(company.id, broken.id);
  const declined = await engine.startMandate(company.id, mandateInput(alex.id, { notes: '[szenario:managervertrag]', selfStartUpToEur: 0 }));
  await until(() => declined.status === 'active', 'Planung');
  assert.equal(alex.live.kind, 'review');
  await engine.signContract(company.id, declined.id, declined.contracts[0].id, { decision: 'decline' });
  assert.equal(declined.contracts[0].status, 'declined');
  assert.equal(company.agents.length, 3);
  engine.closeMandate(company.id, declined.id);
  const third = await engine.startMandate(company.id, mandateInput(alex.id, { notes: '[szenario:managervertrag]' }));
  await until(() => third.status === 'active', 'Planung');
  engine.closeMandate(company.id, third.id);
  assert.equal(third.contracts[0].status, 'declined', 'Abschließen lehnt offene Verträge ab');
  await until(() => company.orders.every((o) => o.status !== 'running'), 'Aufträge der Attrappe');
});

test('Räume richten sich nach der Teamgröße, der Schalter hebt die Grenze auf', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-team-'));
  const gated = await makeEngine(data, false);
  const company = gated.createCompany({ name: 'Klein', idea: 'x', locationId: 'garage', budgetEur: 5 });
  assert.equal(gated.system().unlimitedBuild, false);
  assert.throws(() => gated.townAction(company.id, 'eckladen', { action: 'rent' }), /ab 2 Agenten/, 'Allein lohnt sich kein Laden');
  assert.throws(() => gated.moveCompany(company.id, 'buero'), /ab 4 Agenten/);
  for (let n = 0; n < 3; n++) gated.placeItem(company.id, { kind: 'plant', i: 3 + n, j: 4, rot: 0 });
  gated.createDepartment(company.id, { name: 'Alles', i: 4, j: 1, w: 3, d: 3, budgetEur: 0 });
  gated.shutdown();
  assert.equal(engine.system().unlimitedBuild, true, 'Die übrigen Tests bauen ohne Grenze');
  engine.moveCompany(newCompany().id, 'buero');
  fs.rmSync(data, { recursive: true, force: true });
});


/* ---------- Die Stadt ---------- */

test('Der Stadtplan ist schlüssig: nichts überlappt, und jeder Eingang ist zu Fuß erreichbar', () => {
  for (const a of PARCELS) {
    for (const b of PARCELS) {
      if (a === b) continue;
      const overlap = a.i < b.i + b.w && b.i < a.i + a.w && a.j < b.j + b.d && b.j < a.j + a.d;
      assert.ok(!overlap, `${a.id} überlappt ${b.id}`);
    }
    assert.ok(a.i >= 0 && a.j >= 0 && a.i + a.w <= TOWN_W && a.j + a.d <= TOWN_D, `${a.id} liegt außerhalb`);
    for (let n = 0; n < a.w; n++) for (let m = 0; m < a.d; m++) assert.equal(tileKind(a.i + n, a.j + m), 'grass', `${a.id} liegt auf einer Straße`);
    assert.equal(tileKind(a.entry.i, a.entry.j), 'sidewalk', `${a.id}: Der Eingang liegt nicht auf dem Gehweg`);
    assert.ok(!TOWN_BLOCKED.has(`${a.entry.i},${a.entry.j}`), `${a.id}: Der Eingang ist versperrt`);
    assert.equal(parcelNear(a.entry)?.id, a.id, `${a.id}: Am Eingang muss das Grundstück erkannt werden`);
  }
  const home = parcelById('elternhaus')!;
  // Eine Suche genügt, wenn sie alle Eingänge findet: Jeder Weg dorthin führt über dieselben Strassen.
  for (const p of PARCELS.filter((x) => x !== home && (x.price || x.kind === 'shop'))) {
    assert.ok(findPath({ w: TOWN_W, d: TOWN_D }, TOWN_BLOCKED, home.entry, p.entry).length > 0, `${p.id} ist vom Elternhaus aus nicht erreichbar`);
  }
  assert.ok(CITIES.length >= 6, 'Sechs Städte');
  for (const city of CITIES) assert.ok(PARCELS.some((p) => cityOf(p.i, p.j)?.id === city.id), `${city.name} ist leer`);
  assert.ok(PARCELS.filter((p) => p.kind === 'lot').length >= 4, 'Viele freie Grundstücke');
  assert.ok(PARCELS.filter((p) => p.kind === 'vacant').length >= 3, 'Leerstehende Läden');
  assert.ok(PARCELS.filter((p) => p.kind === 'house').length >= 4, 'Wohnhäuser');
  assert.ok(PARCELS.filter((p) => p.kind === 'shop').length >= 3, 'Kleine Geschäfte');
  assert.ok(inParcel(home, { i: home.i, j: home.j }));
  for (const p of PARCELS) if (p.kind === 'lot') assert.ok(p.price! > 0 && p.buildCost! > 0, p.id);
});

test('Ein Laden wird gemietet, dann bezogen, nie aus dem KI-Budget bezahlt', () => {
  const company = newCompany(5);
  assert.deepEqual(company.town, { siteId: 'elternhaus', owned: [], rented: [], built: [], furnished: ['garage'] });
  const budget = engine.money(company).remainingEur;
  assert.throws(() => engine.townAction(company.id, 'eckladen', { action: 'move' }), /Miete das zuerst/);
  assert.throws(() => engine.townAction(company.id, 'diner', { action: 'rent' }), /nicht zu vermieten/);
  assert.throws(() => engine.townAction(company.id, 'gibt-es-nicht', { action: 'rent' }), /gibt es nicht/);
  company.buildPoints = 59;
  company.buildPoints = 70;
  engine.townAction(company.id, 'eckladen', { action: 'rent' });
  assert.throws(() => engine.townAction(company.id, 'eckladen', { action: 'rent' }), /schon gemietet/);
  assert.equal(company.locationId, 'garage', 'Mieten allein zieht noch nicht um');
  engine.townAction(company.id, 'eckladen', { action: 'move' });
  assert.equal(company.locationId, 'eckladen');
  assert.equal(company.town.siteId, 'eckladen');
  assert.throws(() => engine.townAction(company.id, 'eckladen', { action: 'move' }), /sitzt schon dort/);
  assert.equal(engine.money(company).remainingEur, budget, 'Das KI-Budget bleibt unberührt');
  engine.townAction(company.id, 'elternhaus', { action: 'move', locationId: 'kinderzimmer' });
  assert.equal(company.locationId, 'kinderzimmer', 'Beide Räume des Elternhauses sind frei wählbar');
  assert.throws(() => engine.townAction(company.id, 'elternhaus', { action: 'move', locationId: 'buero' }), /Kinderzimmer oder die Garage/);
});

test('Ein Grundstück wird gekauft, bebaut und bezogen, in dieser Reihenfolge', () => {
  const company = newCompany();
  company.buildPoints = 500;
  const lot = parcelById('grund-birke')!;
  assert.throws(() => engine.townAction(company.id, lot.id, { action: 'build' }), /zuerst/);
  assert.throws(() => engine.townAction(company.id, lot.id, { action: 'move' }), /noch nichts/);
  engine.townAction(company.id, lot.id, { action: 'buy' });
  assert.throws(() => engine.townAction(company.id, lot.id, { action: 'buy' }), /gehört dir schon/);
  assert.throws(() => engine.townAction(company.id, lot.id, { action: 'move' }), /noch nichts/);
  engine.townAction(company.id, lot.id, { action: 'build' });
  assert.throws(() => engine.townAction(company.id, lot.id, { action: 'build' }), /schon dein Neubau/);
  const desks = company.placed.filter((p) => !isProp(p.kind)).length;
  engine.townAction(company.id, lot.id, { action: 'move' });
  assert.equal(company.locationId, 'neubau-klein');
  assert.equal(company.town.siteId, lot.id);
  assert.equal(company.placed.filter((p) => !isProp(p.kind)).length, desks, 'Die Möbel kommen mit');
  // Ein zweites Grundstück gleicher Größe ist ein anderer Ort, auch wenn der Raum derselbe ist.
  engine.townAction(company.id, 'grund-sued-1', { action: 'buy' });
  engine.townAction(company.id, 'grund-sued-1', { action: 'build' });
  engine.townAction(company.id, 'grund-sued-1', { action: 'move' });
  assert.equal(company.town.siteId, 'grund-sued-1');
});

test('Mitten in der Arbeit zieht niemand um, gekauft werden darf trotzdem', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  const agent = await hired(company.id);
  const order = await engine.startOrder(company.id, orderInput(agent.id, 'Hängt', { notes: '[szenario:haengt]' }));
  await until(() => agent.live.kind === 'writing', 'Arbeit');
  engine.townAction(company.id, 'eckladen', { action: 'rent' });
  assert.throws(() => engine.townAction(company.id, 'eckladen', { action: 'move' }), /Mitten in der Arbeit/);
  engine.stopOrder(company.id, order.id);
  await until(() => order.status === 'stopped', 'Stopp');
  engine.townAction(company.id, 'eckladen', { action: 'move' });
  assert.equal(company.locationId, 'eckladen');
});

test('Firmen aus früheren Ständen stehen danach am richtigen Ort der Stadt', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-altstadt-'));
  const first = await makeEngine(data);
  const home = first.createCompany({ name: 'Zuhause', idea: 'x', locationId: 'kinderzimmer', budgetEur: 5 });
  const away = first.createCompany({ name: 'Post', idea: 'x', locationId: 'garage', budgetEur: 5 });
  away.buildPoints = 200;
  first.moveCompany(away.id, 'buero');
  first.shutdown();
  for (const id of [home.id, away.id]) {
    const file = path.join(data, 'companies', id, 'company.json');
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete old.town;
    fs.writeFileSync(file, JSON.stringify(old));
  }
  const second = await makeEngine(data);
  assert.deepEqual(second.snapshot(home.id).company.town, { siteId: 'elternhaus', owned: [], rented: [], built: [], furnished: ['kinderzimmer'] });
  assert.deepEqual(second.snapshot(away.id).company.town, { siteId: 'postamt', owned: [], rented: ['postamt'], built: [], furnished: ['buero'] });
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

test('Alle Möbel lassen sich drehen, und die Figur steht vor der Vorderseite', () => {
  const company = newCompany();
  company.buildPoints = 500;
  const shelf = engine.placeItem(company.id, { kind: 'shelf', i: 6, j: 3, rot: 1 });
  assert.equal(shelf.rot, 1, 'Die Drehung bleibt beim Platzieren erhalten');
  engine.moveItem(company.id, shelf.id, { i: 6, j: 3, rot: 2 });
  assert.equal(shelf.rot, 2, 'An Ort und Stelle drehen geht');
  const plant = engine.placeItem(company.id, { kind: 'plant', i: 7, j: 4, rot: 3 });
  assert.equal(plant.rot, 3);
  assert.throws(() => engine.moveItem(company.id, shelf.id, { i: 6, j: 3, rot: 4 as never }), /vier Richtungen/);
  assert.throws(() => engine.placeItem(company.id, { kind: 'coffee', i: 6, j: 4, rot: undefined as never }), /vier Richtungen/);
  const loc = locationById('buero');
  const item = { id: 'x', kind: 'shelf' as const, i: 4, j: 4, rot: 0 as const };
  assert.deepEqual(standingTile(loc, new Set(), item), { i: 4, j: 5 });
  assert.deepEqual(standingTile(loc, new Set(), { ...item, rot: 1 }), { i: 5, j: 4 });
  assert.deepEqual(standingTile(loc, new Set(), { ...item, rot: 2 }), { i: 4, j: 3 });
  assert.deepEqual(standingTile(loc, new Set(), { ...item, rot: 3 }), { i: 3, j: 4 });
  assert.ok(standingTile(loc, new Set(['4,5']), item), 'Ist die Vorderseite verstellt, steht die Figur daneben');
});

/* ---------- Stellenausschreibung, eigene Fähigkeiten, Teams, Kontext ---------- */

const posting = (name: string, extra = {}) => ({ name, roleId: 'frei', skillIds: [], modelId: 'claude-haiku-5-5', look: LOOK, ...extra });

test('Die Ausschreibung gibt dem Agenten Aufgabe und eigene Fähigkeiten, und zwar im Profil', async () => {
  const company = newCompany();
  const agent = await engine.hire(company.id, posting('Toni', {
    job: { title: ' Newsletter-Redaktion ', task: 'Du betreust den Newsletter.', requirements: 'Kurze Sätze.' },
    customSkills: [{ title: 'Hausregeln', instruction: '# Regeln\nImmer freundlich.', source: 'datei' }, { title: 'Stil', instruction: 'Ohne Floskeln.' }],
  }));
  await until(() => agent.hired, 'Einstellung');
  assert.equal(agentTitle(agent), 'Newsletter-Redaktion', 'Der Stellentitel gilt überall');
  assert.equal(company.customSkills.length, 2);
  assert.deepEqual(agent.skillIds, company.customSkills.map((s) => s.id));
  const profile = agentProfile(company, agent);
  for (const part of ['Newsletter-Redaktion', 'Du betreust den Newsletter.', 'Kurze Sätze.', 'Immer freundlich.', 'Ohne Floskeln.']) assert.ok(profile.includes(part), part);
  assert.ok(profile.indexOf('Immer freundlich.') < profile.indexOf('Regeln, sie gehen jeder Fähigkeit vor'), 'Die festen Regeln stehen zuletzt');
  assert.equal(company.customSkills[0].source, 'datei');
  assert.equal(company.customSkills[1].source, 'beschrieben');
  assert.match(fs.readFileSync(path.join(engine.workspaceOf(company.id), company.customSkills[0].file), 'utf8'), /Immer freundlich/);
  assert.match(company.runs[0].prompt, /ausgeschriebene Aufgabe/, 'Das Vorstellungsgespräch bezieht sich darauf');
});

test('Eine Ausschreibung wird geprüft, bevor etwas entsteht', async () => {
  const company = newCompany();
  const hire = (extra: object) => engine.hire(company.id, posting('Toni', extra));
  await assert.rejects(hire({ customSkills: [{ title: '', instruction: 'x' }] }), /Namen/);
  await assert.rejects(hire({ customSkills: [{ title: 'Leer', instruction: '  ' }] }), /Beschreibe/);
  await assert.rejects(hire({ customSkills: [{ title: 'Riesig', instruction: 'x'.repeat(RULES.skillTextMax + 1) }] }), /zu lang/);
  await assert.rejects(hire({ customSkills: [{ title: 'konzepte', instruction: 'x' }] }), /gibt es schon/);
  await assert.rejects(hire({ job: { title: 'x'.repeat(61) } }), /60 Zeichen/);
  await assert.rejects(hire({ job: { task: 'x'.repeat(RULES.jobTextMax + 1) } }), /höchstens/);
  assert.equal(company.customSkills.length, 0, 'Abgewiesene Ausschreibungen hinterlassen nichts');
  assert.equal(company.agents.length, 0);
  const full = engine.createCompany({ name: 'Voll', idea: 'x', locationId: 'garage', budgetEur: 0.1 });
  await assert.rejects(engine.hire(full.id, posting('Toni', { customSkills: [{ title: 'Neu', instruction: 'x' }] })), /Budget/);
  assert.equal(full.customSkills.length, 0, 'Auch ohne Budget entsteht keine Fähigkeit');
});

test('Nachgerüstetes kommt genau einmal mit dem nächsten Lauf, und nur nach Erfolg gilt es als mitgeteilt', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  const lastPrompt = () => company.runs.at(-1)!.prompt;
  engine.addAgentSkill(company.id, agent.id, { title: 'Zweitwort', instruction: 'Das Zweitwort ist PELIKAN.' });
  assert.throws(() => engine.addAgentSkill(company.id, agent.id, { skillId: company.customSkills[0].id }), /schon/);
  assert.throws(() => engine.addAgentSkill(company.id, agent.id, { skillId: 'gibt-es-nicht' }), /gibt es nicht/);
  // Ein Abbruch zählt nicht: Die Session hat es dann nicht sicher gelesen.
  await engine.chat(company.id, agent.id, '[szenario:haengt] Hallo');
  assert.match(lastPrompt(), /PELIKAN/);
  await until(() => agent.live.kind === 'writing', 'Lauf');
  engine.stopRun(company.id, company.runs.at(-1)!.id);
  await until(() => company.runs.at(-1)!.status === 'stopped', 'Stopp');
  await engine.chat(company.id, agent.id, 'Nochmal');
  assert.match(lastPrompt(), /PELIKAN/, 'Nach dem Abbruch wird es erneut mitgeteilt');
  await until(() => company.runs.at(-1)!.status === 'success', 'Antwort');
  await engine.chat(company.id, agent.id, 'Und weiter');
  assert.ok(!lastPrompt().includes('PELIKAN'), 'Nach einem Erfolg kostet es nichts mehr');
  await until(() => company.runs.at(-1)!.status === 'success', 'Antwort');
  engine.updateJob(company.id, agent.id, { title: 'Chefredaktion', task: 'Du leitest die Redaktion.' });
  assert.equal(agentTitle(agent), 'Chefredaktion');
  await engine.chat(company.id, agent.id, 'Was machst du?');
  assert.match(lastPrompt(), /Du leitest die Redaktion/, 'Auch die neue Aufgabe kommt mit');
  await until(() => company.runs.at(-1)!.status === 'success', 'Antwort');
  assert.equal(agent.jobPending, false);
  assert.match(fs.readFileSync(path.join(engine.workspaceOf(company.id), 'team', 'mila.md'), 'utf8'), /Du leitest die Redaktion/);
});

test('Ein Team begrenzt, wen der Manager einplanen darf', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  engine.placeItem(company.id, { kind: 'desk', i: 6, j: 1, rot: 0 });
  const mila = await hired(company.id, 'Mila');
  const alex = await hired(company.id, 'Alex');
  const robin = await hired(company.id, 'Robin');
  assert.throws(() => engine.createTeam(company.id, { name: '', memberIds: [mila.id] }), /Namen/);
  assert.throws(() => engine.createTeam(company.id, { name: 'Leer', memberIds: [] }), /mindestens/);
  assert.throws(() => engine.createTeam(company.id, { name: 'Falsch', memberIds: ['niemand'] }), /gibt es nicht/);
  const team = engine.createTeam(company.id, { name: 'Produkt', purpose: 'Baut die App.', memberIds: [alex.id, alex.id, robin.id] });
  assert.deepEqual(team.memberIds, [alex.id, robin.id], 'Doppelte zählen einmal');
  assert.throws(() => engine.createTeam(company.id, { name: 'produkt', memberIds: [mila.id] }), /gibt es schon/);
  const mandate = await engine.startMandate(company.id, { goal: 'Landingpage', managerId: mila.id, budgetEur: 1, selfStartUpToEur: 0, teamId: team.id });
  const prompt = company.runs.at(-1)!.prompt;
  assert.match(prompt, /Team "Produkt"[\s\S]*Baut die App/);
  assert.match(prompt, /- Alex:[\s\S]*- Robin:/);
  assert.ok(!/- Mila:/.test(prompt), 'Der Manager gehört nicht zum Team und plant sich nicht selbst ein');
  await until(() => mandate.status === 'active', 'Planung');
  assert.deepEqual(mandate.proposals.map((p) => p.team.work), [alex.id, alex.id], 'Das Schema nennt nur das Team');
  assert.throws(() => engine.deleteTeam(company.id, team.id), /offenes Projekt/);
  engine.closeMandate(company.id, mandate.id);
  engine.updateTeam(company.id, team.id, { name: 'Produktteam', memberIds: [robin.id] });
  assert.deepEqual(team.memberIds, [robin.id]);
  assert.equal(team.purpose, 'Baut die App.', 'Was nicht geändert wird, bleibt');
  engine.deleteTeam(company.id, team.id);
  assert.equal(company.teams.length, 0);
  await assert.rejects(engine.startMandate(company.id, { goal: 'x', managerId: mila.id, budgetEur: 1, teamId: 'weg' }), /gibt es nicht/);
});

test('Die Belegung des Kontexts stammt aus der letzten Modellantwort, die Kostenschätzung aus den Listenpreisen', async () => {
  const company = newCompany();
  const agent = await hired(company.id);
  assert.equal(agent.context?.tokens, 10 + 200 + 1000, 'Eingabe, Cache gelesen, Cache geschrieben');
  for (const m of MODELS) assert.ok(m.contextWindow > 0 && m.maxOutput > 0, m.id);
  const haiku = modelById('claude-haiku-5-5')!.price;
  assert.ok(Math.abs(estimateStepUsd('claude-haiku-5-5', 1000, 100) - (1000 * haiku.read + 100 * haiku.write1h) / 1e6) < 1e-12);
  assert.ok(estimateStepUsd('claude-fable-5-1', 5000, 0) > estimateStepUsd('claude-haiku-5-5', 5000, 0));
  assert.ok(BASE_CONTEXT_TOKENS > 0);
});

test('Firmen und Mitarbeiter aus früheren Ständen laden ohne Stelle, Teams und Kontext', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-altstelle-'));
  const first = await makeEngine(data);
  const company = first.createCompany({ name: 'Alt', idea: 'x', locationId: 'garage', budgetEur: 5 });
  const agent = await first.hire(company.id, posting('Mila', { roleId: 'planung', skillIds: ['konzept'] }));
  await until(() => agent.hired, 'Einstellung');
  first.shutdown();
  const file = path.join(data, 'companies', company.id, 'company.json');
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete old.customSkills;
  delete old.teams;
  for (const key of ['job', 'briefedSkillIds', 'jobPending', 'context']) delete old.agents[0][key];
  fs.writeFileSync(file, JSON.stringify(old));
  const second = await makeEngine(data);
  const restored = second.snapshot(company.id).company;
  assert.deepEqual(restored.customSkills, []);
  assert.deepEqual(restored.teams, []);
  assert.equal(restored.agents[0].job, null);
  assert.deepEqual(restored.agents[0].briefedSkillIds, ['konzept'], 'Was im Profil stand, muss niemand nachreichen');
  assert.equal(restored.agents[0].context, null);
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

/* ---------- Subagents aus dem eingebundenen Projekt ---------- */

function subagentProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-subagenten-'));
  const dir = path.join(root, '.claude', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'entwickler.md'), '---\nname: entwickler\ndescription: Setzt Pakete um.\nmodel: sonnet\n---\n\nDu baust die App.\n');
  fs.writeFileSync(path.join(dir, 'finance.md'), '---\nname: finance\ndescription: "Prüft Kosten. Ändert nichts."\ntools: Read, Grep, Glob, Bash, WebFetch, Skill\n---\n\nDu prüfst Kosten.\n');
  fs.writeFileSync(path.join(dir, 'figur-3d.md'), '---\nname: figur-3d\ndescription: >\n  Baut den Kopf\n  in Blender.\ntools:\n  - Read\n  - Write\nmodel: inherit\n---\n\nDu modellierst.\n');
  fs.writeFileSync(path.join(dir, 'kaputt.md'), 'Kein Frontmatter.\n');
  fs.writeFileSync(path.join(dir, 'leer.md'), '---\nname: leer\n---\n');
  fs.writeFileSync(path.join(dir, 'notiz.txt'), 'keine Rolle');
  fs.symlinkSync('/etc/hosts', path.join(dir, 'link.md'));
  return root;
}

test('Subagents werden gelesen, Rechte und Modelle wie in der Datei, das Projekt bleibt unverändert', () => {
  const root = subagentProject();
  const before = fs.readdirSync(path.join(root, '.claude', 'agents')).sort();
  const company = engine.createCompany({ name: 'Projektteam', idea: 'x', locationId: 'garage', budgetEur: 5, projectDir: root });
  const list = engine.projectAgents(company.id);
  assert.deepEqual(list.map((a) => a.name), ['entwickler', 'figur-3d', 'finance'], 'Kaputtes, Leeres und Symlinks zählen nicht');
  const [dev, figure, finance] = list;
  assert.equal(dev.modelId, 'claude-sonnet-5-5');
  assert.equal(dev.readOnly, false, 'Ohne Werkzeugliste erbt ein Subagent alles');
  assert.equal(dev.wantsCommands, true);
  assert.equal(figure.modelId, null, 'inherit muss der Mensch entscheiden');
  assert.equal(figure.description, 'Baut den Kopf in Blender.');
  assert.equal(figure.readOnly, false);
  assert.equal(figure.wantsCommands, false);
  assert.equal(finance.readOnly, true);
  assert.equal(finance.wantsCommands, true);
  assert.deepEqual(finance.blockedTools, ['Bash', 'Skill']);
  assert.equal(finance.description, 'Prüft Kosten. Ändert nichts.');
  assert.deepEqual(fs.readdirSync(path.join(root, '.claude', 'agents')).sort(), before, 'Lesen ändert nichts');
  const plain = newCompany();
  assert.deepEqual(engine.projectAgents(plain.id), [], 'Ohne Projekt keine Subagents');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Ein Subagent wird echter Mitarbeiter und bekommt nicht mehr Rechte als in seiner Datei', async () => {
  const root = subagentProject();
  const company = engine.createCompany({ name: 'Projektteam2', idea: 'x', locationId: 'garage', budgetEur: 5, projectDir: root });
  company.buildPoints = 500;
  const finance = await engine.adoptProjectAgent(company.id, { file: '.claude/agents/finance.md', modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => finance.hired, 'Gespräch');
  assert.equal(finance.name, 'Finance');
  assert.equal(finance.job?.task, 'Prüft Kosten. Ändert nichts.');
  assert.equal(finance.origin?.readOnly, true);
  const profile = agentProfile(company, finance);
  assert.match(profile, /Du prüfst Kosten\./, 'Die Anweisung steht wörtlich im Profil');
  assert.match(profile, /änderst nichts/);
  assert.match(profile, /Befehle führst du nicht selbst aus/);
  assert.match(profile, /CLAUDE\.md/, 'Die Projektregeln werden nicht automatisch geladen, also der Hinweis');
  assert.equal(engine.projectAgents(company.id).find((a) => a.name === 'finance')?.adoptedBy, 'Finance');
  await assert.rejects(engine.adoptProjectAgent(company.id, { file: '.claude/agents/finance.md', modelId: 'claude-haiku-5-5', look: LOOK }), /schon Finance/);
  await assert.rejects(engine.adoptProjectAgent(company.id, { file: '.claude/agents/figur-3d.md', look: LOOK }), /kein Modell/);
  await assert.rejects(engine.adoptProjectAgent(company.id, { file: '../../etc/passwd', modelId: 'claude-haiku-5-5', look: LOOK }), /gibt es im Projekt nicht/);
  await assert.rejects(engine.adoptProjectAgent(company.id, { file: '.claude/agents/entwickler.md', look: LOOK }), /Arbeitsplatz/, 'Auch Subagents brauchen einen Schreibtisch');
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  const dev = await engine.adoptProjectAgent(company.id, { file: '.claude/agents/entwickler.md', look: LOOK });
  await until(() => dev.hired, 'Gespräch');
  assert.equal(dev.modelId, 'claude-sonnet-5-5', 'Das Modell aus der Datei gilt');
  assert.equal(dev.origin?.readOnly, false);
  const plain = newCompany();
  await assert.rejects(engine.adoptProjectAgent(plain.id, { file: 'x', look: LOOK }), /kein eingebundenes Projekt/);
  fs.rmSync(root, { recursive: true, force: true });
});

/* ---------- Befehle mit Freigabe ---------- */

/** Firma mit Projekt und einem übernommenen Subagent, der Befehle beantragen darf. */
async function commandCompany(file = '---\nname: macher\ndescription: Macht.\ntools: Read, Write, Bash\nmodel: haiku\n---\n\nDu machst.\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-befehl-'));
  fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'agents', 'macher.md'), file);
  const company = engine.createCompany({ name: 'Befehlsfirma', idea: 'x', locationId: 'garage', budgetEur: 5, projectDir: root });
  const agent = await engine.adoptProjectAgent(company.id, { file: '.claude/agents/macher.md', look: LOOK });
  await until(() => agent.hired, 'Gespräch');
  return { company, agent, root };
}
const ledgerOf = (companyId: string) => fs.readFileSync(path.join(dir, 'companies', companyId, 'befehle.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const idle = (company: { runs: { status: string }[] }) => !company.runs.some((r) => r.status === 'running');

test('Ein Befehl läuft erst nach der Freigabe, im Projektordner, und der Agent erfährt das Ergebnis', async () => {
  const { company, agent, root } = await commandCompany();
  const target = path.join(root, 'ergebnis.txt');
  await engine.chat(company.id, agent.id, '[szenario:befehl] [befehl:echo hallo > ergebnis.txt && cat ergebnis.txt] Bitte');
  await until(() => company.commands.length === 1 && idle(company), 'Antrag');
  const request = company.commands[0];
  assert.equal(request.status, 'pending');
  assert.equal(request.command, 'echo hallo > ergebnis.txt && cat ergebnis.txt');
  assert.equal(request.reason, 'Zum Prüfen.');
  assert.equal(fs.existsSync(target), false, 'Ohne Freigabe läuft nichts');
  assert.equal(agent.live.kind, 'review');
  assert.equal(agent.chat.at(-1)!.text, 'Ich möchte das prüfen.', 'Der Antrag steht nicht in der Antwort');
  await engine.decideCommand(company.id, request.id, { decision: 'approve' });
  await until(() => request.status !== 'running' && request.delivered && idle(company), 'Ergebnis');
  assert.equal(request.status, 'done');
  assert.equal(request.exitCode, 0);
  assert.equal(request.output.trim(), 'hallo');
  assert.equal(fs.readFileSync(target, 'utf8').trim(), 'hallo');
  assert.match(company.runs.at(-1)!.prompt, /freigegeben[\s\S]*Code 0[\s\S]*hallo/, 'Die Ausgabe geht an den Agenten');
  await assert.rejects(engine.decideCommand(company.id, request.id, { decision: 'approve' }), /schon entschieden/, 'Eine Freigabe gilt genau einmal');
  assert.deepEqual(ledgerOf(company.id).filter((l) => l.id === request.id).map((l) => l.event), ['beantragt', 'freigegeben', 'fertig']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Ein abgelehnter Befehl läuft nie, und der Agent erfährt es samt Begründung', async () => {
  const { company, agent, root } = await commandCompany();
  await engine.chat(company.id, agent.id, '[szenario:befehl] [befehl:touch nie.txt] Bitte');
  await until(() => company.commands.length === 1 && idle(company), 'Antrag');
  const request = company.commands[0];
  await engine.decideCommand(company.id, request.id, { decision: 'decline', note: 'Heute nicht.' });
  await until(() => request.delivered && idle(company), 'Ablehnung');
  assert.equal(request.status, 'declined');
  assert.equal(fs.existsSync(path.join(root, 'nie.txt')), false);
  assert.match(company.runs.at(-1)!.prompt, /abgelehnt[\s\S]*Heute nicht/);
  assert.equal(agent.live.kind, 'idle');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Nur wer laut Datei Befehle darf, kann einen beantragen', async () => {
  const noCommands = await commandCompany('---\nname: macher\ndescription: Macht.\ntools: Read, Write\nmodel: haiku\n---\n\nDu machst.\n');
  assert.equal(noCommands.agent.origin?.wantsCommands, false);
  assert.ok(!agentProfile(noCommands.company, noCommands.agent).includes('<<<BEFEHL'), 'Ohne Bash in der Datei erfährt er gar nicht davon');
  await engine.chat(noCommands.company.id, noCommands.agent.id, '[szenario:befehl] Bitte');
  await until(() => idle(noCommands.company), 'Antwort');
  assert.equal(noCommands.company.commands.length, 0, 'Der Antragstext bleibt bloßer Text');
  const plainCompany = newCompany();
  const plain = await hired(plainCompany.id);
  await engine.chat(plainCompany.id, plain.id, '[szenario:befehl] Bitte');
  await until(() => idle(plainCompany), 'Antwort');
  assert.equal(plainCompany.commands.length, 0, 'Selbst eingestellte Mitarbeiter dürfen es nicht');
  const { company, agent } = await commandCompany();
  assert.match(agentProfile(company, agent), /<<<BEFEHL/);
  fs.rmSync(noCommands.root, { recursive: true, force: true });
});

test('Im Auftrag wartet die Stufe auf die Entscheidung und läuft mit dem Ergebnis weiter', async () => {
  const { company, agent, root } = await commandCompany();
  const order = await engine.startOrder(company.id, orderInput(agent.id, 'Mit Befehl', { notes: '[szenario:befehl] [befehl:echo stufe]' }));
  await until(() => order.commandId !== null && order.commandId !== undefined && idle(company), 'Antrag');
  const stage = order.stages[0];
  const runsBefore = company.runs.length;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(order.status, 'running');
  assert.equal(stage.status, 'waiting');
  assert.equal(company.runs.length, runsBefore, 'Ohne Entscheidung kein neuer Lauf und kein Verbrauch');
  assert.ok(engine.money(company).reservedEur > 0, 'Das Limit bleibt reserviert');
  const request = company.commands.at(-1)!;
  await engine.decideCommand(company.id, request.id, { decision: 'approve' });
  await until(() => order.status === 'review', 'Stufe fertig');
  assert.match(company.runs.at(-1)!.prompt, /Code 0[\s\S]*stufe/);
  assert.equal(company.runs.at(-1)!.orderId, order.id);
  assert.equal(order.commandId, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Ein gestoppter Auftrag lässt seinen Antrag verfallen, ein laufender Befehl lässt sich stoppen', async () => {
  const first = await commandCompany();
  const order = await engine.startOrder(first.company.id, orderInput(first.agent.id, 'Wird gestoppt', { notes: '[szenario:befehl] [befehl:touch verfallen.txt]' }));
  await until(() => Boolean(order.commandId) && idle(first.company), 'Antrag');
  const request = first.company.commands.at(-1)!;
  engine.stopOrder(first.company.id, order.id);
  assert.equal(order.status, 'stopped');
  assert.equal(request.status, 'cancelled');
  await assert.rejects(engine.decideCommand(first.company.id, request.id, { decision: 'approve' }), /schon entschieden/, 'Ein verfallener Antrag lässt sich nicht mehr freigeben');
  assert.equal(fs.existsSync(path.join(first.root, 'verfallen.txt')), false);

  const { company, agent, root } = await commandCompany();
  await engine.chat(company.id, agent.id, '[szenario:befehl] [befehl:sleep 30] Bitte');
  await until(() => company.commands.length === 1 && idle(company), 'Antrag');
  const long = company.commands[0];
  assert.throws(() => engine.stopCommand(company.id, long.id), /läuft nicht/);
  await engine.decideCommand(company.id, long.id, { decision: 'approve' });
  assert.equal(long.status, 'running');
  assert.equal(agent.live.kind, 'waiting', 'Die Figur zeigt den laufenden Befehl');
  company.buildPoints = 500;
  assert.throws(() => engine.moveCompany(company.id, 'buero'), /Mitten in der Arbeit/);
  await assert.rejects(engine.chat(company.id, agent.id, 'Hallo'), /arbeitet gerade/);
  engine.stopCommand(company.id, long.id);
  await until(() => long.status === 'stopped' && long.delivered && idle(company), 'Stopp');
  assert.match(company.runs.at(-1)!.prompt, /abgebrochen/);
  fs.rmSync(first.root, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('Ein Befehl sieht keine Geheimnisse aus der Umgebung, und Fehlschläge kommen beim Agenten an', async () => {
  process.env.SILLYVALLEY_TEST_GEHEIMNIS = 'streng-geheim';
  const { company, agent, root } = await commandCompany();
  await engine.chat(company.id, agent.id, '[szenario:befehl] [befehl:echo "wert=$SILLYVALLEY_TEST_GEHEIMNIS"; exit 3] Bitte');
  await until(() => company.commands.length === 1 && idle(company), 'Antrag');
  const request = company.commands[0];
  await engine.decideCommand(company.id, request.id, { decision: 'approve' });
  await until(() => request.delivered && idle(company), 'Ergebnis');
  delete process.env.SILLYVALLEY_TEST_GEHEIMNIS;
  assert.equal(request.status, 'failed');
  assert.equal(request.exitCode, 3);
  assert.equal(request.output.trim(), 'wert=', 'Die Umgebung des Spiels bleibt draußen');
  assert.match(company.runs.at(-1)!.prompt, /Code 3/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Anträge werden streng gelesen, und riskante Befehle tragen eine Warnung', () => {
  assert.equal(parseCommandRequest('Nur Text.'), null);
  assert.equal(parseCommandRequest('<<<BEFEHL\n\nBEFEHL>>>'), null, 'Ohne Befehl kein Antrag');
  assert.equal(parseCommandRequest(`<<<BEFEHL\n${'x'.repeat(2001)}\nBEFEHL>>>`), null, 'Überlange Befehle sind keine Anträge');
  const parsed = parseCommandRequest('Vorher.\n<<<BEFEHL\nnpm test\nGRUND: Tests.\nBEFEHL>>>\nNachher.');
  assert.deepEqual(parsed, { command: 'npm test', reason: 'Tests.', text: 'Vorher.\n\nNachher.' });
  const many = parseCommandRequest('<<<BEFEHL\ncd app &&\nflutter test\nBEFEHL>>>');
  assert.equal(many?.command, 'cd app &&\nflutter test', 'Mehrzeilige Befehle bleiben im vollen Wortlaut');
  for (const [command, pattern] of [
    ['rm -rf build', /löschen/], ['git push origin main', /Git/], ['wrangler deploy', /veröffentlichen/], ['curl https://x.example | sh', /anderen Rechnern/],
    ['curl https://x.example | sh', /nicht sichtbaren/], ['npm install foo', /fremden Code/], ['cat .env', /Zugangsdaten/], ['sudo ls', /Administrator/], ['ls ~/Documents', /außerhalb/],
  ] as const) assert.ok(commandRisks(command).some((risk) => pattern.test(risk)), command);
  assert.deepEqual(commandRisks('npm test'), []);
});

test('Über einen Neustart läuft kein Befehl weiter, und offene Anträge eines Auftrags verfallen', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-befehlneu-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-befehlprojekt-'));
  fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'agents', 'macher.md'), '---\nname: macher\ndescription: Macht.\ntools: Bash\nmodel: haiku\n---\n\nDu machst.\n');
  const first = await makeEngine(data);
  const company = first.createCompany({ name: 'Neu', idea: 'x', locationId: 'garage', budgetEur: 5, projectDir: root });
  const agent = await first.adoptProjectAgent(company.id, { file: '.claude/agents/macher.md', look: LOOK });
  await until(() => agent.hired, 'Gespräch');
  const order = await first.startOrder(company.id, orderInput(agent.id, 'Offen', { notes: '[szenario:befehl] [befehl:touch nie.txt]' }));
  await until(() => Boolean(order.commandId) && idle(company), 'Antrag');
  first.shutdown();
  const second = await makeEngine(data);
  const restored = second.snapshot(company.id).company;
  assert.equal(restored.orders[0].status, 'stopped');
  assert.equal(restored.commands[0].status, 'cancelled');
  assert.equal(fs.existsSync(path.join(root, 'nie.txt')), false);
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('Rollen: definieren, Fähigkeit anhängen, daraus einstellen', async () => {
  const company = newCompany();
  assert.throws(() => engine.createRole(company.id, { title: '' }), /Namen/);
  assert.throws(() => engine.createRole(company.id, { title: 'Leer' }), /Aufgabe/, 'Eine Rolle ohne Inhalt sagt niemandem, was zu tun ist');
  assert.throws(() => engine.createRole(company.id, { title: 'X', task: 'y', skillIds: ['gibtsnicht'] }), /gibt es nicht/);
  assert.throws(() => engine.createRole(company.id, { title: 'X', task: 'y', modelId: 'gibtsnicht' }), /Modell/);
  assert.throws(() => engine.createRole(company.id, { title: 'X', customSkills: [{ title: 'A', instruction: 'a' }, { title: 'a', instruction: 'b' }] }), /heißen gleich/);
  assert.equal(company.customSkills.length, 0, 'Eine abgewiesene Rolle hinterlässt keine Fähigkeiten');

  const role = engine.createRole(company.id, {
    title: 'Newsletter-Redaktion', task: 'Du betreust den Newsletter.', requirements: 'Du kennst Vereine.', baseRoleId: 'text', skillIds: ['text'], modelId: 'claude-haiku-5-5',
    customSkills: [{ title: 'Unser Stil', instruction: 'Schreibe wie ein Vereinsmensch.', source: 'datei' }],
  });
  assert.throws(() => engine.createRole(company.id, { title: 'newsletter-redaktion', task: 'x' }), /gibt es schon/);
  assert.equal(company.agents.length, 0, 'Eine Rolle stellt noch niemanden ein');
  assert.equal(company.runs.length, 0, 'Eine Rolle kostet nichts');
  const custom = company.customSkills[0];
  assert.deepEqual(role.skillIds, ['text', custom.id]);
  assert.ok(fs.existsSync(path.join(dir, 'companies', company.id, 'workspace', custom.file)), 'Die Fähigkeit liegt als Datei im Arbeitsbereich');

  const agent = await engine.hire(company.id, { name: 'Sam', companyRoleId: role.id, look: LOOK });
  assert.equal(agent.roleId, 'text', 'Die Vorlage gibt die Grundhaltung');
  assert.equal(agent.modelId, 'claude-haiku-5-5', 'Ohne eigene Wahl gilt das Modell der Rolle');
  assert.equal(agentTitle(agent), 'Newsletter-Redaktion');
  assert.deepEqual(agent.skillIds, role.skillIds);
  assert.match(agentProfile(company, agent), /Du betreust den Newsletter[\s\S]*Du kennst Vereine[\s\S]*Schreibe wie ein Vereinsmensch/);
  await assert.rejects(engine.hire(company.id, { name: 'Lou', companyRoleId: 'weg', look: LOOK }), /gibt es nicht/);
  await until(() => agent.hired, 'Einstellung');
});

test('Rollen: Änderungen erreichen die Leute mit dem nächsten Lauf, Gelerntes bleibt', async () => {
  const company = newCompany();
  const role = engine.createRole(company.id, { title: 'Redaktion', task: 'Alte Aufgabe.', skillIds: ['text'] });
  const agent = await engine.hire(company.id, { name: 'Sam', companyRoleId: role.id, modelId: 'claude-sonnet-5-5', look: LOOK });
  assert.equal(agent.modelId, 'claude-sonnet-5-5', 'Beim Einstellen lässt sich ein anderes Modell wählen');
  await until(() => agent.hired, 'Einstellung');

  // Eine eigene Stelle bleibt, solange sich an der Stelle der Rolle nichts ändert.
  engine.updateJob(company.id, agent.id, { title: 'Chefredaktion', task: 'Eigene Aufgabe.' });
  agent.jobPending = false;
  engine.updateRole(company.id, role.id, { skillIds: ['text', 'recherche'], customSkills: [{ title: 'Neu gelernt', instruction: 'Prüfe jede Zahl doppelt.' }] });
  assert.equal(agent.job!.task, 'Eigene Aufgabe.');
  assert.equal(agent.jobPending, false);
  assert.ok(agent.skillIds.includes('recherche'));
  const added = company.customSkills.find((s) => s.title === 'Neu gelernt')!;
  assert.ok(agent.skillIds.includes(added.id));

  engine.updateRole(company.id, role.id, { task: 'Neue Aufgabe.', skillIds: ['recherche'] });
  assert.equal(agent.job!.task, 'Neue Aufgabe.');
  assert.equal(agent.jobPending, true);
  assert.ok(agent.skillIds.includes('text'), 'Was jemand gelernt hat, lässt sich nicht zurücknehmen');
  assert.deepEqual(role.skillIds, ['recherche'], 'Neue Leute bekommen nur, was die Rolle jetzt verlangt');

  await engine.chat(company.id, agent.id, 'Hallo');
  const prompt = company.runs.at(-1)!.prompt;
  assert.match(prompt, /Neue Aufgabe/);
  assert.match(prompt, /Prüfe jede Zahl doppelt/);
  await until(() => !company.runs.some((r) => r.status === 'running'), 'Gespräch');

  engine.deleteRole(company.id, role.id);
  assert.equal(company.roles.length, 0);
  assert.equal(agent.companyRoleId, null);
  assert.equal(agent.job!.task, 'Neue Aufgabe.', 'Wer die Rolle hatte, behält die Stelle');
  assert.throws(() => engine.updateRole(company.id, role.id, { title: 'x' }), /gibt es nicht/);
});

test('Teamaufgabe: Die Leitung verteilt nur im Team, ein Vertrag bringt die neue Person ins Team', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  engine.placeItem(company.id, { kind: 'desk', i: 6, j: 1, rot: 0 });
  const redaktion = engine.createRole(company.id, { title: 'Redaktion', task: 'Du schreibst.', baseRoleId: 'text', skillIds: ['text'] });
  const lead = await hired(company.id, 'Mila');
  const writer = await engine.hire(company.id, { name: 'Sam', companyRoleId: redaktion.id, look: LOOK });
  await until(() => writer.hired, 'Einstellung');
  const outsider = await hired(company.id, 'Robin');

  assert.throws(() => engine.createTeam(company.id, { name: 'Falsch', memberIds: [writer.id], leadId: lead.id }), /zum Team gehören/);
  const team = engine.createTeam(company.id, { name: 'Produkt', purpose: 'Baut die App.', memberIds: [lead.id, writer.id] });
  assert.equal(team.leadId, null);
  await assert.rejects(engine.startMandate(company.id, { goal: 'Text', budgetEur: 1, teamId: team.id }), /keine Teamleitung/);

  engine.updateTeam(company.id, team.id, { leadId: lead.id });
  const task = await engine.startMandate(company.id, { goal: 'Text', budgetEur: 1, teamId: team.id });
  assert.equal(task.managerId, lead.id, 'Die Aufgabe geht an die Teamleitung');
  const prompt = company.runs.at(-1)!.prompt;
  assert.match(prompt, /Sam: Redaktion[\s\S]*kann Texte[\s\S]*Du schreibst/, 'Die Leitung sieht Rolle, Fähigkeiten und Aufgabe');
  assert.ok(!/- Robin:/.test(prompt), `${outsider.name} gehört nicht zum Team`);
  assert.match(prompt, /Firmenleitung hat diese Rollen definiert[\s\S]*Redaktion/);
  await until(() => task.status === 'active', 'Planung');
  assert.ok(task.proposals.every((p) => p.team.work !== outsider.id));
  assert.ok(task.proposals.every((p) => p.status === 'pending'), 'Ohne Freigabe startet nichts');

  // Wer das Team verlässt, gibt die Leitung ab.
  engine.closeMandate(company.id, task.id);
  engine.updateTeam(company.id, team.id, { memberIds: [writer.id] });
  assert.equal(team.leadId, null);
});

test('Vertrag: Der Manager kann eine definierte Rolle vorschlagen, die Person kommt ins Team', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  const role = engine.createRole(company.id, { title: 'Redaktion', task: 'Du schreibst.', baseRoleId: 'text', customSkills: [{ title: 'Hausstil', instruction: 'Kurz und klar.' }] });
  assert.ok((manageSchema(['Mila'], ['Redaktion']) as any).properties.einstellungen.items.properties.rolle.enum.includes('Redaktion'));
  const lead = await hired(company.id, 'Mila');
  const team = engine.createTeam(company.id, { name: 'Produkt', memberIds: [lead.id], leadId: lead.id });
  const task = await engine.startMandate(company.id, { goal: 'Text', budgetEur: 1, teamId: team.id });
  await until(() => task.status === 'active', 'Planung');
  const contract = { id: 'cx', round: 1, name: 'Noa', roleId: role.baseRoleId, companyRoleId: role.id, skillIds: role.skillIds, modelId: 'claude-haiku-5-5', reason: 'Fehlt.', status: 'pending' as const, agentId: null, invalidReason: '', at: Date.now(), signedAt: null };
  task.contracts.push(contract);
  const shown = engine.contractOf(company.id, task.id, 'cx').text;
  assert.match(shown, /Rolle: Redaktion/);
  assert.match(shown, /Hausstil/, 'Der Vertrag nennt die Fähigkeit beim Namen, nicht als Kennung');
  const noa = (await engine.signContract(company.id, task.id, 'cx', { decision: 'sign' }))!;
  assert.equal(noa.companyRoleId, role.id);
  assert.equal(noa.job!.task, 'Du schreibst.');
  assert.ok(team.memberIds.includes(noa.id), 'Sonst könnte die Leitung sie nicht einplanen');
  await until(() => noa.hired, 'Einstellung');
});

test('Alte Spielstände bekommen Rollen und Teamleitung', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-alt-'));
  const first = await makeEngine(data);
  const company = first.createCompany({ name: 'Alt', idea: 'Idee', locationId: 'garage', budgetEur: 5 });
  const file = path.join(data, 'companies', company.id, 'company.json');
  first.shutdown();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const root = saved.company ?? saved;
  delete root.roles;
  root.teams = [{ id: 't1', name: 'T', purpose: '', memberIds: [], createdAt: 1 }];
  delete root.inventory;
  delete root.town.furnished;
  root.placed = root.placed.filter((p: { kind: string }) => p.kind === 'desk');
  fs.writeFileSync(file, JSON.stringify(saved));
  const second = await makeEngine(data);
  const loaded = second.snapshot(company.id).company;
  assert.deepEqual(loaded.roles, []);
  assert.equal(loaded.teams[0].leadId, null);
  assert.deepEqual(loaded.inventory, []);
  assert.ok(loaded.placed.some((p) => p.kind === 'workbench'), 'Was fest eingebaut war, wird zum Gegenstand');
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

test('Firmenschild: Name mit Corp., ohne doppelte Rechtsform, und jede Firma meldet ihren Sitz', () => {
  assert.equal(firmSign('Musterfirma'), 'Musterfirma Corp.');
  assert.equal(firmSign('  Rollenfirma '), 'Rollenfirma Corp.');
  assert.equal(firmSign('Muster GmbH'), 'Muster GmbH');
  assert.equal(firmSign('Acme Corp.'), 'Acme Corp.');
  assert.equal(firmSign('Agentur'), 'Agentur Corp.', 'Nur ein ganzes Wort zählt als Rechtsform');
  const company = newCompany();
  assert.equal(engine.summaries().find((c) => c.id === company.id)!.siteId, company.town.siteId);
});

test('Alles ist verschiebbar, auch was schon im Raum stand', () => {
  const company = newCompany();
  const bench = company.placed.find((p) => p.kind === 'workbench')!;
  assert.ok(bench, 'Die Garage bringt ihre Werkbank als Gegenstand mit');
  engine.moveItem(company.id, bench.id, { i: 3, j: 4, rot: 2 });
  assert.deepEqual([bench.i, bench.j, bench.rot], [3, 4, 2], 'Er wandert und dreht sich mit');
  assert.throws(() => engine.placeItem(company.id, { kind: 'workbench', i: 0, j: 3, rot: 0 }), /gibt es nicht/, 'Kaufen lässt er sich nicht');
  // Wo er stand, ist jetzt Platz.
  company.buildPoints = 100;
  engine.placeItem(company.id, { kind: 'plant', i: 5, j: 0, rot: 0 });
});

test('Wände: setzen, nicht doppelt, nur zwischen Feldern im Raum, entfernen', () => {
  const company = newCompany();
  const wall = engine.placeItem(company.id, { kind: 'wall', i: 1, j: 1, rot: 0 });
  assert.equal(wall.kind, 'wall');
  assert.throws(() => engine.placeItem(company.id, { kind: 'wall', i: 1, j: 1, rot: 0 }), /schon eine Wand/);
  assert.throws(() => engine.placeItem(company.id, { kind: 'wall', i: 0, j: 0, rot: 0 }), /zwischen zwei Feldern/, 'Am Raumrand gibt es keine Wand');
  engine.deleteItem(company.id, wall.id);
  assert.ok(!company.placed.some((p) => p.id === wall.id));
});

test('Zonen: Ein Raum aus Wänden und Tür wird mit Tisch zum Besprechungsraum', () => {
  const company = bigCompany();
  company.buildPoints = 500;
  const wall = (i: number, j: number, rot: 0 | 1) => engine.placeItem(company.id, { kind: 'wall', i, j, rot });
  for (let j = 2; j <= 6; j++) if (j !== 4) wall(6, j, 1);
  for (let i = 6; i <= 10; i++) {
    wall(i, 2, 0);
    wall(i, 7, 0);
  }
  assert.throws(() => engine.setZone(company.id, { i: 8, j: 4, kind: 'meeting', name: 'Runde' }), /kein eigener Raum/, 'Ohne Tür ist der Raum noch offen');
  engine.placeItem(company.id, { kind: 'door', i: 6, j: 4, rot: 1 });
  assert.throws(() => engine.placeItem(company.id, { kind: 'wall', i: 6, j: 4, rot: 1 }), /schon eine Tür/);
  assert.throws(() => engine.setZone(company.id, { i: 1, j: 1, kind: 'meeting', name: 'Flur' }), /kein eigener Raum/, 'Der Rest des Büros ist keine Zone');
  const zone = engine.setZone(company.id, { i: 8, j: 4, kind: 'meeting', name: 'Runde' });
  assert.equal(meetingRooms(company).length, 0, 'Ohne Tisch kein Besprechungsraum');
  const table = engine.placeItem(company.id, { kind: 'table', i: 7, j: 3, rot: 0 });
  assert.deepEqual(meetingRooms(company).map((r) => r.id), [table.id]);
  engine.placeItem(company.id, { kind: 'table', i: 9, j: 5, rot: 0 });
  assert.deepEqual(meetingRooms(company).map((r) => r.id), [table.id], 'An der Wand fehlt ein Platz: Dieser Tisch zählt nicht');
  const again = engine.setZone(company.id, { i: 9, j: 6, kind: 'break', name: 'Pause' });
  assert.equal(again.id, zone.id, 'Ein Raum hat genau eine Zone');
  engine.setZone(company.id, { i: 9, j: 6, kind: 'break', name: 'Pause', floorStyle: 'teppich' });
  assert.equal(zone.floorStyle, 'teppich', 'Der Raum bekommt seinen Boden');
  assert.throws(() => engine.setZone(company.id, { i: 9, j: 6, kind: 'break', name: 'Pause', floorStyle: 'lava' }), /Bodenbelag/);
  assert.equal(meetingRooms(company).length, 0, 'Als Pausenraum finden dort keine Besprechungen statt');
  engine.removeZone(company.id, zone.id);
  assert.equal((company.zones ?? []).length, 0);
});

test('Fensterwand und Glaswand versperren wie eine Wand, die Tür nicht; alle trennen Räume', () => {
  const at = (kind: 'wall' | 'door' | 'window' | 'glass') => ({ id: kind, kind, i: 2, j: 1, rot: 0 as const });
  for (const kind of ['wall', 'window', 'glass'] as const) assert.ok(blockedEdges([at(kind)]).has('2,0>2,1'), kind);
  assert.ok(!blockedEdges([at('door')]).has('2,0>2,1'), 'Durch die Tür geht man');
  for (const kind of ['wall', 'door', 'window', 'glass'] as const) {
    const fence = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ ...at(kind), id: `${kind}${i}`, i }));
    assert.ok(!regionOf(garage, fence, { i: 0, j: 0 }).has('0,1'), `${kind} trennt den Raum`);
  }
  // In die hinteren Außenwände gehen Fenster, aber keine Wand und keine Tür.
  assert.ok(checkPlacement(garage, [], { kind: 'window', i: 3, j: 0, rot: 0 }).ok);
  assert.ok(checkPlacement(garage, [], { kind: 'glass', i: 0, j: 3, rot: 1 }).ok);
  assert.ok(!checkPlacement(garage, [], { kind: 'wall', i: 3, j: 0, rot: 0 }).ok);
  assert.ok(!checkPlacement(garage, [], { kind: 'window', i: 3, j: 6, rot: 0 }).ok, 'Vorn ist aufgeschnitten');
});

test('Inventar: einlagern, kostenlos neu platzieren, löschen ohne Erstattung', async () => {
  const company = newCompany();
  company.buildPoints = 100;
  const plant = engine.placeItem(company.id, { kind: 'plant', i: 4, j: 4, rot: 0 });
  engine.storeItem(company.id, plant.id);
  assert.ok(!company.placed.includes(plant));
  assert.deepEqual(company.inventory.map((s) => s.kind), ['plant']);
  const stored = company.inventory[0].id;
  assert.throws(() => engine.placeItem(company.id, { inventoryId: 'weg', i: 4, j: 4, rot: 0 }), /nicht im Inventar/);
  assert.throws(() => engine.placeItem(company.id, { inventoryId: stored, i: 99, j: 4, rot: 0 }), /passt nicht/);
  assert.equal(company.inventory.length, 1, 'Ein abgewiesener Platz nimmt nichts aus dem Inventar');
  const again = engine.placeItem(company.id, { inventoryId: stored, i: 4, j: 3, rot: 1 });
  assert.equal(company.inventory.length, 0);
  engine.deleteItem(company.id, again.id);
  assert.ok(!company.placed.some((p) => p.id === again.id));
  engine.storeItem(company.id, company.placed.find((p) => p.kind === 'boxes')!.id);
  engine.deleteItem(company.id, company.inventory[0].id);
  assert.equal(company.inventory.length, 0);
  assert.throws(() => engine.deleteItem(company.id, 'weg'), /gibt es nicht/);

  const mila = await hired(company.id);
  assert.throws(() => engine.storeItem(company.id, mila.deskId), /Hier sitzt Mila/);
  assert.throws(() => engine.deleteItem(company.id, mila.deskId), /Hier sitzt Mila/);
});

test('Umzug: Einrichtung des alten Raums kommt ins Inventar, die neue nur beim ersten Einzug', () => {
  const company = newCompany();
  company.buildPoints = 10000;
  engine.moveCompany(company.id, 'kino');
  assert.ok(company.placed.some((p) => p.kind === 'sofa'), 'Das Kino bringt sein Sofa mit');
  assert.ok(!company.placed.some((p) => p.kind === 'workbench'));
  assert.deepEqual(company.inventory.map((s) => s.kind).sort(), ['boxes', 'tires', 'workbench']);
  engine.moveCompany(company.id, 'garage');
  assert.equal(company.placed.filter((p) => p.kind === 'workbench').length, 0, 'Die Werkbank liegt im Inventar und taucht nicht doppelt auf');
  assert.ok(company.inventory.some((s) => s.kind === 'sofa'));
  engine.moveCompany(company.id, 'kino');
  assert.equal(company.placed.filter((p) => p.kind === 'sofa').length, 0, 'Auch beim zweiten Einzug kein zweites Sofa');
});

test('Kündigen: Platz wird frei, Verlauf bleibt, offene Arbeit hält die Person', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  const mila = await hired(company.id, 'Mila');
  const alex = await hired(company.id, 'Alex');
  const desk = mila.deskId;
  const team = engine.createTeam(company.id, { name: 'T', memberIds: [mila.id, alex.id], leadId: mila.id });

  const project = await engine.startMandate(company.id, { goal: 'Plan', budgetEur: 1, teamId: team.id });
  await until(() => project.status === 'active', 'Planung');
  assert.throws(() => engine.fireAgent(company.id, mila.id), /Projekt "Plan"/);
  engine.closeMandate(company.id, project.id);

  const order = await engine.startOrder(company.id, orderInput(mila.id));
  assert.throws(() => engine.fireAgent(company.id, mila.id), /noch/);
  await until(() => order.status === 'review', 'Abnahme');
  assert.throws(() => engine.fireAgent(company.id, mila.id), /Auftrag "Namen finden"/);
  engine.decide(company.id, order.id, { decision: 'accept', checked: [true] });

  const seats = engine.snapshot(company.id).seats.used;
  const halted = await engine.startOrder(company.id, orderInput(mila.id, 'Abgebrochen'));
  engine.stopOrder(company.id, halted.id);
  await until(() => halted.status === 'stopped', 'Stopp');
  engine.fireAgent(company.id, mila.id);
  assert.equal(engine.snapshot(company.id).seats.used, seats - 1);
  await assert.rejects(engine.revise(company.id, halted.id, { feedback: 'Weiter' }), /nicht mehr hier/, 'Ein gestoppter Auftrag läuft nicht mit Gekündigten weiter');
  assert.equal(mila.deskId, '');
  assert.deepEqual(team.memberIds, [alex.id]);
  assert.equal(team.leadId, null, 'Die Leitung wird frei');
  assert.ok(company.agents.includes(mila), 'Der Verlauf kennt sie weiter');
  assert.ok(company.runs.some((r) => r.agentId === mila.id), 'Die Kosten bleiben im Buch');
  assert.ok(company.orders.includes(order));

  await assert.rejects(engine.chat(company.id, mila.id, 'Hallo'), /nicht mehr hier/);
  await assert.rejects(engine.startOrder(company.id, orderInput(mila.id)), /nicht mehr hier/);
  assert.throws(() => engine.fireAgent(company.id, mila.id), /nicht mehr hier/);

  // Der Platz ist wieder frei, und der Name auch. Es ist eine neue Person mit neuer Session.
  const again = await engine.hire(company.id, { name: 'Mila', roleId: 'text', modelId: 'claude-haiku-5-5', look: LOOK, deskId: desk });
  assert.notEqual(again.sessionId, mila.sessionId);
  await until(() => again.hired, 'Neue Einstellung');
});

test('Tafel: Zettel auslesen, begrenzen und aus der Antwort entfernen', () => {
  const block = (title: string) => `<<<ZETTEL\nTITEL: ${title}\nROLLE: tester\nHINWEIS: Eins\nHINWEIS: Zwei\nKRITERIUM: A\nKRITERIUM: B\nZETTEL>>>`;
  const parsed = parseNotes(`Vorher.\n${block('Eins')}\nMitte.\n<<<ZETTEL\nROLLE: ohne Titel\nZETTEL>>>\n${block('Zwei')}`, 10);
  assert.deepEqual(parsed.notes.map((n) => n.title), ['Eins', 'Zwei'], 'Ohne Titel kein Zettel');
  assert.equal(parsed.notes[0].notes, 'Eins\nZwei');
  assert.deepEqual(parsed.notes[0].criteria, ['A', 'B']);
  assert.ok(!parsed.text.includes('ZETTEL') && parsed.text.includes('Mitte'), 'Die Antwort bleibt lesbar');
  assert.equal(parseNotes(`${block('A')}${block('B')}${block('C')}`, 2).notes.length, 2);
  assert.equal(parseNotes('Keine Zettel.', 5).text, 'Keine Zettel.');
});

test('Tafel: Ein Agent hängt Zettel an, verteilt wird erst durch den Menschen', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  const mila = await hired(company.id, 'Mila');
  const alex = await hired(company.id, 'Alex');
  await engine.chat(company.id, mila.id, 'Was als Nächstes? [szenario:zettel]');
  assert.match(company.runs.at(-1)!.prompt, /<<<ZETTEL/, 'Der Agent erfährt, wie ein Zettel aussieht');
  await until(() => !company.runs.some((r) => r.status === 'running'), 'Gespräch');
  assert.deepEqual(company.board.map((n) => [n.title, n.status]), [['Ist-Stand prüfen', 'open'], ['Kosten rechnen', 'open']]);
  assert.equal(company.orders.length, 0, 'Ein Zettel startet nichts');
  assert.ok(!mila.chat.at(-1)!.text.includes('ZETTEL'), 'Im Gespräch steht kein Rohtext');
  assert.equal(boardNotes(company).length, 2);

  // Dieselbe Aufgabe hängt nicht zweimal.
  await engine.chat(company.id, mila.id, 'Nochmal [szenario:zettel]');
  await until(() => !company.runs.some((r) => r.status === 'running'), 'Zweites Gespräch');
  assert.equal(company.board.length, 2);

  const [check, costs] = company.board;
  assert.equal(check.byAgentId, mila.id);
  await assert.rejects(engine.startOrder(company.id, orderInput(alex.id, 'Falsch', { noteId: 'weg' })), /gibt es nicht/);
  assert.equal(company.orders.length, 0);
  await assert.rejects(engine.startOrder(company.id, orderInput(alex.id, 'Zu teuer', { noteId: check.id, limitEur: 999 })), /reicht nicht/);
  assert.equal(check.status, 'open', 'Scheitert der Auftrag, bleibt der Zettel hängen');

  const order = await engine.startOrder(company.id, orderInput(alex.id, check.title, { noteId: check.id }));
  assert.equal(check.status, 'taken');
  assert.equal(check.orderId, order.id);
  assert.equal(noteTaker(company, check.id), alex.id, 'Wer daran arbeitet, holt den Zettel');
  assert.deepEqual(boardNotes(company).map((n) => n.id), [costs.id]);
  await until(() => order.status === 'review', 'Abnahme');
  await assert.rejects(engine.startOrder(company.id, orderInput(alex.id, 'Nochmal', { noteId: check.id })), /nicht mehr an der Tafel/);

  engine.dropNote(company.id, costs.id);
  assert.equal(costs.status, 'dropped');
  assert.equal(noteTaker(company, costs.id), null, 'Weggeworfenes holt niemand');
  assert.equal(boardNotes(company).length, 0);
});

test('Tafel: Ein Zettel wird zum Teamprojekt, Vorschläge eines Projekts hängen auch dort', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  const mila = await hired(company.id, 'Mila');
  const team = engine.createTeam(company.id, { name: 'T', memberIds: [mila.id], leadId: mila.id });
  await engine.chat(company.id, mila.id, 'Vorschläge? [szenario:zettel]');
  await until(() => !company.runs.some((r) => r.status === 'running'), 'Gespräch');
  const note = company.board[0];
  const project = await engine.startMandate(company.id, { goal: note.title, budgetEur: 1, teamId: team.id, noteId: note.id });
  assert.equal(note.status, 'taken');
  assert.equal(note.mandateId, project.id);
  assert.equal(noteTaker(company, note.id), mila.id, 'Die Leitung holt den Zettel');
  await until(() => project.status === 'active', 'Planung');
  const proposals = boardNotes(company).filter((n) => n.kind === 'vorschlag');
  assert.deepEqual(proposals.map((n) => n.id), project.proposals.filter((p) => p.status === 'pending').map((p) => p.id));
  assert.ok(proposals.every((n) => n.byAgentId === mila.id && n.mandateId === project.id));
  await engine.decideProposal(company.id, project.id, proposals[0].id, { decision: 'decline' });
  assert.ok(!boardNotes(company).some((n) => n.id === proposals[0].id), 'Abgelehntes hängt nicht mehr');
});

test('Tafel: Eigene Zettel kosten nichts und lassen sich vergeben', async () => {
  const company = newCompany();
  const mila = await hired(company.id, 'Mila');
  const runs = company.runs.length;
  assert.throws(() => engine.createNote(company.id, { title: '  ' }), /was zu tun ist/);
  const note = engine.createNote(company.id, { title: 'Preise vergleichen', notes: 'Drei Anbieter', role: 'Mila', criteria: ['Tabelle', '', ' Fazit '] });
  assert.deepEqual(note.criteria, ['Tabelle', 'Fazit']);
  assert.equal(note.byAgentId, null);
  assert.equal(company.runs.length, runs, 'Ein Zettel löst keinen Lauf aus');
  assert.throws(() => engine.createNote(company.id, { title: 'preise vergleichen' }), /gibt es schon/);
  assert.deepEqual(boardNotes(company).map((n) => n.kind), ['eigen']);
  const order = await engine.startOrder(company.id, orderInput(mila.id, note.title, { noteId: note.id, criteria: note.criteria }));
  assert.equal(note.status, 'taken');
  assert.equal(noteTaker(company, note.id), mila.id, 'Auch einen eigenen Zettel holt, wer ihn bekommt');
  await until(() => order.status === 'review', 'Abnahme');
});

test('Anzeige: ss statt ß, doch Dateinamen in Attributen bleiben richtig', () => {
  const path = 'ergebnisse/größe.md';
  const out = html`<button data-path="${path}">Draußen: ${'Größe'}</button>`.value;
  assert.ok(out.includes('data-path="ergebnisse/größe.md"'), 'Der Pfad muss weiter stimmen');
  assert.ok(out.includes('Draussen: Grösse'));
  assert.ok(!out.replace(path, '').includes('ß'));
});

const builtHome = (size: 'grund-birke' | 'grund-elm' = 'grund-birke') => {
  const company = newCompany();
  company.buildPoints = 5000;
  engine.townAction(company.id, size, { action: 'buy' });
  engine.townAction(company.id, size, { action: 'build' });
  engine.townAction(company.id, size, { action: 'move' });
  return company;
};

test('Anbau: nur am eigenen Haus, nur soweit das Grundstück reicht', () => {
  const rented = newCompany();
  rented.buildPoints = 1000;
  assert.throws(() => engine.expandBuilding(rented.id, { kind: 'breiter' }), /eigenen Neubau/);
  const company = builtHome();
  const start = roomOf(company);
  engine.expandBuilding(company.id, { kind: 'breiter' });
  engine.expandBuilding(company.id, { kind: 'tiefer' });
  assert.deepEqual([roomOf(company).w, roomOf(company).d], [start.w + 1, start.d + 1]);
  assert.equal(roomOf(company).door.j, roomOf(company).d - 1, 'Die Tür bleibt in der Wand zur Strasse');
  engine.placeItem(company.id, { kind: 'plant', i: start.w, j: start.d, rot: 0 });
  engine.expandBuilding(company.id, { kind: 'breiter' });
  engine.expandBuilding(company.id, { kind: 'breiter' });
  assert.throws(() => engine.expandBuilding(company.id, { kind: 'breiter' }), /Grundstück nicht her/);
  company.buildPoints = 0;
});

test('Stockwerke: Du wählst den Platz für den Aufgang, Möbel und Abteilungen gehören zu ihrer Etage', async () => {
  const company = builtHome();
  assert.throws(() => engine.placeItem(company.id, { kind: 'plant', floor: 1, i: 1, j: 1, rot: 0 }), /Etage gibt es nicht/);
  assert.throws(() => engine.expandBuilding(company.id, { kind: 'etage' }), /Platz für Treppe/);
  assert.throws(() => engine.addShaft(company.id, { kind: 'lift', i: 1, j: 1, rot: 0 }), /zweites Stockwerk/);
  const occupied = engine.placeItem(company.id, { kind: 'plant', i: 2, j: 6, rot: 0 });
  assert.throws(() => engine.expandBuilding(company.id, { kind: 'etage', shaft: { kind: 'stairs', i: 1, j: 6, rot: 0 } }), /Feld frei bleiben/);
  assert.throws(() => engine.expandBuilding(company.id, { kind: 'etage', shaft: { kind: 'stairs', i: 0, j: 0, rot: 2 } }), /freies Feld im Raum/, 'Die Drehung wählt die Seite');
  engine.deleteItem(company.id, occupied.id);
  engine.expandBuilding(company.id, { kind: 'etage', shaft: { kind: 'stairs', i: 1, j: 6, rot: 0 } });
  const stairs = company.placed.filter((p) => p.kind === 'stairs');
  assert.deepEqual(stairs.map((p) => p.floor ?? 0).sort(), [0, 1], 'Auf jeder Etage an derselben Stelle');
  assert.throws(() => engine.moveItem(company.id, stairs[0].id, { i: 3, j: 3, rot: 0 }), /bleibt, wo sie ist/);
  assert.throws(() => engine.deleteItem(company.id, stairs[0].id), /einzige Weg/);
  assert.throws(() => engine.storeItem(company.id, stairs[0].id), /bleibt, wo sie ist/);
  assert.throws(() => engine.expandBuilding(company.id, { kind: 'etage' }), /Grundstück nicht her/, 'Das kleine Grundstück trägt zwei Etagen');

  // Oben ist derselbe Platz frei, auf dem unten etwas steht.
  const below = engine.placeItem(company.id, { kind: 'desk', i: 4, j: 3, rot: 0 });
  const above = engine.placeItem(company.id, { kind: 'desk', floor: 1, i: 4, j: 3, rot: 0 });
  assert.equal(above.floor, 1);
  assert.equal(below.floor, undefined);
  const landing = roomOf(company).keep![0];
  assert.deepEqual(landing, { i: 2, j: 6 });
  assert.throws(() => engine.placeItem(company.id, { kind: 'plant', floor: 1, ...landing, rot: 0 }), /belegt/, 'Vor der Treppe bleibt es frei');

  // Ein Fahrstuhl muss auf allen Etagen passen. Danach darf die Treppe weg.
  assert.throws(() => engine.addShaft(company.id, { kind: 'lift', i: 4, j: 3, rot: 0 }), /OG|EG/);
  engine.addShaft(company.id, { kind: 'lift', i: 8, j: 6, rot: 2 });
  assert.equal(company.placed.filter((p) => p.kind === 'lift').length, 2);
  engine.deleteItem(company.id, stairs[1].id);
  assert.equal(company.placed.filter((p) => p.kind === 'stairs').length, 0, 'Der Aufgang verschwindet von allen Etagen');
  assert.deepEqual(roomOf(company, 1).door, { i: 7, j: 6 }, 'Oben kommt man jetzt am Fahrstuhl an');

  const mila = await engine.hire(company.id, { name: 'Mila', roleId: 'text', modelId: 'claude-haiku-5-5', look: LOOK, deskId: above.id });
  await until(() => mila.hired, 'Einstellung');
  assert.equal(engine.snapshot(company.id).seats.total, company.placed.filter((p) => p.kind === 'desk').length, 'Plätze zählen über alle Etagen');
  const up = engine.createDepartment(company.id, { name: 'Oben', floor: 1, i: 3, j: 2, w: 3, d: 3, budgetEur: 0 });
  assert.equal(engine.departmentOfAgent(company, mila)?.id, up.id);
  // Dieselben Felder unten gehören nicht zur Abteilung oben.
  const down = await engine.hire(company.id, { name: 'Alex', roleId: 'text', modelId: 'claude-haiku-5-5', look: LOOK, deskId: below.id });
  await until(() => down.hired, 'Zweite Einstellung');
  assert.equal(engine.departmentOfAgent(company, down), null);

  engine.placeItem(company.id, { kind: 'plant', floor: 1, i: 0, j: 0, rot: 0 });
  engine.moveItem(company.id, above.id, { floor: 0, i: 6, j: 3, rot: 0 });
  assert.equal(above.floor, undefined, 'Möbel wechseln die Etage');
  assert.equal(engine.departmentOfAgent(company, mila), null, 'Mit dem Tisch wechselt die Abteilung');
});

test('Abteilung neu abstecken: Grösse und Platz ändern sich, wer im Bereich sitzt, gehört dazu', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  const mila = await hired(company.id, 'Mila');
  const desk = company.placed.find((p) => p.id === mila.deskId)!;
  const zone = engine.createDepartment(company.id, { name: 'Produkt', i: desk.i, j: desk.j, w: 2, d: 2, budgetEur: 1 });
  const other = engine.createDepartment(company.id, { name: 'Vertrieb', i: desk.i + 3, j: desk.j, w: 2, d: 2, budgetEur: 0 });
  assert.equal(engine.departmentOfAgent(company, mila)?.id, zone.id);
  assert.throws(() => engine.updateDepartment(company.id, zone.id, { i: desk.i + 2, j: desk.j, w: 2, d: 2 }), /Vertrieb/);
  assert.throws(() => engine.updateDepartment(company.id, zone.id, { i: desk.i, j: desk.j, w: 1, d: 1 }), /mindestens/);
  assert.throws(() => engine.updateDepartment(company.id, zone.id, { i: 99, j: 0, w: 2, d: 2 }), /passt nicht/);
  engine.updateDepartment(company.id, zone.id, { i: 0, j: 4, w: 2, d: 2 });
  assert.deepEqual([zone.i, zone.j], [0, 4]);
  assert.equal(zone.budgetEur, 1, 'Das Budget bleibt');
  assert.equal(engine.departmentOfAgent(company, mila), null, 'Wer nicht mehr im Bereich sitzt, gehört nicht mehr dazu');
  engine.updateDepartment(company.id, zone.id, { i: desk.i, j: desk.j, w: 3, d: 2 });
  assert.equal(engine.departmentOfAgent(company, mila)?.id, zone.id);
  assert.equal(zone.w, 3, 'Vergrössern geht auch über das eigene alte Feld hinweg');
  engine.dissolveDepartment(company.id, other.id);
  assert.equal(company.departments.length, 1);
});

test('Umzug: Das eigene Haus behält Anbau und Etagen', () => {
  const company = builtHome();
  engine.expandBuilding(company.id, { kind: 'etage', shaft: { kind: 'lift', i: 8, j: 6, rot: 2 } });
  engine.placeItem(company.id, { kind: 'plant', floor: 1, i: 5, j: 5, rot: 0 });
  engine.moveCompany(company.id, 'garage');
  assert.equal(company.placed.filter((p) => p.kind === 'lift').length, 0, 'In der Garage gibt es keinen Fahrstuhl');
  assert.ok(company.placed.every((p) => !p.floor), 'Alles steht unten');
  engine.townAction(company.id, 'grund-birke', { action: 'move' });
  assert.equal(buildingAt(company.town, company.town.siteId).floors, 2);
  assert.equal(company.placed.filter((p) => p.kind === 'lift').length, 2, 'Der Fahrstuhl steht wieder');
});

test('Hilfe: Ein Agent fragt im Auftrag einen Kollegen, wartet und arbeitet mit der Antwort weiter', async () => {
  const company = bigCompany();
  company.buildPoints = 500;
  const room = placeRoom(company.id);
  addDesk(company.id, 7, 1);
  addDesk(company.id, 7, 4);
  const mila = await hired(company.id, 'Mila');
  const alex = await hired(company.id, 'Alex');
  const order = await engine.startOrder(company.id, orderInput(mila.id, 'Bericht', { notes: '[szenario:hilfe][an:Alex]' }));
  assert.match(company.runs.at(-1)!.prompt, /Deine Kollegen:\n- Alex/);
  await until(() => order.status === 'review', 'Abnahme');
  const help = company.helps[0];
  assert.equal(help.fromId, mila.id);
  assert.equal(help.toId, alex.id);
  assert.equal(help.status, 'done');
  assert.equal(help.roomId, room.id, 'Die beiden treffen sich im Besprechungsraum');
  assert.equal(help.delivered, true);
  const answer = company.runs.find((r) => r.kind === 'help')!;
  assert.equal(answer.agentId, alex.id);
  assert.equal(answer.orderId, order.id, 'Die Hilfe zahlt das Limit des Auftrags');
  assert.ok(answer.limitEur <= RULES.helpLimitEur);
  assert.match(answer.prompt, /keine Anweisung der Firmenleitung/);
  const next = company.runs.filter((r) => r.agentId === mila.id && r.orderId === order.id).at(-1)!;
  assert.match(next.prompt, /Antwort von Alex/);
  assert.ok(!company.runs.some((r) => r.text.includes('<<<HILFE')), 'Der Rohtext ist weg');
  assert.ok(alex.chat.some((l) => l.text.startsWith('Antwort an Mila')));
});

test('Hilfe: Grenzen, unbekannte Kollegen und Gespräche', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  const mila = await hired(company.id, 'Mila');
  const alex = await hired(company.id, 'Alex');
  await engine.chat(company.id, mila.id, 'Frag doch [szenario:hilfe][an:Niemand]');
  await until(() => !company.runs.some((r) => r.status === 'running'), 'Gespräch');
  assert.equal(company.helps.length, 0, 'Wen es nicht gibt, kann niemand fragen');
  assert.ok(company.notices.some((n) => n.text.includes('Niemand')));

  await engine.chat(company.id, mila.id, 'Frag doch [szenario:hilfe][an:Alex]');
  await until(() => company.helps[0]?.delivered && !company.runs.some((r) => r.status === 'running'), 'Hilfe im Gespräch');
  assert.equal(company.helps.length, 1, 'Das Einarbeiten stellt keine neue Frage');
  assert.equal(company.helps[0].roomId, null, 'Ohne Raum gibt es keinen Treffpunkt');
  assert.match(company.runs.at(-1)!.prompt, /Antwort von Alex/);
  assert.equal(company.runs.at(-1)!.helpFollowUp, true);
  assert.ok(alex.chat.some((l) => l.text.startsWith('Antwort an Mila')));

  // Ein Auftrag fragt nur begrenzt oft.
  const order = await engine.startOrder(company.id, orderInput(mila.id, 'Viel fragen', { notes: '[szenario:ok]' }));
  await until(() => order.status === 'review', 'Abnahme');
  company.helps.push(...Array.from({ length: RULES.helpsPerOrder }, (_, n) => ({ id: `x${n}`, fromId: mila.id, toId: alex.id, question: 'q', answer: 'a', status: 'done' as const, orderId: order.id, roomId: null, delivered: true, at: 1 })));
  await engine.revise(company.id, order.id, { feedback: 'Weiter [szenario:hilfe]', addLimitEur: 1 });
  await until(() => order.status === 'review', 'Korrektur');
  assert.equal(company.helps.filter((h) => h.orderId === order.id).length, RULES.helpsPerOrder, 'Mehr Fragen gibt es nicht');
});

test('Weitergeben: Passt der Auftrag nicht, geht er an den Besseren, und die Stufe läuft dort', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  const robin = await hired(company.id, 'Robin');
  const sam = await hired(company.id, 'Sam');
  const order = await engine.startOrder(company.id, orderInput(robin.id, 'Flyer', { notes: '[szenario:weitergeben][zu:Sam]', noteId: engine.createNote(company.id, { title: 'Flyer' }).id }));
  const first = company.runs.at(-1)!;
  assert.match(first.prompt, /<<<WEITERGEBEN/);
  assert.match(first.prompt, /Sam: Planung/, 'Robin kennt Sam und weiss, was Sam kann');
  await until(() => order.status === 'review', 'Abnahme');
  const work = order.stages.find((s) => s.kind === 'work')!;
  assert.equal(work.agentId, sam.id, 'Der Auftrag liegt jetzt bei Sam');
  assert.deepEqual(order.handedBy, [robin.id]);
  assert.ok(robin.chat.some((l) => l.text.startsWith('Gibt "Flyer" an Sam')));
  const second = company.runs.filter((r) => r.orderId === order.id).at(1)!;
  assert.equal(second.agentId, sam.id);
  assert.match(second.prompt, /Robin hat dir diesen Auftrag gegeben/);
  assert.equal(order.stages.length, 1);
  assert.ok(!company.runs.some((r) => r.text.includes('<<<WEITERGEBEN')), 'Der Rohtext ist weg');
});

test('Weitergeben: Der Server lehnt ab, was nicht geht, und niemand bekommt den Auftrag zurück', async () => {
  assert.equal(parseHandover('Nichts davon.'), null);
  assert.equal(parseHandover('A\n<<<WEITERGEBEN\nAN: Sam\nGRUND: Passt.\nWEITERGEBEN>>>')!.to, 'Sam');
  const company = newCompany();
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  const robin = await hired(company.id, 'Robin');
  await hired(company.id, 'Sam');
  // Wen es nicht gibt, der bekommt nichts. Robin arbeitet selbst weiter.
  const order = await engine.startOrder(company.id, orderInput(robin.id, 'Flyer', { notes: '[szenario:weitergeben][zu:Niemand]' }));
  await until(() => order.status === 'review', 'Abnahme');
  assert.equal(order.stages[0].agentId, robin.id);
  assert.equal(order.handoverDenied, true);
  assert.equal(order.handedBy, undefined);
  assert.match(company.runs.filter((r) => r.orderId === order.id).at(1)!.prompt, /nicht weitergeben/);
  assert.ok(company.notices.some((n) => n.text.includes('Niemand')));
});

test('Kennenlernen: Der Neue geht zu jedem Kollegen, und erst dann stehen sie in seinen Anweisungen', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  engine.placeItem(company.id, { kind: 'desk', i: 6, j: 1, rot: 0 });
  const mila = await hired(company.id, 'Mila');
  const alex = await hired(company.id, 'Alex');
  assert.deepEqual(mila.knownIds, [alex.id], 'Beide kennen sich danach');
  engine.tourStepMs = 40;
  const noa = await hired(company.id, 'Noa');
  const shown: string[] = [];
  await until(() => {
    if (noa.live.kind === 'handoff' && shown.at(-1) !== noa.live.detail) shown.push(noa.live.detail);
    return noa.knownIds.length === 2 && noa.live.kind === 'idle';
  }, 'Runde');
  engine.tourStepMs = 0;
  assert.deepEqual(shown, ['fragt Mila nach den Fähigkeiten', 'fragt Alex nach den Fähigkeiten']);
  assert.ok(noa.chat.some((l) => l.text.startsWith('Kennengelernt: Mila')));
  assert.ok(mila.knownIds.includes(noa.id), 'Auch die Kollegen wissen jetzt, was Noa kann');
  assert.equal(company.runs.filter((r) => r.agentId === noa.id).length, 1, 'Die Runde selbst kostet keinen Lauf');
  await engine.chat(company.id, noa.id, 'Hallo');
  assert.match(company.runs.at(-1)!.prompt, /Mila: Planung[\s\S]*Alex: Planung/);
  await until(() => !company.runs.some((r) => r.status === 'running'), 'Gespräch');
});

test('Kennenlernen: Kommt Arbeit dazwischen, endet die Runde, das Wissen bleibt', async () => {
  const company = newCompany();
  company.buildPoints = 500;
  engine.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  engine.placeItem(company.id, { kind: 'desk', i: 6, j: 1, rot: 0 });
  await hired(company.id, 'Mila');
  await hired(company.id, 'Alex');
  engine.tourStepMs = 30;
  const noa = await hired(company.id, 'Noa');
  engine.tourStepMs = 0;
  await engine.chat(company.id, noa.id, 'Sofort etwas tun');
  await until(() => noa.knownIds.length === 2, 'Wissen');
  await until(() => !company.runs.some((r) => r.status === 'running'), 'Gespräch');
});

test('Hilfe: Ein Neustart beendet eine offene Anfrage, und niemand bleibt beim Warten stehen', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-hilfe-'));
  const first = await makeEngine(data);
  const company = first.createCompany({ name: 'Neustart', idea: 'x', locationId: 'garage', budgetEur: 5 });
  company.buildPoints = 100;
  first.placeItem(company.id, { kind: 'desk', i: 5, j: 3, rot: 0 });
  const mila = await first.hire(company.id, { name: 'Mila', roleId: 'text', modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => mila.hired, 'Mila');
  const alex = await first.hire(company.id, { name: 'Alex', roleId: 'text', modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => alex.hired, 'Alex');
  company.helps.push({ id: 'h1', fromId: mila.id, toId: alex.id, question: 'q', answer: '', status: 'running', orderId: null, roomId: null, delivered: false, at: 1 });
  mila.live = { kind: 'waiting', detail: 'fragt Alex', since: 1, runId: null, targetId: null };
  first.shutdown();
  const second = await makeEngine(data);
  const loaded = second.snapshot(company.id).company;
  assert.equal(loaded.helps[0].status, 'failed');
  assert.equal(loaded.agents.find((a) => a.name === 'Mila')!.live.kind, 'idle');
  second.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

test('Geschäftsführung: Name und Aussehen sind deine, sonst ändert sich nichts', () => {
  const company = newCompany();
  assert.equal(company.ceo, undefined);
  engine.updateCeo(company.id, { name: ' Kim ', look: { hair: 'locken', glasses: true } });
  assert.equal(company.ceo!.name, 'Kim');
  assert.equal(company.ceo!.look.hair, 'locken');
  assert.equal(company.ceo!.look.top, '#f8b62d', 'Was du nicht änderst, bleibt');
  assert.throws(() => engine.updateCeo(company.id, { name: ' ' }), /Namen/);
  assert.throws(() => engine.updateCeo(company.id, { name: 'x'.repeat(21) }), /20 Zeichen/);
  assert.throws(() => engine.updateCeo(company.id, { look: { hairColor: 'url(x)' } }), /aussehen/);
  assert.throws(() => engine.updateCeo(company.id, { look: { hair: 'glatze' as never } }), /aussehen/);
  assert.equal(company.agents.length, 0, 'Du zählst nicht als Mitarbeiter');
  assert.equal(engine.snapshot(company.id).seats.used, 0);
});

test('Chefschreibtisch: kostenlos, nur einmal, kein Platz für Mitarbeiter', () => {
  const company = newCompany();
  company.buildPoints = 0;
  const seats = engine.snapshot(company.id).seats.total;
  const desk = engine.placeItem(company.id, { kind: 'ceoDesk', i: 2, j: 3, rot: 1 });
  assert.equal(engine.snapshot(company.id).seats.total, seats, 'Niemand sonst sitzt dort');
  assert.throws(() => engine.placeItem(company.id, { kind: 'ceoDesk', i: 5, j: 3, rot: 0 }), /schon einen/);
  engine.storeItem(company.id, desk.id);
  assert.throws(() => engine.placeItem(company.id, { kind: 'ceoDesk', i: 5, j: 3, rot: 0 }), /schon einen/, 'Auch im Inventar zählt er');
  engine.placeItem(company.id, { inventoryId: desk.id, i: 5, j: 3, rot: 0 });
  assert.equal(company.placed.filter((p) => p.kind === 'ceoDesk').length, 1);
});

test('Tafel: Kommen auf Bitte keine Zettel, erfährt die Firmenleitung das', async () => {
  const company = newCompany();
  const mila = await hired(company.id, 'Mila');
  await engine.chat(company.id, mila.id, 'Nur ein Gruss');
  await until(() => !company.runs.some((r) => r.status === 'running'), 'Gespräch');
  assert.ok(!company.notices.some((n) => n.text.includes('keine neuen Zettel')), 'Im normalen Gespräch ist das kein Thema');
  await engine.chat(company.id, mila.id, 'Vorschläge bitte', { expectNotes: true });
  await until(() => !company.runs.some((r) => r.status === 'running'), 'Gespräch');
  assert.ok(company.notices.some((n) => n.text === 'Mila hat keine neuen Zettel an die Tafel gehängt.'));
});

test('Akte: Mitgebracht und dazugelernt bleiben getrennt', async () => {
  const company = newCompany();
  const mila = await hired(company.id, 'Mila');
  assert.deepEqual(mila.startSkillIds, ['konzept']);
  engine.addAgentSkill(company.id, mila.id, { skillId: 'recherche' });
  engine.addAgentSkill(company.id, mila.id, { title: 'Hausstil', instruction: 'Kurz.' });
  assert.deepEqual(mila.startSkillIds, ['konzept'], 'Mitgebracht bleibt, was es war');
  assert.equal(mila.skillIds.filter((id) => !mila.startSkillIds.includes(id)).length, 2);
});

test('Rollen als Markdown: Vorlage, Datei und Rückweg', () => {
  const template = parseRole(ROLE_TEMPLATE, []);
  assert.ok('role' in template, 'Die Vorlage lässt sich so speichern');
  assert.equal(template.role.title, 'Name der Rolle');
  assert.deepEqual(template.role.skillIds, ['text']);
  assert.equal(template.role.customSkills[0].title, 'Unser Schreibstil');
  assert.match(template.role.task, /Wofür ist diese Stelle/);
  assert.match((parseRole('Kein Titel', []) as { error: string }).error, /Name/);
  assert.match((parseRole('# X\nVorlage: Astronaut', []) as { error: string }).error, /Astronaut/);
  assert.match((parseRole('# X\nModell: GPT', []) as { error: string }).error, /GPT/);
  assert.match((parseRole('# X\n## Fähigkeiten\n- Zaubern', []) as { error: string }).error, /Eigene Fähigkeit: Zaubern/);
  assert.match((parseRole('# X\n## Eigene Fähigkeit: Leer\n', []) as { error: string }).error, /Leer/);
  const firm = [{ id: 'sA', title: 'Hausstil' }];
  const known = parseRole('# X\n## Aufgabe\nTun\n## Eigene Fähigkeit: hausstil\nEgal', firm);
  assert.ok('role' in known);
  assert.deepEqual(known.role.skillIds, ['sA'], 'Was es schon gibt, wird nicht doppelt angelegt');
  assert.equal(known.role.customSkills.length, 0);

  const company = newCompany();
  const role = engine.createRole(company.id, template.role);
  const again = parseRole(roleToMarkdown(role, company.customSkills), company.customSkills);
  assert.ok('role' in again);
  assert.equal(again.role.title, role.title);
  assert.deepEqual(again.role.skillIds, role.skillIds, 'Hin und zurück geht nichts verloren');
  assert.equal(again.role.task, role.task);
  assert.equal(again.role.modelId, role.modelId);
});

test('Rollenfarben: selbst gewählt, sonst Voreinstellung, und der Zettel folgt der Rolle', () => {
  const company = newCompany();
  const first = engine.createRole(company.id, { title: 'Redaktion', task: 'Schreibt' });
  const second = engine.createRole(company.id, { title: 'Grafik', task: 'Zeichnet', color: '#123456' });
  assert.equal(roleColor(company, first), NOTE_COLORS[0], 'Ohne Wahl gilt die Voreinstellung');
  assert.equal(roleColor(company, second), '#123456');
  assert.throws(() => engine.updateRole(company.id, first.id, { color: 'url(x)' }), /Farbe/);
  engine.updateRole(company.id, second.id, { color: null });
  assert.equal(roleColor(company, second), NOTE_COLORS[1], 'Zurück auf die Voreinstellung');
  engine.updateRole(company.id, second.id, { color: '#123456' });
  const note = engine.createNote(company.id, { title: 'Flyer', role: 'Grafik' });
  const [board] = boardNotes(company);
  assert.equal(board.id, note.id);
  assert.deepEqual(noteLook(company, board), { role: 'Grafik', color: '#123456', ink: '#fbf6ea' });
  assert.equal(noteLook(company, { role: 'Niemand', workerId: null, byAgentId: null }).role, '', 'Ohne Rolle ein neutraler Zettel');
  assert.equal(noteInk('#f7d774'), '#33261a');
  const text = withRoleColor(ROLE_TEMPLATE, '#a8e6a1');
  assert.equal(colorInText(text), '#a8e6a1');
  assert.equal((parseRole(text, []) as { role: { color: string } }).role.color, '#a8e6a1');
  assert.equal(colorInText(withRoleColor(text, null)), null);
  assert.match((parseRole('# X\nFarbe: rot', []) as { error: string }).error, /rot/);
});

test('Zettel lassen sich ändern, zurücklegen und wieder aufhängen', () => {
  const company = newCompany();
  const note = engine.createNote(company.id, { title: 'Flyer schreiben' });
  engine.updateNote(company.id, note.id, { title: 'Flyer für das Sommerfest', notes: 'Eine Seite', role: 'Redaktion', criteria: ['Termin steht drin'] });
  const stored = company.board.find((n) => n.id === note.id)!;
  assert.equal(stored.title, 'Flyer für das Sommerfest');
  assert.deepEqual(stored.criteria, ['Termin steht drin']);
  engine.laterNote(company.id, note.id);
  assert.equal(boardNotes(company).length, 0, 'Nicht mehr an der Tafel');
  assert.throws(() => engine.createNote(company.id, { title: 'Flyer für das Sommerfest' }), /gibt es schon/);
  engine.updateNote(company.id, note.id, { title: 'Flyer fürs Fest' });
  engine.backToBoard(company.id, note.id);
  assert.equal(boardNotes(company)[0].id, note.id);
  assert.throws(() => engine.backToBoard(company.id, note.id), /Für später/);
  engine.dropNote(company.id, note.id);
  assert.throws(() => engine.updateNote(company.id, note.id, { title: 'Weg' }), /nicht mehr/);
});

test('Scrum: Planning, Freigabe, Board, Ende, Retrospektive', async () => {
  const company = newCompany();
  const mila = await hired(company.id, 'Mila');
  engine.createNote(company.id, { title: 'Eins', criteria: ['Liegt vor'] });
  engine.createNote(company.id, { title: 'Zwei' });
  const third = engine.createNote(company.id, { title: 'Drei' });
  await assert.rejects(engine.planSprint(company.id, { budgetEur: 1 }), /Scrum Master/);

  company.placed.push({ id: 'platz2', kind: 'desk', i: 3, j: 3, rot: 0 });
  const sam = await engine.hire(company.id, { name: 'Sam', roleId: 'scrum', skillIds: ['scrum'], modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => sam.hired, 'Einstellung');
  assert.ok(isScrumMaster(sam));
  assert.equal(scrumMaster(company)?.id, sam.id);
  await assert.rejects(engine.planSprint(company.id, { budgetEur: 0 }), /Budgetrahmen/);

  const sprint = await engine.planSprint(company.id, { budgetEur: 0.5, hint: 'Klein halten' });
  const planning = company.runs.find((r) => r.kind === 'planning')!;
  assert.match(planning.prompt, /Klein halten/);
  assert.match(planning.prompt, /Eins/);
  await assert.rejects(engine.planSprint(company.id, { budgetEur: 1 }), /schon ein Sprint/);
  await until(() => sprint.status === 'proposed', 'Vorschlag');
  assert.ok(planning.costEur > 0, 'Das Planning kostet echtes Geld');
  assert.equal(sprint.goal, 'Das Wichtigste zuerst.');
  assert.equal(sprint.noteIds.length, 2);
  assert.equal(company.orders.length, 0, 'Das Planning startet nichts');
  assert.equal(third.status, 'open');

  assert.throws(() => engine.startSprint(company.id, sprint.id, { goal: '', noteIds: sprint.noteIds }), /Ziel/);
  assert.throws(() => engine.startSprint(company.id, sprint.id, { goal: 'Ziel', noteIds: [] }), /mindestens einen/);
  engine.startSprint(company.id, sprint.id, { goal: 'Unser Ziel', budgetEur: 0.5, noteIds: sprint.noteIds });
  assert.equal(sprint.status, 'running');
  const [one, two] = sprint.noteIds.map((id) => company.board.find((n) => n.id === id)!);
  assert.equal(one.status, 'sprint');
  assert.deepEqual(boardNotes(company).map((n) => n.id), [third.id], 'Im Backlog bleibt der Rest');
  assert.throws(() => engine.laterNote(company.id, one.id), /im Sprint/);
  assert.deepEqual(sprintRows(company, sprint).map((r) => r.column), ['offen', 'offen']);

  await assert.rejects(engine.startOrder(company.id, orderInput(mila.id, one.title, { noteId: one.id, limitEur: 0.6 })), /Rahmen/);
  assert.equal(company.orders.length, 0);
  const order = await engine.startOrder(company.id, orderInput(mila.id, one.title, { noteId: one.id, limitEur: 0.4 }));
  assert.equal(order.sprintId, sprint.id);
  assert.equal(sprintRows(company, sprint)[0].column, 'arbeit');
  assert.ok(sprintCommitted(company, sprint) >= 0.4, 'Ein laufender Auftrag bindet sein Limit');
  assert.throws(() => engine.endSprint(company.id, sprint.id), /läuft noch/);
  await until(() => order.status === 'review', 'Abnahme');
  assert.equal(sprintRows(company, sprint)[0].column, 'abnahme');
  engine.decide(company.id, order.id, { decision: 'accept', checked: order.criteria.map(() => true) });
  assert.equal(sprintRows(company, sprint)[0].column, 'fertig');

  await until(() => !company.runs.some((r) => r.status === 'running'), 'Alle frei');
  engine.endSprint(company.id, sprint.id);
  assert.equal(two.status, 'open', 'Nicht Vergebenes geht zurück ins Backlog');
  assert.equal(sprintRows(company, sprint).length, 1);
  assert.equal(sprint.status, 'review');

  await assert.rejects(engine.startRetro(company.id, sprint.id), /Besprechungsraum/);
  company.placed.push({ id: 'raum', kind: 'meeting', i: 0, j: 0, rot: 0 });
  const meeting = await engine.startRetro(company.id, sprint.id);
  assert.equal(meeting.moderatorId, sam.id);
  assert.ok(meeting.participantIds.includes(mila.id));
  assert.match(meeting.notes, /Unser Ziel/);
  assert.equal(sprint.retroMeetingId, meeting.id);
  await assert.rejects(engine.startRetro(company.id, sprint.id), /schon stattgefunden/);
  await until(() => meeting.status !== 'running', 'Retro');
  engine.closeSprint(company.id, sprint.id);
  assert.equal(openSprint(company), null);
});

test('Scrum: Planning scheitert sauber, und eine eigene Rolle zählt', async () => {
  const company = newCompany();
  const role = engine.createRole(company.id, { title: 'Scrum Master', task: 'Moderiert' });
  const sam = await engine.hire(company.id, { name: 'Sam', companyRoleId: role.id, modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => sam.hired, 'Einstellung');
  assert.equal(scrumMaster(company)?.id, sam.id);
  await assert.rejects(engine.planSprint(company.id, { budgetEur: 1 }), /Backlog ist leer/);
  engine.createNote(company.id, { title: 'Eins' });
  const sprint = await engine.planSprint(company.id, { budgetEur: 1, hint: '[szenario:planningkaputt]' });
  await until(() => sprint.status === 'proposed', 'Vorschlag');
  assert.match(sprint.error ?? '', /nicht auswertbar/);
  engine.discardSprint(company.id, sprint.id);
  assert.equal(company.sprints.length, 0);
  assert.deepEqual(parsePlanning({ ziel: 'Z', begruendung: 'B', zettel: ['a', 'fremd', 'a'] }, ['a']), { goal: 'Z', reason: 'B', noteIds: ['a'] });
  assert.equal(parsePlanning({ zettel: [] }, []), null);
});

test('Roadmap: alle Aufgaben mit Stand und Verantwortlichen aus dem echten Stand', async () => {
  const company = newCompany();
  const mila = await hired(company.id, 'Mila');
  const open = engine.createNote(company.id, { title: 'An der Tafel', role: 'Planung' });
  const later = engine.createNote(company.id, { title: 'Zurückgelegt' });
  engine.laterNote(company.id, later.id);
  const taken = engine.createNote(company.id, { title: 'Vergeben', criteria: ['Liegt vor'] });
  const order = await engine.startOrder(company.id, orderInput(mila.id, taken.title, { noteId: taken.id }));
  const row = (id: string) => roadmapRows(company).find((r) => r.id === id)!;
  assert.equal(row(open.id).phase, 'naechstes');
  assert.equal(row(open.id).ownerId, null);
  assert.equal(row(open.id).wanted, 'Planung');
  assert.equal(row(later.id).phase, 'spaeter');
  assert.equal(row(taken.id), undefined, 'Ein vergebener Zettel steht nur noch als Auftrag da');
  assert.equal(row(order.id).phase, 'jetzt');
  assert.equal(row(order.id).ownerId, mila.id);
  await until(() => order.status === 'review', 'Abnahme');
  assert.equal(row(order.id).state, 'Wartet auf deine Abnahme');
  engine.decide(company.id, order.id, { decision: 'accept', checked: order.criteria.map(() => true) });
  assert.equal(row(order.id).phase, 'erledigt');
  assert.ok(row(order.id).costEur! > 0, 'Die Kosten stammen aus den Läufen');
});

test('Jede Haustür liegt in der Wand zur Strasse, und ihr Feld ist frei', () => {
  for (const loc of LOCATIONS) {
    assert.equal(loc.door.j, loc.d - 1, loc.id);
    assert.ok(loc.door.i >= 0 && loc.door.i < loc.w, loc.id);
    const taken = (loc.props ?? []).concat(loc.startItems.map((s: { kind: string; i: number; j: number }) => ({ ...footprint(s.kind as never), ...s })) as never);
    for (const p of taken) assert.ok(!(loc.door.i >= p.i && loc.door.i < p.i + p.w && loc.door.j >= p.j && loc.door.j < p.j + p.d), `${loc.id}: ${p.kind}`);
  }
});

test('Standorte: Hineingehen ohne Umzug, dort einrichten und ein eigenes Team aufbauen', async () => {
  const company = newCompany();
  company.buildPoints = 2000;
  const mila = await hired(company.id, 'Mila');
  const head = { location: company.locationId, site: company.town.siteId, desk: mila.deskId };
  assert.throws(() => engine.enterSite(company.id, 'eckladen'), /gehört dir nicht/);
  engine.townAction(company.id, 'eckladen', { action: 'rent' });

  const floor = engine.enterSite(company.id, 'eckladen');
  assert.equal(floor, 100);
  assert.equal(engine.enterSite(company.id, 'eckladen'), 100, 'Ein zweites Mal entsteht nichts Neues');
  assert.equal(company.locationId, head.location, 'Die Firma ist nicht umgezogen');
  assert.equal(company.town.siteId, head.site);
  assert.equal(mila.deskId, head.desk);
  assert.equal(baseFloorOf(company, 'eckladen'), 100);
  assert.equal(siteAt(company, floor).locationId, 'eckladen');
  assert.equal(roomOf(company, floor).id, 'eckladen');
  assert.equal(roomOf(company, 0).id, head.location, 'Der Firmensitz bleibt, wie er ist');

  const desk = engine.placeItem(company.id, { kind: 'desk', floor, i: 1, j: 1, rot: 0 });
  assert.equal(desk.floor, 100);
  assert.throws(() => engine.placeItem(company.id, { kind: 'desk', floor: 200, i: 1, j: 1, rot: 0 }), /Etage/);
  const alex = await engine.hire(company.id, { name: 'Alex', roleId: 'text', skillIds: ['text'], modelId: 'claude-haiku-5-5', look: LOOK, deskId: desk.id });
  await until(() => alex.hired, 'Einstellung');
  assert.equal(alex.deskId, desk.id);
  const team = engine.createTeam(company.id, { name: 'Laden', memberIds: [alex.id], leadId: alex.id });
  assert.deepEqual(team.memberIds, [alex.id]);
  const order = await engine.startOrder(company.id, orderInput(alex.id, 'Am neuen Standort'));
  await until(() => order.status === 'review', 'Abnahme');

  assert.throws(() => engine.townAction(company.id, 'eckladen', { action: 'move' }), /weiterer Standort/);
  engine.decide(company.id, order.id, { decision: 'accept', checked: [true] });
  engine.townAction(company.id, 'kino', { action: 'rent' });
  engine.townAction(company.id, 'kino', { action: 'move' });
  assert.equal(company.locationId, 'kino');
  assert.ok(company.placed.some((p) => p.id === desk.id), 'Ein Umzug des Firmensitzes lässt den anderen Standort stehen');
});

test('Kontingent leer: Feierabend, wartende Arbeit läuft danach von selbst weiter', async () => {
  const now = Date.now();
  assert.equal(quotaClosedUntil(null, now), null);
  assert.equal(quotaClosedUntil({ status: 'allowed', fiveHour: null, sevenDay: null, at: now }, now), null);
  assert.equal(quotaClosedUntil({ status: 'rejected', fiveHour: { utilization: 1, resetsAt: now + 5000 }, sevenDay: { utilization: 0.4, resetsAt: now + 99000 }, at: now }, now), now + 5000, 'Es zählt das volle Fenster');
  assert.equal(quotaClosedUntil({ status: 'rejected', fiveHour: { utilization: 1, resetsAt: now - 1 }, sevenDay: null, at: now }, now), null, 'Danach wird wieder gearbeitet');
  assert.equal(quotaClosedUntil({ status: 'rejected', fiveHour: null, sevenDay: null, at: now }, now), now + 3_600_000);

  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-kontingent-'));
  const own = await makeEngine(data);
  const company = own.createCompany({ name: 'Feierabend', idea: 'Idee', locationId: 'garage', budgetEur: 10 });
  const agent = await own.hire(company.id, { name: 'Mila', roleId: 'planung', skillIds: ['konzept'], modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => agent.hired, 'Einstellung');
  await own.chat(company.id, agent.id, '[szenario:kontingent] [bis:2] Hallo');
  await until(() => own.system().plan?.status === 'rejected' && !company.runs.some((r) => r.status === 'running'), 'Meldung');
  await assert.rejects(own.chat(company.id, agent.id, 'Noch etwas'), /Feierabend/);

  const order = await own.startOrder(company.id, orderInput(agent.id, 'Wartet aufs Kontingent'));
  assert.equal(order.status, 'running');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(company.runs.filter((r) => r.orderId === order.id).length, 0, 'Solange ist Feierabend, nichts kostet etwas');
  await until(() => order.status === 'review', 'Danach läuft die Arbeit von selbst weiter');
  own.shutdown();
  fs.rmSync(data, { recursive: true, force: true });
});

test('Ein Anthropic-Schlüssel ersetzt das Abo nur, wenn er hinterlegt ist', () => {
  const before = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(agentEnv().ANTHROPIC_API_KEY, undefined);
  assert.equal(agentEnv('geheim').ANTHROPIC_API_KEY, 'geheim');
  if (before) process.env.ANTHROPIC_API_KEY = before;
});

test('Die Welt rund ums Tal entsteht aus der Lage und ist überall gleich', () => {
  assert.equal(biomeAt(-3000, 2200), biomeAt(-3000, 2200));
  const places = placesIn(-40 * REGION, -40 * REGION, 40 * REGION, 40 * REGION);
  const far = places.filter((p) => p.id.startsWith('w'));
  assert.ok(far.length > 200, `Viele Orte, nicht nur ${far.length}`);
  assert.ok(new Set(far.map((p) => p.name)).size > 50, 'Unterschiedliche Namen');
  assert.ok(far.every((p) => settlementIn(Number(p.id.split('_')[0].slice(1)), Number(p.id.split('_')[1]))?.name === p.name), 'Der Name hängt nur an der Stelle');
  const place = far.find((p) => parcelsIn(p.i, p.j, p.i + 60, p.j + 60).some((x) => x.price))!;
  const offer = parcelsIn(place.i, place.j, place.i + 60, place.j + 60).find((x) => x.price)!;
  assert.deepEqual(parcelById(offer.id), offer, 'Eine Kennung führt wieder zum selben Grundstück');
  assert.equal(tileKind(offer.entry.i, offer.entry.j), 'sidewalk');
  for (let k = 0; k < 40; k++) assert.equal(tileKind(place.i + k, place.j + 28), 'road', 'Die Stadt hat Strassen');
  assert.ok(townPath(offer.entry, { i: offer.entry.i + 20, j: offer.entry.j }, isBlocked).length > 0, 'Auf dem Gehweg kommt man weiter');
  assert.ok(decorIn(-2000, -2000, 2000, 2000).length > 0);
  assert.equal(isBlocked(-90000, 0), true, 'Die Welt hat einen Rand');
});

test('Ein Grundstück draussen lässt sich kaufen, bebauen und betreten', () => {
  const company = newCompany();
  company.buildPoints = 5000;
  const far = placesIn(-40 * REGION, -40 * REGION, 40 * REGION, 40 * REGION).filter((p) => p.id.startsWith('w'));
  const lot = far.flatMap((p) => parcelsIn(p.i, p.j, p.i + 170, p.j + 170)).find((x) => x.kind === 'lot')!;
  engine.townAction(company.id, lot.id, { action: 'buy' });
  engine.townAction(company.id, lot.id, { action: 'build' });
  const floor = engine.enterSite(company.id, lot.id);
  assert.equal(floor, 100);
  assert.equal(roomOf(company, floor).id, lot.locationId);
});

test('Auch am Rand der Welt ist ein Grundstück eindeutig und erreichbar', () => {
  const edge = placesIn(265 * REGION, 265 * REGION, 280 * REGION, 280 * REGION).filter((p) => p.id.startsWith('w'));
  assert.ok(edge.length > 20);
  const parcel = edge.flatMap((p) => parcelsIn(p.i, p.j, p.i + 170, p.j + 170))[0];
  assert.deepEqual(parcelById(parcel.id), parcel);
  assert.ok(townPath(parcel.entry, { i: parcel.entry.i + 12, j: parcel.entry.j }, isBlocked).length > 0);
  assert.ok(placesIn(-283 * REGION, -283 * REGION, 283 * REGION, 283 * REGION).length > 100_000, 'Über 100.000 Orte');
});

test('Eine Stadt bekommt beim ersten Besuch ihre Zufallszahl und behält sie', () => {
  const company = newCompany();
  engine.visitCity(company.id, 'paloalto');
  const first = company.town.citySalts?.paloalto;
  assert.ok(Number.isInteger(first) && first! > 0, 'Beim ersten Besuch wird eine Zahl gezogen');
  engine.visitCity(company.id, 'paloalto');
  assert.equal(company.town.citySalts?.paloalto, first, 'Beim zweiten Besuch ändert sich nichts');
  const wild = placesIn(-40 * REGION, -40 * REGION, 40 * REGION, 40 * REGION).find((p) => p.id.startsWith('w'))!;
  engine.visitCity(company.id, wild.id);
  assert.ok((company.town.citySalts?.[wild.id] ?? 0) > 0, 'Auch Städte in der offenen Welt');
  assert.throws(() => engine.visitCity(company.id, 'gibtsnicht'), /Diese Stadt gibt es nicht/);
});
