import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ViewXf, dirOfView, viewOfDir, type Cam } from '../client/world/camera.ts';
import { footprint } from '../shared/layout.ts';
import type { FurnitureKind, Rotation } from '../shared/types.ts';

const CAMS: Cam[] = [0, 1, 2, 3];

test('Punkte und Felder kommen nach dem Drehen unverändert zurück', () => {
  for (const cam of CAMS) {
    const xf = new ViewXf(cam, 7, 5);
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 5; j++) {
        const [u, v] = xf.pt(i, j);
        assert.deepEqual(xf.back(u, v), [i, j]);
        const view = xf.tile({ i, j });
        assert.ok(view.i >= 0 && view.j >= 0 && view.i < xf.w && view.j < xf.d, `Feld ${i},${j} liegt bei Kamera ${cam} im Raum`);
        assert.deepEqual(xf.tileBack(view), { i, j });
      }
    }
  }
});

test('Eine Vierteldrehung tauscht Breite und Tiefe', () => {
  const xf = new ViewXf(1, 7, 5);
  assert.equal(xf.w, 5);
  assert.equal(xf.d, 7);
  assert.equal(new ViewXf(2, 7, 5).w, 7);
});

test('Kanten bleiben Kanten und kommen zurück', () => {
  for (const cam of CAMS) {
    const xf = new ViewXf(cam, 6, 4);
    for (const rot of [0, 1] as Rotation[]) {
      const edge = { i: 2, j: 1, rot };
      const view = xf.edge(edge);
      assert.equal(view.rot, cam % 2 === 0 ? rot : 1 - rot, 'Bei ungerader Drehung wechselt die Richtung');
      assert.deepEqual(xf.edgeBack(view), edge);
    }
  }
});

test('Die Kamera sieht bei halber Drehung die andere Wandseite', () => {
  const edge = { i: 2, j: 2, rot: 0 as Rotation };
  assert.equal(new ViewXf(0, 6, 6).edgeSide(edge), 'front');
  assert.equal(new ViewXf(2, 6, 6).edgeSide(edge), 'back');
});

test('Möbel drehen sich mit, ihre Grundfläche bleibt im Raum', () => {
  const kinds: FurnitureKind[] = ['desk', 'sofa', 'shelf', 'meeting', 'workbench'];
  for (const cam of CAMS) {
    const xf = new ViewXf(cam, 10, 8);
    for (const kind of kinds) {
      for (const rot of [0, 1, 2, 3] as Rotation[]) {
        const item = { kind, i: 1, j: 2, rot };
        const view = xf.item(item);
        const size = footprint(kind, view.rot);
        assert.ok(view.i >= 0 && view.j >= 0 && view.i + size.w <= xf.w && view.j + size.d <= xf.d, `${kind} bei Kamera ${cam}`);
        assert.deepEqual(xf.itemBack(view), item, `${kind} rot ${rot} kommt bei Kamera ${cam} zurück`);
      }
    }
  }
});

test('Wandbilder zeigen nach dem Drehen zur selben Seite', () => {
  for (const cam of CAMS) {
    const xf = new ViewXf(cam, 6, 6);
    for (const rot of [0, 1, 2, 3] as Rotation[]) {
      const item = { kind: 'picture' as FurnitureKind, i: 3, j: 2, rot };
      assert.deepEqual(xf.itemBack(xf.item(item)), item);
    }
  }
  // Von vorn sieht man das Bild an der Vorderseite, von hinten nicht.
  const front = { kind: 'picture' as FurnitureKind, i: 3, j: 2, rot: 0 as Rotation };
  assert.ok(new ViewXf(0, 6, 6).item(front).rot < 2);
  assert.ok(new ViewXf(2, 6, 6).item(front).rot >= 2);
});

test('Blickrichtungen der Figuren lassen sich umrechnen', () => {
  for (const dir of [0, 1, 2, 3] as const) {
    const { view, flip } = viewOfDir(dir);
    assert.equal(dirOfView(view, flip), dir);
  }
});

test('Sitzplatz und Raumtür drehen sich mit dem Möbel', async () => {
  const { seatOf, meetingDoor } = await import('../shared/layout.ts');
  for (const cam of CAMS) {
    const xf = new ViewXf(cam, 10, 8);
    for (const rot of [0, 1, 2, 3] as Rotation[]) {
      const desk = { kind: 'desk' as FurnitureKind, i: 3, j: 2, rot };
      const world = seatOf(desk);
      const view = seatOf(xf.item(desk));
      assert.deepEqual(xf.pt(world.i, world.j), [view.i, view.j], `Sitz bei Kamera ${cam}, rot ${rot}`);
      // Die Tür des Glasraums liegt nach dem Drehen an derselben Wand. Ihr genaues Feld gibt die Welt beim Zeichnen vor.
      const room = { kind: 'meeting' as FurnitureKind, i: 2, j: 2, rot };
      const door = xf.tile(meetingDoor(room).outside);
      const viewDoor = meetingDoor(xf.item(room)).outside;
      assert.ok(door.i === viewDoor.i || door.j === viewDoor.j, `Tür bei Kamera ${cam}, rot ${rot}`);
    }
  }
});
