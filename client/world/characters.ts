// Figuren mit großem Kopf, im Code gezeichnet, damit Aussehen und Rolle frei kombinierbar bleiben.

import type { Look } from '../../shared/types.ts';
import { darken, layer, lighten, outline, rect, type Ctx, type Layer } from './pixel.ts';
import { INK } from './art.ts';

export type Pose = 'stand' | 'walk' | 'sit' | 'type' | 'think' | 'wave' | 'slump' | 'read' | 'phone' | 'talk';
export type View = 'front' | 'back';

export const CHAR = { w: 24, h: 36, ax: 12, ay: 33 };
const SEAT_AY = 27;

const PANTS = '#27324a';
const SHOE = '#171d2b';

function drawHairFront(ctx: Ctx, look: Look, dy: number): void {
  const hair = look.hairColor;
  const shine = lighten(hair, 0.22);
  rect(ctx, 6, 2 + dy, 12, 3, hair);
  rect(ctx, 5, 3 + dy, 14, 3, hair);
  rect(ctx, 5, 6 + dy, 2, 3, hair);
  rect(ctx, 17, 6 + dy, 2, 3, hair);
  rect(ctx, 7, 6 + dy, 6, 1, hair);
  rect(ctx, 7, 7 + dy, 3, 1, hair);
  rect(ctx, 8, 3 + dy, 4, 1, shine);
  rect(ctx, 14, 4 + dy, 2, 1, shine);
  rect(ctx, 17, 3 + dy, 2, 3, darken(hair, 0.16));
  if (look.hair === 'lang') {
    rect(ctx, 4, 6 + dy, 3, 11, hair);
    rect(ctx, 17, 6 + dy, 3, 11, hair);
    rect(ctx, 4, 16 + dy, 2, 2, darken(hair, 0.2));
    rect(ctx, 18, 16 + dy, 2, 2, darken(hair, 0.2));
  } else if (look.hair === 'zopf') {
    rect(ctx, 18, 5 + dy, 3, 3, hair);
    rect(ctx, 19, 8 + dy, 3, 7, hair);
    rect(ctx, 20, 15 + dy, 2, 2, darken(hair, 0.2));
    rect(ctx, 18, 5 + dy, 1, 1, '#e5534b');
  } else if (look.hair === 'locken') {
    for (const [x, y] of [[4, 2], [8, 1], [12, 1], [16, 2], [3, 5], [19, 5], [4, 8], [18, 8]]) rect(ctx, x, y + dy, 3, 3, hair);
    rect(ctx, 9, 2 + dy, 2, 1, shine);
  }
}

function drawHairBack(ctx: Ctx, look: Look, dy: number): void {
  const hair = look.hairColor;
  rect(ctx, 6, 2 + dy, 12, 2, hair);
  rect(ctx, 5, 4 + dy, 14, 9, hair);
  rect(ctx, 7, 13 + dy, 10, 1, hair);
  rect(ctx, 8, 4 + dy, 5, 1, lighten(hair, 0.2));
  rect(ctx, 16, 5 + dy, 3, 8, darken(hair, 0.15));
  if (look.hair === 'lang') rect(ctx, 5, 13 + dy, 14, 5, hair);
  else if (look.hair === 'zopf') rect(ctx, 11, 13 + dy, 3, 7, hair);
  else if (look.hair === 'locken') for (const [x, y] of [[4, 2], [9, 1], [15, 2], [3, 6], [19, 6], [5, 11], [17, 11]]) rect(ctx, x, y + dy, 3, 3, hair);
}

function drawFace(ctx: Ctx, look: Look, dy: number, blink: boolean, down: boolean): void {
  const { skin } = look;
  rect(ctx, 7, 3 + dy, 10, 11, skin);
  rect(ctx, 6, 5 + dy, 12, 7, skin);
  rect(ctx, 16, 5 + dy, 2, 7, darken(skin, 0.1));
  rect(ctx, 8, 13 + dy, 8, 1, skin);
  // Ohren, Kinnschatten, Nase
  rect(ctx, 5, 8 + dy, 1, 2, darken(skin, 0.14));
  rect(ctx, 18, 8 + dy, 1, 2, darken(skin, 0.22));
  rect(ctx, 8, 13 + dy, 8, 1, darken(skin, 0.1));
  rect(ctx, 11, 10 + dy, 1, 1, darken(skin, 0.16));
  rect(ctx, 7, 5 + dy, 9, 1, darken(skin, 0.12));
  const eyeY = (down ? 9 : 8) + dy;
  if (blink) {
    rect(ctx, 8, eyeY + 1, 2, 1, INK);
    rect(ctx, 13, eyeY + 1, 2, 1, INK);
  } else {
    rect(ctx, 8, eyeY, 2, 2, INK);
    rect(ctx, 13, eyeY, 2, 2, INK);
    rect(ctx, 8, eyeY, 1, 1, '#ffffff');
    rect(ctx, 13, eyeY, 1, 1, '#ffffff');
  }
  rect(ctx, 7, 10 + dy, 1, 1, lighten('#e5534b', 0.4));
  rect(ctx, 15, 10 + dy, 1, 1, lighten('#e5534b', 0.4));
  rect(ctx, 10, 12 + dy, 3, 1, darken(skin, 0.5));
  rect(ctx, 8, eyeY - 2, 2, 1, darken(look.hairColor, 0.1));
  rect(ctx, 13, eyeY - 2, 2, 1, darken(look.hairColor, 0.1));
  if (look.glasses) {
    rect(ctx, 7, eyeY - 1, 4, 1, INK);
    rect(ctx, 12, eyeY - 1, 4, 1, INK);
    rect(ctx, 7, eyeY + 2, 4, 1, INK);
    rect(ctx, 12, eyeY + 2, 4, 1, INK);
    rect(ctx, 11, eyeY, 1, 1, INK);
  }
  drawHairFront(ctx, look, dy);
}

function drawBody(ctx: Ctx, look: Look, dy: number, view: View): void {
  const top = look.top;
  const dark = darken(top, 0.22);
  const light = lighten(top, 0.2);
  rect(ctx, 7, 15 + dy, 10, 10, top);
  rect(ctx, 15, 15 + dy, 2, 10, dark);
  rect(ctx, 7, 24 + dy, 10, 1, dark);
  if (view === 'front') {
    // Kragen, Knopfleiste, Gürtel
    rect(ctx, 8, 14 + dy, 8, 2, light);
    rect(ctx, 11, 16 + dy, 2, 3, light);
    rect(ctx, 10, 15 + dy, 4, 1, darken(look.skin, 0.1));
    rect(ctx, 12, 19 + dy, 1, 1, dark);
    rect(ctx, 12, 21 + dy, 1, 1, dark);
    rect(ctx, 7, 15 + dy, 1, 9, light);
    rect(ctx, 7, 24 + dy, 10, 1, '#1d2436');
    rect(ctx, 11, 24 + dy, 2, 1, '#d9a62e');
  } else {
    rect(ctx, 8, 14 + dy, 8, 4, dark);
    rect(ctx, 9, 15 + dy, 6, 2, top);
  }
}

function drawLegs(ctx: Ctx, walk: number, dy: number): void {
  const lift = walk === 1 ? 2 : 0;
  const lift2 = walk === 3 ? 2 : 0;
  rect(ctx, 8, 25 + dy, 3, 6 - lift, PANTS);
  rect(ctx, 13, 25 + dy, 3, 6 - lift2, PANTS);
  // Schatten auf der Innenseite der Beine, helle Sohle
  rect(ctx, 10, 25 + dy, 1, 6 - lift, darken(PANTS, 0.25));
  rect(ctx, 15, 25 + dy, 1, 6 - lift2, darken(PANTS, 0.25));
  rect(ctx, 7, 30 + dy - lift, 4, 2, SHOE);
  rect(ctx, 13, 30 + dy - lift2, 4, 2, SHOE);
  rect(ctx, 7, 31 + dy - lift, 4, 1, '#3a4660');
  rect(ctx, 13, 31 + dy - lift2, 4, 1, '#3a4660');
}

function drawArms(ctx: Ctx, look: Look, pose: Pose, frame: number, dy: number, walk: number): void {
  const top = look.top;
  const dark = darken(top, 0.22);
  const { skin } = look;
  switch (pose) {
    case 'type': {
      const a = frame % 2;
      rect(ctx, 5, 17 + dy, 2, 4, top);
      rect(ctx, 17, 17 + dy, 2, 4, dark);
      rect(ctx, 5, 20 + dy, 6, 2, top);
      rect(ctx, 13, 20 + dy, 6, 2, dark);
      rect(ctx, 9, 21 + dy + a, 2, 1, skin);
      rect(ctx, 13, 21 + dy + (1 - a), 2, 1, skin);
      break;
    }
    case 'think':
      rect(ctx, 5, 16 + dy, 2, 7, top);
      rect(ctx, 17, 16 + dy, 2, 3, dark);
      rect(ctx, 15, 14 + dy, 3, 3, skin);
      break;
    case 'wave': {
      const a = frame % 2;
      rect(ctx, 5, 16 + dy, 2, 8, top);
      rect(ctx, 5, 24 + dy, 2, 2, skin);
      rect(ctx, 17 + a, 8 + dy, 2, 8, dark);
      rect(ctx, 17 + a, 5 + dy, 3, 3, skin);
      break;
    }
    case 'read':
      rect(ctx, 5, 17 + dy, 2, 4, top);
      rect(ctx, 17, 17 + dy, 2, 4, dark);
      rect(ctx, 7, 19 + dy, 10, 5, '#e8edf0');
      rect(ctx, 12, 19 + dy, 1, 5, '#9fb0c8');
      rect(ctx, 5, 21 + dy, 2, 2, skin);
      rect(ctx, 17, 21 + dy, 2, 2, skin);
      break;
    case 'slump':
      rect(ctx, 6, 18 + dy, 2, 7, top);
      rect(ctx, 16, 18 + dy, 2, 7, dark);
      break;
    case 'phone': {
      // Pause: Beide Hände halten ein Handy vor dem Bauch, der Bildschirm flackert leicht.
      rect(ctx, 5, 16 + dy, 2, 6, top);
      rect(ctx, 17, 16 + dy, 2, 6, dark);
      rect(ctx, 7, 20 + dy, 3, 2, skin);
      rect(ctx, 14, 20 + dy, 3, 2, skin);
      rect(ctx, 9, 18 + dy, 6, 6, '#111a29');
      rect(ctx, 10, 19 + dy, 4, 4, frame % 6 < 3 ? '#8fd7ff' : '#6fc3f2');
      break;
    }
    case 'talk': {
      // Pause: Ein Arm gestikuliert beim Plaudern.
      const a = frame % 2;
      rect(ctx, 5, 16 + dy, 2, 8, top);
      rect(ctx, 5, 24 + dy, 2, 2, skin);
      rect(ctx, 17, 15 + dy - a, 2, 5, dark);
      rect(ctx, 18, 14 + dy - a, 3, 2, skin);
      break;
    }
    default: {
      const swing = walk === 1 ? 1 : walk === 3 ? -1 : 0;
      rect(ctx, 5, 16 + dy + swing, 2, 8, top);
      rect(ctx, 5, 24 + dy + swing, 2, 2, skin);
      rect(ctx, 17, 16 + dy - swing, 2, 8, dark);
      rect(ctx, 17, 24 + dy - swing, 2, 2, skin);
    }
  }
}

const seatedPose = (pose: Pose) => pose === 'sit' || pose === 'type' || pose === 'think' || pose === 'slump' || pose === 'read';

function paint(l: Layer, look: Look, pose: Pose, frame: number, view: View, standing: boolean): void {
  const ctx = l.ctx;
  const seated = seatedPose(pose) && !standing;
  const walk = pose === 'walk' ? frame % 4 : 0;
  const bob = pose === 'walk' && frame % 2 === 1 ? -1 : 0;
  const breathe = pose === 'stand' && frame % 2 === 1 ? 1 : 0;
  const headDrop = pose === 'slump' ? 2 : pose === 'type' && frame % 2 === 1 ? 1 : 0;

  if (view === 'front') {
    if (look.hair === 'lang') {
      // Haare fallen hinter die Schultern
      rect(ctx, 4, 8 + bob, 3, 8, darken(look.hairColor, 0.1));
      rect(ctx, 17, 8 + bob, 3, 8, darken(look.hairColor, 0.1));
    }
    if (!seated) drawLegs(ctx, walk, bob);
    else rect(ctx, 8, 25, 8, 2, PANTS);
    drawBody(ctx, look, bob, 'front');
    drawArms(ctx, look, pose, frame, bob, walk);
    drawFace(ctx, look, headDrop + bob + breathe, frame % 23 === 22, pose === 'slump' || pose === 'read' || pose === 'type' || pose === 'phone');
  } else {
    if (!seated) drawLegs(ctx, walk, bob);
    else rect(ctx, 8, 25, 8, 2, PANTS);
    drawBody(ctx, look, bob, 'back');
    drawArms(ctx, look, pose === 'type' ? 'slump' : pose, frame, bob, walk);
    rect(ctx, 7, 3 + bob, 10, 11, look.skin);
    drawHairBack(ctx, look, bob + breathe);
  }
}

export interface CharSprite {
  canvas: HTMLCanvasElement;
  ax: number;
  ay: number;
}

const cache = new Map<string, CharSprite>();

export function characterSprite(look: Look, pose: Pose, frame: number, view: View, standing = false): CharSprite {
  const key = `${look.hair}|${look.hairColor}|${look.top}|${look.skin}|${look.glasses}|${pose}|${frame}|${view}|${standing}`;
  let s = cache.get(key);
  if (!s) {
    const l = layer(CHAR.w, CHAR.h);
    paint(l, look, pose, frame, view, standing);
    outline(l, INK);
    s = { canvas: l.canvas, ax: CHAR.ax, ay: seatedPose(pose) && !standing ? SEAT_AY : CHAR.ay };
    cache.set(key, s);
  }
  return s;
}

/** Porträt für das Team-Fenster: derselbe Kopf wie die Figur im Büro. */
export function portraitUrl(look: Look): string {
  const l = layer(24, 22);
  rect(l.ctx, 0, 0, 24, 22, '#1d3550');
  const sprite = characterSprite(look, 'stand', 0, 'front');
  l.ctx.drawImage(sprite.canvas, 0, 1);
  return l.canvas.toDataURL();
}
