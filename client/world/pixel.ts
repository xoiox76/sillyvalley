// Pixelgenaues Zeichnen. Canvas-Pfade würden kantengeglättet, darum rastert fillPoly selbst.

export interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export function layer(w: number, h: number): Layer {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export type Ctx = CanvasRenderingContext2D;
type Point = readonly [number, number];

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export function fillPoly(ctx: Ctx, pts: readonly Point[], color: string): void {
  const ys = pts.map((p) => p[1]);
  const minY = Math.floor(Math.min(...ys));
  const maxY = Math.ceil(Math.max(...ys));
  ctx.fillStyle = color;
  for (let y = minY; y < maxY; y++) {
    const scan = y + 0.5;
    const xs: number[] = [];
    for (let a = 0; a < pts.length; a++) {
      const [x0, y0] = pts[a];
      const [x1, y1] = pts[(a + 1) % pts.length];
      if ((y0 <= scan && y1 > scan) || (y1 <= scan && y0 > scan)) xs.push(x0 + ((scan - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const left = Math.round(xs[k]);
      const right = Math.round(xs[k + 1]);
      if (right > left) ctx.fillRect(left, y, right - left, 1);
    }
  }
}

export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string): void {
  ctx.fillStyle = color;
  let [x, y] = [Math.round(x0), Math.round(y0)];
  const [ex, ey] = [Math.round(x1), Math.round(y1)];
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x, y, 1, 1);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

const toRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

export function mix(a: string, b: string, t: number): string {
  const [r0, g0, b0] = toRgb(a);
  const [r1, g1, b1] = toRgb(b);
  return toHex(r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t);
}

export const lighten = (c: string, t: number) => mix(c, '#ffffff', t);
export const darken = (c: string, t: number) => mix(c, '#08101c', t);

export interface Faces {
  top: string;
  left: string;
  right: string;
}

/** Drei Seiten einer Farbe: oben hell, links die Farbe selbst, rechts im Schatten. */
export const tri = (c: string, spread = 0.2): Faces => ({ top: lighten(c, spread), left: c, right: darken(c, spread) });

/** Kleiner, deterministischer Zufall, damit Räume bei jedem Laden gleich aussehen. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Zieht einen dunklen Rand um alles Deckende. */
export function outline(target: Layer, color: string): void {
  const { canvas, ctx } = target;
  const { width: w, height: h } = canvas;
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const [r, g, b] = toRgb(color);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 40;
  const edges: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) edges.push((y * w + x) * 4);
    }
  }
  for (const at of edges) {
    data[at] = r;
    data[at + 1] = g;
    data[at + 2] = b;
    data[at + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/** Isometrischer Stift: rechnet Feldkoordinaten (i, j) und Höhe z in Pixel um. */
export class Pen {
  readonly ctx: Ctx;
  readonly ox: number;
  readonly oy: number;

  constructor(ctx: Ctx, ox: number, oy: number) {
    this.ctx = ctx;
    this.ox = ox;
    this.oy = oy;
  }

  pt(i: number, j: number, z = 0): [number, number] {
    return [Math.round(this.ox + (i - j) * 16), Math.round(this.oy + (i + j) * 8 - z)];
  }

  box(i: number, j: number, z: number, w: number, d: number, h: number, c: Faces): void {
    const P = (a: number, b: number, k: number) => this.pt(a, b, k);
    fillPoly(this.ctx, [P(i, j + d, z), P(i + w, j + d, z), P(i + w, j + d, z + h), P(i, j + d, z + h)], c.left);
    fillPoly(this.ctx, [P(i + w, j, z), P(i + w, j + d, z), P(i + w, j + d, z + h), P(i + w, j, z + h)], c.right);
    fillPoly(this.ctx, [P(i, j, z + h), P(i + w, j, z + h), P(i + w, j + d, z + h), P(i, j + d, z + h)], c.top);
    const [ax, ay] = P(i, j + d, z + h);
    const [bx, by] = P(i + w, j + d, z + h);
    const [cx, cy] = P(i + w, j, z + h);
    line(this.ctx, ax, ay, bx, by, lighten(c.top, 0.18));
    line(this.ctx, bx, by, cx, cy, lighten(c.top, 0.1));
  }

  /** Fläche auf einer Wand, die nach vorn links zeigt und entlang i läuft. u, v in Pixel ab (i, j, z). */
  faceJ(i: number, j: number, z: number, u: number, v: number, w: number, h: number, color: string): void {
    const [bx, by] = this.pt(i, j, z);
    this.ctx.fillStyle = color;
    for (let c = 0; c < w; c++) this.ctx.fillRect(bx + u + c, by + Math.floor((u + c) / 2) - v - h, 1, h);
  }

  /** Fläche auf einer Wand, die nach vorn rechts zeigt und entlang j läuft. */
  faceI(i: number, j: number, z: number, u: number, v: number, w: number, h: number, color: string): void {
    const [bx, by] = this.pt(i, j, z);
    this.ctx.fillStyle = color;
    for (let c = 0; c < w; c++) this.ctx.fillRect(bx - u - c - 1, by + Math.floor((u + c) / 2) - v - h, 1, h);
  }

  floorPoly(i: number, j: number, w: number, d: number, color: string): void {
    fillPoly(this.ctx, [this.pt(i, j), this.pt(i + w, j), this.pt(i + w, j + d), this.pt(i, j + d)], color);
  }
}
