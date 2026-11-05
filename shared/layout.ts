// Grundriss-Regeln. Server und Client nutzen dieselben Funktionen, damit das,
// was der Bau-Modus grün zeigt, auch tatsächlich gespeichert werden kann.

import { PROPS, RULES, type LocationInfo } from './catalog.ts';
import type { Department, FurnitureKind, PlacedItem, Rotation } from './types.ts';

export interface Tile {
  i: number;
  j: number;
}

export const footprint = (kind: FurnitureKind): { w: number; d: number } =>
  PROPS.find((p) => p.kind === kind) ?? (kind === 'desk' || kind === 'ceoDesk' ? { w: 2, d: 2 } : kind === 'meeting' ? { w: 3, d: 3 } : { w: 1, d: 1 });

export function occupiedTiles(item: Pick<PlacedItem, 'kind' | 'i' | 'j'>): Tile[] {
  const { w, d } = footprint(item.kind);
  const out: Tile[] = [];
  for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) out.push({ i: item.i + a, j: item.j + b });
  return out;
}

/** Der Tisch selbst blockiert; die Stuhlreihe bleibt begehbar. */
export function blockingTiles(item: Pick<PlacedItem, 'kind' | 'i' | 'j' | 'rot'>): Tile[] {
  if (item.kind === 'meeting') return [{ i: item.i + 1, j: item.j + 1 }];
  if (item.kind !== 'desk' && item.kind !== 'ceoDesk') return occupiedTiles(item);
  switch (item.rot) {
    case 0:
      return [{ i: item.i, j: item.j + 1 }, { i: item.i + 1, j: item.j + 1 }];
    case 1:
      return [{ i: item.i + 1, j: item.j }, { i: item.i + 1, j: item.j + 1 }];
    case 2:
      return [{ i: item.i, j: item.j }, { i: item.i + 1, j: item.j }];
    default:
      return [{ i: item.i, j: item.j }, { i: item.i, j: item.j + 1 }];
  }
}

export type Facing = 'sw' | 'se' | 'ne' | 'nw';

export interface Seat {
  i: number;
  j: number;
  tile: Tile;
  facing: Facing;
}

/** Sitzposition (Feldmitten-Koordinaten) und Blickrichtung für einen Schreibtisch. */
export function seatOf(item: Pick<PlacedItem, 'i' | 'j' | 'rot'>): Seat {
  switch (item.rot) {
    case 0:
      return { i: item.i + 1, j: item.j + 0.5, tile: { i: item.i, j: item.j }, facing: 'sw' };
    case 1:
      return { i: item.i + 0.5, j: item.j + 1, tile: { i: item.i, j: item.j }, facing: 'se' };
    case 2:
      return { i: item.i + 1, j: item.j + 1.5, tile: { i: item.i, j: item.j + 1 }, facing: 'ne' };
    default:
      return { i: item.i + 1.5, j: item.j + 1, tile: { i: item.i + 1, j: item.j }, facing: 'nw' };
  }
}

const key = (t: Tile) => `${t.i},${t.j}`;

export interface RoomDoor {
  inside: Tile;
  outside: Tile;
}

/** Die Drehung legt fest, in welcher Glaswand die Tür sitzt. */
export function meetingDoor(item: Pick<PlacedItem, 'i' | 'j' | 'rot'>): RoomDoor {
  switch (item.rot) {
    case 0:
      return { inside: { i: item.i + 2, j: item.j + 1 }, outside: { i: item.i + 3, j: item.j + 1 } };
    case 1:
      return { inside: { i: item.i + 1, j: item.j + 2 }, outside: { i: item.i + 1, j: item.j + 3 } };
    case 2:
      return { inside: { i: item.i, j: item.j + 1 }, outside: { i: item.i - 1, j: item.j + 1 } };
    default:
      return { inside: { i: item.i + 1, j: item.j }, outside: { i: item.i + 1, j: item.j - 1 } };
  }
}

/** Plätze rund um den Tisch. Der Platz an der Tür kommt zuletzt, damit niemand den Eingang besetzt. */
export function meetingSeats(item: Pick<PlacedItem, 'i' | 'j' | 'rot'>): Seat[] {
  const seats: Seat[] = [
    { i: item.i + 1.5, j: item.j + 0.5, tile: { i: item.i + 1, j: item.j }, facing: 'sw' },
    { i: item.i + 0.5, j: item.j + 1.5, tile: { i: item.i, j: item.j + 1 }, facing: 'se' },
    { i: item.i + 2.5, j: item.j + 1.5, tile: { i: item.i + 2, j: item.j + 1 }, facing: 'nw' },
    { i: item.i + 1.5, j: item.j + 2.5, tile: { i: item.i + 1, j: item.j + 2 }, facing: 'ne' },
  ];
  const door = key(meetingDoor(item).inside);
  return [...seats.filter((s) => key(s.tile) !== door), ...seats.filter((s) => key(s.tile) === door)];
}

const edge = (a: Tile, b: Tile) => `${key(a)}>${key(b)}`;

/** Glaswände sperren den Weg zwischen zwei Feldern, außer an der Tür. */
export function blockedEdges(items: Pick<PlacedItem, 'kind' | 'i' | 'j' | 'rot'>[]): Set<string> {
  const edges = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'meeting') continue;
    const door = meetingDoor(item);
    const wall = (a: Tile, b: Tile) => {
      if (key(a) === key(door.inside) && key(b) === key(door.outside)) return;
      edges.add(edge(a, b));
      edges.add(edge(b, a));
    };
    for (let n = 0; n < 3; n++) {
      wall({ i: item.i + n, j: item.j }, { i: item.i + n, j: item.j - 1 });
      wall({ i: item.i + n, j: item.j + 2 }, { i: item.i + n, j: item.j + 3 });
      wall({ i: item.i, j: item.j + n }, { i: item.i - 1, j: item.j + n });
      wall({ i: item.i + 2, j: item.j + n }, { i: item.i + 3, j: item.j + n });
    }
  }
  return edges;
}

export function blockedSet(loc: LocationInfo, items: PlacedItem[]): Set<string> {
  const blocked = new Set<string>();
  for (const item of items) for (const t of blockingTiles(item)) blocked.add(key(t));
  return blocked;
}

export const inBounds = (loc: Pick<LocationInfo, 'w' | 'd'>, t: Tile) => t.i >= 0 && t.j >= 0 && t.i < loc.w && t.j < loc.d;

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function reachableFrom(loc: LocationInfo, blocked: Set<string>, start: Tile, edges: Set<string>): Set<string> {
  const seen = new Set<string>([key(start)]);
  const queue = [start];
  while (queue.length) {
    const t = queue.shift()!;
    for (const [a, b] of NEIGHBOURS) {
      const n = { i: t.i + a, j: t.j + b };
      if (!inBounds(loc, n) || blocked.has(key(n)) || seen.has(key(n)) || edges.has(edge(t, n))) continue;
      seen.add(key(n));
      queue.push(n);
    }
  }
  return seen;
}

export interface PlacementCheck {
  ok: boolean;
  reason: string;
}

/** Prüft Grenzen, Überschneidungen und ob jeder Arbeitsplatz von der Tür aus erreichbar bleibt. */
export function checkPlacement(
  loc: LocationInfo,
  items: PlacedItem[],
  candidate: { id?: string; kind: FurnitureKind; i: number; j: number; rot: Rotation },
): PlacementCheck {
  const others = items.filter((x) => x.id !== candidate.id);
  const tiles = occupiedTiles(candidate);
  if (tiles.some((t) => !inBounds(loc, t))) return { ok: false, reason: 'Das passt nicht in den Raum.' };

  const taken = new Set<string>();
  for (const other of others) for (const t of occupiedTiles(other)) taken.add(key(t));
  taken.add(key(loc.door));
  for (const t of loc.keep ?? []) taken.add(key(t));
  if (tiles.some((t) => taken.has(key(t)))) return { ok: false, reason: 'Dieser Platz ist schon belegt.' };

  const next: PlacedItem[] = [...others, { id: candidate.id ?? 'neu', ...candidate }];
  const blocked = blockedSet(loc, next);
  const reach = reachableFrom(loc, blocked, loc.door, blockedEdges(next));
  if ((loc.keep ?? []).some((t) => !reach.has(key(t)))) return { ok: false, reason: 'Das versperrt den Weg zur Treppe.' };
  for (const item of next) {
    if (item.kind === 'desk' || item.kind === 'ceoDesk') {
      if (!reach.has(key(seatOf(item).tile))) return { ok: false, reason: 'Das versperrt den Weg zu einem Arbeitsplatz.' };
    } else if (item.kind === 'meeting') {
      if (!reach.has(key(meetingDoor(item).inside))) return { ok: false, reason: 'Die Tür wäre versperrt. Drehen legt fest, wo sie sitzt.' };
    } else if (item.kind !== 'plant') {
      const open = NEIGHBOURS.some(([a, b]) => reach.has(key({ i: item.i + a, j: item.j + b })));
      if (!open) return { ok: false, reason: 'Das wäre danach nicht mehr erreichbar.' };
    }
  }
  return { ok: true, reason: '' };
}

/** Kürzester Weg auf dem Raster (Breitensuche). Leer, wenn es keinen gibt. */
export function findPath(loc: Pick<LocationInfo, 'w' | 'd'>, blocked: Set<string>, from: Tile, to: Tile, edges: Set<string> = new Set()): Tile[] {
  if (from.i === to.i && from.j === to.j) return [];
  const prev = new Map<string, Tile | null>([[key(from), null]]);
  const queue = [from];
  while (queue.length) {
    const t = queue.shift()!;
    if (t.i === to.i && t.j === to.j) {
      const path: Tile[] = [];
      let at: Tile | null = t;
      while (at && key(at) !== key(from)) {
        path.unshift(at);
        at = prev.get(key(at)) ?? null;
      }
      return path;
    }
    for (const [a, b] of NEIGHBOURS) {
      const n = { i: t.i + a, j: t.j + b };
      const isGoal = n.i === to.i && n.j === to.j;
      if (!inBounds(loc, n) || prev.has(key(n)) || (blocked.has(key(n)) && !isGoal) || edges.has(edge(t, n))) continue;
      prev.set(key(n), t);
      queue.push(n);
    }
  }
  return [];
}

/* ---------- Abteilungen ---------- */

export type Rect = Pick<Department, 'i' | 'j' | 'w' | 'd'>;

export const inRect = (r: Rect, t: Tile) => t.i >= r.i && t.j >= r.j && t.i < r.i + r.w && t.j < r.j + r.d;

/** Zwei Ecken werden zum Bereich, egal in welcher Reihenfolge sie geklickt wurden. */
export function rectFromCorners(a: Tile, b: Tile): Rect {
  const i = Math.min(a.i, b.i);
  const j = Math.min(a.j, b.j);
  return { i, j, w: Math.abs(a.i - b.i) + 1, d: Math.abs(a.j - b.j) + 1 };
}

/** Ein Bereich muss in den Raum passen, groß genug sein und darf keine andere Abteilung überlagern. */
export function checkDepartment(loc: LocationInfo, departments: Department[], candidate: Rect & { id?: string }): PlacementCheck {
  const { i, j, w, d } = candidate;
  if (w < RULES.departmentMinSize || d < RULES.departmentMinSize) return { ok: false, reason: `Eine Abteilung ist mindestens ${RULES.departmentMinSize} × ${RULES.departmentMinSize} Felder groß.` };
  if (!inBounds(loc, { i, j }) || !inBounds(loc, { i: i + w - 1, j: j + d - 1 })) return { ok: false, reason: 'Das passt nicht in den Raum.' };
  for (const other of departments) {
    if (other.id === candidate.id) continue;
    const overlap = i < other.i + other.w && other.i < i + w && j < other.j + other.d && other.j < j + d;
    if (overlap) return { ok: false, reason: `Hier liegt schon die Abteilung "${other.name}".` };
  }
  return { ok: true, reason: '' };
}

/** Der Platz am Schreibtisch entscheidet, zu welcher Abteilung jemand gehört. */
export function deskDepartment(departments: Department[], desk: Pick<PlacedItem, 'i' | 'j' | 'rot' | 'floor'> | null | undefined): Department | null {
  if (!desk) return null;
  const tile = seatOf(desk).tile;
  return departments.find((dept) => (dept.floor ?? 0) === (desk.floor ?? 0) && inRect(dept, tile)) ?? null;
}

/** Freies Feld direkt neben einem Möbelstück, damit Figuren davor stehen können. */
export function standingTile(loc: LocationInfo, blocked: Set<string>, item: PlacedItem): Tile | null {
  // Am liebsten vor der Vorderseite: Wer ein Regal nutzt, steht nicht dahinter.
  const front = [{ i: item.i, j: item.j + 1 }, { i: item.i + 1, j: item.j }, { i: item.i, j: item.j - 1 }, { i: item.i - 1, j: item.j }][item.rot];
  if (footprint(item.kind).w === 1 && inBounds(loc, front) && !blocked.has(key(front))) return front;
  for (const t of occupiedTiles(item)) {
    for (const [a, b] of NEIGHBOURS) {
      const n = { i: t.i + a, j: t.j + b };
      if (inBounds(loc, n) && !blocked.has(key(n))) return n;
    }
  }
  return null;
}
