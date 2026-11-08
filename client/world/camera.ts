// Die Kamera dreht sich in Vierteldrehungen um das Haus. Gespeichert wird immer in Weltkoordinaten,
// gezeichnet in Ansichtskoordinaten. Diese Datei rechnet zwischen beiden um.

import { footprint, isEdgeKind, isWallHung, wallSides } from '../../shared/layout.ts';
import type { PlacedItem, Rotation } from '../../shared/types.ts';

export type Cam = 0 | 1 | 2 | 3;

export interface Edge {
  i: number;
  j: number;
  rot: Rotation;
}

/** Richtungen wie bei Drehungen: 0 +i, 1 +j, 2 -i, 3 -j. */
export type Dir = 0 | 1 | 2 | 3;

export class ViewXf {
  readonly cam: Cam;
  /** Breite und Tiefe des Raums in der Welt. */
  readonly W: number;
  readonly D: number;

  constructor(cam: Cam, W: number, D: number) {
    this.cam = cam;
    this.W = W;
    this.D = D;
  }

  /** Breite und Tiefe so, wie die Kamera den Raum sieht. */
  get w(): number {
    return this.cam % 2 ? this.D : this.W;
  }

  get d(): number {
    return this.cam % 2 ? this.W : this.D;
  }

  /** Ein Punkt der Welt in Ansichtskoordinaten. */
  pt(i: number, j: number): [number, number] {
    switch (this.cam) {
      case 0:
        return [i, j];
      case 1:
        return [this.D - j, i];
      case 2:
        return [this.W - i, this.D - j];
      default:
        return [j, this.W - i];
    }
  }

  /** Ein Punkt der Ansicht zurück in die Welt. */
  back(u: number, v: number): [number, number] {
    switch (this.cam) {
      case 0:
        return [u, v];
      case 1:
        return [v, this.D - u];
      case 2:
        return [this.W - u, this.D - v];
      default:
        return [this.W - v, u];
    }
  }

  /** Ein Rechteck der Welt als Rechteck der Ansicht. */
  rect<R extends { i: number; j: number; w: number; d: number }>(r: R): R {
    const [a, b] = this.pt(r.i, r.j);
    const [c, d] = this.pt(r.i + r.w, r.j + r.d);
    return { ...r, i: Math.min(a, c), j: Math.min(b, d), w: Math.abs(c - a), d: Math.abs(d - b) };
  }

  /** Ein Feld der Welt als Feld der Ansicht. */
  tile(t: { i: number; j: number }): { i: number; j: number } {
    const r = this.rect({ i: t.i, j: t.j, w: 1, d: 1 });
    return { i: r.i, j: r.j };
  }

  /** Ein Feld der Ansicht als Feld der Welt. */
  tileBack(t: { i: number; j: number }): { i: number; j: number } {
    const [a, b] = this.back(t.i, t.j);
    const [c, d] = this.back(t.i + 1, t.j + 1);
    return { i: Math.min(a, c), j: Math.min(b, d) };
  }

  dir(d: number): Dir {
    return (((d + this.cam) % 4) + 4) % 4 as Dir;
  }

  /**
   * Die Drehung eines Möbels in der Ansicht. Fast alle Möbel zählen ihre Drehung andersherum als die Richtungen:
   * rot 0 schaut nach +j, 1 nach +i, 2 nach -j, 3 nach -i. Nur der Glasraum und der Besprechungstisch zählen wie die Richtungen.
   */
  rot(r: Rotation, kind?: string): Rotation {
    if (kind === 'meeting' || kind === 'table') return this.dir(r) as Rotation;
    return (this.dir(r ^ 1) ^ 1) as Rotation;
  }

  /** Eine Kante der Welt als Kante der Ansicht. Die Drehung sagt nur, ob sie längs i (0) oder längs j (1) läuft. */
  edge(e: Edge): Edge {
    const [a, b] = this.pt(e.i, e.j);
    const [c, d] = e.rot % 2 === 0 ? this.pt(e.i + 1, e.j) : this.pt(e.i, e.j + 1);
    return b === d ? { i: Math.min(a, c), j: b, rot: 0 } : { i: a, j: Math.min(b, d), rot: 1 };
  }

  /** Eine Kante der Ansicht zurück in die Welt. */
  edgeBack(e: Edge): Edge {
    const [a, b] = this.back(e.i, e.j);
    const [c, d] = e.rot % 2 === 0 ? this.back(e.i + 1, e.j) : this.back(e.i, e.j + 1);
    return b === d ? { i: Math.min(a, c), j: b, rot: 0 } : { i: a, j: Math.min(b, d), rot: 1 };
  }

  /** Welche Seite einer Wand die Kamera sieht: die vordere (höheres i oder j in der Welt) oder die hintere. */
  edgeSide(e: Edge): 'front' | 'back' {
    const [, b] = wallSides(e);
    const [u, v] = this.pt(b.i + 0.5, b.j + 0.5);
    const view = this.edge(e);
    return (view.rot === 0 ? v > view.j : u > view.i) ? 'front' : 'back';
  }

  /** Ein Gegenstand so, wie er in der Ansicht steht. Kanten bleiben Kanten, Wandgegenstände zeigen weiter zu ihrer Seite. */
  item<T extends Pick<PlacedItem, 'kind' | 'i' | 'j' | 'rot'>>(item: T): T {
    if (this.cam === 0) return item;
    if (isEdgeKind(item.kind)) return { ...item, ...this.edge(item) };
    if (isWallHung(item.kind)) {
      const view = this.edge(item);
      const facing = item.rot < 2 ? 'front' : 'back';
      const seen = this.edgeSide(item);
      return { ...item, i: view.i, j: view.j, rot: ((view.rot % 2) + (facing === seen ? 0 : 2)) as Rotation };
    }
    const size = footprint(item.kind, item.rot);
    const r = this.rect({ i: item.i, j: item.j, w: size.w, d: size.d });
    return { ...item, i: r.i, j: r.j, rot: this.rot(item.rot, item.kind) };
  }

  /** Ein Gegenstand der Ansicht zurück in die Welt. Für Vorschau und Klicks beim Bauen. */
  itemBack<T extends Pick<PlacedItem, 'kind' | 'i' | 'j' | 'rot'>>(item: T): T {
    if (this.cam === 0) return item;
    const inverse = new ViewXf(((4 - this.cam) % 4) as Cam, this.w, this.d);
    return inverse.item(item);
  }
}

/** Blickrichtung einer Figur aus Bild und Spiegelung, und zurück. */
export function dirOfView(view: 'front' | 'back', flip: boolean): Dir {
  if (view === 'front') return flip ? 0 : 1;
  return flip ? 3 : 2;
}

export function viewOfDir(dir: Dir): { view: 'front' | 'back'; flip: boolean } {
  return [{ view: 'front', flip: true }, { view: 'front', flip: false }, { view: 'back', flip: false }, { view: 'back', flip: true }][dir] as { view: 'front' | 'back'; flip: boolean };
}
