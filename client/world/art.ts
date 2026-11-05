// Möbel und feste Einrichtung, aus isometrischen Quadern und Pixeln aufgebaut.
// Jedes Motiv wird einmal in eine Ebene gerendert und danach nur noch kopiert.

import type { FixedProp } from '../../shared/catalog.ts';
import type { Rotation } from '../../shared/types.ts';
import { Pen, darken, layer, lighten, outline, rect, seeded, tri, type Faces, type Layer } from './pixel.ts';

export const INK = '#111a29';

const WOOD = tri('#b5804c');
const WOOD_DARK = tri('#6d4a30');
const STEEL = tri('#2a3347');
const PLASTIC = tri('#3a4660');
const SEAT = tri('#393a5c', 0.16);
const WHITE = tri('#e8edf0', 0.1);
const POT = tri('#2d3b57');

export interface Sprite {
  canvas: HTMLCanvasElement;
  ax: number;
  ay: number;
}

const CANVAS = { w: 168, h: 132, ax: 84, ay: 72 };

function sprite(draw: (pen: Pen, l: Layer) => void, withOutline = true): Sprite {
  const l = layer(CANVAS.w, CANVAS.h);
  draw(new Pen(l.ctx, CANVAS.ax, CANVAS.ay), l);
  if (withOutline) outline(l, INK);
  return { canvas: l.canvas, ax: CANVAS.ax, ay: CANVAS.ay };
}

const cache = new Map<string, Sprite>();
function cached(key: string, build: () => Sprite): Sprite {
  let s = cache.get(key);
  if (!s) {
    s = build();
    cache.set(key, s);
  }
  return s;
}

/** Vertauscht i und j. So reicht eine Zeichnung für beide Tischausrichtungen. */
const drawer = (pen: Pen, swap: boolean) => ({
  box: (a: number, b: number, z: number, w: number, d: number, h: number, c: Faces) =>
    swap ? pen.box(b, a, z, d, w, h, c) : pen.box(a, b, z, w, d, h, c),
  face: (a: number, b: number, z: number, u: number, v: number, w: number, h: number, color: string) =>
    swap ? pen.faceI(b, a, z, u, v, w, h, color) : pen.faceJ(a, b, z, u, v, w, h, color),
});

/** Lage des Tisches: Stuhl hinten (rot 0, 1) oder vorn (rot 2, 3). */
const tableB = (rot: Rotation) => (rot < 2 ? 1.04 : 0.04);

export function deskTable(rot: Rotation): Sprite {
  return cached(`table${rot}`, () =>
    sprite((pen) => {
      const d = drawer(pen, rot % 2 === 1);
      const b = tableB(rot);
      for (const [x, y] of [[0.08, b + 0.06], [1.82, b + 0.06], [0.08, b + 0.8], [1.82, b + 0.8]]) d.box(x, y, 0, 0.1, 0.1, 13, STEEL);
      // Rollcontainer mit Griffen
      d.box(0.2, b + 0.2, 0, 0.36, 0.56, 13, tri('#2b3550'));
      for (const v of [3, 8]) d.face(0.2, b + 0.76, 0, 1, v, 4, 1, '#8d97a3');
      d.box(0.04, b, 13, 1.92, 0.92, 2, WOOD);
      d.box(0.04, b + 0.9, 13, 1.92, 0.02, 1, tri('#d9a770', 0.1));
      // Tastatur mit Tastenreihen, Maus, Papier, Becher
      const keyB = rot < 2 ? b + 0.12 : b + 0.6;
      d.box(0.68, keyB, 15, 0.62, 0.2, 1, PLASTIC);
      d.box(0.72, keyB + 0.03, 16, 0.54, 0.04, 0, tri('#8d97a3', 0.05));
      d.box(0.72, keyB + 0.1, 16, 0.54, 0.04, 0, tri('#8d97a3', 0.05));
      d.box(1.38, keyB + 0.04, 15, 0.1, 0.13, 1, tri('#c9d0d6', 0.12));
      d.box(0.22, keyB - 0.02, 15, 0.3, 0.4, 0.5, tri('#e8edf0', 0.05));
      d.box(0.28, keyB + 0.04, 15.5, 0.2, 0.26, 0.5, tri('#f6f7f2', 0.03));
      d.box(1.62, rot < 2 ? b + 0.5 : b + 0.14, 15, 0.14, 0.14, 4, tri('#c5484a', 0.14));
      d.box(1.65, rot < 2 ? b + 0.53 : b + 0.17, 19, 0.08, 0.08, 0.5, tri('#3a2418', 0.05));
      const monB = rot < 2 ? b + 0.62 : b + 0.24;
      d.box(0.82, monB - 0.04, 15, 0.36, 0.22, 1, STEEL);
      d.box(0.94, monB + 0.04, 16, 0.12, 0.08, 3, STEEL);
      d.box(0.56, monB + 0.02, 18, 0.88, 0.08, 14, tri('#1c2436', 0.14));
      d.face(0.56, monB + 0.1, 18, 12, 0, 1, 1, '#5eeac0');
    }),
  );
}

/** Dein Tisch: dunkleres Holz, statt Bildschirm ein Pineapple-Laptop. Das Logo sieht man von hinten, sitzt du davor, den Bildschirm. */
export function ceoTable(rot: Rotation): Sprite {
  return cached(`ceotable${rot}`, () =>
    sprite((pen) => {
      const d = drawer(pen, rot % 2 === 1);
      const b = tableB(rot);
      const wood = tri('#5a3a26');
      for (const [x, y] of [[0.08, b + 0.06], [1.82, b + 0.06], [0.08, b + 0.8], [1.82, b + 0.8]]) d.box(x, y, 0, 0.1, 0.1, 13, tri('#2a2320'));
      d.box(0.2, b + 0.2, 0, 0.36, 0.56, 13, tri('#3a2418'));
      for (const v of [3, 8]) d.face(0.2, b + 0.76, 0, 1, v, 4, 1, '#d9a62e');
      d.box(0.04, b, 13, 1.92, 0.92, 2, wood);
      d.box(0.04, b + 0.9, 13, 1.92, 0.02, 1, tri('#8a5f3e', 0.1));
      // Becher, Notizblock und eine kleine Lampe
      d.box(1.6, rot < 2 ? b + 0.5 : b + 0.14, 15, 0.14, 0.14, 4, WHITE);
      d.box(0.2, rot < 2 ? b + 0.2 : b + 0.5, 15, 0.26, 0.32, 0.5, tri('#f6e9a8', 0.04));
      d.box(1.66, rot < 2 ? b + 0.12 : b + 0.66, 15, 0.14, 0.14, 1, STEEL);
      d.box(1.71, rot < 2 ? b + 0.17 : b + 0.71, 16, 0.04, 0.04, 9, STEEL);
      d.box(1.58, rot < 2 ? b + 0.08 : b + 0.62, 25, 0.28, 0.2, 2, tri('#d9a62e', 0.12));
      const silver = tri('#c9d0d6');
      const lid = rot < 2 ? b + 0.62 : b + 0.22;
      d.box(0.62, rot < 2 ? b + 0.22 : b + 0.28, 15, 0.76, 0.44, 1, silver);
      d.box(0.62, lid, 16, 0.76, 0.05, 11, silver);
      if (rot >= 2) d.face(0.62, lid + 0.05, 16, 1, 1, 10, 9, '#1b4a66');
      // Die Ananas: gelber Bauch, grüne Krone.
      d.face(0.62, lid + 0.05, 16, 4, 2, 4, 5, '#f8d34a');
      d.face(0.62, lid + 0.05, 16, 5, 3, 1, 1, '#c99a1e');
      d.face(0.62, lid + 0.05, 16, 7, 5, 1, 1, '#c99a1e');
      d.face(0.62, lid + 0.05, 16, 5, 7, 2, 1, '#37a064');
      d.face(0.62, lid + 0.05, 16, 4, 8, 1, 1, '#37a064');
      d.face(0.62, lid + 0.05, 16, 7, 8, 1, 1, '#37a064');
    }),
  );
}

export function chairBase(rot: Rotation): Sprite {
  return cached(`chairbase${rot}`, () =>
    sprite((pen) => {
      const d = drawer(pen, rot % 2 === 1);
      const b = rot < 2 ? 0.5 : 1.5;
      // Fünf Rollen, eine Säule, ein Polster mit heller Naht.
      for (const [x, y] of [[0.68, -0.22], [1.2, -0.2], [0.62, 0.14], [1.26, 0.14], [0.94, 0.24]]) d.box(x, b + y, 0, 0.1, 0.1, 1, tri('#14192a', 0.05));
      d.box(0.74, b - 0.2, 1, 0.52, 0.4, 1, STEEL);
      d.box(0.95, b - 0.05, 2, 0.1, 0.1, 6, tri('#59636f', 0.12));
      d.box(0.72, b - 0.28, 8, 0.56, 0.56, 2, SEAT);
      d.box(0.76, b - 0.24, 10, 0.48, 0.48, 0.5, tri('#4a4c74', 0.08));
    }),
  );
}

export function chairBack(rot: Rotation): Sprite {
  return cached(`chairback${rot}`, () =>
    sprite((pen) => {
      const d = drawer(pen, rot % 2 === 1);
      const b = rot < 2 ? 0.14 : 1.78;
      d.box(0.72, b, 10, 0.56, 0.08, 15, SEAT);
      d.box(0.68, b + (rot < 2 ? 0.06 : -0.26), 14, 0.04, 0.28, 1, STEEL);
      d.box(1.28, b + (rot < 2 ? 0.06 : -0.26), 14, 0.04, 0.28, 1, STEEL);
      d.face(0.72, b + 0.08, 10, 2, 12, 5, 1, '#5a5c86');
    }),
  );
}

/** Der Bildschirm ist nur sichtbar, wenn der Stuhl vorn steht. Er leuchtet nur bei echter Arbeit. */
export function drawScreen(pen: Pen, rot: Rotation, active: boolean, tick: number): void {
  if (rot < 2) return;
  const d = drawer(pen, rot === 3);
  const b = tableB(rot) + 0.34;
  const off = '#16293d';
  d.face(0.56, b, 18, 1, 1, 12, 12, active ? '#1b4a66' : off);
  if (!active) return;
  for (let row = 0; row < 4; row++) {
    const len = 3 + ((row * 3 + tick) % 7);
    d.face(0.56, b, 18, 2, 10 - row * 2, len, 1, row === 1 ? '#f8b62d' : '#5eeac0');
  }
}

/** Blatt für Blatt gezeichnete Zimmerpflanze. */
function drawLeaves(pen: Pen, cx: number, cy: number, seed: number, size: number): void {
  const random = seeded(seed);
  const greens = ['#1f6b47', '#2a8455', '#37a064', '#57bf72'];
  for (let n = 0; n < 16; n++) {
    const angle = -Math.PI * (0.06 + random() * 0.88);
    const length = size * (0.55 + random() * 0.55);
    const color = greens[Math.min(3, Math.floor(random() * 3 + (n > 8 ? 1 : 0)))];
    for (let t = 0; t < length; t += 0.5) {
      const x = cx + Math.cos(angle) * t;
      const y = cy + Math.sin(angle) * t * 0.95 + (t * t) / (size * 2.4);
      const width = t > length * 0.75 ? 1 : 2;
      rect(pen.ctx, Math.round(x), Math.round(y), width, 2, color);
      if (t > length - 1) rect(pen.ctx, Math.round(x), Math.round(y), 1, 1, lighten(color, 0.3));
    }
  }
}

/** Vorderseite je Drehung: 0 nach vorn links, 1 nach vorn rechts, 2 und 3 vom Betrachter weg. Dann sieht man die Rückwand. */
export function furnitureSprite(kind: 'shelf' | 'coffee' | 'plant', variant = 0, rot: Rotation = 0): Sprite {
  return cached(`${kind}${variant}r${rot}`, () =>
    sprite((pen) => {
      const d = drawer(pen, rot % 2 === 1);
      const facing = rot < 2;
      if (kind === 'plant') {
        pen.box(0.3, 0.3, 0, 0.4, 0.4, 7, POT);
        pen.box(0.26, 0.26, 7, 0.48, 0.48, 2, tri('#3c4d70', 0.12));
        pen.box(0.3, 0.3, 9, 0.4, 0.4, 0.5, tri('#3a2a1e', 0.05));
        const [cx, cy] = pen.pt(0.5, 0.5, 9);
        // Eine Pflanze hat keine Vorderseite. Jede Drehung zeigt eine andere Blattstellung.
        drawLeaves(pen, cx, cy, 17 + variant * 13 + rot * 41, 16);
      } else if (kind === 'shelf') {
        d.box(0.06, 0.3, 0, 0.88, 0.4, 42, WOOD_DARK);
        d.box(0.3, 0.38, 42, 0.4, 0.26, 5, tri('#b5804c', 0.14));
        if (!facing) {
          d.face(0.06, 0.7, 0, 1, 2, 12, 37, darken('#6d4a30', 0.14));
          for (let row = 1; row < 4; row++) d.face(0.06, 0.7, 0, 1, row * 10, 12, 1, darken('#6d4a30', 0.3));
          return;
        }
        const colors = ['#c5484a', '#3f7fd0', '#e9c46a', '#2fa58f', '#b05cc6', '#e4792b', '#e8edf0'];
        const random = seeded(5);
        for (let row = 0; row < 4; row++) {
          const base = 3 + row * 10;
          d.face(0.06, 0.7, 0, 1, base - 1, 12, 9, darken('#6d4a30', 0.5));
          for (let u = 2; u < 13; u += 2) {
            const h = 5 + Math.floor(random() * 3);
            d.face(0.06, 0.7, 0, u, base, 2, h, colors[Math.floor(random() * colors.length)]);
          }
        }
      } else {
        // Der Kopf der Maschine sitzt hinten. Dreht sie sich weg, wandert er nach vorn und verdeckt die Tassen nicht.
        const top = facing ? 0.26 : 0.32;
        d.box(0.08, 0.16, 0, 0.84, 0.68, 14, tri('#3b4a63'));
        if (facing) {
          d.face(0.08, 0.84, 0, 2, 3, 5, 8, '#2d3a51');
          d.face(0.08, 0.84, 0, 8, 3, 4, 8, '#2d3a51');
        } else {
          for (let v = 3; v < 11; v += 2) d.face(0.08, 0.84, 0, 3, v, 8, 1, '#2d3a51');
        }
        d.box(0.22, top, 14, 0.44, 0.42, 13, tri('#1e2638'));
        if (facing) {
          d.face(0.22, top + 0.42, 14, 1, 6, 5, 5, '#101a2a');
          d.face(0.22, top + 0.42, 14, 2, 8, 2, 2, '#e5534b');
          d.face(0.22, top + 0.42, 14, 2, 3, 3, 2, '#5a3a26');
          d.box(0.3, 0.46, 15, 0.14, 0.14, 4, WHITE);
          d.face(0.3, 0.6, 15, 1, 3, 1, 1, '#c5484a');
          const [sx, sy] = pen.pt(0.4, 0.5, 21);
          rect(pen.ctx, sx, sy, 1, 2, 'rgba(240,245,250,.7)');
          rect(pen.ctx, sx + 1, sy - 3, 1, 2, 'rgba(240,245,250,.5)');
        }
        d.box(0.72, facing ? 0.3 : 0.56, 14, 0.14, 0.14, 4, WHITE);
      }
    }),
  );
}

export function propSprite(prop: Pick<FixedProp, 'kind'>): Sprite {
  return cached(`prop${prop.kind}`, () =>
    sprite((pen) => {
      switch (prop.kind) {
        case 'bed': {
          pen.box(0.04, 0.04, 0, 1.92, 0.14, 22, WOOD_DARK);
          pen.box(0.06, 0.16, 0, 1.88, 2.78, 7, WOOD);
          pen.box(0.1, 0.2, 7, 1.8, 2.7, 5, WHITE);
          pen.box(0.34, 0.26, 12, 1.32, 0.58, 3, tri('#f4f4ef', 0.1));
          pen.box(0.08, 1.06, 8, 1.84, 1.86, 6, tri('#1d8f7d'));
          for (let u = 3; u < 28; u += 6) pen.faceJ(0.08, 2.92, 8, u, 1, 2, 5, '#2bb39c');
          break;
        }
        case 'toybox': {
          pen.box(0.1, 0.12, 0, 0.8, 0.76, 10, tri('#d05a4e'));
          pen.box(0.2, 0.2, 10, 0.26, 0.26, 4, tri('#e9c46a'));
          pen.box(0.5, 0.44, 10, 0.26, 0.26, 4, tri('#3f7fd0'));
          break;
        }
        case 'workbench': {
          pen.box(0.04, 0.12, 0, 2.92, 0.74, 3, STEEL);
          for (const x of [0.1, 1.45, 2.8]) pen.box(x, 0.2, 3, 0.1, 0.56, 11, STEEL);
          pen.box(0.02, 0.08, 14, 2.96, 0.82, 3, WOOD);
          pen.box(0.3, 0.26, 17, 0.5, 0.3, 6, tri('#c5484a'));
          pen.box(1.2, 0.3, 17, 0.2, 0.3, 10, tri('#3b4a63'));
          pen.box(2.1, 0.26, 17, 0.56, 0.22, 3, tri('#e9c46a'));
          break;
        }
        case 'boxes': {
          const card = tri('#b58a56');
          pen.box(0.08, 0.1, 0, 0.84, 0.8, 13, card);
          pen.faceJ(0.08, 0.9, 0, 5, 0, 3, 13, '#d9b27e');
          pen.box(0.22, 0.2, 13, 0.56, 0.52, 10, card);
          pen.faceJ(0.22, 0.72, 13, 3, 0, 2, 10, '#d9b27e');
          break;
        }
        case 'tires': {
          const rubber = tri('#26282f', 0.1);
          for (let n = 0; n < 3; n++) {
            pen.box(0.16, 0.16, n * 6, 0.68, 0.68, 5, rubber);
            pen.box(0.34, 0.34, n * 6 + 5, 0.32, 0.32, 0.5, tri('#0d0f14', 0.05));
          }
          break;
        }
        case 'lockers': {
          pen.box(0.04, 0.2, 0, 1.92, 0.7, 40, tri('#27344f', 0.14));
          for (let n = 0; n < 3; n++) {
            pen.faceJ(0.04, 0.9, 0, 1 + n * 10, 2, 9, 36, '#2f3f5e');
            pen.faceJ(0.04, 0.9, 0, 7 + n * 10, 18, 1, 5, '#9fb0c8');
          }
          break;
        }
        case 'lift': {
          pen.box(0.06, 0.06, 0, 0.88, 0.88, 46, tri('#7d8894'));
          pen.faceJ(0.06, 0.94, 0, 1, 0, 12, 32, '#59636f');
          pen.faceJ(0.06, 0.94, 0, 2, 0, 10, 30, '#b9c2cb');
          pen.faceJ(0.06, 0.94, 0, 6, 0, 1, 30, '#59636f');
          pen.faceJ(0.06, 0.94, 0, 3, 20, 2, 8, '#dbe2e8');
          pen.faceJ(0.06, 0.94, 0, 8, 20, 2, 8, '#dbe2e8');
          pen.faceJ(0.06, 0.94, 0, 3, 34, 8, 4, '#1b2436');
          pen.faceJ(0.06, 0.94, 0, 5, 35, 4, 2, '#f8b62d');
          pen.faceJ(0.06, 0.94, 0, 12, 13, 1, 3, '#5eeac0');
          break;
        }
        case 'stairs': {
          // Von vorn nach hinten ansteigend. Die hinterste, höchste Stufe zuerst, sonst verdeckt sie die vorderen.
          const steps = 8;
          const depth = 1.84 / steps;
          const y = (k: number) => 1.92 - (k + 1) * depth;
          const top = (k: number) => (k + 1) * 6;
          for (let k = steps - 1; k >= 0; k--) {
            pen.box(0.02, y(k), 0, 0.96, depth, top(k), tri(k % 2 ? '#9aa4ae' : '#b4bcc4', 0.16));
            // Die Vorderkante jeder Stufe hebt sie vom nächsten Absatz ab.
            pen.faceJ(0.02, y(k) + depth, top(k) - 1, 0, 0, 15, 1, '#dfe4e8');
          }
          // Handlauf auf der offenen Seite, Stufe für Stufe.
          for (let k = steps - 1; k >= 0; k--) {
            pen.box(0.92, y(k), top(k) + 9, 0.05, depth, 1, tri('#2a3347', 0.1));
            if (k % 2 === 0) pen.box(0.92, y(k) + depth / 2, top(k), 0.05, 0.05, 9, tri('#59636f', 0.1));
          }
          break;
        }
        case 'sofa': {
          const teal = tri('#1c6f75');
          pen.box(0.12, 0.08, 0, 0.8, 1.84, 8, teal);
          pen.box(0.12, 0.08, 8, 0.2, 1.84, 10, teal);
          pen.box(0.32, 0.08, 8, 0.6, 0.2, 5, teal);
          pen.box(0.32, 1.72, 8, 0.6, 0.2, 5, teal);
          break;
        }
      }
    }),
  );
}

/* ---------- Fahrstuhl ---------- */

const LIFT_STEEL = tri('#7d8894');

/** Der Schacht ohne Tür. Die Tür bewegt sich und wird deshalb je Bild gemalt. */
export function liftShell(): Sprite {
  return cached('liftShell', () => sprite((pen) => pen.box(0.06, 0.06, 0, 0.88, 0.88, 46, LIFT_STEEL)));
}

export type LiftFace = 'i' | 'j';
type FaceDraw = (u: number, v: number, w: number, h: number, color: string) => void;

const liftFace = (pen: Pen, i: number, j: number, face: LiftFace): FaceDraw =>
  face === 'j'
    ? (u, v, w, h, color) => pen.faceJ(i + 0.06, j + 0.94, 0, u, v, w, h, color)
    : (u, v, w, h, color) => pen.faceI(i + 0.94, j + 0.06, 0, u, v, w, h, color);

/** Rahmen, offene Kabine, Knopf und Anzeige. Die Figur steht davor, die Türflügel kommen danach. */
export function drawLiftFrame(pen: Pen, i: number, j: number, face: LiftFace, cabin: number, floors: number, called: boolean): void {
  const f = liftFace(pen, i, j, face);
  f(1, 0, 12, 32, '#59636f');
  f(2, 0, 10, 30, '#131a27');
  f(3, 2, 8, 25, '#3b4a60');
  f(3, 26, 8, 1, '#f2e7b8');
  // Die Anzeige über der Tür: ein Punkt je Etage, der Punkt der Kabine leuchtet.
  f(3, 34, 8, 4, '#1b2436');
  for (let n = 0; n < Math.min(floors, 4); n++) f(4 + n * 2, 35, 1, 2, n === cabin ? '#f8b62d' : '#3b4658');
  // Der Knopf
  f(13, 12, 1, 4, '#2a3347');
  f(13, 13, 1, 2, called ? '#f8b62d' : '#5eeac0');
}

/** Die Türflügel. Bei 1 ist die Tür ganz offen. */
export function drawLiftDoors(pen: Pen, i: number, j: number, face: LiftFace, open: number): void {
  const f = liftFace(pen, i, j, face);
  const leaf = Math.round(5 * (1 - open));
  if (leaf <= 0) return;
  f(2, 0, leaf, 30, '#b9c2cb');
  f(12 - leaf, 0, leaf, 30, '#b9c2cb');
  f(2 + leaf - 1, 0, 1, 30, '#8c96a1');
  f(12 - leaf, 0, 1, 30, '#8c96a1');
  f(2, 20, leaf - 1, 8, '#dbe2e8');
  f(13 - leaf, 20, leaf - 1, 8, '#dbe2e8');
}

/* ---------- Besprechungsraum ---------- */

const GLASS_H = 34;
const FRAME = '#1c2a40';

/** Teppich und Hocker. Liegt unter allem, was im Raum passiert. */
export function meetingFloor(): Sprite {
  return cached('meetingfloor', () =>
    sprite((pen) => {
      pen.floorPoly(0.1, 0.1, 2.8, 2.8, '#33536b');
      pen.floorPoly(0.28, 0.28, 2.44, 2.44, '#456a84');
      pen.floorPoly(0.42, 0.42, 2.16, 2.16, '#3b5e77');
      for (const [x, y] of [[1.5, 0.5], [0.5, 1.5], [2.5, 1.5], [1.5, 2.5]]) pen.box(x - 0.2, y - 0.2, 0, 0.4, 0.4, 8, SEAT);
    }, false),
  );
}

export function meetingTable(): Sprite {
  return cached('meetingtable', () =>
    sprite((pen) => {
      for (const [x, y] of [[1.02, 1.02], [1.88, 1.02], [1.02, 1.88], [1.88, 1.88]]) pen.box(x, y, 0, 0.1, 0.1, 11, STEEL);
      pen.box(0.86, 0.86, 11, 1.28, 1.28, 2, WOOD);
      pen.box(1.14, 1.0, 13, 0.34, 0.26, 1, PLASTIC);
      pen.box(1.56, 1.5, 13, 0.34, 0.26, 1, PLASTIC);
      pen.box(1.06, 1.64, 13, 0.14, 0.14, 4, WHITE);
      pen.box(1.72, 1.04, 13, 0.3, 0.2, 1, WHITE);
    }),
  );
}

/** Ein Wandstück von einem Feld Breite. So lässt sich jedes Stück einzeln in die Tiefe sortieren. */
export function glassSegment(axis: 'i' | 'j', door: boolean): Sprite {
  return cached(`glass${axis}${door}`, () =>
    sprite((pen) => {
      const put = (u: number, v: number, w: number, h: number, color: string) =>
        axis === 'i' ? pen.faceJ(0, 0, 0, u, v, w, h, color) : pen.faceI(0, 0, 0, u, v, w, h, color);
      if (door) {
        put(0, 0, 1, GLASS_H, FRAME);
        put(15, 0, 1, GLASS_H, FRAME);
        put(0, GLASS_H - 3, 16, 3, FRAME);
        return;
      }
      put(0, 0, 16, GLASS_H, 'rgba(150,225,235,.2)');
      put(5, 8, 2, 20, 'rgba(255,255,255,.24)');
      put(9, 14, 1, 12, 'rgba(255,255,255,.16)');
      put(0, 0, 16, 3, FRAME);
      put(0, GLASS_H - 2, 16, 2, FRAME);
      put(0, 0, 1, GLASS_H, FRAME);
      put(15, 0, 1, GLASS_H, FRAME);
    }, false),
  );
}

export const ROOM_HEIGHT = GLASS_H;
