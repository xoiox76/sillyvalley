// Möbel und feste Einrichtung, aus isometrischen Quadern und Pixeln aufgebaut.
// Jedes Motiv wird einmal in eine Ebene gerendert und danach nur noch kopiert.

import { PROPS, type FixedProp } from '../../shared/catalog.ts';
import { MEETING_SIZE } from '../../shared/layout.ts';
import type { Rotation } from '../../shared/types.ts';
import { Pen, darken, hash2, layer, lighten, outline, rect, seeded, step, tri, type Faces, type Layer, type Ramp } from './pixel.ts';

export const INK = '#111a29';


export interface Sprite {
  canvas: HTMLCanvasElement;
  ax: number;
  ay: number;
}

/** Auflösung des Büros: Jedes alte Pixel wird zu RES × RES feineren. Ein Feld ist damit 64 × 32 Pixel. */
export const RES = 2;

const CANVAS = { w: 168, h: 132, ax: 84, ay: 72 };

/** Maße in alten Pixeln. Die Zeichenfläche ist RES-fach größer, der Stift zeichnet RES-fach feiner. */
function sprite(draw: (pen: Pen, l: Layer) => void, withOutline = true, size = CANVAS): Sprite {
  const l = layer(size.w * RES, size.h * RES);
  draw(new Pen(l.ctx, size.ax * RES, size.ay * RES, RES), l);
  if (withOutline) outline(l, INK);
  return { canvas: l.canvas, ax: size.ax * RES, ay: size.ay * RES };
}

/** Eine Wandkante. Sie läuft von Feld zu Feld und hat dieselbe Höhe wie die Glaswände. */
export function wallSprite(rot: Rotation, color = '#d9dee6'): Sprite {
  return cached(`wall${rot % 2}${color}`, () =>
    sprite((pen) => {
      const face = tri(color, 0.12);
      if (rot % 2 === 0) pen.box(0, -0.07, 0, 1, 0.14, 50, face);
      else pen.box(-0.07, 0, 0, 0.14, 1, 50, face);
      // Ohne Umriss: Nebeneinander gesetzte Stücke laufen so als eine Wand durch, ohne Fugen.
    }, false),
  );
}

/** Eine Tür in einer Kante: Zarge mit Sturz, offen in der Mitte. */
export function doorSprite(rot: Rotation): Sprite {
  return cached(`door${rot % 2}`, () =>
    sprite((pen) => {
      const frame = tri('#7a5a3c', 0.12);
      if (rot % 2 === 0) {
        pen.box(0, -0.07, 0, 0.14, 0.14, 50, frame);
        pen.box(0.86, -0.07, 0, 0.14, 0.14, 50, frame);
        pen.box(0, -0.07, 40, 1, 0.14, 10, tri('#d9dee6', 0.12));
      } else {
        pen.box(-0.07, 0, 0, 0.14, 0.14, 50, frame);
        pen.box(-0.07, 0.86, 0, 0.14, 0.14, 50, frame);
        pen.box(-0.07, 0, 40, 0.14, 1, 10, tri('#d9dee6', 0.12));
      }
    }),
  );
}

/** Kanten-Bauteile: Wand, Tür, Fensterwand mit breitem Fensterband, bodentiefe Glaswand. */
export function edgeSprite(kind: string, rot: Rotation, low = false, color = '#d9dee6'): Sprite {
  if (low) return lowEdgeSprite(kind, rot, color);
  if (kind === 'door') return doorSprite(rot);
  if (kind === 'window') return windowSprite(rot, color);
  if (kind === 'glass') return glassWallSprite(rot);
  if (kind === 'half') return halfWallSprite(rot, color);
  if (kind === 'fence') return fenceSprite(rot);
  return wallSprite(rot, color);
}

/** Hüfthohe Wand mit Abdeckleiste. */
export function halfWallSprite(rot: Rotation, color = '#d9dee6'): Sprite {
  return cached(`half${rot % 2}${color}`, () =>
    sprite((pen) => {
      const face = tri(color, 0.12);
      const cap = tri('#8a6a4c', 0.12);
      if (rot % 2 === 0) {
        pen.box(0, -0.07, 0, 1, 0.14, 16, face);
        pen.box(0, -0.09, 16, 1, 0.18, 2, cap);
      } else {
        pen.box(-0.07, 0, 0, 0.14, 1, 16, face);
        pen.box(-0.09, 0, 16, 0.18, 1, 2, cap);
      }
    }, false),
  );
}

/** Wie stark Glas deckt. Was dahinter steht, bleibt gut zu sehen. */
const GLASS_ALPHA = 0.32;

/** Höhe einer Podeststufe in Pixeln. */
export const LEVEL_PX = 12;

/** Geländer: Pfosten, Handlauf und Stäbe. */
export function fenceSprite(rot: Rotation): Sprite {
  return cached(`fence${rot % 2}`, () =>
    sprite((pen) => {
      const wood = tri('#6d4a30', 0.12);
      const bar = tri('#3b4658', 0.1);
      const along = rot % 2 === 0;
      const box = (a: number, z: number, len: number, h: number, thick: number, c: typeof wood) =>
        along ? pen.box(a, -thick / 2, z, len, thick, h, c) : pen.box(-thick / 2, a, z, thick, len, h, c);
      box(0, 0, 0.1, 16, 0.1, wood);
      box(0.9, 0, 0.1, 16, 0.1, wood);
      for (let n = 1; n < 5; n++) box(n * 0.2 - 0.02, 0, 0.04, 14, 0.04, bar);
      box(0, 14, 1, 2, 0.12, wood);
    }, false),
  );
}

/** Stufen eine Höhenstufe hinauf. rot wie bei Möbeln: 0 nach +j, 1 nach +i, 2 nach -j, 3 nach -i. */
export function stepsSprite(rot: Rotation): Sprite {
  return cached(`steps${rot}`, () =>
    sprite((pen) => {
      const stone = tri('#b7a58a', 0.14);
      for (let k = 0; k < 3; k++) {
        const h = Math.round(((k + 1) * LEVEL_PX) / 3);
        // Die k-te Stufe, von unten gezählt, ein Drittel breit.
        const from = rot === 0 || rot === 1 ? k / 3 : (2 - k) / 3;
        if (rot % 2 === 0) pen.box(0.04, from, 0, 0.92, 1 / 3, h, stone);
        else pen.box(from, 0.04, 0, 1 / 3, 0.92, h, stone);
      }
    }),
  );
}

/** Ein Feld eines Podests: Fundament und Oberseite. top ist die Farbe des Bodens oben. */
export function platformSprite(level: number, top: string): Sprite {
  return cached(`platform${level}${top}`, () =>
    sprite((pen) => {
      const h = level * LEVEL_PX;
      const side = tri('#8a8378', 0.14);
      pen.box(0, 0, 0, 1, 1, h, { ...side, top });
    }, false),
  );
}

/** Säule mit Sockel und Kapitell. */
export function columnSprite(): Sprite {
  return cached('column', () =>
    sprite((pen) => {
      const stone = tri('#d9dee6', 0.14);
      pen.box(0.24, 0.24, 0, 0.52, 0.52, 3, tri('#b7bec8', 0.14));
      pen.box(0.32, 0.32, 3, 0.36, 0.36, 44, stone);
      pen.box(0.24, 0.24, 47, 0.52, 0.52, 3, tri('#b7bec8', 0.14));
    }),
  );
}

/**
 * Was an einer Wand hängt. Gezeichnet wird nur die Seite, die zum Betrachter zeigt: rot 0 an einer Wand längs i,
 * rot 1 an einer Wand längs j. Die Rückseiten (rot 2 und 3) sieht man in dieser Ansicht nicht.
 */
export function hungSprite(kind: string, rot: Rotation, variant = 0): Sprite {
  return cached(`hung${kind}${rot % 2}v${variant}`, () =>
    sprite((pen) => {
      const alongI = rot % 2 === 0;
      // u läuft in Pixeln die Wand entlang, v nach oben.
      const face = (u: number, v: number, w: number, h: number, color: string) =>
        alongI ? pen.faceJ(0, 0.08, 0, u, v, w, h, color) : pen.faceI(0.08, 0, 0, u, v, w, h, color);
      if (kind === 'picture') {
        const art = [['#e5534b', '#f8b62d', '#3f7fd0'], ['#5eeac0', '#2f6f68', '#e9c46a'], ['#b07cf0', '#6fb3ff', '#f2f4ef']][variant % 3];
        face(3, 20, 11, 13, '#5a4130');
        face(4, 21, 9, 11, '#f2f4ef');
        face(5, 22, 7, 9, art[0]);
        face(5, 22, 7, 4, art[1]);
        face(8, 25, 3, 3, art[2]);
      } else if (kind === 'clock') {
        face(5, 30, 7, 7, '#2a3347');
        face(6, 31, 5, 5, '#f2f4ef');
        face(8, 33, 1, 3, '#111a29');
        face(8, 33, 2, 1, '#e5534b');
      } else if (kind === 'wallLamp') {
        face(7, 26, 3, 4, '#3b4658');
        face(6, 30, 5, 3, '#f8d070');
        face(7, 33, 3, 1, '#fff2c0');
      } else {
        // Wandregal: ein Brett mit Büchern und einer kleinen Pflanze.
        const box = (a: number, z: number, len: number, deep: number, h: number, c: ReturnType<typeof tri>) =>
          alongI ? pen.box(a, 0.07, z, len, deep, h, c) : pen.box(0.07, a, z, deep, len, h, c);
        box(0.12, 22, 0.76, 0.18, 2, tri('#8a6443', 0.14));
        const colors = ['#c5484a', '#3f7fd0', '#e9c46a', '#2fa58f'];
        colors.forEach((c, n) => box(0.16 + n * 0.1, 24, 0.08, 0.14, 6 + (n % 2), tri(c, 0.14)));
        box(0.66, 24, 0.14, 0.12, 3, tri('#2d3b57', 0.1));
        box(0.68, 27, 0.1, 0.08, 3, tri('#3f8f50', 0.1));
      }
    }),
  );
}

/**
 * Wände im Schnitt: in voller Höhe, aber durchscheinend. Unten der Sockel und oben die Abschlussleiste decken,
 * dazwischen lässt die Wand drei Viertel durch. So bleibt sie als Wand erkennbar, und man sieht, was dahinter steht.
 */
export function cutEdgeSprite(kind: string, rot: Rotation, paint = '#d9dee6'): Sprite {
  return cached(`cut${kind}${rot % 2}${paint}`, () =>
    sprite((pen, l) => {
      const along = rot % 2 === 0;
      const color = kind === 'door' ? tri('#7a5a3c', 0.12) : tri(paint, 0.12);
      const part = (p: Pen, from: number, to: number, z: number, h: number, c = color) =>
        along ? p.box(from, -0.07, z, to - from, 0.14, h, c) : p.box(-0.07, from, z, 0.14, to - from, h, c);
      const spans: [number, number][] = kind === 'door' ? [[0, 0.14], [0.86, 1]] : [[0, 1]];
      // Die Mitte als Raster: Nur jedes vierte Pixel deckt. Das liest sich als Wand im Schnitt, nicht als Glas.
      const ghost = layer(l.canvas.width, l.canvas.height);
      const gp = new Pen(ghost.ctx, pen.ox, pen.oy, pen.res);
      for (const [a, b] of spans) part(gp, a, b, 7, 39);
      if (kind === 'door') part(gp, 0.14, 0.86, 40, 6);
      const data = ghost.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
      for (let y = 0; y < l.canvas.height; y++) {
        for (let x = 0; x < l.canvas.width; x++) {
          const k = (y * l.canvas.width + x) * 4;
          if (data.data[k + 3] && (x + 2 * (y % 2)) % 4 === 0) {
            l.ctx.fillStyle = `rgb(${data.data[k]},${data.data[k + 1]},${data.data[k + 2]})`;
            l.ctx.fillRect(x, y, 1, 1);
          }
        }
      }
      // Sockel, Kanten an beiden Enden und Abschlussleiste decken voll.
      for (const [a, b] of spans) part(pen, a, b, 0, 7);
      for (const end of kind === 'door' ? [0, 0.86] : [0, 0.94]) part(pen, end, end + (kind === 'door' ? 0.14 : 0.06), 7, 39);
      part(pen, 0, 1, 46, 4, kind === 'door' ? tri(paint, 0.12) : color);
    }, false),
  );
}

/** Heruntergeschaltete Wände: nur ein Sockel, damit man in die Räume sieht. Türen zeigen zwei Pfosten. */
export function lowEdgeSprite(kind: string, rot: Rotation, paint = '#d9dee6'): Sprite {
  return cached(`low${kind}${rot % 2}${paint}`, () =>
    sprite((pen) => {
      const along = rot % 2 === 0;
      const color = kind === 'glass' ? tri('#9fd8e8', 0.08) : kind === 'door' ? tri('#7a5a3c', 0.12) : tri(paint, 0.12);
      const part = (from: number, to: number) => (along ? pen.box(from, -0.07, 0, to - from, 0.14, 7, color) : pen.box(-0.07, from, 0, 0.14, to - from, 7, color));
      if (kind === 'door') {
        part(0, 0.14);
        part(0.86, 1);
      } else {
        part(0, 1);
      }
    }, false),
  );
}

/** Wand mit breitem Fenster: Brüstung unten, Glasband, Sturz oben. */
export function windowSprite(rot: Rotation, color = '#d9dee6'): Sprite {
  return cached(`window${rot % 2}${color}`, () =>
    sprite((pen) => {
      const wall = tri(color, 0.12);
      const glass = tri('#9fd8e8', 0.08);
      const along = rot % 2 === 0;
      const part = (z: number, h: number, c: typeof wall, thick = 0.14) =>
        along ? pen.box(0, -thick / 2, z, 1, thick, h, c) : pen.box(-thick / 2, 0, z, thick, 1, h, c);
      part(0, 16, wall);
      // Durchs Glas sieht man, was dahinter steht.
      pen.ctx.globalAlpha = GLASS_ALPHA;
      part(16, 26, glass, 0.06);
      pen.ctx.globalAlpha = 1;
      if (along) pen.box(0, -0.02, 16, 1, 0.04, 1, tri('#e8f6fb', 0.05));
      else pen.box(-0.02, 0, 16, 0.04, 1, 1, tri('#e8f6fb', 0.05));
      part(42, 8, wall);
    }, false),
  );
}

/** Bodentiefe Glaswand mit schmalem Rahmen. */
export function glassWallSprite(rot: Rotation): Sprite {
  return cached(`glasswall${rot % 2}`, () =>
    sprite((pen) => {
      const frame = tri('#3b4658', 0.1);
      const glass = tri('#a8e0ee', 0.08);
      pen.ctx.globalAlpha = GLASS_ALPHA;
      if (rot % 2 === 0) pen.box(0, -0.03, 0, 1, 0.06, 50, glass);
      else pen.box(-0.03, 0, 0, 0.06, 1, 50, glass);
      pen.ctx.globalAlpha = 1;
      if (rot % 2 === 0) {
        pen.box(0, -0.05, 0, 0.06, 0.1, 50, frame);
        pen.box(0, -0.05, 48, 1, 0.1, 2, frame);
      } else {
        pen.box(-0.05, 0, 0, 0.1, 0.06, 50, frame);
        pen.box(-0.05, 0, 48, 0.1, 1, 2, frame);
      }
    }, false),
  );
}

/** Spielautomat für den Gaming-Raum. */
export function arcadeSprite(): Sprite {
  return cached('arcade', () =>
    sprite((pen) => {
      const f = fine(pen, false);
      const purple: Ramp = ['#1c1430', '#2c2048', '#3a2f5c', '#54457e', '#7a68a8'];
      // Gehäuse mit Seitenstreifen, Münzklappe unten, Bildschirm vertieft, Leuchtschild oben
      f.box(0.18, 0.2, 0, 0.64, 0.6, 38, purple, (front, top, u, v) => {
        if (top) return null;
        if (!front) return v > 6 && v < 70 && Math.abs(u - v * 0.18 - 4) < 2 ? '#b07cf0' : null;
        if (v > 46 && v < 70 && u > 4 && u < 17) {
          // Bildschirm: Sterne, Raumschiff, Punkte
          if (v < 48 || v > 68 || u < 5 || u > 16) return '#0a0a14';
          if ((u * 7 + v * 3) % 23 === 0) return '#ffffff';
          if (v > 50 && v < 54 && Math.abs(u - 10) < 2) return '#5eeac0';
          if (v > 62 && v < 64 && u % 3 === 0) return '#f8b62d';
          return '#101830';
        }
        if (v > 8 && v < 22 && u > 6 && u < 15) return v === 15 && u > 9 && u < 12 ? '#0a0a14' : purple[1];
        return u < 1 ? purple[4] : null;
      });
      f.box(0.18, 0.2, 38, 0.64, 0.6, 4, ['#7a2a8a', '#a03aaa', '#d060d0', '#f090f0', '#ffd0ff'], (front, top, u, v) => (front && !top && v > 1 && v < 7 && u % 4 < 2 ? '#fff0ff' : null));
      // Bedienfeld schräg vor dem Bildschirm, Steuerknüppel, zwei Knöpfe
      f.box(0.2, 0.74, 16, 0.6, 0.14, 4, purple);
      f.rod([0.36, 0.82, 20], [0.36, 0.82, 23], 2, RAMP.black);
      f.ball(0.36, 0.82, 23.5, 0.035, RAMP.red);
      f.ball(0.56, 0.8, 20.5, 0.025, ['#8a6a12', '#b08a1e', '#d9a62e', '#f0c04a', '#ffe08a']);
      f.ball(0.66, 0.8, 20.5, 0.025, RAMP.fabric);
    }),
  );
}

/** Sitzsack: weich, oben eine Mulde, eine Naht schräg über den Stoff. */
export function beanbagSprite(): Sprite {
  return cached('beanbag', () =>
    sprite((pen) => {
      const bag: Ramp = ['#7a3410', '#a0461c', '#d0703c', '#e8925c', '#f8b886'];
      const [cx, cy] = pen.pt(0.5, 0.5, 0);
      const r = pen.res;
      for (let y = -17 * r; y <= 3 * r; y++) {
        for (let x = -13 * r; x <= 13 * r; x++) {
          const yy = y + 7 * r;
          const wdt = 13 * r - Math.max(0, -y - 5 * r) * 0.45;
          const e = (x / wdt) ** 2 + (yy / (10 * r)) ** 2;
          if (e > 1) continue;
          const dent = Math.hypot(x + r, y + 5 * r) < 5 * r;
          const lit = 0.75 - ((x + 13 * r) / (26 * r)) * 0.55 - ((y + 17 * r) / (20 * r)) * 0.2 + (dent ? -0.28 : 0) + (e < 0.2 ? 0.1 : 0);
          let c = step(bag, lit * 4 + (hash2(x, y) > 0.94 ? 0.6 : 0));
          if (e > 0.86) c = bag[0];
          if (Math.abs(x - y * 0.4 - 2 * r) < 0.6 && e < 0.85) c = bag[1];
          rect(pen.ctx, cx + x, cy + y, 1, 1, c);
        }
      }
    }),
  );
}

/** Tafel auf Rollen: Gestell, weiße Fläche mit Rahmen, Zettel, Magnete, Stiftablage. */
export function boardSprite(rot: Rotation): Sprite {
  return cached(`board${rot % 2}`, () =>
    sprite((pen) => {
      const f = fine(pen, rot % 2 === 1);
      for (const a of [0.12, 0.82]) {
        f.box(a - 0.04, 0.3, 0, 0.14, 0.32, 1, RAMP.chrome);
        f.ball(a + 0.03, 0.32, 0.5, 0.02, RAMP.black);
        f.ball(a + 0.03, 0.6, 0.5, 0.02, RAMP.black);
        f.box(a, 0.44, 1, 0.06, 0.06, 19, RAMP.chrome);
      }
      f.box(0.06, 0.45, 18, 0.88, 0.07, 22, RAMP.white, (front, top, u, v) => {
        if (top || !front) return null;
        if (u < 1 || u > 26 || v < 1 || v > 42) return RAMP.chrome[1];
        // Zettel in Farben mit Knick, Magnete, eine Strichliste
        const notes: [number, number, string][] = [[3, 30, '#f8d070'], [12, 32, '#5eeac0'], [19, 28, '#ff9fb0'], [5, 12, '#9fd0ff'], [15, 14, '#f8d070']];
        for (const [nu, nv, c] of notes) {
          if (u >= nu && u < nu + 6 && v >= nv && v < nv + 7) return v === nv ? darken(c, 0.2) : u === nu + 5 && v === nv + 6 ? darken(c, 0.3) : c;
          if (u === nu + 2 && v === nv + 7) return '#e5534b';
        }
        if (v === 24 && u > 3 && u < 23 && u % 3 !== 0) return '#3a78c4';
        return hash2(u, v) > 0.97 ? RAMP.white[3] : null;
      });
      f.box(0.1, 0.5, 18, 0.8, 0.06, 1, RAMP.chrome);
      f.box(0.3, 0.52, 19, 0.14, 0.03, 0.6, RAMP.red);
      f.box(0.5, 0.52, 19, 0.14, 0.03, 0.6, RAMP.fabric);
    }),
  );
}

/** Für Treppen, die unter den Boden reichen: mehr Platz nach unten. */
const STAIR_CANVAS = { w: 168, h: 200, ax: 84, ay: 96 };

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

/* ---------- Farbrampen des neuen Stils: fünf Stufen, dunkel nach hell ---------- */
export const RAMP = {
  oak: ['#5a3820', '#7d5132', '#9c6942', '#ba8455', '#d6a36e'] as Ramp,
  walnut: ['#2e1d14', '#462c1d', '#5e3c27', '#7a5136', '#9a6a47'] as Ramp,
  black: ['#0c0d12', '#16181f', '#22252e', '#30343f', '#454b5a'] as Ramp,
  chrome: ['#3a404b', '#6b7380', '#9aa3b0', '#cdd4dd', '#f5f8fb'] as Ramp,
  white: ['#8e9298', '#b0b4ba', '#cdd0d4', '#e2e4e7', '#f4f5f6'] as Ramp,
  fabric: ['#1f2a48', '#2c3b63', '#3a4d7e', '#506aa0', '#7290c4'] as Ramp,
  red: ['#6a1a16', '#8a2a24', '#b0362e', '#d24a40', '#e5685d'] as Ramp,
  clay: ['#6e3420', '#8f4529', '#ad5834', '#c97448', '#de9566'] as Ramp,
  leaf: ['#1d4227', '#2a5e36', '#3a7d47', '#58a35a', '#8ccc78'] as Ramp,
  paper: ['#b8b2a4', '#d4cebf', '#e8e3d6', '#f4f0e6', '#fffdf6'] as Ramp,
};

/** Wie drawer, für die neuen Grundformen. swap vertauscht i und j, die Flächen heißen dann aus Sicht des Möbels. */
const fine = (pen: Pen, swap: boolean) => {
  const face = (f: 'top' | 'left' | 'right') => (swap ? (f === 'left' ? 'right' : f === 'right' ? 'left' : f) : f);
  return {
    box: (a: number, b: number, z: number, w: number, d: number, h: number, r: Ramp, tex?: (front: boolean, top: boolean, u: number, v: number, x: number, y: number) => string | null) =>
      swap
        ? pen.tbox(b, a, z, d, w, h, r, tex && ((f, u, v, x, y) => tex(face(f) === 'left', f === 'top', u, v, x, y)))
        : pen.tbox(a, b, z, w, d, h, r, tex && ((f, u, v, x, y) => tex(face(f) === 'left', f === 'top', u, v, x, y))),
    cyl: (a: number, b: number, z: number, rad: number, h: number, r: Ramp, gloss = false) => (swap ? pen.cylinder(b, a, z, rad, h, r, gloss) : pen.cylinder(a, b, z, rad, h, r, gloss)),
    ball: (a: number, b: number, z: number, rad: number, r: Ramp) => (swap ? pen.sphere(b, a, z, rad, r) : pen.sphere(a, b, z, rad, r)),
    rod: (p: readonly [number, number, number], q: readonly [number, number, number], t: number, r: Ramp) =>
      swap ? pen.rod([p[1], p[0], p[2]], [q[1], q[0], q[2]], t, r) : pen.rod(p, q, t, r),
  };
};

/** Holzmaserung auf einer Oberseite: Linien längs, ab und zu heller. */
const grain = (r: Ramp) => (_f: boolean, top: boolean, u: number, v: number, x: number, y: number) =>
  top ? step(r, Math.sin(u * 0.32 + Math.sin(v * 0.21) * 1.6) > 0.86 ? 2 : hash2(x, y) > 0.93 ? 4 : 3) : null;

/** Lage des Tisches: Stuhl hinten (rot 0, 1) oder vorn (rot 2, 3). */
const tableB = (rot: Rotation) => (rot < 2 ? 1.04 : 0.04);

export function deskTable(rot: Rotation): Sprite {
  return cached(`table${rot}`, () =>
    sprite((pen) => {
      const f = fine(pen, rot % 2 === 1);
      const b = tableB(rot);
      const near = rot < 2;
      // Kufengestell: Fuß mit Gleitern, Säule, Querholm unter der Platte
      for (const a of [0.1, 1.78]) {
        f.box(a, b + 0.06, 0, 0.12, 0.8, 1.2, RAMP.black);
        f.box(a + 0.02, b + 0.06, 0, 0.08, 0.06, 0.4, RAMP.chrome);
        f.box(a + 0.02, b + 0.8, 0, 0.08, 0.06, 0.4, RAMP.chrome);
        f.box(a + 0.02, b + 0.42, 1.2, 0.08, 0.08, 11, RAMP.black);
        f.box(a, b + 0.08, 11.6, 0.12, 0.76, 1, RAMP.black);
      }
      // Kabelwanne
      f.box(0.4, near ? b + 0.12 : b + 0.66, 10, 1.2, 0.14, 1.4, RAMP.black);
      // Rollcontainer mit drei Schubladen, Fugen und Griffen
      f.box(0.24, b + 0.2, 0.8, 0.4, 0.58, 11.6, RAMP.white, (front, _t, u, v) => {
        if (!front) return null;
        if (v === 8 || v === 16) return RAMP.white[0];
        if ((v === 4 || v === 12 || v === 20) && u > 4 && u < 9) return RAMP.chrome[1];
        return u < 1 ? RAMP.white[3] : null;
      });
      for (const [x, y] of [[0.27, b + 0.24], [0.6, b + 0.24], [0.27, b + 0.74], [0.6, b + 0.74]]) f.ball(x, y, 0.4, 0.02, RAMP.black);
      // Platte: gemasert, helle Vorderkante
      f.box(0.04, b, 13, 1.92, 0.92, 2, RAMP.oak, grain(RAMP.oak));
      const z = 15;
      // Tastatur mit Tastenraster, Maus auf Unterlage, Papierstapel, Becher mit Dampf
      const keyB = near ? b + 0.12 : b + 0.6;
      f.box(0.66, keyB, z, 0.64, 0.2, 0.6, RAMP.black, (_fr, top, u, v) => (top ? (u % 3 < 1 || v % 3 < 1 ? RAMP.black[1] : RAMP.black[4]) : null));
      f.box(1.4, keyB - 0.04, z, 0.3, 0.28, 0.1, RAMP.black);
      f.box(1.5, keyB + 0.04, z + 0.1, 0.09, 0.12, 0.8, RAMP.white);
      for (let k = 0; k < 3; k++) f.box(0.18 + k * 0.01, (near ? b + 0.5 : b + 0.14) - k * 0.01, z + k * 0.3, 0.3, 0.36, 0.3, RAMP.paper);
      f.cyl(1.72, near ? b + 0.62 : b + 0.24, z, 0.07, 4, RAMP.red);
      // Bildschirm: Fuß, Hals, schwarzer Rahmen. Von hinten Lüftungsschlitze und Logo.
      const monB = near ? b + 0.62 : b + 0.24;
      f.box(0.84, monB - 0.04, z, 0.32, 0.2, 0.4, RAMP.black);
      f.box(0.96, monB + 0.04, z + 0.4, 0.08, 0.06, 3, RAMP.black);
      f.box(0.54, monB + 0.02, 18, 0.92, 0.06, 15, RAMP.black, (front, _t, u, v) => {
        if (!front) return null;
        if (near) return (v > 6 && v < 24 && u > 6 && u < 24 && (u + v) % 4 === 0) ? RAMP.black[3] : (Math.abs(u - 15) < 2 && Math.abs(v - 16) < 2 ? RAMP.chrome[2] : null);
        return u < 2 || u > 26 || v < 2 || v > 27 ? RAMP.black[2] : '#16293d';
      });
      // Schreibtischlampe in der Ecke
      const lb = near ? b + 0.2 : b + 0.7;
      f.cyl(1.82, lb, z, 0.08, 0.6, RAMP.black);
      f.rod([1.82, lb, z + 0.6], [1.86, lb - 0.04, z + 10], 2, RAMP.chrome);
      f.rod([1.86, lb - 0.04, z + 10], [1.66, lb + 0.08, z + 11], 2, RAMP.chrome);
      f.box(1.58, lb + 0.02, z + 8.6, 0.16, 0.14, 2.4, RAMP.black);
    }),
  );
}

/** Dein Tisch: Nussbaum, statt Bildschirm ein Pineapple-Laptop. Das Logo sieht man von hinten, sitzt du davor, den Bildschirm. */
export function ceoTable(rot: Rotation): Sprite {
  return cached(`ceotable${rot}`, () =>
    sprite((pen) => {
      const f = fine(pen, rot % 2 === 1);
      const d = drawer(pen, rot % 2 === 1);
      const b = tableB(rot);
      const near = rot < 2;
      for (const [x, y] of [[0.08, b + 0.06], [1.82, b + 0.06], [0.08, b + 0.8], [1.82, b + 0.8]]) {
        f.box(x, y, 0, 0.1, 0.1, 13, RAMP.walnut);
        f.box(x, y, 0, 0.1, 0.1, 0.3, RAMP.chrome);
      }
      f.box(0.22, b + 0.2, 0.4, 0.38, 0.56, 12.6, RAMP.walnut, (front, _t, u, v) => {
        if (!front) return null;
        if (v === 9 || v === 17) return RAMP.walnut[0];
        if ((v === 5 || v === 13 || v === 21) && u > 4 && u < 9) return '#d9a62e';
        return null;
      });
      f.box(0.04, b, 13, 1.92, 0.92, 2, RAMP.walnut, grain(RAMP.walnut));
      const z = 15;
      for (let k = 0; k < 3; k++) f.box(0.2 + k * 0.01, (near ? b + 0.2 : b + 0.5) - k * 0.01, z + k * 0.3, 0.26, 0.32, 0.3, ['#c8b878', '#e0d08a', '#f6e9a8', '#fbf2c4', '#fffbe0']);
      f.cyl(1.67, near ? b + 0.57 : b + 0.21, z, 0.07, 4, RAMP.white);
      // Lampe mit goldenem Schirm
      const lb = near ? b + 0.14 : b + 0.68;
      f.cyl(1.73, lb, z, 0.08, 0.8, RAMP.black);
      f.rod([1.73, lb, z + 0.8], [1.73, lb, z + 9], 2, RAMP.chrome);
      f.box(1.6, lb - 0.08, z + 9, 0.26, 0.2, 2, ['#8a6a12', '#b08a1e', '#d9a62e', '#f0c04a', '#ffe08a']);
      // Pineapple-Laptop
      const silver = RAMP.chrome;
      const lid = near ? b + 0.62 : b + 0.22;
      f.box(0.62, near ? b + 0.22 : b + 0.28, z, 0.76, 0.44, 0.8, silver, (_fr, top, u, v) => (top && u % 3 < 1 && v % 3 < 1 ? silver[1] : null));
      f.box(0.62, lid, z + 0.8, 0.76, 0.05, 11, silver);
      if (rot >= 2) d.face(0.62, lid + 0.05, 16, 1, 1, 10, 9, '#1b4a66');
      d.face(0.62, lid + 0.05, 16, 4, 2, 4, 5, '#f8d34a');
      d.face(0.62, lid + 0.05, 16, 5, 3, 1, 1, '#c99a1e');
      d.face(0.62, lid + 0.05, 16, 7, 5, 1, 1, '#c99a1e');
      d.face(0.62, lid + 0.05, 16, 5, 7, 2, 1, '#37a064');
      d.face(0.62, lid + 0.05, 16, 4, 8, 1, 1, '#37a064');
      d.face(0.62, lid + 0.05, 16, 7, 8, 1, 1, '#37a064');
    }),
  );
}

/** Bürostuhl, unterer Teil: Fußkreuz mit fünf Rollen, Gasfeder, Polster. */
export function chairBase(rot: Rotation): Sprite {
  return cached(`chairbase${rot}`, () =>
    sprite((pen) => {
      const f = fine(pen, rot % 2 === 1);
      const ci = 1.0;
      const cj = rot < 2 ? 0.5 : 1.5;
      const ends = [0, 1, 2, 3, 4]
        .map((k) => { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5 + 0.3; return [ci + Math.cos(a) * 0.3, cj + Math.sin(a) * 0.3] as const; })
        .sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
      for (const [ai, aj] of ends) {
        f.rod([ci, cj, 2], [ai, aj, 1.2], 2, RAMP.black);
        f.ball(ai, aj, 0.6, 0.035, RAMP.black);
      }
      f.cyl(ci, cj, 1.4, 0.06, 1.2, RAMP.black);
      f.cyl(ci, cj, 2.6, 0.04, 2.4, RAMP.black);
      f.cyl(ci, cj, 5, 0.025, 3.4, RAMP.chrome, true);
      f.box(ci - 0.12, cj - 0.12, 8, 0.24, 0.24, 0.8, RAMP.black);
      f.box(ci - 0.27, cj - 0.27, 8.8, 0.54, 0.54, 1.6, RAMP.fabric, (_fr, top, u, v, x, y) => {
        if (!top) return null;
        if (u < 2 || v < 2) return RAMP.fabric[4];
        return hash2(x, y) > 0.9 ? RAMP.fabric[4] : RAMP.fabric[3];
      });
    }),
  );
}

/** Bürostuhl, oberer Teil: Rückenlehne mit Lendenstütze und Naht, Armlehnen. */
export function chairBack(rot: Rotation): Sprite {
  return cached(`chairback${rot}`, () =>
    sprite((pen) => {
      const f = fine(pen, rot % 2 === 1);
      const near = rot < 2;
      const b = near ? 0.14 : 1.78;
      // Armlehnen: Stütze und Auflage
      for (const a of [0.7, 1.3]) {
        f.rod([a, b + (near ? 0.3 : -0.2), 9.5], [a, b + (near ? 0.3 : -0.2), 13.5], 2, RAMP.black);
        f.box(a - 0.03, b + (near ? 0.16 : -0.34), 13.5, 0.06, 0.28, 0.6, RAMP.black);
      }
      f.rod([1.0, b + (near ? 0.12 : -0.04), 9], [1.0, b + 0.04, 12], 3, RAMP.black);
      f.box(0.73, b, 10.5, 0.54, 0.08, 14, RAMP.fabric, (front, _t, u, v) => {
        if (!front) return null;
        if (u < 1 || v > 26) return RAMP.fabric[4];
        if (u > 16) return RAMP.fabric[1];
        if (Math.abs(u - 9) < 0.6) return RAMP.fabric[1];
        return v > 4 && v < 10 ? RAMP.fabric[3] : null;
      });
    }),
  );
}

/** Der Bildschirm ist nur sichtbar, wenn der Stuhl vorn steht. Er leuchtet nur bei echter Arbeit: Code in Zeilen, Cursor blinkt. */
export function drawScreen(pen: Pen, rot: Rotation, active: boolean, tick: number): void {
  if (rot < 2) return;
  const d = drawer(pen, rot === 3);
  const b = tableB(rot) + 0.33;
  d.face(0.56, b, 18, 1, 1, 13, 13, active ? '#12324a' : '#0f1a26');
  if (!active) {
    d.face(0.56, b, 18, 2, 10, 3, 1, '#1d2c3c');
    return;
  }
  const colors = ['#5eeac0', '#f8b62d', '#9fd0ff', '#ff9fb0'];
  for (let row = 0; row < 5; row++) {
    const len = 2 + ((row * 5 + tick) % 8);
    const indent = (row % 3) * 1;
    d.face(0.56, b, 18, 2 + indent, 11 - row * 2, Math.min(len, 10 - indent), 1, colors[row % 4]);
  }
  if (tick % 4 < 2) d.face(0.56, b, 18, 11, 2, 1, 1, '#ffffff');
}

/** Zimmerpflanze: Blätter als lange Bögen, jedes mit heller Mittelrippe. Jede Drehung zeigt eine andere Stellung. */
function drawLeaves(pen: Pen, cx: number, cy: number, seed: number, size: number): void {
  const random = seeded(seed);
  const r = pen.res;
  const leaves = Array.from({ length: 18 }, () => ({ a: random() * Math.PI * 2, len: size * r * (0.6 + random() * 0.6), lift: 0.5 + random() * 0.8 })).sort((p, q) => Math.sin(p.a) - Math.sin(q.a));
  for (const lf of leaves) {
    for (let t = 0; t <= 1; t += 0.02) {
      const x = cx + Math.cos(lf.a) * lf.len * t;
      const y = cy - lf.len * lf.lift * Math.sin(t * Math.PI * 0.85) + Math.sin(lf.a) * lf.len * t * 0.4;
      const wdt = Math.sin(t * Math.PI) * 1.6 * r;
      for (let k = -wdt; k <= wdt; k++) {
        const tone = Math.abs(k) < 0.6 ? 4 : k < 0 ? 3 : Math.sin(lf.a) > 0 ? 2 : 1;
        rect(pen.ctx, Math.round(x), Math.round(y + k), 1, 1, RAMP.leaf[tone]);
      }
    }
  }
}

export function furnitureSprite(kind: 'shelf' | 'coffee' | 'plant', variant = 0, rot: Rotation = 0): Sprite {
  return cached(`${kind}${variant}r${rot}`, () =>
    sprite((pen) => {
      const f = fine(pen, rot % 2 === 1);
      const facing = rot < 2;
      if (kind === 'plant') {
        pen.cylinder(0.5, 0.5, 0, 0.2, 8, RAMP.clay);
        pen.cylinder(0.5, 0.5, 8, 0.23, 1.6, RAMP.clay);
        const [ex, ey] = pen.pt(0.5, 0.5, 9.6);
        for (let x = -7; x <= 7; x++) for (let y = -3; y <= 3; y++) if ((x * x) / 49 + (y * y) / 12 < 1) rect(pen.ctx, ex + x, ey + y, 1, 1, hash2(x, y) > 0.7 ? '#4a3020' : '#3a2416');
        drawLeaves(pen, ex, ey, 17 + variant * 13 + rot * 41, 16);
      } else if (kind === 'shelf') {
        // Regal aus Nussbaum: vier Fächer, Bücher mit Etiketten, ein Ordner, eine Vase oben
        f.box(0.06, 0.3, 0, 0.88, 0.4, 42, RAMP.walnut, (front, top, u, v) => {
          if (top) return null;
          if (!front || !facing) return front && (v % 20 < 2) ? RAMP.walnut[1] : null;
          if (u < 2 || u > 26 || v > 80) return RAMP.walnut[u < 2 ? 3 : 2];
          const row = Math.floor(v / 20);
          const inRow = v % 20;
          if (inRow < 2) return RAMP.walnut[inRow === 1 ? 4 : 0];
          const slot = Math.floor((u + row * 3) / 3);
          const tall = 10 + Math.floor(hash2(slot, row) * 6);
          if (inRow > tall || hash2(slot, row + 5) > 0.86) return RAMP.walnut[0];
          const colors = ['#c5484a', '#3f7fd0', '#e9c46a', '#2fa58f', '#7b5cc6', '#e4792b', '#e8edf0', '#3b3f4c'];
          const c = colors[Math.floor(hash2(slot, row + 2) * colors.length)];
          const spine = (u + row * 3) % 3;
          if (inRow === Math.floor(tall * 0.6) && spine === 1) return '#f2ead7';
          return spine === 0 ? darken(c, 0.3) : inRow === tall ? lighten(c, 0.2) : c;
        });
        pen.cylinder(0.5, 0.5, 42, 0.1, 6, RAMP.clay);
        pen.cylinder(0.5, 0.5, 48, 0.06, 2, RAMP.clay);
      } else {
        // Kaffeeecke: Unterschrank mit Türen, Arbeitsplatte, Maschine mit Anzeige, Glaskanne, Tassen
        f.box(0.06, 0.14, 0, 0.88, 0.7, 13, RAMP.white, (front, top, u, v) => {
          if (top || !front) return null;
          if (Math.abs(u - 14) < 0.6 || v === 11) return RAMP.white[0];
          if (v > 7 && v < 10 && (Math.abs(u - 11) < 1 || Math.abs(u - 17) < 1)) return RAMP.chrome[1];
          return u < 1 ? RAMP.white[4] : null;
        });
        f.box(0.04, 0.12, 13, 0.92, 0.74, 1.2, RAMP.walnut, (_fr, top, u, v, x, y) => (top ? step(RAMP.walnut, Math.sin(u * 0.3 + v * 0.05) > 0.85 ? 2 : hash2(x, y) > 0.9 ? 4 : 3) : null));
        const z = 14.2;
        const back = facing ? 0.2 : 0.5;
        f.box(0.24, back, z, 0.44, 0.34, 13, RAMP.black, (front, top, u, v) => {
          if (top) return u % 4 < 1 ? RAMP.chrome[2] : RAMP.chrome[3];
          if (!front || !facing) return null;
          if (v > 18 && v < 23 && u > 3 && u < 11) return v === 20 ? '#5eeac0' : '#0a1a14';
          if (v > 2 && v < 13 && u > 2 && u < 12) return '#0a0c10';
          return null;
        });
        if (facing) {
          pen.cylinder(0.46, 0.66, z, 0.07, 5, ['#2a1408', '#4a2a14', '#6a3a1c', '#bcdce6', '#e6f6fb']);
          f.cyl(0.8, 0.3, z, 0.05, 3.4, RAMP.white);
          f.cyl(0.8, 0.5, z, 0.05, 3.4, RAMP.red);
        } else {
          f.cyl(0.8, 0.7, z, 0.05, 3.4, RAMP.white);
        }
      }
    }),
  );
}

export type StairMode = 'up' | 'down' | 'both';

/**
 * Treppe nach Etage. Unten (EG) steigt sie vom Boden zur Bodendecke. Oben (OG) ist im Boden ein Loch,
 * und die Stufen führen darunter ins Erdgeschoss. Dazwischen liegen beide Hälften nebeneinander.
 */
export function stairSprite(mode: StairMode): Sprite {
  return cached(`stairs-${mode}`, () =>
    sprite((pen) => {
      const steps = 8;
      const depth = 1.84 / steps;
      const y = (k: number) => 1.92 - (k + 1) * depth;
      const j0 = 0.08;
      // Aufgang: vorn niedrig, hinten hoch. Die höchste Stufe zuerst, sonst verdeckt sie die vorderen.
      const up = (x0: number, width: number) => {
        const top = (k: number) => (k + 1) * 6;
        for (let k = steps - 1; k >= 0; k--) {
          pen.box(x0, y(k), 0, width, depth, top(k), tri(k % 2 ? '#9aa4ae' : '#b4bcc4', 0.16));
          pen.faceJ(x0, y(k) + depth, top(k) - 1, 0, 0, width * 16, 1, '#dfe4e8');
        }
      };
      // Loch im Boden: dunkle Öffnung, vorn an der Kante die Stufe am höchsten, hinten am tiefsten.
      const down = (x0: number, width: number) => {
        pen.box(x0, j0, 0, width, 1.84, 0, tri('#0d111a', 0.05));
        for (let k = 0; k < steps; k++) {
          const top = -(steps - k) * 6;
          pen.box(x0, y(k), top - 6, width, depth, 6, tri(k % 2 ? '#5b6573' : '#6d7885', 0.16));
          pen.faceJ(x0, y(k) + depth, top - 1, 0, 0, width * 16, 1, '#8c96a3');
        }
      };
      if (mode === 'both') {
        up(0.02, 0.46);
        down(0.52, 0.46);
      } else if (mode === 'down') {
        down(0.02, 0.96);
      } else {
        up(0.02, 0.96);
      }
    }, true, STAIR_CANVAS),
  );
}

/** Nur die Teile, die Möbel mit Grundfläche und Wänden brauchen. Pen erfüllt sie. */
export interface PropPen {
  box(i: number, j: number, z: number, w: number, d: number, h: number, c: Faces): void;
  faceJ(i: number, j: number, z: number, u: number, v: number, w: number, h: number, color: string): void;
  tbox(i: number, j: number, z: number, w: number, d: number, h: number, r: Ramp, tex?: (face: 'top' | 'left' | 'right', u: number, v: number, x: number, y: number) => string | null): void;
  ball(i: number, j: number, z: number, rad: number, r: Ramp): void;
  cyl(i: number, j: number, z: number, rad: number, h: number, r: Ramp): void;
}

/**
 * Dreht ein Möbel um die Ecke seiner Grundfläche. Die Zeichnung bleibt in ihren Koordinaten,
 * nur die Quader und Flächen werden auf die neue Ausrichtung abgebildet.
 */
function rotatePen(pen: Pen, rot: number, W: number, D: number): PropPen {
  const map = (i: number, j: number): [number, number] => (rot === 0 ? [i, j] : rot === 1 ? [D - j, i] : rot === 2 ? [W - i, D - j] : [j, W - i]);
  return {
    box(i, j, z, w, d, h, c) {
      const corners = [map(i, j), map(i + w, j), map(i, j + d), map(i + w, j + d)];
      const i0 = Math.min(...corners.map((p) => p[0]));
      const i1 = Math.max(...corners.map((p) => p[0]));
      const j0 = Math.min(...corners.map((p) => p[1]));
      const j1 = Math.max(...corners.map((p) => p[1]));
      pen.box(i0, j0, z, i1 - i0, j1 - j0, h, c);
    },
    faceJ(i, j, z, u, v, w, h, color) {
      // Eine Wandfläche wird am Ankerpunkt versetzt. Bei ungerader Drehung läuft sie dann an der anderen Seite.
      const [a, b] = map(i, j);
      pen.faceJ(a, b, z, u, v, w, h, color);
    },
    tbox(i, j, z, w, d, h, r, tex) {
      const corners = [map(i, j), map(i + w, j), map(i, j + d), map(i + w, j + d)];
      const i0 = Math.min(...corners.map((p) => p[0]));
      const i1 = Math.max(...corners.map((p) => p[0]));
      const j0 = Math.min(...corners.map((p) => p[1]));
      const j1 = Math.max(...corners.map((p) => p[1]));
      pen.tbox(i0, j0, z, i1 - i0, j1 - j0, h, r, tex);
    },
    ball(i, j, z, rad, r) {
      const [a, b] = map(i, j);
      pen.sphere(a, b, z, rad, r);
    },
    cyl(i, j, z, rad, h, r) {
      const [a, b] = map(i, j);
      pen.cylinder(a, b, z, rad, h, r);
    },
  };
}

export function propSprite(prop: Pick<FixedProp, 'kind'> & { rot?: number }): Sprite {
  const rot = prop.rot ?? 0;
  const base = PROPS.find((p) => p.kind === prop.kind);
  const W = base?.w ?? 1;
  const D = base?.d ?? 1;
  return cached(`prop${prop.kind}r${rot}`, () =>
    sprite((raw) => {
      const pen = rotatePen(raw, rot, W, D);
      switch (prop.kind) {
        case 'bed': {
          // Kopfteil aus Nussbaum mit Paneelen, Rahmen, Kisten darunter, Laken, Kissen, Karodecke mit Umschlag, Katze
          pen.tbox(0.04, 0.04, 0, 1.92, 0.14, 24, RAMP.walnut, (f, u, v) => (f === 'left' && (u % 16 < 1 || v === 20) ? RAMP.walnut[1] : f === 'left' && v > 21 ? RAMP.walnut[4] : null));
          pen.tbox(0.06, 0.16, 0, 1.88, 2.78, 6, RAMP.walnut);
          for (const a of [0.3, 1.1]) pen.tbox(a, 2.86, 0.4, 0.6, 0.12, 4.4, ['#2a3a4a', '#3a4e62', '#4a627a', '#6a86a0', '#8eaac2'], (f, u, v) => (f === 'left' && v === 6 && u > 6 && u < 13 ? '#1a2430' : null));
          pen.tbox(0.1, 0.2, 6, 1.8, 2.7, 5, RAMP.white, (f, _u, v, x, y) => (f === 'top' ? (hash2(x, y) > 0.9 ? RAMP.white[3] : RAMP.white[4]) : v > 7 ? RAMP.white[4] : null));
          pen.tbox(0.3, 0.26, 11, 1.4, 0.56, 3, RAMP.white, (f, u, v, x, y) => (f === 'top' ? (Math.abs(u - 22) < 1 ? RAMP.white[2] : hash2(x, y) > 0.85 ? RAMP.white[3] : RAMP.white[4]) : null));
          const plaid = ['#3a2c2c', '#5a4040', '#7a5652', '#9a6e66', '#c89a8a'] as Ramp;
          const tartan = (f: 'top' | 'left' | 'right', u: number, v: number) => {
            const a = Math.floor(u / 7) % 2;
            const b = Math.floor(v / 7) % 2;
            const stripe = u % 14 < 1.5 || v % 14 < 1.5;
            return step(plaid, a + b + (stripe ? 1.5 : 0) + (f === 'top' ? 1 : f === 'left' ? 0 : -1));
          };
          pen.tbox(0.08, 1.02, 7, 1.84, 1.9, 5.4, plaid, tartan);
          pen.tbox(0.08, 1.02, 12.4, 1.84, 0.16, 0.8, RAMP.white);
          // Katze, eingerollt, mit Streifen, Ohren und Schwanz
          const fur = ['#6a3a14', '#8f521c', '#b06a28', '#cf8a3e', '#e8ae66'] as Ramp;
          pen.ball(0.8, 1.7, 15.6, 0.11, fur);
          pen.ball(0.68, 1.64, 17.2, 0.065, fur);
          pen.tbox(0.64, 1.6, 19.6, 0.03, 0.03, 1.4, fur);
          pen.tbox(0.72, 1.58, 19.6, 0.03, 0.03, 1.4, fur);
          pen.tbox(0.82, 1.84, 13, 0.24, 0.04, 0.8, fur);
          break;
        }
        case 'toybox': {
          // Holzkiste mit Beschlägen, offener Deckel, Spielzeug: Ball, Würfel, kleiner Roboter
          const red = ['#6a2a22', '#8f3a2e', '#b04a3a', '#d06450', '#e88a76'] as Ramp;
          pen.tbox(0.1, 0.12, 0, 0.8, 0.76, 10, red, (f, u, v) => ((f !== 'top' && (v === 2 || v === 17 || u % 13 < 1)) ? '#d9a62e' : null));
          pen.tbox(0.1, 0.08, 10, 0.8, 0.06, 9, red);
          pen.ball(0.32, 0.36, 12.5, 0.1, ['#1d4580', '#285ca6', '#3a78c4', '#5e98dc', '#a8d0ff']);
          pen.tbox(0.52, 0.42, 10, 0.2, 0.2, 4, ['#8a6a12', '#b08a1e', '#d9a62e', '#f0c04a', '#ffe08a']);
          pen.tbox(0.62, 0.62, 10, 0.12, 0.12, 5, RAMP.white);
          pen.tbox(0.64, 0.64, 15, 0.08, 0.08, 3, RAMP.white);
          break;
        }
        case 'workbench': {
          // Werkbank: Stahlgestell mit Ablage, Holzplatte, Lochwand-Schubladen, Werkzeugkiste, Schraubstock, Dose
          const steel: Ramp = ['#2a3040', '#3b4558', '#4e5a70', '#6a788e', '#8e9cb2'];
          pen.tbox(0.04, 0.12, 2, 2.92, 0.74, 1.4, steel);
          for (const x of [0.08, 1.45, 2.82]) {
            pen.tbox(x, 0.16, 0, 0.1, 0.1, 14, steel);
            pen.tbox(x, 0.7, 0, 0.1, 0.1, 14, steel);
          }
          pen.tbox(0.3, 0.24, 3.4, 0.7, 0.5, 4, ['#6a4a14', '#8a6420', '#b08a3a', '#d0aa5a', '#e8c87a']);
          pen.tbox(0.02, 0.08, 14, 2.96, 0.82, 2.4, RAMP.oak, (f, u, v, x, y) => (f === 'top' ? step(RAMP.oak, Math.sin(u * 0.25 + Math.sin(v * 0.3)) > 0.85 ? 2 : hash2(x, y) > 0.9 ? 1.6 : 3) : null));
          pen.tbox(0.3, 0.24, 16.4, 0.56, 0.32, 5, RAMP.red, (f, u, v) => (f === 'left' && (v === 3 || (u > 6 && u < 11 && v === 1)) ? RAMP.red[0] : null));
          pen.tbox(0.44, 0.34, 21.4, 0.28, 0.06, 1.4, RAMP.black);
          pen.tbox(1.2, 0.3, 16.4, 0.24, 0.3, 5, steel);
          pen.tbox(1.14, 0.36, 21.4, 0.36, 0.18, 2, steel);
          pen.cyl(2.2, 0.4, 16.4, 0.08, 4, ['#8a6a12', '#b08a1e', '#d9a62e', '#f0c04a', '#ffe08a']);
          pen.tbox(2.4, 0.2, 16.4, 0.4, 0.14, 0.6, steel);
          break;
        }
        case 'boxes': {
          // Umzugskartons: Klebeband, Beschriftung, eine offene Klappe
          const card: Ramp = ['#6e4e2a', '#8e6a3c', '#b58a56', '#cfa676', '#e6c496'];
          const tape = (f: 'top' | 'left' | 'right', u: number, v: number) => (f === 'top' ? (Math.abs(v - 12) < 2 ? '#d9c08a' : null) : Math.abs(u - 12) < 2 && v > 18 ? '#d9c08a' : f === 'left' && v > 6 && v < 12 && u > 3 && u < 10 ? (u % 2 ? '#2a1e14' : null) : null);
          pen.tbox(0.08, 0.1, 0, 0.84, 0.8, 13, card, tape);
          pen.tbox(0.22, 0.2, 13, 0.56, 0.52, 10, card, tape);
          pen.tbox(0.22, 0.18, 23, 0.56, 0.04, 4, card);
          break;
        }
        case 'tires': {
          // Reifenstapel: drei Reifen übereinander. Lauffläche mit Profil, oben Flanke, Felge und Loch.
          const rubber: Ramp = ['#0c0d10', '#16181e', '#22252c', '#30343e', '#444a56'];
          const r = raw.res;
          const rx = 0.32 * 22.6 * r;
          const ry = rx / 2;
          const h = 5 * r;
          for (let n = 0; n < 3; n++) {
            const [cx, base] = raw.pt(0.5, 0.5, n * 5.6);
            const top = base - h;
            // Lauffläche: von der oberen bis zur unteren Ellipse, quer schattiert, Profil als Kerben
            for (let x = Math.ceil(-rx); x <= Math.floor(rx); x++) {
              const yy = ry * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2));
              const t = (x + rx) / (2 * rx);
              for (let y = Math.round(top + yy); y <= Math.round(base + yy); y++) {
                const v = y - (top + yy);
                const groove = Math.abs(x) < rx - 2 && v > 1.5 && v < h - 1.5 && ((x + Math.round(v / 2)) % 4 === 0);
                const tone = groove ? 0 : t < 0.2 ? 3 : t < 0.6 ? 2 : 1;
                rect(raw.ctx, cx + x, y, 1, 1, rubber[v < 1 ? Math.min(4, tone + 1) : tone]);
              }
            }
            // Oberseite: Gummiring, Felge, dunkles Loch
            for (let y = Math.floor(-ry); y <= Math.ceil(ry); y++) {
              for (let x = Math.floor(-rx); x <= Math.ceil(rx); x++) {
                const q = (x / rx) ** 2 + (y / ry) ** 2;
                if (q > 1) continue;
                let c = q > 0.82 ? rubber[3] : q > 0.36 ? rubber[2] : q > 0.16 ? RAMP.chrome[x < 0 ? 3 : 2] : '#05060a';
                if (q > 0.36 && q < 0.42) c = rubber[1];
                rect(raw.ctx, cx + x, top + y, 1, 1, c);
              }
            }
          }
          break;
        }
        case 'lockers': {
          // Spinde: drei Türen mit Lüftungsschlitzen, Griff, Nummernschild
          const blue: Ramp = ['#141c2c', '#1f2a40', '#27344f', '#384a6c', '#52688e'];
          pen.tbox(0.04, 0.2, 0, 1.92, 0.7, 40, blue, (f, u, v) => {
            if (f !== 'left') return null;
            const door = u % 20;
            if (door < 1) return blue[0];
            if (v > 66 && v < 76 && door > 4 && door < 16 && v % 3 === 0) return blue[0];
            if (v > 36 && v < 44 && door > 14 && door < 17) return RAMP.chrome[2];
            if (v > 58 && v < 63 && door > 6 && door < 13) return v === 60 ? '#2a3347' : '#e8edf0';
            return door === 1 ? blue[3] : null;
          });
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
          // Sofa: Holzfüße, Sockel, zwei Sitzkissen mit Knopf, Rückenkissen, Armlehnen, ein Zierkissen
          const teal: Ramp = ['#0e3a3e', '#155258', '#1c6f75', '#2e8e94', '#58b8bc'];
          const cushion = (f: 'top' | 'left' | 'right', u: number, v: number, x: number, y: number) => (f === 'top' ? (u < 1.5 || v < 1.5 ? teal[4] : hash2(x, y) > 0.9 ? teal[4] : null) : null);
          for (const [a, b] of [[0.16, 0.12], [0.8, 0.12], [0.16, 1.8], [0.8, 1.8]]) pen.tbox(a, b, 0, 0.06, 0.06, 2, RAMP.walnut);
          pen.tbox(0.12, 0.08, 2, 0.8, 1.84, 5, teal);
          pen.tbox(0.12, 0.08, 7, 0.24, 1.84, 12, teal, (f, u, v) => (f === 'left' && v > 18 ? teal[4] : null));
          for (const b of [0.26, 0.98]) {
            pen.tbox(0.34, b, 7, 0.56, 0.7, 3, teal, cushion);
            pen.ball(0.62, b + 0.35, 10.2, 0.012, teal);
          }
          pen.tbox(0.12, 0.08, 7, 0.8, 0.2, 7, teal);
          pen.tbox(0.12, 1.72, 7, 0.8, 0.2, 7, teal);
          pen.tbox(0.34, 1.3, 10, 0.12, 0.34, 5, ['#8a5a1a', '#b07a22', '#d29a34', '#e8b858', '#f6d68a']);
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
  const S = MEETING_SIZE;
  return cached('meetingfloor', () =>
    sprite((pen) => {
      // Teppich mit Bordüre und feinem Rautenmuster, an jeder Seite ein Stuhl
      const blue: Ramp = ['#1e3446', '#284660', '#33536b', '#456a84', '#5a84a2'];
      pen.tbox(0.1, 0.1, 0, S - 0.2, S - 0.2, 0, blue, (_f, u, v, x, y) => {
        const edge = Math.min(u, v, (S - 0.2) * 32 - u, (S - 0.2) * 32 - v);
        if (edge < 4) return blue[edge < 2 ? 4 : 1];
        const m = (Math.abs(((u / 12) % 1) - 0.5) + Math.abs(((v / 12) % 1) - 0.5));
        return m < 0.12 ? blue[3] : (x + y) & 1 ? blue[2] : blue[1];
      });
      for (const [x, y] of [[1.5, 0.5], [0.5, 1.5], [S - 0.5, 1.5], [2.5, S - 0.5]]) {
        pen.cylinder(x, y, 0, 0.04, 6, RAMP.chrome, true);
        pen.cylinder(x, y, 0, 0.18, 0.6, RAMP.black);
        pen.tbox(x - 0.2, y - 0.2, 6, 0.4, 0.4, 2.4, RAMP.fabric, (f, u, v) => (f === 'top' && (u < 1.5 || v < 1.5) ? RAMP.fabric[4] : null));
      }
    }, false),
  );
}

export function meetingTable(): Sprite {
  // Der Tisch steht in der Mitte des Raums. c ist die Mitte in Feldern.
  const c = MEETING_SIZE / 2;
  return cached('meetingtable', () =>
    sprite((pen) => {
      pen.cylinder(c, c, 0, 0.3, 0.6, RAMP.black);
      pen.cylinder(c, c, 0.6, 0.06, 10.4, RAMP.chrome, true);
      pen.tbox(c - 0.64, c - 0.64, 11, 1.28, 1.28, 2, RAMP.oak, (f, u, v, x, y) => (f === 'top' ? step(RAMP.oak, Math.sin(u * 0.3 + Math.sin(v * 0.2) * 1.4) > 0.86 ? 2 : hash2(x, y) > 0.93 ? 4 : 3) : null));
      const z = 13;
      // Laptop, zwei Blöcke mit Stift, Wasserflasche, Tasse
      pen.tbox(c - 0.4, c - 0.52, z, 0.38, 0.26, 0.6, RAMP.chrome, (f, u, v) => (f === 'top' && u % 3 < 1 && v % 3 < 1 ? RAMP.chrome[1] : null));
      pen.tbox(c - 0.4, c - 0.52, z + 0.6, 0.38, 0.03, 6, RAMP.chrome);
      pen.tbox(c + 0.06, c, z, 0.3, 0.36, 0.4, RAMP.paper, (f, _u, v) => (f === 'top' && v % 3 === 0 ? '#b8c8d8' : null));
      pen.tbox(c + 0.1, c + 0.1, z + 0.4, 0.2, 0.02, 0.4, RAMP.fabric);
      pen.tbox(c - 0.52, c + 0.12, z, 0.26, 0.32, 0.4, RAMP.paper, (f, _u, v) => (f === 'top' && v % 3 === 0 ? '#b8c8d8' : null));
      pen.cylinder(c + 0.34, c - 0.42, z, 0.05, 6, ['#5a8aa0', '#7aaac0', '#a8d0e0', '#d0ecf6', '#ffffff']);
      pen.cylinder(c + 0.34, c - 0.42, z + 6, 0.025, 1, RAMP.fabric);
      pen.cylinder(c - 0.12, c + 0.42, z, 0.05, 3.4, RAMP.white);
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

/* ---------- Bilder für Bau-Menü und Inventar ---------- */

const icons = new Map<string, string>();

/** Ein Bild des Möbelstücks aus denselben Sprites wie im Büro, eng zugeschnitten. Für das Bau-Menü und das Inventar. */
export function itemIcon(kind: string): string {
  const known = icons.get(kind);
  if (known) return known;
  const W = 200 * RES;
  const H = 200 * RES;
  const ax = 100 * RES;
  const ay = 130 * RES;
  const l = layer(W, H);
  const put = (s: Sprite, i = 0, j = 0) => {
    const x = ax + (i - j) * 16 * RES;
    const y = ay + (i + j) * 8 * RES;
    l.ctx.drawImage(s.canvas, x - s.ax, y - s.ay);
  };
  switch (kind) {
    case 'desk':
      put(chairBase(0));
      put(deskTable(0));
      put(chairBack(0));
      break;
    case 'ceoDesk':
      put(chairBase(0));
      put(ceoTable(0));
      put(chairBack(0));
      break;
    case 'shelf':
    case 'coffee':
    case 'plant':
      put(furnitureSprite(kind, 0, 0));
      break;
    case 'meeting':
      put(meetingFloor());
      put(meetingTable());
      break;
    case 'table':
      put(meetingTable(), -1, -1);
      break;
    case 'wall':
      put(wallSprite(0));
      break;
    case 'door':
      put(doorSprite(0));
      break;
    case 'board':
      put(boardSprite(0));
      break;
    case 'window':
      put(windowSprite(0));
      break;
    case 'glass':
      put(glassWallSprite(0));
      break;
    case 'half':
      put(halfWallSprite(0));
      break;
    case 'column':
      put(columnSprite());
      break;
    case 'fence':
      put(fenceSprite(0));
      break;
    case 'steps':
      put(stepsSprite(0));
      break;
    case 'level': {
      put(platformSprite(2, '#a57d58'), 0, 0);
      put(platformSprite(2, '#a57d58'), 1, 0);
      put(platformSprite(2, '#a57d58'), 0, 1);
      put(platformSprite(2, '#a57d58'), 1, 1);
      break;
    }
    case 'picture':
    case 'clock':
    case 'wallLamp':
    case 'wallShelf':
      put(wallSprite(0));
      put(hungSprite(kind, 0));
      break;
    case 'floor': {
      const pen = new Pen(l.ctx, ax, ay, RES);
      for (let n = 0; n < 4; n++) pen.floorPoly(n * 0.5, 0, 0.5, 2, n % 2 ? '#9a7350' : '#a57d58');
      break;
    }
    case 'arcade':
      put(arcadeSprite());
      break;
    case 'beanbag':
      put(beanbagSprite());
      break;
    case 'stairs':
      put(stairSprite('up'));
      break;
    case 'lift':
      put(liftShell());
      break;
    case 'roomwalls':
      // Ein kleiner Raum: hinten die beiden Wände, vorn die beiden anderen.
      put(wallSprite(0), 0, 0);
      put(wallSprite(0), 1, 0);
      put(wallSprite(1), 0, 0);
      put(wallSprite(1), 0, 1);
      put(wallSprite(1), 2, 0);
      put(wallSprite(1), 2, 1);
      put(wallSprite(0), 0, 2);
      put(wallSprite(0), 1, 2);
      break;
    case 'department': {
      // Ein abgesteckter Bereich: getönte Felder mit Rand.
      const pen = new Pen(l.ctx, ax, ay, RES);
      pen.floorPoly(0, 0, 3, 2, '#2f6f68');
      pen.floorPoly(0.15, 0.15, 2.7, 1.7, '#3f8f86');
      break;
    }
    default:
      if (PROPS.some((p) => p.kind === kind)) put(propSprite({ kind: kind as FixedProp['kind'] }));
  }
  const url = crop(l.canvas);
  icons.set(kind, url);
  return url;
}

/** Schneidet den durchsichtigen Rand weg. */
function crop(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return canvas.toDataURL();
  const out = layer(x1 - x0 + 1, y1 - y0 + 1);
  out.ctx.drawImage(canvas, -x0, -y0);
  return out.canvas.toDataURL();
}
