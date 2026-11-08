// Bau-Modus wie in einem Bauspiel: Halbwände, Säulen, Wanddeko, Anstrich pro Seite und Boden pro Feld.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { locationById } from '../shared/catalog.ts';
import { blockedEdges, blockingTiles, checkPlacement, footprint, hasWallAt, heightEdges, hungFacing, regionOf, stepsUp } from '../shared/layout.ts';
import { floorStyleAt, heightAt, paintFloorTiles, paintedTiles } from '../shared/zones.ts';
import type { Company, PlacedItem } from '../shared/types.ts';
import { Engine } from '../server/engine.ts';
import { FxSource } from '../server/fx.ts';
import { createAnthropicProvider } from '../server/providers/anthropic.ts';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-agent.mjs');
const ECB = "<Cube time='2026-10-30'><Cube currency='USD' rate='1.25'/></Cube>";
const garage = locationById('garage');
let dir = '';
let engine: Engine;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyvalley-build-'));
  engine = new Engine(dir, createAnthropicProvider(FAKE), new FxSource(dir, async () => ECB), 0, true);
  await engine.init();
});
after(() => {
  engine.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

const newCompany = (): Company => engine.createCompany({ name: 'Baufirma', idea: 'Bauen', locationId: 'garage', budgetEur: 10 } as never);

test('Halbwand versperrt den Weg, trennt aber keine Räume', () => {
  const fence = [0, 1, 2, 3, 4, 5, 6, 7].map((i): PlacedItem => ({ id: `h${i}`, kind: 'half', i, j: 3, rot: 0 }));
  assert.ok(blockedEdges(fence).has('2,2>2,3'), 'Durch eine Halbwand geht man nicht');
  assert.ok(regionOf(garage, fence, { i: 0, j: 0 }).has('0,5'), 'Der Raum geht über die Halbwand hinweg');
  assert.deepEqual(footprint('half'), { w: 0, d: 0 });
  assert.ok(!checkPlacement(garage, fence, { kind: 'wall', i: 2, j: 3, rot: 0 }).ok, 'Auf einer Halbwand steht keine zweite Wand');
});

test('Säule belegt ein Feld', () => {
  assert.deepEqual(footprint('column'), { w: 1, d: 1 });
  assert.ok(checkPlacement(garage, [], { kind: 'column', i: 3, j: 3, rot: 0 }).ok);
  assert.ok(!checkPlacement(garage, [{ id: 'p', kind: 'plant', i: 3, j: 3, rot: 0 }], { kind: 'column', i: 3, j: 3, rot: 0 }).ok);
});

test('Wanddeko hängt nur an einer Wand, an der Innenseite, einmal je Seite', () => {
  const wall: PlacedItem = { id: 'w', kind: 'wall', i: 3, j: 2, rot: 0 };
  assert.ok(!checkPlacement(garage, [], { kind: 'picture', i: 3, j: 2, rot: 0 }).ok, 'Ohne Wand hängt nichts');
  assert.ok(checkPlacement(garage, [wall], { kind: 'picture', i: 3, j: 2, rot: 0 }).ok, 'Vorderseite');
  assert.ok(checkPlacement(garage, [wall], { kind: 'clock', i: 3, j: 2, rot: 2 }).ok, 'Rückseite');
  const hung: PlacedItem = { id: 'b', kind: 'picture', i: 3, j: 2, rot: 0 };
  assert.ok(!checkPlacement(garage, [wall, hung], { kind: 'wallLamp', i: 3, j: 2, rot: 0 }).ok, 'Eine Seite trägt eines');
  assert.ok(checkPlacement(garage, [wall, hung], { kind: 'wallLamp', i: 3, j: 2, rot: 2 }).ok, 'Die andere Seite ist frei');
  assert.ok(checkPlacement(garage, [], { kind: 'picture', i: 4, j: 0, rot: 0 }).ok, 'Die hintere Außenwand trägt auch');
  assert.ok(!checkPlacement(garage, [], { kind: 'picture', i: 4, j: 0, rot: 2 }).ok, 'Aber nur innen');
  assert.ok(hasWallAt(garage, [], { i: 0, j: 2, rot: 1 }));
  assert.deepEqual(hungFacing({ i: 3, j: 2, rot: 2 }), { i: 3, j: 1 });
  // Wanddeko versperrt nichts.
  assert.ok(checkPlacement(garage, [wall, hung], { kind: 'plant', i: 3, j: 2, rot: 0 }).ok);
});

test('Boden pro Feld: verlegen, auslesen, entfernen', () => {
  const company = { floorPaint: undefined } as Pick<Company, 'floorPaint'>;
  paintFloorTiles(company, 0, [{ i: 1, j: 1 }, { i: 2, j: 1 }], 'parkett');
  paintFloorTiles(company, 1, [{ i: 1, j: 1 }], 'marmor');
  assert.equal(floorStyleAt(company, 0, { i: 1, j: 1 }), 'parkett');
  assert.equal(floorStyleAt(company, 1, { i: 1, j: 1 }), 'marmor', 'Jede Etage hat ihren Boden');
  assert.equal(paintedTiles(company, 0).length, 2);
  paintFloorTiles(company, 0, [{ i: 1, j: 1 }], null);
  assert.equal(floorStyleAt(company, 0, { i: 1, j: 1 }), undefined);
});

test('Server: Anstrich je Seite, Boden je Feld, Deko fällt mit der Wand ins Inventar', () => {
  const company = newCompany();
  const wall = engine.placeItem(company.id, { kind: 'wall', i: 3, j: 3, rot: 0 });
  engine.paintItem(company.id, wall.id, { color: 'salbei', side: 'back' });
  assert.equal(wall.color, undefined, 'Die Vorderseite bleibt weiß');
  assert.equal(wall.colorBack, 'salbei');
  engine.paintItem(company.id, wall.id, { color: 'sand', side: 'front' });
  assert.equal(wall.color, 'sand');
  assert.equal(wall.colorBack, 'salbei');
  engine.paintItem(company.id, wall.id, { color: 'himmel' });
  assert.equal(wall.color, 'himmel');
  assert.equal(wall.colorBack, undefined, 'Ohne Seite beide gleich');
  assert.throws(() => engine.paintItem(company.id, wall.id, { color: 'sand', side: 'oben' as never }), /Seite/);
  const half = engine.placeItem(company.id, { kind: 'half', i: 3, j: 4, rot: 0 });
  engine.paintItem(company.id, half.id, { color: 'koralle' });
  assert.equal(half.color, 'koralle');

  engine.paintFloor(company.id, { floor: 0, tiles: [{ i: 1, j: 3 }, { i: 1, j: 4 }], style: 'marmor' });
  assert.equal(floorStyleAt(company, 0, { i: 1, j: 4 }), 'marmor');
  assert.throws(() => engine.paintFloor(company.id, { floor: 0, tiles: [{ i: 1, j: 3 }], style: 'lava' }), /Bodenbelag/);
  assert.throws(() => engine.paintFloor(company.id, { floor: 0, tiles: [{ i: 99, j: 3 }], style: 'holz' }), /nicht im Raum/);
  engine.paintFloor(company.id, { floor: 0, tiles: [{ i: 1, j: 3 }], style: null });
  assert.equal(floorStyleAt(company, 0, { i: 1, j: 3 }), undefined);

  const picture = engine.placeItem(company.id, { kind: 'picture', i: 3, j: 3, rot: 0 });
  assert.throws(() => engine.placeItem(company.id, { kind: 'clock', i: 6, j: 3, rot: 0 }), /keine/);
  engine.deleteItem(company.id, wall.id);
  assert.ok(!company.placed.some((p) => p.id === picture.id), 'Das Bild hängt nicht mehr');
  assert.ok(company.inventory.some((s) => s.id === picture.id), 'Es liegt im Inventar');
});

test('Tür und Fenster setzen sich in eine stehende Wand; durch die Tür geht man', () => {
  const company = newCompany();
  const wall = engine.placeItem(company.id, { kind: 'wall', i: 2, j: 4, rot: 0 });
  engine.paintItem(company.id, wall.id, { color: 'salbei' });
  const door = engine.placeItem(company.id, { kind: 'door', i: 2, j: 4, rot: 0 });
  assert.ok(!company.placed.some((p) => p.id === wall.id), 'Das Wandstück ist ersetzt');
  assert.ok(!blockedEdges(company.placed).has('2,3>2,4'), 'Durch die Tür geht man');
  assert.throws(() => engine.placeItem(company.id, { kind: 'door', i: 2, j: 4, rot: 0 }), /schon eine Tür/);
  const second = engine.placeItem(company.id, { kind: 'wall', i: 3, j: 4, rot: 0 });
  engine.paintItem(company.id, second.id, { color: 'sand' });
  const window = engine.placeItem(company.id, { kind: 'window', i: 3, j: 4, rot: 0 });
  assert.ok(!company.placed.some((p) => p.id === second.id));
  assert.equal(window.color, 'sand', 'Das Fenster übernimmt den Anstrich');
  assert.ok(door.id);
});

test('Podeste: Höhen trennen Wege, Stufen verbinden eine Stufe', () => {
  const heights = new Map([['3,2', 1], ['4,2', 1]]);
  const height = (t: { i: number; j: number }) => heights.get(`${t.i},${t.j}`) ?? 0;
  const flat = heightEdges(garage, [], height);
  assert.ok(flat.has('3,3>3,2'), 'Ohne Stufen kommt man nicht hinauf');
  const steps: PlacedItem = { id: 's', kind: 'steps', i: 3, j: 3, rot: 2 };
  assert.deepEqual(stepsUp(steps), { i: 3, j: 2 });
  const withSteps = heightEdges(garage, [steps], height);
  assert.ok(!withSteps.has('3,3>3,2'), 'Die Stufen führen hinauf');
  assert.ok(withSteps.has('4,3>4,2'), 'Daneben nicht');
  assert.deepEqual(blockingTiles(steps), [], 'Über Stufen geht man');
});

test('Server: Podest nur, wenn jeder Platz erreichbar bleibt', () => {
  const company = newCompany();
  // Der Schreibtisch der Garage steht bei 2,1. Ein Podest um ihn herum sperrt ihn ab.
  assert.throws(() => engine.setLevel(company.id, { floor: 0, tiles: [{ i: 2, j: 1 }, { i: 3, j: 1 }, { i: 2, j: 2 }, { i: 3, j: 2 }, { i: 2, j: 0 }, { i: 3, j: 0 }, { i: 4, j: 0 }, { i: 4, j: 1 }, { i: 4, j: 2 }, { i: 1, j: 0 }, { i: 1, j: 1 }, { i: 1, j: 2 }], level: 1 }), /Stufen/);
  assert.equal(heightAt(company, 0, { i: 2, j: 1 }), 0, 'Abgelehnt heißt: nichts geändert');
  engine.setLevel(company.id, { floor: 0, tiles: [{ i: 6, j: 3 }, { i: 6, j: 4 }], level: 2 });
  assert.equal(heightAt(company, 0, { i: 6, j: 3 }), 2);
  assert.throws(() => engine.setLevel(company.id, { floor: 0, tiles: [{ i: 6, j: 3 }], level: 9 }), /Stufen/);
  assert.throws(() => engine.setLevel(company.id, { floor: 0, tiles: [{ i: 0, j: 5 }], level: 1 }), /Eingang/);
  engine.setLevel(company.id, { floor: 0, tiles: [{ i: 6, j: 3 }, { i: 6, j: 4 }], level: 0 });
  assert.equal(company.floorHeight?.['0:6,3'], undefined);
});

test('Ein Möbel in der Ecke bleibt erreichbar, wenn eine andere Seite frei ist', () => {
  const kids = locationById('kinderzimmer');
  const bed: PlacedItem = { id: 'bett', kind: 'bed', i: 0, j: 0, rot: 0 };
  assert.ok(checkPlacement(kids, [bed], { kind: 'plant', i: 5, j: 0, rot: 0 }).ok, 'Das Bett in der Ecke sperrt nichts');
});
