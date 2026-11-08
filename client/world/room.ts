// Baut den Raum eines Standorts: Insel, Boden, Rückwände, Vorderwände.
// Boden und Wände werden pixelweise aus Funktionen gefärbt, deshalb wirken sie handgesetzt.

import type { LocationInfo } from '../../shared/catalog.ts';
import type { LocationId } from '../../shared/types.ts';
import { Pen, darken, fillPoly, fillPolyFn, hash2, layer, lighten, line, mix, rect, seeded, tri, type Ctx, type Layer, type Faces } from './pixel.ts';
import { INK, RES } from './art.ts';

export const WALL_H = 56;
const FRONT_H = 12;
const THICK = 0.24;
const MARGIN = 58;

export interface Room {
  base: Layer;
  front: Layer;
  pen: Pen;
  width: number;
  height: number;
  /** Pinnwand auf der hinteren rechten Wand. u, v in Pixel. */
  board: { u: number; v: number; w: number; h: number };
  /** Wo man hinausgeht. u in Pixel entlang der Wand. Die Welt prüft darauf Klicks. */
  doors: { face: 'J' | 'I'; j: number; u: number; w: number; h: number }[];
  /** Feste Lichter im Raum, in Pixeln der Raumebene. Die Welt legt ihren Schein darüber. */
  lights: RoomLight[];
  /** Abendstimmung: Der Raum ist gedämpft, Lampen und Bildschirme leuchten. */
  evening: boolean;
}

export interface RoomLight {
  x: number;
  y: number;
  r: number;
  color: string;
  strength: number;
  /** Ein Lämpchen: Es bekommt einen kleinen hellen Kern. */
  bulb?: boolean;
}

interface Theme {
  floor: (i: number, j: number) => string;
  /** u, v in alten Pixeln, fu, fv in feinen. */
  wallRight: (u: number, v: number, fu?: number, fv?: number) => string;
  wallLeft: (u: number, v: number, fu?: number, fv?: number) => string;
  /** Fein aufgelöster Boden: Farbe für einen Punkt (i, j) in Feldern, x, y in Bildpixeln. Ohne ihn gilt floor. */
  floorFine?: (i: number, j: number, x: number, y: number) => string;
  pillar: string;
  cap: string;
  frontFace: string;
  board: { u: number; v: number; w: number; h: number };
}

const frac = (n: number) => n - Math.floor(n);

/** Mischt einen Boden mit Parkettbraun. */
function toParquet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (shift: number, target: number) => Math.round(((n >> shift) & 255) * 0.5 + target * 0.5);
  const parquet = [0xb0, 0x7d, 0x4f];
  return `#${[mix(16, parquet[0]), mix(8, parquet[1]), mix(0, parquet[2])].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const woodFloor = (i: number, j: number) => {
  const plank = Math.floor(j * 3);
  const along = i + hash2(plank, 3) * 5;
  const shade = hash2(plank, Math.floor(along / 2.6));
  const base = shade < 0.33 ? '#9b6f48' : shade < 0.66 ? '#a67950' : '#8f6541';
  if (frac(j * 3) < 0.07) return '#6e4c31';
  if (frac(along / 2.6) < 0.012) return '#6e4c31';
  const grain = hash2(Math.floor(i * 16), Math.floor(j * 32));
  return grain > 0.93 ? darken(base, 0.1) : grain < 0.05 ? lighten(base, 0.06) : base;
};

const concreteFloor = (i: number, j: number) => {
  const speck = hash2(Math.floor(i * 24), Math.floor(j * 24));
  let base = '#74787b';
  const stain = Math.hypot(i - 5.2, j - 4) < 0.7 + hash2(Math.floor(i * 6), Math.floor(j * 6)) * 0.3 || Math.hypot(i - 2.4, j - 4.6) < 0.34;
  if (stain) base = '#5e6265';
  if (frac(i / 4) < 0.006 || frac(j / 3) < 0.008) return '#55595c';
  if (i < 1.16 && j > 3.2 && i > 1.0 && Math.floor((j * 2)) % 2 === 0) return '#d9a62e';
  return speck > 0.94 ? darken(base, 0.12) : speck < 0.05 ? lighten(base, 0.08) : base;
};

const tileFloor = (i: number, j: number) => {
  if (frac(i) < 0.045 || frac(j) < 0.045) return '#6b6865';
  const shade = hash2(Math.floor(i), Math.floor(j));
  const base = shade < 0.5 ? '#8c8782' : '#857f7a';
  const speck = hash2(Math.floor(i * 20), Math.floor(j * 20));
  return speck > 0.95 ? darken(base, 0.08) : speck < 0.04 ? lighten(base, 0.07) : base;
};

const skirting = (v: number, color: string) => (v < 4 ? color : null);

/** Eigener Neubau: heller Putz, glatter Boden. Unterschiede nur in der Wandfarbe. */
function newBuild(right: string, left: string): Theme {
  return {
    floor: (i, j) => {
      // Grosse Platten mit heller Kante und leichten Wolken, wie geschliffener Stein.
      if (frac(i / 2) < 0.02 || frac(j / 2) < 0.02) return '#6f7a7e';
      const edge = frac(i / 2) < 0.04 || frac(j / 2) < 0.04;
      const plate = hash2(Math.floor(i / 2), Math.floor(j / 2));
      const base = plate < 0.33 ? '#8e999d' : plate < 0.66 ? '#939ea2' : '#8a9599';
      if (edge) return lighten(base, 0.1);
      const cloud = hash2(Math.floor(i * 3), Math.floor(j * 3));
      const speck = hash2(Math.floor(i * 22), Math.floor(j * 22));
      const tinted = cloud > 0.7 ? darken(base, 0.03) : cloud < 0.25 ? lighten(base, 0.03) : base;
      return speck > 0.95 ? darken(tinted, 0.07) : speck < 0.04 ? lighten(tinted, 0.07) : tinted;
    },
    wallRight: (_u, v) => skirting(v, '#4d5159') ?? right,
    wallLeft: (_u, v) => skirting(v, '#42454c') ?? left,
    pillar: '#2f6f62',
    cap: '#e4e4dc',
    frontFace: '#9da29c',
    board: { u: 20, v: 24, w: 40, h: 22 },
  };
}

/* ---------- Fein aufgelöste Muster: Backstein und Dielen ---------- */

const ramp = (cs: string[]) => (t: number) => cs[Math.max(0, Math.min(cs.length - 1, Math.round(t * (cs.length - 1))))];
const BRICK = ramp(['#4a1e14', '#6a2c1c', '#8a3c26', '#a85234', '#c46a46']);
const MORTAR = ['#2a2420', '#3a332d', '#4c443c'];
const PLANK = ramp(['#2a160c', '#3f2414', '#55331d', '#6d4429', '#8a5a36']);
const SKIRT = ['#3a2212', '#55321b', '#734626', '#b07644'];

/** Backstein in feinen Pixeln: Steine 12 × 5, versetzt, oben heller, unten dunkler, einzelne Steine abweichend. */
function fineBrick(u: number, v: number, dark: boolean): string {
  if (v < 6 * RES) return v === 6 * RES - 1 ? SKIRT[3] : v >= 6 * RES - 3 ? SKIRT[2] : SKIRT[dark ? 0 : 1];
  const w = v - 6 * RES;
  const row = Math.floor(w / 5);
  const inRow = w % 5;
  const off = row % 2 ? 6 : 0;
  const col = Math.floor((u + off) / 12);
  const inCol = (u + off) % 12;
  if (inRow === 4 || inCol === 11) return MORTAR[dark ? 0 : 1];
  const t = 0.5 + (hash2(col, row) - 0.5) * 0.55 + (inRow === 0 ? 0.2 : 0) + (inCol === 0 ? 0.12 : 0) - (inRow === 3 ? 0.15 : 0) - (dark ? 0.22 : 0);
  return BRICK(t + (hash2(u, v) > 0.93 ? -0.18 : 0));
}

/** Dunkle Dielen mit Fugen, Maserung und Astlöchern. i, j in Feldern. */
function darkPlanks(i: number, j: number, x: number, y: number): string {
  const row = Math.floor(i * 4.5);
  const along = j + hash2(row, 3) * 3;
  if (frac(i * 4.5) < 0.07 || frac(along * 0.7) < 0.012) return PLANK(0);
  const grain = Math.sin(along * 30 + Math.sin(along * 2.6 + row) * 2.2 + hash2(row, 1) * 9);
  const knot = hash2(row, Math.floor(along * 4)) > 0.985 && Math.abs(frac(along * 4) - 0.5) < 0.12;
  if (knot) return PLANK(0);
  return PLANK(0.5 + (hash2(row, Math.floor(along * 0.7)) - 0.5) * 0.4 + (grain > 0.8 ? -0.25 : 0) + (hash2(x, y) > 0.95 ? 0.25 : 0));
}

/** Backstein mit Fugen, versetzt je Reihe. */
const brick = (u: number, v: number, base: string, joint: string) => {
  const row = Math.floor(v / 5);
  if (v % 5 === 0 || (u + (row % 2) * 5) % 10 === 0) return joint;
  const tone = hash2(Math.floor((u + (row % 2) * 5) / 10), row);
  return tone > 0.8 ? darken(base, 0.08) : tone < 0.2 ? lighten(base, 0.06) : base;
};

const THEMES: Record<LocationId, Theme> = {
  coworking: {
    floor: woodFloor,
    wallRight: (u, v) => skirting(v, '#4d5159') ?? (u % 30 < 2 ? '#c9cfd6' : '#dfe4ea'),
    wallLeft: (u, v) => skirting(v, '#42454c') ?? (u % 30 < 2 ? '#b3bac3' : '#c8ced6'),
    pillar: '#2f6f62',
    cap: '#e4e4dc',
    frontFace: '#9da29c',
    board: { u: 20, v: 24, w: 36, h: 20 },
  },
  fabrik: {
    floor: (i, j) => {
      // Betonboden mit gelben Fahrlinien.
      if ((frac(j / 6) < 0.035 && frac(i / 1.5) < 0.6) || frac(i / 8) < 0.02) return '#c9a227';
      return concreteFloor(i, j);
    },
    wallRight: (u, v) => skirting(v, '#3f3a38') ?? brick(u, v, '#9a4f3c', '#6e5a52'),
    wallLeft: (u, v) => skirting(v, '#35302e') ?? brick(u, v, '#7d4031', '#5a4a44'),
    pillar: '#3b4658',
    cap: '#8c8c84',
    frontFace: '#7a6a62',
    board: { u: 28, v: 24, w: 44, h: 22 },
  },
  kinderzimmer: {
    floor: woodFloor,
    // Dunkle Dielen und offener Backstein, wie ein Zimmer unterm Dach am Abend.
    floorFine: (i, j, x, y) => darkPlanks(i, j, x, y),
    wallRight: (u, v, fu = u * RES, fv = v * RES) => fineBrick(fu, fv, false),
    wallLeft: (u, v, fu = u * RES, fv = v * RES) => fineBrick(fu, fv, true),
    pillar: '#4a2a1c',
    cap: '#2a1a14',
    frontFace: '#5a3424',
    board: { u: 40, v: 24, w: 32, h: 20 },
  },
  garage: {
    floor: concreteFloor,
    wallRight: (u, v) => {
      const rib = u % 6 === 0 ? -0.1 : u % 6 === 3 ? 0.05 : 0;
      const stain = hash2(u >> 3, 9) > 0.8 && v < 14 + hash2(u >> 3, 4) * 14 ? -0.08 : 0;
      return (skirting(v, '#5c5f60') ?? (rib + stain < 0 ? darken('#8b8d88', -(rib + stain) * 1.6) : lighten('#8b8d88', rib + stain)));
    },
    wallLeft: (u, v) => {
      const rib = u % 6 === 0 ? -0.1 : u % 6 === 3 ? 0.05 : 0;
      return skirting(v, '#4f5253') ?? (rib < 0 ? darken('#73756f', 0.14) : lighten('#73756f', rib));
    },
    pillar: '#8a4438',
    cap: '#b4b3ab',
    frontFace: '#8c8c84',
    board: { u: 12, v: 24, w: 32, h: 20 },
  },
  buero: {
    floor: tileFloor,
    wallRight: (u, v) => {
      const seam = u % 40 === 0 || v % 26 === 0;
      const speck = hash2(u, v) > 0.97;
      return skirting(v, '#4d5159') ?? (seam ? '#73736c' : speck ? '#7d7d76' : '#8d8d85');
    },
    wallLeft: (u, v) => {
      const seam = u % 40 === 0 || v % 26 === 0;
      return skirting(v, '#42454c') ?? (seam ? '#5f5f59' : '#75756e');
    },
    pillar: '#8a4438',
    cap: '#b9b8ae',
    frontFace: '#8c8c84',
    board: { u: 20, v: 24, w: 40, h: 22 },
  },
  eckladen: {
    floor: woodFloor,
    wallRight: (u, v) => skirting(v, '#d6d2c6') ?? (hash2(u >> 2, v >> 2) > 0.96 ? '#c9b89a' : '#d4c5a8'),
    wallLeft: (u, v) => skirting(v, '#bcb8ad') ?? (hash2(u >> 2, v >> 2) > 0.96 ? '#ad9e82' : '#b8aa8e'),
    pillar: '#7a5a3e',
    cap: '#d3cfc4',
    frontFace: '#a8a397',
    board: { u: 20, v: 24, w: 36, h: 20 },
  },
  kino: {
    floor: (i, j) => (frac(i / 2) < 0.04 || frac(j / 2) < 0.04 ? '#4f2f38' : (Math.floor(i / 2) + Math.floor(j / 2)) % 2 ? '#6d3d48' : '#7c4852'),
    wallRight: (u, v) => skirting(v, '#3a2a30') ?? (u % 24 < 2 ? '#5f3e50' : '#6f4a5f'),
    wallLeft: (u, v) => skirting(v, '#30232a') ?? (u % 24 < 2 ? '#4f3443' : '#5c3e50'),
    pillar: '#d9a62e',
    cap: '#a88aa0',
    frontFace: '#7d6a8c',
    board: { u: 24, v: 24, w: 44, h: 22 },
  },
  'neubau-klein': newBuild('#c6ccd0', '#aab1b6'),
  'neubau-mittel': newBuild('#c9d2cc', '#adb7b0'),
  'neubau-gross': newBuild('#d0ccc4', '#b4b0a8'),
};

function drawWindow(pen: Pen, face: 'J' | 'I', u: number, v: number, w: number, h: number): void {
  const put = (a: number, b: number, c: number, d: number, color: string) =>
    face === 'J' ? pen.faceJ(0, 0, 0, a, b, c, d, color) : pen.faceI(0, 0, 0, a, b, c, d, color);
  // Rahmen, dahinter Himmel, Wolken und ferne Bäume.
  put(u - 2, v - 2, w + 4, h + 4, '#2a3347');
  put(u - 1, v - 1, w + 2, h + 2, '#e6e4da');
  const bands = ['#7fc7e8', '#93d3ec', '#a9dff0', '#c4eaf2'];
  for (let n = 0; n < h; n++) put(u, v + h - 1 - n, w, 1, bands[Math.min(3, Math.floor((n / h) * 4))]);
  const random = seeded(u * 13 + v);
  put(u + 2 + Math.floor(random() * Math.max(1, w - 9)), v + h - 5, 6, 2, '#ffffff');
  put(u + 3 + Math.floor(random() * Math.max(1, w - 9)), v + h - 4, 4, 1, '#f2fafc');
  for (let n = 0; n < w; n++) {
    const top = 2 + Math.floor(hash2(n >> 1, u) * 3);
    put(u + n, v, 1, top, hash2(n >> 2, v) > 0.5 ? '#4d9060' : '#3f7d54');
  }
  put(u + Math.floor(w / 2), v, 1, h, '#e6e4da');
  put(u, v + Math.floor(h / 2), w, 1, '#e6e4da');
  // Spiegelung und Fensterbank
  for (let n = 0; n < Math.min(4, h - 2); n++) put(u + 2 + n, v + h - 2 - n, 1, 1, '#ffffff');
  put(u - 3, v - 3, w + 6, 2, '#f2f0e6');
  put(u - 3, v - 4, w + 6, 1, '#8d8d85');
}

/** Eine Wanduhr: Die Zeiger stehen still, doch der Raum wirkt bewohnt. */
function drawClock(pen: Pen, u: number, v: number): void {
  const put = (a: number, b: number, c: number, d: number, color: string) => pen.faceJ(0, 0, 0, a, b, c, d, color);
  put(u + 1, v, 6, 8, '#2a3347');
  put(u, v + 1, 8, 6, '#2a3347');
  put(u + 1, v + 1, 6, 6, '#f2f0e6');
  put(u + 4, v + 4, 1, 3, '#2a3347');
  put(u + 4, v + 3, 2, 1, '#c5484a');
}

function drawPoster(pen: Pen, face: 'J' | 'I', u: number, v: number, w: number, h: number, colors: string[]): void {
  const put = (a: number, b: number, c: number, d: number, color: string) =>
    face === 'J' ? pen.faceJ(0, 0, 0, a, b, c, d, color) : pen.faceI(0, 0, 0, a, b, c, d, color);
  put(u - 1, v - 1, w + 2, h + 2, '#2a3347');
  put(u, v, w, h, '#eef0ea');
  const random = seeded(u * 7 + v);
  for (let n = 0; n < 5; n++) {
    put(u + 1 + Math.floor(random() * (w - 5)), v + 1 + Math.floor(random() * (h - 4)), 3, 3, colors[n % colors.length]);
  }
}

/** Die Haustür in der vorderen Wand. Sie überragt die niedrige Schnittkante, damit man sie von aussen erkennt. */
function drawDoor(pen: Pen, j: number, u: number): void {
  const put = (a: number, b: number, c: number, d: number, color: string) => pen.faceJ(0, j, 0, a, b, c, d, color);
  put(u - 2, 0, 17, 40, '#e6e4da');
  put(u - 1, 0, 15, 38, '#141b2a');
  put(u, 0, 13, 37, '#2a3550');
  put(u, 0, 1, 37, '#3a4868');
  put(u + 2, 24, 9, 10, '#a9dff0');
  put(u + 2, 24, 9, 1, '#1d2740');
  put(u + 3, 30, 2, 2, '#ffffff');
  put(u + 2, 4, 9, 14, '#34425f');
  put(u + 3, 5, 7, 12, '#2d3a55');
  put(u + 10, 18, 2, 3, '#f0c04a');
  put(u + 10, 18, 2, 1, '#fff0b0');
}

function drawRollerDoor(pen: Pen, u: number, w: number): void {
  pen.faceI(0, 0, 0, u - 2, 0, w + 4, 42, '#2b303b');
  for (let v = 0; v < 38; v += 3) {
    pen.faceI(0, 0, 0, u, v, w, 2, v % 6 === 0 ? '#4a5261' : '#414958');
    pen.faceI(0, 0, 0, u, v + 2, w, 1, '#2f3644');
  }
  pen.faceI(0, 0, 0, u + Math.floor(w / 2) - 3, 3, 6, 1, '#d9a62e');
}

/** Wo die Sonne auf dem Boden liegt. Fenster sitzen je Standort anders, darum steht ihr Ort hier. */
const SUN: Partial<Record<LocationId, { face: 'I' | 'J'; u: number; w: number }[]>> = {
  kinderzimmer: [{ face: 'I', u: 62, w: 22 }],
  garage: [{ face: 'J', u: 56, w: 24 }],
};
const DEFAULT_SUN: { face: 'I' | 'J'; u: number; w: number }[] = [{ face: 'I', u: 28, w: 30 }, { face: 'I', u: 76, w: 30 }, { face: 'J', u: 110, w: 18 }];

function sunlight(id: LocationId, i: number, j: number): number {
  for (const { face, u, w } of SUN[id] ?? DEFAULT_SUN) {
    // Das Licht fällt schräg vom Fenster in den Raum und wird nach innen schwächer.
    const out = face === 'I' ? i : j;
    const along = (face === 'I' ? j : i) - out * 0.35;
    const reach = 2.6;
    if (out < 0 || out > reach) continue;
    const pos = along * 16 - u;
    if (pos < 0 || pos > w) continue;
    if (Math.abs(pos - w / 2) < 0.8) continue;
    return 0.13 * (1 - out / reach) + 0.02;
  }
  return 0;
}

/* ---------- Kinderzimmer: Fenster mit Nachtstadt, Lichterkette, Poster ---------- */

/** Ein feines Pixel auf der linken (I, längs j) oder rechten (J, längs i) Rückwand. u, v in feinen Pixeln. */
function wallDot(ctx: Ctx, ox: number, oy: number, face: 'I' | 'J', u: number, v: number, color: string): void {
  const x = face === 'J' ? ox + u : ox - u - 1;
  rect(ctx, x, oy + Math.floor(u / 2) - v - 1, 1, 1, color);
}

const GLYPH: Record<string, string> = { D: '110101101101110', E: '111100110100111', P: '110101110100100', L: '100100100100111', O: '010101101101010', Y: '101101010010010', S: '011100010001110', H: '101101111101101', I: '111010010010111', T: '111010010010010', '!': '010010010000010', ' ': '000000000000000' };

function wallText(ctx: Ctx, ox: number, oy: number, face: 'I' | 'J', u: number, v: number, text: string, color: string): void {
  let at = 0;
  for (const ch of text) {
    const g = GLYPH[ch] ?? GLYPH[' '];
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r * 3 + q] === '1') wallDot(ctx, ox, oy, face, u + at + q, v - r, color);
    at += 4;
  }
}

function kidsRoomDecor(ctx: Ctx, ox: number, oy: number): RoomLight[] {
  const lights: RoomLight[] = [];
  const dot = (face: 'I' | 'J', u: number, v: number, c: string) => wallDot(ctx, ox, oy, face, u, v, c);
  // Fenster in der linken Wand: Rahmen, Sprossen, Nachthimmel, Hochhäuser mit hellen Fenstern, Sterne, Spiegelung
  const W0 = { u: 118, v: 42, w: 52, h: 46 };
  for (let u = -3; u < W0.w + 3; u++) {
    for (let v = -3; v < W0.h + 3; v++) {
      const inside = u >= 0 && v >= 0 && u < W0.w && v < W0.h;
      if (!inside) {
        dot('I', W0.u + u, W0.v + v, v < 0 ? '#b0b4ba' : '#e2e4e7');
        continue;
      }
      const frame = u < 2 || v < 2 || u >= W0.w - 2 || v >= W0.h - 2 || Math.abs(u - W0.w / 2) < 1 || v === Math.floor(W0.h * 0.62);
      if (frame) {
        dot('I', W0.u + u, W0.v + v, u < 1 ? '#cdd0d4' : '#eceef1');
        continue;
      }
      // Tagsüber: Himmel und Hochhäuser. Abends färbt das Licht der Welt alles ein.
      const b = Math.floor(u / 6);
      const bh = 10 + hash2(b, 2) * 20;
      let c = mix('#8fc4e8', '#d8eefa', v / W0.h);
      if (v < bh) {
        c = hash2(b, 5) > 0.5 ? '#8a96a8' : '#9aa6b6';
        if (u % 6 > 1 && u % 6 < 4 && v % 4 === 1) c = hash2(b * 13 + (u % 6), v) > 0.5 ? '#c8dcea' : '#6a7888';
      } else if (v > 34 && hash2(u >> 2, v >> 1) > 0.9) c = '#ffffff';
      if ((u + v) % 26 < 2) c = mix(c, '#ffffff', 0.3);
      dot('I', W0.u + u, W0.v + v, c);
    }
  }
  for (let u = -5; u < W0.w + 5; u++) for (let v = 0; v < 3; v++) dot('I', W0.u + u, W0.v - 4 - v, v === 0 ? '#f4f5f6' : '#b0b4ba');
  // Lichterkette um das Fenster, mit Lämpchen in warmem Gelb
  const wire: [number, number][] = [];
  for (let v = 0; v <= W0.h + 6; v++) wire.push([W0.u - 6, W0.v + v]);
  for (let u = -6; u <= W0.w + 6; u++) wire.push([W0.u + u, W0.v + W0.h + 6 - Math.round(Math.abs(Math.sin((u / (W0.w + 12)) * Math.PI * 4)) * 3)]);
  for (let v = W0.h + 6; v >= 0; v--) wire.push([W0.u + W0.w + 6, W0.v + v]);
  wire.forEach(([u, v]) => dot('I', u, v, '#2a2a22'));
  wire.forEach(([u, v], k) => {
    if (k % 9) return;
    dot('I', u, v - 1, '#fff4c8');
    dot('I', u, v - 2, '#ffd27a');
    lights.push({ x: ox - u - 1, y: oy + Math.floor(u / 2) - v, r: 22, color: '#ffbe6e', strength: 0.14, bulb: true });
  });
  // Mondlicht durchs Fenster
  lights.push({ x: ox - W0.u - W0.w / 2, y: oy + (W0.u + W0.w / 2) / 2 - W0.v + 40, r: 130, color: '#6e8cdc', strength: 0.35 });
  // Neonposter mit abstraktem Gesicht links neben dem Fenster
  for (let u = 0; u < 30; u++) {
    for (let v = 0; v < 42; v++) {
      const fr = u < 2 || v < 2 || u > 27 || v > 39;
      const cx = u - 15;
      const cy = v - 22;
      const face = (cx * cx) / 100 + (cy * cy) / 200 < 1;
      let c = fr ? '#1a1a20' : mix('#1c2a3a', '#2e1c3a', v / 42);
      if (face) c = cx < -2 ? '#3fc4a8' : cx < 4 ? '#e58a2e' : '#c43a6a';
      if (face && Math.abs(cy - 4) < 2 && Math.abs(Math.abs(cx) - 4) < 2) c = '#f4f0e0';
      dot('I', 30 + u, 50 + v, c);
    }
  }
  // Poster rechte Wand: Rakete mit DEPLOY, Neon SHIP IT
  for (let u = 0; u < 28; u++) {
    for (let v = 0; v < 40; v++) {
      const fr = u < 2 || v < 2 || u > 25 || v > 37;
      let c = fr ? '#141418' : mix('#d97b2e', '#e9c46a', v / 40);
      const cx = u - 14;
      const top = v - 14;
      if (!fr && v > 12 && v < 32 && Math.abs(cx) <= (top > 12 ? (18 - top) * 0.7 : 4)) c = Math.abs(cx) < 1 && v > 20 && v < 24 ? '#3a78c4' : '#f4f0e0';
      if (!fr && v > 8 && v <= 12 && Math.abs(cx) < 3) c = hash2(u, v) > 0.4 ? '#ff5a2a' : '#ffd34a';
      dot('J', 14 + u, 46 + v, c);
    }
  }
  wallText(ctx, ox, oy, 'J', 17, 51, 'DEPLOY', '#2a1408');
  for (let u = 0; u < 28; u++) for (let v = 0; v < 34; v++) dot('J', 150 + u, 52 + v, u < 2 || v < 2 || u > 25 || v > 31 ? '#141418' : mix('#1a1030', '#121a2e', v / 34));
  wallText(ctx, ox, oy, 'J', 155, 78, 'SHIP', '#5eeac0');
  wallText(ctx, ox, oy, 'J', 159, 68, 'IT!', '#ff5aa8');
  lights.push({ x: ox + 164, y: oy + 82 - 70, r: 40, color: '#c46aff', strength: 0.3 });
  return lights;
}

/** grounded: Das Haus steht auf seinem Grundstück in der Stadt, ebenerdig und ohne eigene Insel. */
/** Höhe einer Etage: Wand, Decke und Schwelle. */
const STOREY_H = WALL_H + 4;

/** decor false: ohne Fenster, Bilder, Pinnwand und Haustür. So sieht das Haus bei gedrehter Kamera aus. */
/** low: Wände unten wie im Bauspiel. Die Außenwände sind dann nur ein Sockel, die Etagen darüber fehlen. */
export function buildRoom(loc: LocationInfo, level = 0, grounded = false, floors = 1, decor = true, lowWalls = false): Room {
  const theme = THEMES[loc.id];
  const { w: W, d: D } = loc;
  // Über dem Raum stehen die oberen Etagen, unter ihm das Erdgeschoss. Beide gehören zum Bild.
  const topExtra = Math.max(0, floors - 1 - level) * STOREY_H;
  const bottomExtra = Math.max(0, level) * STOREY_H;
  // Alles in alten Pixeln gerechnet und RES-fach feiner gezeichnet.
  const width = ((W + D) * 16 + MARGIN * 2) * RES;
  const height = ((W + D) * 8 + WALL_H + MARGIN + 26 + topExtra + bottomExtra) * RES;
  const ox = (D * 16 + MARGIN) * RES;
  const oy = (WALL_H + 22 + topExtra) * RES;
  const base = layer(width, height);
  const front = layer(width, height);
  const pen = new Pen(base.ctx, ox, oy, RES);
  const ctx = base.ctx;

  // Insel
  const pad = 0.95;
  const island = [pen.pt(-pad, -pad), pen.pt(W + pad, -pad), pen.pt(W + pad, D + pad), pen.pt(-pad, D + pad)] as const;
  const skirt = island.map(([x, y]) => [x, y + 10] as const);
  if (!grounded) {
    fillPoly(ctx, [skirt[1], skirt[2], skirt[3], island[3], island[2], island[1]], '#3c3a35');
    fillPoly(ctx, [island[3], island[2], skirt[2], skirt[3]], '#4a463f');
    fillPoly(ctx, island, '#3f7d48');
  }
  const random = seeded(loc.id.length * 991);
  const [minX, maxX] = [island[3][0], island[1][0]];
  for (let n = 0; n < (grounded ? 0 : (W + D) * 90 * RES * RES); n++) {
    const x = minX + random() * (maxX - minX);
    const y = random() * height;
    const ii = ((x - ox) / (16 * RES) + (y - oy) / (8 * RES)) / 2;
    const jj = ((y - oy) / (8 * RES) - (x - ox) / (16 * RES)) / 2;
    if (ii < -pad || jj < -pad || ii > W + pad || jj > D + pad) continue;
    rect(ctx, Math.round(x), Math.round(y), 1 + Math.floor(random() * 2), 1, random() > 0.5 ? '#4f9457' : '#33693d');
  }
  // Büsche an den Vorderkanten
  const bushes = ['#2c6a3d', '#3a8549', '#57a65e'];
  for (let n = 0; n < (grounded ? 0 : (W + D) * 1.7); n++) {
    const along = random();
    const onLeft = random() > 0.5;
    const [bx, by] = onLeft ? pen.pt(-0.5 + along * (W + 1), D + 0.62) : pen.pt(W + 0.62, -0.5 + along * (D + 1));
    for (let k = 0; k < 14 * RES; k++) {
      const dx = (random() - 0.5) * 12 * RES;
      const dy = (random() - 0.7) * 7 * RES;
      rect(ctx, Math.round(bx + dx), Math.round(by + dy), 2, 2, bushes[Math.floor(random() * 3)]);
    }
  }

  // Boden
  const floor = ctx.getImageData(0, 0, width, height);
  const paint = (x: number, y: number, hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const at = (y * width + x) * 4;
    floor.data[at] = (n >> 16) & 255;
    floor.data[at + 1] = (n >> 8) & 255;
    floor.data[at + 2] = n & 255;
    floor.data[at + 3] = 255;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = ((x + 0.5 - ox) / (16 * RES) + (y + 0.5 - oy) / (8 * RES)) / 2;
      const j = ((y + 0.5 - oy) / (8 * RES) - (x + 0.5 - ox) / (16 * RES)) / 2;
      if (i < 0 || j < 0 || i >= W || j >= D) continue;
      // Zu den Wänden hin wird es weich dunkler, und durch die Fenster fällt Licht.
      const near = Math.min(i, j);
      const corner = near < 1.3 ? (1.3 - near) * 0.17 : 0;
      const sun = sunlight(loc.id, i, j);
      // Im Obergeschoss liegt Parkett statt des Erdgeschoss-Bodens, damit man sofort sieht, dass man oben ist.
      const plain = theme.floorFine ? theme.floorFine(i, j, x, y) : theme.floor(i, j);
      const color = level > 0 ? toParquet(plain) : plain;
      paint(x, y, sun > 0 ? lighten(darken(color, corner * 0.6), sun) : corner > 0 ? darken(color, corner) : color);
    }
  }
  ctx.putImageData(floor, 0, 0);

  // Teppiche
  if (loc.id === 'kinderzimmer') {
    // Abgetretener Teppich mit Bordüre, Rautenmuster und Fransen
    const RUG = ['#4a3e2c', '#625238', '#7a6848', '#94825c', '#b09e78'];
    fillPolyFn(ctx, [pen.pt(2.4, 2.9), pen.pt(5.6, 2.9), pen.pt(5.6, 5.4), pen.pt(2.4, 5.4)], (x, y) => {
      const i = ((x + 0.5 - ox) / (16 * RES) + (y + 0.5 - oy) / (8 * RES)) / 2 - 2.4;
      const j = ((y + 0.5 - oy) / (8 * RES) - (x + 0.5 - ox) / (16 * RES)) / 2 - 2.9;
      if (i < 0.12 || j < 0.12 || i > 3.08 || j > 2.38) return RUG[1 + ((Math.floor(i * 12) + Math.floor(j * 12)) % 2)];
      const m = Math.abs(frac(i * 1.5) - 0.5) + Math.abs(frac(j * 1.5) - 0.5);
      const worn = Math.hypot(i - 1.6, j - 1.2) < 0.7 ? 1 : 0;
      const t = (m < 0.15 ? 4 : m < 0.24 ? 1 : (x + y) & 1 ? 3 : 2) - worn * 0.7 + (hash2(x, y) > 0.94 ? -1 : 0);
      return RUG[Math.max(0, Math.min(4, Math.round(t)))];
    });
    for (let k = 0; k < 32; k++) {
      const [x, y] = pen.pt(2.4 + k * 0.1, 5.4);
      line(ctx, x, y, x - 1, y + 3, RUG[3]);
    }
  } else if (loc.id === 'buero') {
    for (let n = 0; n < 7; n++) pen.floorPoly(4 + n * 0.5, 4.5, 0.5, 2.6, n % 2 ? '#3f6078' : '#54758c');
  }

  // Rückwände, pixelweise. Oben fällt Schatten von der Decke, und Deckenlicht zeichnet sanfte Kegel.
  const wallH = lowWalls ? FRONT_H : WALL_H;
  const wallShade = (color: string, u: number, v: number) => {
    if (v >= wallH - 3) return darken(color, 0.16 - (wallH - v) * 0.03);
    if (v === 4) return lighten(color, 0.14);
    if (v === 5) return darken(color, 0.08);
    const beam = Math.abs(((u + 26) % 64) - 32);
    const glow = v > 20 ? Math.max(0, 0.07 - beam * 0.004 - (v - 20) * 0.0015) : 0;
    return glow > 0 ? lighten(color, glow) : color;
  };
  // Rückwände Pixel für Pixel in voller Auflösung. Die Muster rechnen in alten Pixeln, fein aufgelöste bekommen die Feinwerte dazu.
  for (let u = 0; u < W * 16 * RES; u++) {
    for (let v = 0; v < wallH * RES; v++) {
      const y = oy + Math.floor(u / 2) - v - 1;
      const [cu, cv] = [Math.floor(u / RES), Math.floor(v / RES)];
      rect(ctx, ox + u, y, 1, 1, wallShade(theme.wallRight(cu, cv, u, v), cu, cv));
    }
  }
  for (let u = 0; u < D * 16 * RES; u++) {
    for (let v = 0; v < wallH * RES; v++) {
      const y = oy + Math.floor(u / 2) - v - 1;
      const [cu, cv] = [Math.floor(u / RES), Math.floor(v / RES)];
      rect(ctx, ox - u - 1, y, 1, 1, wallShade(theme.wallLeft(cu, cv, u, v), cu, cv));
    }
  }

  // Wanddeko und Türen
  const doors: Room['doors'] = [];
  const lights: RoomLight[] = [];
  if (!decor) {
    // Keine Deko: Die Wände der Grundansicht stehen hier an anderen Stellen.
  } else if (loc.id === 'kinderzimmer') {
    lights.push(...kidsRoomDecor(ctx, ox, oy));
  } else if (loc.id === 'garage') {
    drawRollerDoor(pen, 44, 46);
    if (level === 0) doors.push({ face: 'I', j: 0, u: 42, w: 50, h: 42 });
    drawWindow(pen, 'J', 56, 26, 24, 13);
  } else {
    drawWindow(pen, 'I', 28, 24, 30, 18);
    drawWindow(pen, 'I', 76, 24, 30, 18);
    drawWindow(pen, 'J', 110, 24, 18, 18);
    if (W >= 9) {
      drawPoster(pen, 'J', 72, 24, 14, 18, ['#e5534b', '#2fa58f', '#f8b62d']);
      drawClock(pen, 94, 34);
    }
    if (level > 0) drawPoster(pen, 'J', 24, 24, 30, 18, ['#3f7fd0', '#e8c46a', '#2fa58f']);
    // Steckdosen über der Fussleiste
    for (let u = 40; u < W * 16 - 20; u += 72) pen.faceJ(0, 0, 0, u, 6, 3, 3, '#e6e4da');
  }

  // Pinnwandrahmen. Die Zettel darauf zeichnet die Welt je nach echten Aufträgen.
  const b = theme.board;
  if (level === 0 && decor) {
    pen.faceJ(0, 0, 0, b.u - 2, b.v - 2, b.w + 4, b.h + 4, '#2a3347');
    pen.faceJ(0, 0, 0, b.u, b.v, b.w, b.h, '#d9d4c5');
  }

  // Mauerkrone und Pfeiler der Rückwände
  const capColor = theme.cap;
  fillPoly(ctx, [pen.pt(-THICK, -THICK, wallH), pen.pt(W + THICK, -THICK, wallH), pen.pt(W + THICK, 0, wallH), pen.pt(0, 0, wallH)], capColor);
  fillPoly(ctx, [pen.pt(-THICK, -THICK, wallH), pen.pt(0, 0, wallH), pen.pt(0, D + THICK, wallH), pen.pt(-THICK, D + THICK, wallH)], darken(capColor, 0.06));
  const [ex, ey] = pen.pt(W, 0, wallH);
  line(ctx, ox, oy - wallH * RES, ex, ey, INK);
  const [fx, fy] = pen.pt(0, D, wallH);
  line(ctx, ox, oy - wallH * RES, fx, fy, INK);

  const pillar = tri(theme.pillar, 0.14);
  pen.box(-THICK, -THICK, 0, THICK + 0.1, THICK + 0.1, wallH + 3, pillar);
  const stepI = Math.max(3, Math.round(W / 2));
  const stepJ = Math.max(3, Math.round(D / 2));
  for (let k = stepI; k < W; k += stepI) pen.box(k - 0.14, -THICK, 0, 0.28, THICK + 0.08, wallH + 3, pillar);
  for (let k = stepJ; k < D; k += stepJ) pen.box(-THICK, k - 0.14, 0, THICK + 0.08, 0.28, wallH + 3, pillar);

  // Vorderwände
  const fp = new Pen(front.ctx, ox, oy, RES);
  const low = tri(theme.frontFace, 0.16);
  fp.box(W, -THICK, 0, THICK, D + THICK * 2, FRONT_H, low);
  fp.box(-THICK, D, 0, W + THICK, THICK, FRONT_H, low);
  // Fensterbänder in den Außenseiten. Das Kinderzimmer zeigt stattdessen Backstein.
  if (loc.id === 'kinderzimmer') {
    fillPolyFn(front.ctx, [fp.pt(0, D + THICK, 0), fp.pt(W, D + THICK, 0), fp.pt(W, D + THICK, FRONT_H), fp.pt(0, D + THICK, FRONT_H)], (x, y) => {
      const [bx, by] = fp.pt(0, D + THICK, 0);
      const u = x - bx;
      return fineBrick(u, by + Math.floor(u / 2) - y + 6 * RES, false);
    });
    fillPolyFn(front.ctx, [fp.pt(W + THICK, 0, 0), fp.pt(W + THICK, D, 0), fp.pt(W + THICK, D, FRONT_H), fp.pt(W + THICK, 0, FRONT_H)], (x, y) => {
      const [bx, by] = fp.pt(W + THICK, 0, 0);
      const u = bx - x - 1;
      return fineBrick(u, by + Math.floor(u / 2) - y + 6 * RES, true);
    });
  } else {
    for (let u = 18; u < W * 16 - 18; u += 48) fp.faceJ(0, D + THICK, 0, u, 3, 30, 6, '#3e4a5a');
    for (let u = 18; u < D * 16 - 18; u += 48) fp.faceI(W + THICK, 0, 0, u, 3, 30, 6, '#343f4e');
  }
  // Andere Etagen, von außen: Das Erdgeschoss liegt unter dem Raum, die oberen Etagen darüber.
  // Die oberen sind halb durchsichtig, damit man weiter in den eigenen Raum sieht.
  const facade = (z: number, h: number, color: Faces) => {
    fp.box(W, -THICK, z, THICK, D + THICK * 2, h, color);
    fp.box(-THICK, D, z, W + THICK, THICK, h, color);
    for (let u = 18; u < W * 16 - 18; u += 48) fp.faceJ(0, D + THICK, z, u, 16, 30, 16, '#3e4a5a');
    for (let u = 18; u < D * 16 - 18; u += 48) fp.faceI(W + THICK, 0, z, u, 16, 30, 16, '#343f4e');
  };
  for (let s = 0; s < level; s++) facade(-(level - s) * STOREY_H, STOREY_H - 4, tri(theme.frontFace, 0.1));
  // Obere Etagen: Die Rückwände stehen voll da. Die Vorderseite ist aufgeschnitten und zeigt nur den Deckenschnitt,
  // so bleibt der eigene Raum sichtbar.
  const cut = '#8a7f72';
  for (let s = level + 1; s < (lowWalls ? level + 1 : floors); s++) {
    const z = WALL_H + 4 + (s - level - 1) * STOREY_H;
    const wall = tri(theme.frontFace, 0.14);
    pen.box(-THICK, -THICK, z, W + THICK * 2, THICK, STOREY_H - 4, wall);
    pen.box(-THICK, -THICK, z, THICK, D + THICK * 2, STOREY_H - 4, wall);
    for (let u = 18; u < W * 16 - 18; u += 48) pen.faceJ(0, 0, z, u, 16, 30, 16, '#3e4a5a');
    for (let u = 18; u < D * 16 - 18; u += 48) pen.faceI(0, 0, z, u, 16, 30, 16, '#343f4e');
    // Deckenschnitt: die Stärke der Decke an der offenen Vorderseite.
    fp.box(W, -THICK, z - 4, THICK, D + THICK * 2, 4, tri(cut, 0.14));
    fp.box(-THICK, D, z - 4, W + THICK, THICK, 4, tri(cut, 0.14));
  }
  fp.box(W - 0.06, -THICK, 0, THICK + 0.1, THICK + 0.16, FRONT_H + 6, pillar);
  fp.box(-THICK, D - 0.06, 0, THICK + 0.16, THICK + 0.1, FRONT_H + 6, pillar);
  fp.box(W - 0.06, D - 0.06, 0, THICK + 0.1, THICK + 0.1, FRONT_H + 6, pillar);
  for (let k = stepI; k < W; k += stepI) fp.box(k - 0.14, D - 0.04, 0, 0.28, THICK + 0.08, FRONT_H + 5, pillar);
  for (let k = stepJ; k < D; k += stepJ) fp.box(W - 0.04, k - 0.14, 0, THICK + 0.08, 0.28, FRONT_H + 5, pillar);

  if (level === 0 && decor) {
    const u = loc.door.i * 16 + 2;
    drawDoor(fp, D + THICK, u);
    doors.push({ face: 'J', j: D + THICK, u: u - 2, w: 17, h: 40 });
  }

  return { base, front, pen, width, height, board: b, doors, lights, evening: loc.id === 'kinderzimmer' && decor };
}

export function waterPattern(): Layer {
  const size = 128;
  const l = layer(size, size);
  rect(l.ctx, 0, 0, size, size, '#0f7c82');
  const random = seeded(4242);
  for (let n = 0; n < 340; n++) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const len = 2 + Math.floor(random() * 5);
    rect(l.ctx, x, y, len, 1, random() > 0.55 ? '#0c6f76' : '#148a8f');
  }
  return l;
}
