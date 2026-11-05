// Baut den Raum eines Standorts: Insel, Boden, Rückwände, Vorderwände.
// Boden und Wände werden pixelweise aus Funktionen gefärbt, deshalb wirken sie handgesetzt.

import type { LocationInfo } from '../../shared/catalog.ts';
import type { LocationId } from '../../shared/types.ts';
import { Pen, darken, fillPoly, hash2, layer, lighten, line, rect, seeded, tri, type Layer } from './pixel.ts';
import { INK } from './art.ts';

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
  doors: { face: 'J' | 'I'; u: number; w: number; h: number }[];
}

interface Theme {
  floor: (i: number, j: number) => string;
  wallRight: (u: number, v: number) => string;
  wallLeft: (u: number, v: number) => string;
  pillar: string;
  cap: string;
  frontFace: string;
  board: { u: number; v: number; w: number; h: number };
}

const frac = (n: number) => n - Math.floor(n);

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

const THEMES: Record<LocationId, Theme> = {
  kinderzimmer: {
    floor: woodFloor,
    wallRight: (u, v) => skirting(v, '#d6d2c6') ?? (v === 4 ? '#8a9aa3' : (Math.floor(u / 12) % 2 ? '#7f9aa8' : '#7692a1')),
    wallLeft: (u, v) => skirting(v, '#bcb8ad') ?? (v === 4 ? '#6f7f88' : (Math.floor(u / 12) % 2 ? '#6c8795' : '#648090')),
    pillar: '#8a6443',
    cap: '#d3cfc4',
    frontFace: '#a8a397',
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

function drawDoor(pen: Pen, face: 'J' | 'I', u: number): void {
  const put = (a: number, b: number, c: number, d: number, color: string) =>
    face === 'J' ? pen.faceJ(0, 0, 0, a, b, c, d, color) : pen.faceI(0, 0, 0, a, b, c, d, color);
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

export function buildRoom(loc: LocationInfo, level = 0): Room {
  const theme = THEMES[loc.id];
  const { w: W, d: D } = loc;
  const width = (W + D) * 16 + MARGIN * 2;
  const height = (W + D) * 8 + WALL_H + MARGIN + 26;
  const ox = D * 16 + MARGIN;
  const oy = WALL_H + 22;
  const base = layer(width, height);
  const front = layer(width, height);
  const pen = new Pen(base.ctx, ox, oy);
  const ctx = base.ctx;

  // Insel
  const pad = 0.95;
  const island = [pen.pt(-pad, -pad), pen.pt(W + pad, -pad), pen.pt(W + pad, D + pad), pen.pt(-pad, D + pad)] as const;
  const skirt = island.map(([x, y]) => [x, y + 10] as const);
  fillPoly(ctx, [skirt[1], skirt[2], skirt[3], island[3], island[2], island[1]], '#3c3a35');
  fillPoly(ctx, [island[3], island[2], skirt[2], skirt[3]], '#4a463f');
  fillPoly(ctx, island, '#3f7d48');
  const random = seeded(loc.id.length * 991);
  const [minX, maxX] = [island[3][0], island[1][0]];
  for (let n = 0; n < (W + D) * 90; n++) {
    const x = minX + random() * (maxX - minX);
    const y = random() * height;
    const ii = ((x - ox) / 16 + (y - oy) / 8) / 2;
    const jj = ((y - oy) / 8 - (x - ox) / 16) / 2;
    if (ii < -pad || jj < -pad || ii > W + pad || jj > D + pad) continue;
    rect(ctx, Math.round(x), Math.round(y), 1 + Math.floor(random() * 2), 1, random() > 0.5 ? '#4f9457' : '#33693d');
  }
  // Büsche an den Vorderkanten
  const bushes = ['#2c6a3d', '#3a8549', '#57a65e'];
  for (let n = 0; n < (W + D) * 1.7; n++) {
    const along = random();
    const onLeft = random() > 0.5;
    const [bx, by] = onLeft ? pen.pt(-0.5 + along * (W + 1), D + 0.62) : pen.pt(W + 0.62, -0.5 + along * (D + 1));
    for (let k = 0; k < 14; k++) {
      const dx = (random() - 0.5) * 12;
      const dy = (random() - 0.7) * 7;
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
      const i = ((x + 0.5 - ox) / 16 + (y + 0.5 - oy) / 8) / 2;
      const j = ((y + 0.5 - oy) / 8 - (x + 0.5 - ox) / 16) / 2;
      if (i < 0 || j < 0 || i >= W || j >= D) continue;
      // Zu den Wänden hin wird es weich dunkler, und durch die Fenster fällt Licht.
      const near = Math.min(i, j);
      const corner = near < 1.3 ? (1.3 - near) * 0.17 : 0;
      const sun = sunlight(loc.id, i, j);
      const color = theme.floor(i, j);
      paint(x, y, sun > 0 ? lighten(darken(color, corner * 0.6), sun) : corner > 0 ? darken(color, corner) : color);
    }
  }
  ctx.putImageData(floor, 0, 0);

  // Teppiche
  if (loc.id === 'kinderzimmer') {
    pen.floorPoly(2.6, 3.2, 3, 2.2, '#3f6d94');
    pen.floorPoly(2.8, 3.4, 2.6, 1.8, '#4f83ad');
    pen.floorPoly(3.1, 3.7, 2, 1.2, '#d9a62e');
    pen.floorPoly(3.2, 3.8, 1.8, 1, '#4f83ad');
  } else if (loc.id === 'buero') {
    for (let n = 0; n < 7; n++) pen.floorPoly(4 + n * 0.5, 4.5, 0.5, 2.6, n % 2 ? '#3f6078' : '#54758c');
  }

  // Rückwände, pixelweise. Oben fällt Schatten von der Decke, und Deckenlicht zeichnet sanfte Kegel.
  const wallH = WALL_H;
  const wallShade = (color: string, u: number, v: number) => {
    if (v >= wallH - 3) return darken(color, 0.16 - (wallH - v) * 0.03);
    if (v === 4) return lighten(color, 0.14);
    if (v === 5) return darken(color, 0.08);
    const beam = Math.abs(((u + 26) % 64) - 32);
    const glow = v > 20 ? Math.max(0, 0.07 - beam * 0.004 - (v - 20) * 0.0015) : 0;
    return glow > 0 ? lighten(color, glow) : color;
  };
  for (let u = 0; u < W * 16; u++) {
    for (let v = 0; v < wallH; v++) {
      const y = oy + Math.floor(u / 2) - v - 1;
      rect(ctx, ox + u, y, 1, 1, wallShade(theme.wallRight(u, v), u, v));
    }
  }
  for (let u = 0; u < D * 16; u++) {
    for (let v = 0; v < wallH; v++) {
      const y = oy + Math.floor(u / 2) - v - 1;
      rect(ctx, ox - u - 1, y, 1, 1, wallShade(theme.wallLeft(u, v), u, v));
    }
  }

  // Wanddeko und Türen
  const doors: Room['doors'] = [];
  const addDoor = (u: number) => {
    drawDoor(pen, 'J', u);
    doors.push({ face: 'J', u: u - 2, w: 17, h: 40 });
  };
  if (loc.id === 'kinderzimmer') {
    drawWindow(pen, 'I', 62, 22, 22, 18);
    drawPoster(pen, 'I', 40, 22, 12, 16, ['#e5534b', '#f8b62d', '#3f7fd0']);
    drawPoster(pen, 'J', 82, 24, 10, 13, ['#2fa58f', '#b05cc6', '#f8b62d']);
    for (const [u, v] of [[8, 46], [20, 40], [90, 44]]) {
      pen.faceI(0, 0, 0, u % 92, v, 2, 2, '#f8e27a');
    }
    if (level === 0) addDoor(W * 16 - 14);
  } else if (loc.id === 'garage') {
    drawRollerDoor(pen, 44, 46);
    if (level === 0) doors.push({ face: 'I', u: 42, w: 50, h: 42 });
    drawWindow(pen, 'J', 56, 26, 24, 13);
    addDoor(96);
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
    if (level === 0) addDoor(W * 16 - 14);
  }

  // Pinnwandrahmen. Die Zettel darauf zeichnet die Welt je nach echten Aufträgen.
  const b = theme.board;
  if (level === 0) {
    pen.faceJ(0, 0, 0, b.u - 2, b.v - 2, b.w + 4, b.h + 4, '#2a3347');
    pen.faceJ(0, 0, 0, b.u, b.v, b.w, b.h, '#d9d4c5');
  }

  // Mauerkrone und Pfeiler der Rückwände
  const capColor = theme.cap;
  fillPoly(ctx, [pen.pt(-THICK, -THICK, wallH), pen.pt(W + THICK, -THICK, wallH), pen.pt(W + THICK, 0, wallH), pen.pt(0, 0, wallH)], capColor);
  fillPoly(ctx, [pen.pt(-THICK, -THICK, wallH), pen.pt(0, 0, wallH), pen.pt(0, D + THICK, wallH), pen.pt(-THICK, D + THICK, wallH)], darken(capColor, 0.06));
  const [ex, ey] = pen.pt(W, 0, wallH);
  line(ctx, ox, oy - wallH, ex, ey, INK);
  const [fx, fy] = pen.pt(0, D, wallH);
  line(ctx, ox, oy - wallH, fx, fy, INK);

  const pillar = tri(theme.pillar, 0.14);
  pen.box(-THICK, -THICK, 0, THICK + 0.1, THICK + 0.1, wallH + 3, pillar);
  const stepI = Math.max(3, Math.round(W / 2));
  const stepJ = Math.max(3, Math.round(D / 2));
  for (let k = stepI; k < W; k += stepI) pen.box(k - 0.14, -THICK, 0, 0.28, THICK + 0.08, wallH + 3, pillar);
  for (let k = stepJ; k < D; k += stepJ) pen.box(-THICK, k - 0.14, 0, THICK + 0.08, 0.28, wallH + 3, pillar);

  // Vorderwände
  const fp = new Pen(front.ctx, ox, oy);
  const low = tri(theme.frontFace, 0.16);
  fp.box(W, -THICK, 0, THICK, D + THICK * 2, FRONT_H, low);
  fp.box(-THICK, D, 0, W + THICK, THICK, FRONT_H, low);
  // Fensterbänder in den Außenseiten
  for (let u = 18; u < W * 16 - 18; u += 48) fp.faceJ(0, D + THICK, 0, u, 3, 30, 6, '#3e4a5a');
  for (let u = 18; u < D * 16 - 18; u += 48) fp.faceI(W + THICK, 0, 0, u, 3, 30, 6, '#343f4e');
  fp.box(W - 0.06, -THICK, 0, THICK + 0.1, THICK + 0.16, FRONT_H + 6, pillar);
  fp.box(-THICK, D - 0.06, 0, THICK + 0.16, THICK + 0.1, FRONT_H + 6, pillar);
  fp.box(W - 0.06, D - 0.06, 0, THICK + 0.1, THICK + 0.1, FRONT_H + 6, pillar);
  for (let k = stepI; k < W; k += stepI) fp.box(k - 0.14, D - 0.04, 0, 0.28, THICK + 0.08, FRONT_H + 5, pillar);
  for (let k = stepJ; k < D; k += stepJ) fp.box(W - 0.04, k - 0.14, 0, THICK + 0.08, 0.28, FRONT_H + 5, pillar);

  return { base, front, pen, width, height, board: b, doors };
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
