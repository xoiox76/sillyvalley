// Der Stadtplan von Silly Vailley. Server und Client nutzen dieselben Grundstücke und Wege,
// damit das, was die Karte anbietet, auch dem entspricht, was das Spiel zulässt.

import type { LocationId, TownState } from './types.ts';

export const TOWN_W = 40;
export const TOWN_D = 36;
export const TOWN_NAME = 'Silly Vailley';

export interface TownTile {
  i: number;
  j: number;
}

export type ParcelKind = 'home' | 'house' | 'shop' | 'vacant' | 'lot' | 'park';

export interface TownBuilding {
  i: number;
  j: number;
  w: number;
  d: number;
  color: string;
  accent: string;
}

/** Was auf dem Schild am Haus steht. Wer schon eine Rechtsform im Namen trägt, bekommt keine zweite. */
export const firmSign = (name: string) => (/\b(corp|corporation|inc|llc|ltd|gmbh|ug|ag|kg|co)\.?$/i.test(name.trim()) ? name.trim() : `${name.trim()} Corp.`);

export interface Parcel {
  id: string;
  name: string;
  street: string;
  kind: ParcelKind;
  i: number;
  j: number;
  w: number;
  d: number;
  /** Wo man steht, um hier etwas zu tun: immer ein Feld auf dem Gehweg. */
  entry: TownTile;
  building?: TownBuilding;
  /** Miete oder Kaufpreis in Baupunkten. */
  price?: number;
  /** Bei Grundstücken: Kosten des Baus. */
  buildCost?: number;
  /** Der Raum, in dem die Firma hier sitzt. */
  locationId?: LocationId;
}

const lot = (id: string, name: string, street: string, i: number, j: number, w: number, d: number, entry: TownTile, size: 'klein' | 'mittel' | 'gross'): Parcel => {
  const plan = { klein: { price: 60, buildCost: 100 }, mittel: { price: 100, buildCost: 180 }, gross: { price: 180, buildCost: 300 } }[size];
  return { id, name, street, kind: 'lot', i, j, w, d, entry, ...plan, locationId: `neubau-${size}` };
};

const house = (id: string, name: string, street: string, i: number, j: number, w: number, d: number, entry: TownTile, color: string, accent: string): Parcel => ({
  id, name, street, kind: 'house', i, j, w, d, entry, building: { i, j, w, d, color, accent },
});

const shop = (id: string, name: string, street: string, i: number, j: number, w: number, d: number, entry: TownTile, color: string, accent: string): Parcel => ({
  id, name, street, kind: 'shop', i, j, w, d, entry, building: { i, j, w, d, color, accent },
});

const vacant = (id: string, name: string, street: string, i: number, j: number, w: number, d: number, entry: TownTile, price: number, locationId: LocationId, color: string): Parcel => ({
  id, name, street, kind: 'vacant', i, j, w, d, entry, price, locationId, building: { i, j, w, d, color, accent: '#8d97a3' },
});

export const PARCELS: Parcel[] = [
  {
    id: 'elternhaus', name: 'Elternhaus', street: 'Main Street', kind: 'home', i: 1, j: 6, w: 9, d: 6, entry: { i: 5, j: 12 },
    building: { i: 2, j: 7, w: 5, d: 4, color: '#c9b79a', accent: '#8a4438' },
  },
  shop('diner', "Dottie's Diner", 'Main Street', 15, 8, 3, 4, { i: 16, j: 12 }, '#b5493f', '#f2efe4'),
  vacant('eckladen', 'Eckladen', 'Main Street', 18, 8, 3, 4, { i: 19, j: 12 }, 60, 'eckladen', '#a7907a'),
  shop('eisenwaren', "Hank's Eisenwaren", 'Main Street', 21, 8, 4, 4, { i: 23, j: 12 }, '#5f7f93', '#e4792b'),
  vacant('postamt', 'Altes Postamt', 'Main Street', 29, 7, 5, 5, { i: 31, j: 12 }, 150, 'buero', '#9c8f7c'),
  shop('friseur', 'Salon Rosie', 'Main Street', 34, 8, 3, 4, { i: 35, j: 12 }, '#c58aa4', '#f2efe4'),
  shop('apotheke', 'Apotheke', 'Main Street', 37, 8, 3, 4, { i: 38, j: 12 }, '#6fa58d', '#f2efe4'),
  vacant('kino', 'Altes Kino', 'Maple Avenue', 15, 17, 6, 5, { i: 18, j: 22 }, 260, 'kino', '#7d6a8c'),
  house('haus-pine-1', 'Wohnhaus', 'Pine Lane', 2, 0, 3, 2, { i: 3, j: 2 }, '#b8c4c9', '#54606b'),
  house('haus-pine-2', 'Wohnhaus', 'Pine Lane', 7, 0, 3, 2, { i: 8, j: 2 }, '#d3c4a2', '#7a4f3a'),
  house('haus-pine-3', 'Wohnhaus', 'Pine Lane', 17, 0, 4, 2, { i: 19, j: 2 }, '#a9bfa4', '#5a5148'),
  house('haus-pine-4', 'Wohnhaus', 'Pine Lane', 31, 0, 4, 2, { i: 33, j: 2 }, '#c7a9a0', '#54606b'),
  house('haus-maple-1', 'Wohnhaus', 'Maple Avenue', 1, 17, 4, 4, { i: 3, j: 22 }, '#cfd0c4', '#7a4f3a'),
  house('haus-maple-2', 'Wohnhaus', 'Maple Avenue', 22, 17, 3, 4, { i: 23, j: 22 }, '#b5c3d1', '#5a5148'),
  house('haus-maple-3', 'Wohnhaus', 'Maple Avenue', 36, 17, 3, 4, { i: 37, j: 22 }, '#d9c8a8', '#8a4438'),
  house('haus-sued', 'Wohnhaus', 'Birch Road', 6, 26, 4, 4, { i: 8, j: 30 }, '#bcae9e', '#54606b'),
  lot('grund-maple-west', 'Grundstück Maple Avenue 12', 'Maple Avenue', 6, 16, 5, 6, { i: 8, j: 22 }, 'mittel'),
  lot('grund-elm', 'Eckgrundstück Elm Street', 'Elm Street', 29, 16, 6, 6, { i: 32, j: 22 }, 'gross'),
  lot('grund-birke', 'Grundstück Birch Road 3', 'Birch Road', 1, 26, 4, 4, { i: 3, j: 30 }, 'klein'),
  lot('grund-sued-1', 'Grundstück Birch Road 17', 'Birch Road', 15, 26, 4, 4, { i: 17, j: 30 }, 'klein'),
  lot('grund-sued-2', 'Grundstück Birch Road 22', 'Birch Road', 20, 26, 5, 4, { i: 22, j: 30 }, 'mittel'),
  {
    id: 'park', name: 'Stadtpark', street: 'Birch Road', kind: 'park', i: 29, j: 26, w: 11, d: 4, entry: { i: 34, j: 30 },
    
  },
];

export const parcelById = (id: string) => PARCELS.find((p) => p.id === id);

/** Die beiden Räume des Elternhauses. Beide kosten nichts. */
export const HOME_ROOMS: LocationId[] = ['kinderzimmer', 'garage'];

export const parcelOfLocation = (locationId: LocationId): Parcel | undefined =>
  HOME_ROOMS.includes(locationId) ? parcelById('elternhaus') : PARCELS.find((p) => p.locationId === locationId);

export const startTown = (locationId: LocationId): TownState => {
  const site = parcelOfLocation(locationId) ?? parcelById('elternhaus')!;
  return { siteId: site.id, owned: [], rented: site.kind === 'vacant' ? [site.id] : [], built: [], furnished: [locationId] };
};

/* ---------- Straßen ---------- */

const ROADS_I = [12, 13, 26, 27];
const ROADS_J = [3, 4, 13, 14, 23, 24, 31, 32];

export type TileKind = 'road' | 'sidewalk' | 'grass';

export function tileKind(i: number, j: number): TileKind {
  if (ROADS_I.includes(i) || ROADS_J.includes(j)) return 'road';
  if (ROADS_I.includes(i - 1) || ROADS_I.includes(i + 1) || ROADS_J.includes(j - 1) || ROADS_J.includes(j + 1)) return 'sidewalk';
  return 'grass';
}

export const STREET_LABELS: { name: string; i: number; j: number }[] = [
  { name: 'Main Street', i: 6, j: 14 },
  { name: 'Maple Avenue', i: 20, j: 24 },
  { name: 'Pine Lane', i: 22, j: 4 },
  { name: 'Birch Road', i: 8, j: 32 },
  { name: 'Oak Street', i: 13, j: 9 },
  { name: 'Elm Street', i: 27, j: 19 },
];

export const inTown = (t: TownTile) => t.i >= 0 && t.j >= 0 && t.i < TOWN_W && t.j < TOWN_D;
export const inParcel = (p: Pick<Parcel, 'i' | 'j' | 'w' | 'd'>, t: TownTile) => t.i >= p.i && t.j >= p.j && t.i < p.i + p.w && t.j < p.j + p.d;

const scatter = (i: number, j: number) => {
  const h = Math.imul(i * 73 + j * 151 + 11, 2654435761) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

/** Bäume stehen auf freiem Gras, nie auf einem Grundstück. Sie sehen auf jedem Rechner gleich aus. */
export const TREES: TownTile[] = (() => {
  const out: TownTile[] = [];
  for (let i = 0; i < TOWN_W; i++) {
    for (let j = 0; j < TOWN_D; j++) {
      if (tileKind(i, j) !== 'grass') continue;
      const inside = PARCELS.find((p) => inParcel(p, { i, j }));
      if (inside?.kind === 'park' ? scatter(i, j) < 0.3 : !inside && scatter(i, j) < 0.34) out.push({ i, j });
    }
  }
  return out;
})();

/** Gebäude und Bäume versperren den Weg. Freie Grundstücke darf man betreten. */
export const TOWN_BLOCKED: Set<string> = (() => {
  const blocked = new Set<string>(TREES.map((t) => `${t.i},${t.j}`));
  for (const p of PARCELS) {
    const b = p.building;
    if (!b) continue;
    for (let a = 0; a < b.w; a++) for (let c = 0; c < b.d; c++) blocked.add(`${b.i + a},${b.j + c}`);
  }
  return blocked;
})();

/** Woran die Figur gerade steht: im Grundstück oder direkt vor seinem Eingang. */
export function parcelNear(t: TownTile): Parcel | null {
  const atEntry = PARCELS.filter((p) => Math.abs(p.entry.i - t.i) + Math.abs(p.entry.j - t.j) <= 1);
  if (atEntry.length) return atEntry.sort((a, b) => Math.abs(a.entry.i - t.i) + Math.abs(a.entry.j - t.j) - (Math.abs(b.entry.i - t.i) + Math.abs(b.entry.j - t.j)))[0];
  return PARCELS.find((p) => inParcel(p, t)) ?? null;
}
