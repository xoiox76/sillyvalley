// Repo im Spiel, mit echtem Git gegen ein lokales Ziel. Die Agenten sind die Test-Attrappe.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Engine } from '../server/engine.ts';
import { FxSource } from '../server/fx.ts';
import { assertIntact, isCloneUrl } from '../server/git.ts';
import { createAnthropicProvider } from '../server/providers/anthropic.ts';
import { Workspace, Denied } from '../server/providers/compatible.ts';

const FAKE = path.join(import.meta.dirname, 'fake-agent.mjs');
const ECB = '<Cube time="2026-10-30"><Cube currency="USD" rate="1.25"/></Cube>';
const LOOK = { hair: 'kurz', hairColor: '#333333', skin: '#f2c9a0', top: '#2fa58f', bottom: '#223344', glasses: false } as never;

let dir: string;
let engine: Engine;
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const until = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Zeitüberschreitung: ${label}`);
};

/** Ein Ziel, das wie ein Anbieter wirkt, und ein Checkout mit einem offenen, nicht committeten Stand des Menschen. */
function makeRepo(name: string): { remote: string; checkout: string } {
  const remote = path.join(dir, `${name}.git`);
  const checkout = path.join(dir, name);
  sh(dir, 'init', '--quiet', '--bare', '-b', 'main', remote);
  sh(dir, 'clone', '--quiet', remote, checkout);
  sh(checkout, 'config', 'user.name', 'Mensch');
  sh(checkout, 'config', 'user.email', 'mensch@example.invalid');
  sh(checkout, 'checkout', '--quiet', '-b', 'main');
  fs.writeFileSync(path.join(checkout, 'code.txt'), 'alt\n');
  sh(checkout, 'add', '.');
  sh(checkout, 'commit', '--quiet', '-m', 'Start');
  sh(checkout, 'push', '--quiet', 'origin', 'main');
  fs.writeFileSync(path.join(checkout, 'offen.txt'), 'Arbeit des Menschen\n');
  return { remote, checkout };
}

const setup = async (name: string) => {
  const { remote, checkout } = makeRepo(name);
  const company = engine.createCompany({ name, idea: 'Idee', locationId: 'garage', budgetEur: 10, projectDir: checkout });
  const agent = await engine.hire(company.id, { name: 'Mila', roleId: 'planung', skillIds: ['konzept'], modelId: 'claude-haiku-5-5', look: LOOK });
  await until(() => agent.hired, 'Einstellung');
  return { company, agent, remote, checkout };
};
const input = (agentId: string, title: string) => ({ team: { work: agentId }, title, criteria: ['Liegt vor'], limitEur: 1, maxRevisions: 0 });

before(async () => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sv-repo-')));
  const data = path.join(dir, 'daten');
  engine = new Engine(data, createAnthropicProvider(FAKE), new FxSource(data, async () => ECB));
  engine.tourStepMs = 0;
  await engine.init();
});
after(() => {
  engine.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Abnahme: eigener Branch, Checkout unberührt, Hochladen erst auf Klick', async () => {
  const { company, agent, remote, checkout } = await setup('abnahme');
  assert.equal(company.repo?.branch, 'main', 'Ein Git-Ordner wird beim Gründen verbunden');
  const order = await engine.startOrder(company.id, input(agent.id, '[szenario:repo] Neue Datei'));
  assert.match(order.git!.branch, /^auftrag\//);
  const run = company.runs.find((r) => r.orderId === order.id)!;
  assert.match(run.prompt, new RegExp(order.git!.dir));
  await until(() => order.status === 'review', 'Abnahme');
  assert.ok(order.files.includes(`${order.git!.dir}/neu.txt`), 'Die Änderung im Branch ist das Ergebnis');
  assert.equal(fs.existsSync(path.join(checkout, 'neu.txt')), false, 'Im Checkout des Menschen passiert nichts');
  assert.equal(sh(checkout, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.ok(fs.existsSync(path.join(checkout, 'offen.txt')), 'Offene Arbeit des Menschen bleibt');
  assert.match(engine.orderDiff(company.id, order.id), /\+vom Agenten/);
  await assert.rejects(engine.pushOrder(company.id, order.id), /zuerst ab/);

  engine.decide(company.id, order.id, { decision: 'accept', checked: [true] });
  assert.ok(order.git!.commit, 'Abnehmen committet');
  assert.equal(sh(remote, 'branch', '--list', order.git!.branch), '', 'Noch ist nichts hochgeladen');
  assert.equal(sh(checkout, 'log', '-1', '--format=%an <%ae>', order.git!.branch), 'Mila <agent@sillyvailley.invalid>', 'Keine persönliche Adresse');
  await engine.pushOrder(company.id, order.id);
  assert.ok(order.git!.pushedAt);
  assert.match(sh(remote, 'branch', '--list', order.git!.branch), /auftrag/);
  assert.equal(sh(remote, 'rev-parse', 'main'), order.git!.base, 'Der Hauptbranch bleibt unberührt');
});

test('Ablehnen löscht den Branch, und ohne Änderung bleibt keiner', async () => {
  const { company, agent, checkout } = await setup('ablehnen');
  const rejected = await engine.startOrder(company.id, input(agent.id, '[szenario:repo] Abgelehnt'));
  await until(() => rejected.status === 'review', 'Abnahme');
  const branch = rejected.git!.branch;
  engine.decide(company.id, rejected.id, { decision: 'reject', checked: [false] });
  assert.equal(sh(checkout, 'branch', '--list', branch), '');
  assert.equal(fs.existsSync(path.join(engine.rootsOf(company.id).workspace, rejected.git!.dir)), false);

  const empty = await engine.startOrder(company.id, input(agent.id, 'Nur Text'));
  await until(() => empty.status === 'review', 'Abnahme');
  engine.decide(company.id, empty.id, { decision: 'accept', checked: [true] });
  assert.equal(empty.git!.commit, null);
  assert.equal(sh(checkout, 'branch', '--list', empty.git!.branch), '');
  await assert.rejects(engine.pushOrder(company.id, empty.id), /nichts im Repo/);
});

test('Hooks laufen nicht, und eine veränderte .git sperrt Git', async () => {
  const { company, agent, checkout } = await setup('angriff');
  const marker = path.join(dir, 'hook-lief');
  fs.writeFileSync(path.join(checkout, '.git/hooks/pre-commit'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
  const order = await engine.startOrder(company.id, input(agent.id, '[szenario:repo] Mit Hook'));
  await until(() => order.status === 'review', 'Abnahme');
  engine.decide(company.id, order.id, { decision: 'accept', checked: [true] });
  assert.ok(order.git!.commit);
  assert.equal(fs.existsSync(marker), false, 'Der Hook wurde nicht ausgeführt');

  const broken = await engine.startOrder(company.id, input(agent.id, '[szenario:gitkaputt] Kaputt'));
  await until(() => broken.status === 'review', 'Abnahme');
  const worktree = path.join(engine.rootsOf(company.id).workspace, broken.git!.dir);
  assert.throws(() => assertIntact(checkout, worktree), /verändert/);
  assert.throws(() => engine.orderDiff(company.id, broken.id), /verändert/);
  engine.decide(company.id, broken.id, { decision: 'accept', checked: [true] });
  assert.equal(broken.git!.commit, null, 'Ohne intaktes .git entsteht kein Commit');
  assert.ok(company.notices.some((n) => /verändert/.test(n.text)));

  const space = new Workspace(worktree, [], false);
  assert.throws(() => space.run('write_file', { path: '.git/config', content: 'x' }), Denied);
  assert.throws(() => space.run('read_file', { path: '.git' }), Denied);
});

test('Verbinden: Ordner, Adresse, Prüfungen; Läufe ohne Auftrag sehen den Checkout nicht', async () => {
  const { remote, checkout } = makeRepo('verbinden');
  const company = engine.createCompany({ name: 'Nachher', idea: 'Idee', locationId: 'garage', budgetEur: 10 });
  assert.equal(company.repo ?? null, null);
  await assert.rejects(engine.connectRepo(company.id, { source: 'relativ/pfad' }), /vollständigen Pfad/);
  const plain = path.join(dir, 'kein-repo');
  fs.mkdirSync(plain);
  await assert.rejects(engine.connectRepo(company.id, { source: plain }), /kein Git-Repo/);
  assert.equal(isCloneUrl('ext::sh -c touch'), false, 'Adressen, die Programme starten, gehen nicht');
  assert.equal(isCloneUrl('https://example.invalid/a.git'), true);
  await engine.connectRepo(company.id, { source: checkout });
  assert.equal(company.repo!.dir, checkout);
  assert.equal(company.repo!.remote, remote);
  const read = path.join(engine.rootsOf(company.id).workspace, 'zweige/lesen');
  assert.ok(fs.existsSync(path.join(read, 'code.txt')));
  assert.equal(fs.existsSync(path.join(read, 'offen.txt')), false, 'Nur Committetes');
  assert.ok(!engine.files(company.id).some((f) => f.path.startsWith('zweige/')), 'Die Dateiliste bleibt übersichtlich');
  engine.disconnectRepo(company.id);
  assert.equal(company.repo, null);
  assert.equal(fs.existsSync(path.join(checkout, 'code.txt')), true);
});
