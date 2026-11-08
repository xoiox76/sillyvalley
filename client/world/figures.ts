// Figuren in feiner Auflösung für das Büro. Jede Figur wird aus Formen gefüllt, quer schattiert und
// mit einem Umriss im Farbton ihrer Fläche versehen. Aussehen, Haltung und Blickrichtung bleiben frei kombinierbar.

import type { Look } from '../../shared/types.ts';
import { darken, layer, lighten, mix, rampOf, step, type Ramp } from './pixel.ts';
import type { CharSprite, Pose, View } from './characters.ts';

/** Größe in feinen Pixeln. Die Füße stehen bei ay, sitzend liegt der Schoß bei SEAT_AY. */
export const FIGURE = { w: 48, h: 72, ax: 24, ay: 66 };
const SEAT_AY = 54;

const PANTS = rampOf('#2a3656', 0.2);
const SHOE: Ramp = ['#0e1018', '#171b26', '#222838', '#343c52', '#56607a'];
const BELT: Ramp = ['#1a120c', '#2a1e14', '#3a2a1a', '#5a4028', '#7a5a38'];
const PAPER: Ramp = ['#9aa3ae', '#c2cad3', '#dde3e9', '#eef2f5', '#ffffff'];
const PHONE: Ramp = ['#07090e', '#0e121a', '#161b26', '#232a38', '#3a4458'];

const seatedPose = (pose: Pose) => pose === 'sit' || pose === 'type' || pose === 'think' || pose === 'slump' || pose === 'read';

type Shape = (x: number, y: number) => boolean;
const ell = (cx: number, cy: number, rx: number, ry: number): Shape => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const rr = (x0: number, y0: number, w: number, h: number, r: number): Shape => (x, y) => {
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false;
  const dx = Math.max(x0 + r - x, 0, x - (x0 + w - r));
  const dy = Math.max(y0 + r - y, 0, y - (y0 + h - r));
  return dx * dx + dy * dy <= r * r;
};
const and = (a: Shape, b: Shape): Shape => (x, y) => a(x, y) && b(x, y);

/** Eine Figur entsteht in Schichten: Jede Form setzt eine Fläche, spätere decken frühere ab. */
class Canvas {
  readonly w = FIGURE.w;
  readonly h = FIGURE.h;
  readonly part: (string | null)[] = new Array(FIGURE.w * FIGURE.h).fill(null);
  readonly color: (string | null)[] = new Array(FIGURE.w * FIGURE.h).fill(null);
  private readonly ramps = new Map<string, Ramp>();

  fill(shape: Shape, part: string, ramp: Ramp): void {
    this.ramps.set(part, ramp);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (shape(x + 0.5, y + 0.5)) this.part[y * this.w + x] = part;
  }

  /** Quer schattieren: links hell, rechts dunkel, oben eine Lichtkante. Jede Fläche für sich. */
  shade(): void {
    const { w, h, part } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = part[y * w + x];
        if (!p) continue;
        let l = x;
        let r = x;
        while (l > 0 && part[y * w + l - 1] === p) l--;
        while (r < w - 1 && part[y * w + r + 1] === p) r++;
        const across = r > l ? (x - l) / (r - l) : 0.5;
        const topEdge = y === 0 || part[(y - 1) * w + x] !== p;
        const bottomEdge = y === h - 1 || part[(y + 1) * w + x] !== p;
        let tone = across < 0.18 ? 3.4 : across < 0.6 ? 3 : across < 0.86 ? 2 : 1.3;
        if (topEdge) tone += 0.8;
        if (bottomEdge) tone -= 0.8;
        this.color[y * w + x] = step(this.ramps.get(p)!, tone);
      }
    }
  }

  dot(x: number, y: number, c: string): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.color[y * this.w + x] = c;
  }

  /** Ein Pixel nur dort, wo schon eine bestimmte Fläche liegt. Für Details, die nicht über den Rand ragen. */
  on(part: string, x: number, y: number, c: string): void {
    if (this.part[y * this.w + x] === part) this.color[y * this.w + x] = c;
  }

  rampOf(part: string): Ramp {
    return this.ramps.get(part)!;
  }

  /** Umriss außen im dunkelsten Ton der angrenzenden Fläche, leicht ins Blaue gezogen. */
  render(): HTMLCanvasElement {
    const { w, h } = this;
    const l = layer(w, h);
    const out = this.color.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (this.color[y * w + x]) continue;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + a;
          const yy = y + b;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const p = this.part[yy * w + xx];
          if (!p || !this.color[yy * w + xx]) continue;
          out[y * w + x] = mix(this.ramps.get(p)![0], '#0a0c16', 0.45);
          break;
        }
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = out[y * w + x];
        if (!c) continue;
        l.ctx.fillStyle = c;
        l.ctx.fillRect(x, y, 1, 1);
      }
    }
    return l.canvas;
  }
}

interface Rig {
  look: Look;
  pose: Pose;
  frame: number;
  view: View;
  seated: boolean;
  /** Auf und ab beim Gehen, Atmen im Stehen. */
  bob: number;
  /** Kopf sinkt beim Hängenlassen und Tippen. */
  head: number;
  walk: number;
}

function hairBehind(c: Canvas, rig: Rig, hair: Ramp): void {
  const { look, bob } = rig;
  const y = bob + rig.head;
  if (look.hair === 'lang') {
    c.fill(rr(13, 12 + y, 5, 22, 2.5), 'hairL', hair);
    c.fill(rr(30, 12 + y, 5, 22, 2.5), 'hairR', hair);
  }
  if (look.hair === 'zopf' && rig.view === 'front') c.fill(rr(32.5, 13 + y, 4, 14, 2), 'tail', hair);
}

function legs(c: Canvas, rig: Rig): void {
  const { walk, bob } = rig;
  if (rig.seated) {
    // Sitzend: Oberschenkel zeigen nach vorn, verkürzt.
    c.fill(rr(15, 46 + bob, 8.5, 8, 3), 'legL', PANTS);
    c.fill(rr(24.5, 46 + bob, 8.5, 8, 3), 'legR', PANTS);
    return;
  }
  const liftL = walk === 1 ? 3 : 0;
  const liftR = walk === 3 ? 3 : 0;
  const stepL = walk === 1 ? -1 : walk === 3 ? 1 : 0;
  c.fill(rr(16 + stepL, 47 + bob, 7, 16 - liftL, 2.5), 'legL', PANTS);
  c.fill(rr(25 - stepL, 47 + bob, 7, 16 - liftR, 2.5), 'legR', PANTS);
  c.fill(rr(15 + stepL, 61 + bob - liftL, 8.5, 5, 2.4), 'shoeL', SHOE);
  c.fill(rr(24.5 - stepL, 61 + bob - liftR, 8.5, 5, 2.4), 'shoeR', SHOE);
}

function torso(c: Canvas, rig: Rig, top: Ramp): void {
  const y = rig.bob;
  c.fill(rr(14, 27 + y, 20, 22, 6), 'top', top);
  c.fill(rr(14.5, 46 + y, 19, 2.6, 0.8), 'belt', BELT);
}

/** Arme je Haltung. Ärmel sind eigene Flächen, damit sie sich vom Oberkörper abheben. */
function arms(c: Canvas, rig: Rig, top: Ramp, skin: Ramp): { paper?: boolean; phone?: boolean } {
  const { pose, frame, walk, bob: y } = rig;
  const a = frame % 2;
  const sleeve = rampOf(top[2], 0.2);
  const hang = (side: 'L' | 'R', dy = 0) => {
    const x = side === 'L' ? 10 : 33;
    c.fill(rr(x, 29 + y + dy, 5, 18, 2.5), `arm${side}`, sleeve);
    c.fill(ell(x + 2.5, 49 + y + dy, 2.6, 3), `hand${side}`, skin);
  };
  switch (rig.view === 'back' && pose === 'type' ? 'slump' : pose) {
    case 'type':
      c.fill(rr(10, 29 + y, 5, 10, 2.5), 'armL', sleeve);
      c.fill(rr(33, 29 + y, 5, 10, 2.5), 'armR', sleeve);
      c.fill(rr(11, 37 + y, 11, 4.5, 2), 'foreL', sleeve);
      c.fill(rr(26, 37 + y, 11, 4.5, 2), 'foreR', sleeve);
      c.fill(ell(21, 40 + y + a, 2.6, 2.2), 'handL', skin);
      c.fill(ell(27, 40 + y + (1 - a), 2.6, 2.2), 'handR', skin);
      return {};
    case 'think':
      hang('L');
      c.fill(rr(33, 29 + y, 5, 9, 2.5), 'armR', sleeve);
      c.fill(rr(29, 24 + y, 4.5, 14, 2.2), 'foreR', sleeve);
      c.fill(ell(30.5, 23 + y, 2.8, 2.6), 'handR', skin);
      return {};
    case 'wave':
      hang('L');
      c.fill(rr(33.5 + a, 13 + y, 5, 18, 2.5), 'armR', sleeve);
      c.fill(ell(36 + a, 11 + y, 3, 3.2), 'handR', skin);
      return {};
    case 'read':
      c.fill(rr(10, 29 + y, 5, 12, 2.5), 'armL', sleeve);
      c.fill(rr(33, 29 + y, 5, 12, 2.5), 'armR', sleeve);
      c.fill(rr(15, 34 + y, 18, 12, 1), 'paper', PAPER);
      c.fill(ell(14.5, 41 + y, 2.4, 2.6), 'handL', skin);
      c.fill(ell(33.5, 41 + y, 2.4, 2.6), 'handR', skin);
      return { paper: true };
    case 'slump':
      c.fill(rr(12, 33 + y, 4.5, 17, 2.2), 'armL', sleeve);
      c.fill(rr(31.5, 33 + y, 4.5, 17, 2.2), 'armR', sleeve);
      c.fill(ell(14, 51 + y, 2.4, 2.6), 'handL', skin);
      c.fill(ell(34, 51 + y, 2.4, 2.6), 'handR', skin);
      return {};
    case 'phone':
      c.fill(rr(10, 29 + y, 5, 12, 2.5), 'armL', sleeve);
      c.fill(rr(33, 29 + y, 5, 12, 2.5), 'armR', sleeve);
      c.fill(rr(20, 35 + y, 8, 12, 1.5), 'phone', PHONE);
      c.fill(ell(18.5, 41 + y, 2.6, 2.4), 'handL', skin);
      c.fill(ell(29.5, 41 + y, 2.6, 2.4), 'handR', skin);
      return { phone: true };
    case 'talk':
      hang('L');
      c.fill(rr(33, 29 + y, 5, 9, 2.5), 'armR', sleeve);
      c.fill(rr(34, 27 + y - a, 9, 4.5, 2), 'foreR', sleeve);
      c.fill(ell(43, 28 + y - a, 2.8, 2.6), 'handR', skin);
      return {};
    default: {
      const swing = walk === 1 ? 2 : walk === 3 ? -2 : 0;
      hang('L', swing);
      hang('R', -swing);
      return {};
    }
  }
}

function head(c: Canvas, rig: Rig, skin: Ramp, hair: Ramp): void {
  const y = rig.bob + rig.head;
  const breathe = rig.pose === 'stand' && rig.frame % 2 === 1 ? 1 : 0;
  const hy = y + breathe;
  c.fill(rr(21, 22 + y, 6, 6, 1), 'neck', skin);
  c.fill(ell(15.6, 16 + hy, 1.6, 2.4), 'earL', skin);
  c.fill(ell(32.4, 16 + hy, 1.6, 2.4), 'earR', skin);
  c.fill(ell(24, 15 + hy, 8.4, 9.2), 'face', skin);
  const back = rig.view === 'back';
  const look = rig.look;
  if (back) {
    // Von hinten bedecken die Haare den ganzen Kopf.
    c.fill(and(ell(24, 14 + hy, 9, 10), (_x, yy) => yy < 23 + hy), 'hair', hair);
  } else {
    // Oberkopf, Seiten, Pony mit Scheitel
    c.fill((x, yy) => ell(24, 12.5 + hy, 9.3, 8)(x, yy) && (yy < 12 + hy || x < 17 || x > 31) && yy < 18 + hy, 'hair', hair);
    c.fill(ell(19.5, 10 + hy, 5, 3), 'hair', hair);
  }
  if (look.hair === 'locken') {
    for (const [cx, cy] of [[15, 9], [19, 5], [24, 4], [29, 5], [33, 9], [15, 14], [33, 14]]) c.fill(ell(cx, cy + hy, 3.2, 3.2), 'hair', hair);
  }
  if (look.hair === 'zopf') {
    c.fill(ell(33.5, 11 + hy, 3, 3), 'hair', hair);
    if (back) c.fill(rr(22, 22 + hy, 4, 13, 2), 'tail', hair);
  }
  if (look.hair === 'lang' && back) c.fill(rr(15, 18 + hy, 18, 14, 4), 'hairBack', hair);
}

function details(c: Canvas, rig: Rig, extras: { paper?: boolean; phone?: boolean }): void {
  const { look, view, pose, frame } = rig;
  const y = rig.bob;
  const hy = y + rig.head + (pose === 'stand' && frame % 2 === 1 ? 1 : 0);
  const skin = c.rampOf('face');
  const top = c.rampOf('top');
  const hair = c.rampOf('hair');
  // Haare: Strähnen als helle und dunkle Linien
  for (let x = 16; x < 33; x += 3) {
    for (let k = 0; k < 4; k++) c.on('hair', x + (k >> 1), 5 + hy + k, k === 0 ? hair[4] : hair[3]);
    c.on('hair', x + 1, 9 + hy, hair[1]);
  }
  if (view === 'front') {
    const blink = frame % 23 === 22;
    const down = pose === 'slump' || pose === 'read' || pose === 'type' || pose === 'phone';
    const ey = 15 + hy + (down ? 1 : 0);
    for (const ex of [19, 27]) {
      if (blink || down) {
        for (let k = 0; k < 3; k++) c.dot(ex + k, ey + 1, skin[0]);
      } else {
        for (let k = 0; k < 3; k++) for (let m = 0; m < 3; m++) c.dot(ex + k, ey + m, '#ffffff');
        c.dot(ex + 1, ey, '#3a2a20');
        c.dot(ex + 1, ey + 1, '#141420');
        c.dot(ex + 2, ey + 1, '#3a6ea8');
        c.dot(ex + 1, ey + 2, '#3a6ea8');
        c.dot(ex + 2, ey, '#ffffff');
      }
      // Brauen
      for (let k = 0; k < 3; k++) c.dot(ex + k, ey - 2 - (k === 1 ? 1 : 0), darken(look.hairColor, 0.1));
    }
    // Nase, Mund, Wangen, Kinnschatten
    c.dot(24, 18 + hy, skin[1]);
    c.dot(24, 19 + hy, skin[1]);
    c.dot(23, 19 + hy, skin[2]);
    const smile = pose === 'talk' || pose === 'wave' ? 1 : 0;
    for (let k = -2; k <= 2; k++) c.dot(24 + k, 21 + hy + (Math.abs(k) === 2 ? -smile : 0), Math.abs(k) < 2 ? '#a8524a' : '#c9706a');
    if (pose === 'talk' && frame % 2 === 0) c.dot(24, 22 + hy, '#5a2420');
    c.dot(18, 19 + hy, '#e99a84');
    c.dot(30, 19 + hy, '#e0927c');
    for (let k = 20; k < 29; k++) c.on('face', k, 23 + hy, skin[1]);
    if (look.glasses) {
      const g = '#141420';
      for (const ex of [18, 26]) {
        for (let k = 0; k < 5; k++) {
          c.dot(ex + k, ey - 1, g);
          c.dot(ex + k, ey + 3, g);
        }
        c.dot(ex, ey, g);
        c.dot(ex, ey + 1, g);
        c.dot(ex, ey + 2, g);
        c.dot(ex + 4, ey, g);
        c.dot(ex + 4, ey + 1, g);
        c.dot(ex + 4, ey + 2, g);
        c.dot(ex + 1, ey, '#cfe8ff');
      }
      c.dot(23, ey, g);
      c.dot(24, ey, g);
      c.dot(25, ey, g);
    }
    // Kragen, Ausschnitt, Knopfleiste, Brusttasche
    for (let k = 0; k < 4; k++) {
      c.on('top', 20 + k, 27 + y + k, top[4]);
      c.on('top', 28 - k, 27 + y + k, top[4]);
    }
    for (let k = 0; k < 3; k++) for (let m = 22 + k; m < 27 - k; m++) c.on('top', m, 27 + y + k, skin[2]);
    for (let yy = 31 + y; yy < 46 + y; yy++) c.on('top', 24, yy, (yy - y) % 4 === 1 ? top[4] : top[1]);
    for (let k = 0; k < 4; k++) c.on('top', 17 + k, 33 + y, top[1]);
    c.on('top', 17, 34 + y, top[1]);
    c.on('top', 20, 34 + y, top[1]);
    // Gürtelschnalle
    c.on('belt', 23, 47 + y, '#e8c464');
    c.on('belt', 24, 47 + y, '#e8c464');
    c.on('belt', 25, 47 + y, '#a8862e');
  } else {
    // Hinten: Kragen und Rückennaht
    for (let x = 19; x < 30; x++) c.on('top', x, 28 + y, top[1]);
    for (let yy = 31 + y; yy < 45 + y; yy += 2) c.on('top', 24, yy, top[1]);
  }
  // Ärmelsäume, Finger, Hosenfalten, Sohlen mit heller Kante
  for (const part of ['armL', 'armR', 'foreL', 'foreR']) {
    for (let x = 0; x < c.w; x++) {
      for (let yy = 0; yy < c.h; yy++) {
        if (c.part[yy * c.w + x] !== part) continue;
        const below = c.part[(yy + 1) * c.w + x];
        if (below && below.startsWith('hand')) c.dot(x, yy, c.rampOf(part)[1]);
      }
    }
  }
  for (const part of ['handL', 'handR']) {
    for (let x = 0; x < c.w; x++) for (let yy = 0; yy < c.h; yy++) if (c.part[yy * c.w + x] === part && x % 2 === 0 && c.part[(yy + 1) * c.w + x] !== part) c.dot(x, yy, skin[1]);
  }
  for (const part of ['legL', 'legR']) {
    for (let x = 0; x < c.w; x++) {
      for (let yy = 0; yy < c.h; yy++) {
        if (c.part[yy * c.w + x] !== part) continue;
        if ((yy + x) % 9 === 0) c.dot(x, yy, PANTS[1]);
      }
    }
  }
  for (const part of ['shoeL', 'shoeR']) {
    for (let x = 0; x < c.w; x++) {
      for (let yy = 0; yy < c.h; yy++) {
        if (c.part[yy * c.w + x] !== part) continue;
        if (c.part[(yy + 1) * c.w + x] !== part) c.dot(x, yy, '#c8ccd4');
      }
    }
  }
  if (extras.paper) {
    for (let k = 0; k < 5; k++) for (let x = 17; x < 31 - (k % 2) * 4; x++) c.on('paper', x, 36 + y + k * 2, '#9fb0c8');
    for (let yy = 34; yy < 46; yy++) c.on('paper', 24, yy + y, PAPER[1]);
  }
  if (extras.phone) {
    const glow = frame % 6 < 3 ? '#8fd7ff' : '#6fc3f2';
    for (let x = 21; x < 27; x++) for (let yy = 37; yy < 45; yy++) c.on('phone', x, yy + y, (yy - 37) % 3 === 0 && x > 21 ? lighten(glow, 0.3) : glow);
  }
}

const cache = new Map<string, CharSprite>();

/** Figur in feiner Auflösung. Gleiche Bedeutung der Parameter wie characterSprite. */
export function figureSprite(look: Look, pose: Pose, frame: number, view: View, standing = false): CharSprite {
  const key = `${look.hair}|${look.hairColor}|${look.top}|${look.skin}|${look.glasses}|${pose}|${frame}|${view}|${standing}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const seated = seatedPose(pose) && !standing;
  const rig: Rig = {
    look,
    pose,
    frame,
    view,
    seated,
    bob: pose === 'walk' && frame % 2 === 1 ? -1 : 0,
    head: pose === 'slump' ? 4 : pose === 'type' && frame % 2 === 1 ? 1 : 0,
    walk: pose === 'walk' ? frame % 4 : 0,
  };
  const skin = rampOf(look.skin, 0.14);
  const hair = rampOf(look.hairColor, 0.24);
  const top = rampOf(look.top, 0.2);
  const c = new Canvas();
  hairBehind(c, rig, hair);
  legs(c, rig);
  torso(c, rig, top);
  let extras: { paper?: boolean; phone?: boolean } = {};
  if (view === 'back') {
    extras = arms(c, rig, top, skin);
    head(c, rig, skin, hair);
  } else {
    head(c, rig, skin, hair);
    extras = arms(c, rig, top, skin);
  }
  c.shade();
  details(c, rig, extras);
  const sprite = { canvas: c.render(), ax: FIGURE.ax, ay: seated ? SEAT_AY : FIGURE.ay };
  cache.set(key, sprite);
  return sprite;
}
