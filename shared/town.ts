// Der Stadtplan von Silly Valley. Server und Client nutzen dieselben Grundstücke und Wege,
// damit das, was die Karte anbietet, auch dem entspricht, was das Spiel zulässt.

import type { Company, LocationId, TownState } from './types.ts';

/**
 * Wie viele Agenten eine Firma betreibt, bestimmt, welche Räume sich lohnen. Wer zu zweit ist, braucht
 * keinen Neubau mit drei Stockwerken, sondern zieht erst in einen leeren Laden.
 */
export const TEAM_FOR: Partial<Record<LocationId, number>> = {
  eckladen: 2,
  coworking: 3,
  buero: 4,
  fabrik: 6,
  'neubau-klein': 5,
  kino: 7,
  'neubau-mittel': 9,
  'neubau-gross': 14,
};
export const teamFor = (locationId: LocationId | undefined): number => (locationId ? (TEAM_FOR[locationId] ?? 0) : 0);
/** Ein weiteres Stockwerk lohnt sich ab vier Agenten je Stockwerk, das schon steht. */
export const teamForFloor = (floors: number): number => 4 * floors;
export const teamSize = (company: Pick<Company, 'agents'>): number => company.agents.filter((a) => a.hired && !a.firedAt).length;

export const TOWN_NAME = 'Silicon Valley';

export interface TownTile {
  i: number;
  j: number;
}

export type ParcelKind = 'home' | 'house' | 'shop' | 'office' | 'vacant' | 'lot' | 'park';

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
  /** Alter Preis aus der Baupunkte-Zeit. Wird nicht mehr verlangt, bleibt für alte Spielstände. */
  price?: number;
  /** Bei Grundstücken: Kosten des Baus. */
  buildCost?: number;
  /** Der Raum, in dem die Firma hier sitzt. */
  locationId?: LocationId;
}

/* ---------- Die Karte ---------- */

// Ein Feld der Stadt ist so gross wie ein Feld im Büro. Darum passt jedes Haus zu dem Raum, der in ihm liegt.
const ROAD = 4;
const WALK = 2;
const BLOCK_W = 46;
const BLOCK_D = 20;
const PITCH_I = BLOCK_W + ROAD + WALK * 2;
const PITCH_J = BLOCK_D + ROAD + WALK * 2;
const CITY_COLS = 2;
const CITY_ROWS = 2;
const CITY_W = CITY_COLS * PITCH_I + ROAD + WALK * 2;
const CITY_D = CITY_ROWS * PITCH_J + ROAD + WALK * 2;
const CITY_GAP = 24;
const FREEWAY_J = 14;
const TOP_ROW = 28;
const CAMINO_J = TOP_ROW + CITY_D + 2;
const BOTTOM_ROW = CAMINO_J + ROAD + 10;
export const TOWN_W = 8 + 3 * CITY_W + 2 * CITY_GAP + 8;
export const TOWN_D = BOTTOM_ROW + CITY_D + 14;
/** Hinter dem Highway liegt die Bay, im Süden beginnen die Hügel. */
const BAY_D = 10;
const HILLS_J = TOWN_D - 12;

export interface City {
  id: string;
  name: string;
  i: number;
  j: number;
  /** Strassen entlang i, von oben nach unten. */
  streets: string[];
}

const cityAt = (id: string, name: string, col: number, row: number, streets: string[]): City => ({ id, name, i: 8 + col * (CITY_W + CITY_GAP), j: row ? BOTTOM_ROW : TOP_ROW, streets });

// Lage wie im Original: an der Bay von Menlo Park über Palo Alto und Mountain View, darunter Cupertino, Sunnyvale und San José.
export const CITIES: City[] = [
  cityAt('menlo', 'Menlo Park', 0, 0, ['Santa Cruz Avenue', 'Ravenswood Avenue', 'Middlefield Road']),
  cityAt('paloalto', 'Palo Alto', 1, 0, ['University Avenue', 'Hamilton Avenue', 'California Avenue']),
  cityAt('mountainview', 'Mountain View', 2, 0, ['Castro Street', 'Dana Street', 'Shoreline Boulevard']),
  cityAt('cupertino', 'Cupertino', 0, 1, ['Stevens Creek Boulevard', 'De Anza Boulevard', 'Homestead Road']),
  cityAt('sunnyvale', 'Sunnyvale', 1, 1, ['Murphy Avenue', 'Evelyn Avenue', 'Mathilda Avenue']),
  cityAt('sanjose', 'San José', 2, 1, ['Santa Clara Street', 'San Carlos Street', 'First Street']),
];

const CELL = new Uint8Array(TOWN_W * TOWN_D);
const MARK = new Uint8Array(TOWN_W * TOWN_D);
const CELL_ROAD = 1;
const CELL_WALK = 2;
const CELL_WATER = 3;
const MARK_LINE_I = 1;
const MARK_LINE_J = 2;
const MARK_CROSSWALK = 4;
const at = (i: number, j: number) => j * TOWN_W + i;
const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < TOWN_W && j < TOWN_D;

function roadAlongI(from: number, to: number, j: number, width = ROAD): void {
  for (let i = Math.max(0, from); i < Math.min(TOWN_W, to); i++) {
    for (let k = 0; k < width; k++) if (inside(i, j + k)) CELL[at(i, j + k)] = CELL_ROAD;
    if (inside(i, j + width / 2)) MARK[at(i, j + width / 2)] |= MARK_LINE_I;
  }
}

function roadAlongJ(i: number, from: number, to: number, width = ROAD): void {
  for (let j = Math.max(0, from); j < Math.min(TOWN_D, to); j++) {
    for (let k = 0; k < width; k++) if (inside(i + k, j)) CELL[at(i + k, j)] = CELL_ROAD;
    if (inside(i + width / 2, j)) MARK[at(i + width / 2, j)] |= MARK_LINE_J;
  }
}

roadAlongI(0, TOWN_W, FREEWAY_J, 8);
roadAlongI(0, TOWN_W, CAMINO_J, ROAD);
for (const city of CITIES) {
  for (let r = 0; r <= CITY_ROWS; r++) roadAlongI(city.i, city.i + CITY_W, city.j + r * PITCH_J);
  for (let c = 0; c <= CITY_COLS; c++) {
    const i = city.i + c * PITCH_I;
    // Jede Querstrasse führt bis zum Highway oder zu El Camino Real.
    if (city.j === TOP_ROW) roadAlongJ(i, FREEWAY_J, CAMINO_J + ROAD);
    else roadAlongJ(i, CAMINO_J, city.j + CITY_D - WALK * 2);
  }
}
// Der Bordstein läuft um jede Strasse. Keine Mittellinie auf Kreuzungen, dafür Zebrastreifen an ihren Rändern.
for (let i = 0; i < TOWN_W; i++) {
  for (let j = 0; j < TOWN_D; j++) {
    if (CELL[at(i, j)] === CELL_ROAD) {
      const crossing = (inside(i, j - 3) && CELL[at(i, j - 3)] === CELL_ROAD && inside(i, j + 3) && CELL[at(i, j + 3)] === CELL_ROAD) && (inside(i - 3, j) && CELL[at(i - 3, j)] === CELL_ROAD && inside(i + 3, j) && CELL[at(i + 3, j)] === CELL_ROAD);
      if (crossing) MARK[at(i, j)] = 0;
      continue;
    }
    if (j < BAY_D) {
      CELL[at(i, j)] = CELL_WATER;
      continue;
    }
    let near = false;
    for (let a = -WALK; a <= WALK && !near; a++) for (let b = -WALK; b <= WALK && !near; b++) near = inside(i + a, j + b) && CELL[at(i + a, j + b)] === CELL_ROAD;
    if (near) CELL[at(i, j)] = CELL_WALK;
  }
}

export type TileKind = 'road' | 'bridge' | 'sidewalk' | 'grass' | 'water' | 'beach' | 'sand' | 'rock' | 'snow' | 'forest' | 'field';

function coreKind(i: number, j: number): TileKind {
  const cell = CELL[at(i, j)];
  return cell === CELL_ROAD ? 'road' : cell === CELL_WALK ? 'sidewalk' : cell === CELL_WATER ? 'water' : 'grass';
}

/** Die Mittellinie einer Strasse an diesem Feld. */
const coreLane = (i: number, j: number) => (inside(i, j) ? { alongI: Boolean(MARK[at(i, j)] & MARK_LINE_I), alongJ: Boolean(MARK[at(i, j)] & MARK_LINE_J), crosswalk: Boolean(MARK[at(i, j)] & MARK_CROSSWALK) } : { alongI: false, alongJ: false, crosswalk: false });

/* ---------- Grundstücke ---------- */

/** Abstand eines Hauses zur Strasse. So bleibt vorn Platz für den Weg zum Gehweg. */
export const FRONT_YARD = 2;

/** Wo ein Haus dieser Grösse auf seinem Grundstück steht: mittig und zur Strasse hin. Auch das Büro liegt genau dort. */
export function roomBox(p: Pick<Parcel, 'i' | 'j' | 'w' | 'd'>, w: number, d: number): { i: number; j: number; w: number; d: number } {
  return { i: p.i + Math.floor((p.w - w) / 2), j: p.j + p.d - FRONT_YARD - d, w, d };
}

/** Eine Zeile Grundstücke an der Vorderkante eines Blocks. Was nicht benannt ist, füllt die Reihe auf. */
interface Plot {
  id?: string;
  name?: string;
  kind: ParcelKind;
  w: number;
  d: number;
  /** Grösse des Gebäudes. Bei Läden die des Raums darin. */
  bw?: number;
  bd?: number;
  /** Wo die Haustür sitzt, in Feldern ab der linken Hausecke. */
  doorI?: number;
  color?: string;
  accent?: string;
  price?: number;
  buildCost?: number;
  locationId?: LocationId;
}

const LOT_PLAN = {
  klein: { w: 15, d: 13, doorI: 4, price: 60, buildCost: 100, locationId: 'neubau-klein' },
  mittel: { w: 19, d: 15, doorI: 6, price: 100, buildCost: 180, locationId: 'neubau-mittel' },
  gross: { w: 23, d: 17, doorI: 7, price: 180, buildCost: 320, locationId: 'neubau-gross' },
} as const;

const lotPlot = (id: string, name: string, size: keyof typeof LOT_PLAN): Plot => ({ id, name, kind: 'lot', ...LOT_PLAN[size] });
const shopPlot = (id: string, name: string, w: number, color: string, accent: string): Plot => ({ id, name, kind: 'shop', w: w + 2, d: 13, bw: w, bd: 9, color, accent });
const vacantPlot = (id: string, name: string, bw: number, bd: number, doorI: number, price: number, locationId: LocationId, color: string): Plot =>
  ({ id, name, kind: 'vacant', w: bw + 2, d: bd + FRONT_YARD + 2, bw, bd, doorI, price, locationId, color, accent: '#8d97a3' });

/** Benannte Grundstücke je Stadt und Block: [Spalte, Reihe, Grundstücke]. Die ids bleiben, damit alte Spielstände stimmen. */
const NAMED: Record<string, [number, number, Plot[]][]> = {
  paloalto: [
    [0, 0, [{ id: 'elternhaus', name: 'Elternhaus', kind: 'home', w: 22, d: 15, bw: 12, bd: 9, color: '#c9b79a', accent: '#8a4438' }]],
    [1, 0, [shopPlot('diner', "Dottie's Diner", 10, '#b5493f', '#f2efe4'), vacantPlot('eckladen', 'Eckladen', 9, 7, 4, 60, 'eckladen', '#a7907a'), shopPlot('eisenwaren', "Hank's Eisenwaren", 11, '#5f7f93', '#e4792b')]],
    [0, 1, [lotPlot('grund-maple-west', 'Grundstück Hamilton Avenue 12', 'mittel')]],
    [1, 1, [{ id: 'park', name: 'Stadtpark', kind: 'park', w: 44, d: 18 }]],
  ],
  mountainview: [
    [0, 0, [shopPlot('friseur', 'Salon Rosie', 10, '#c58aa4', '#f2efe4'), vacantPlot('postamt', 'Altes Postamt', 11, 9, 5, 150, 'buero', '#9c8f7c'), shopPlot('apotheke', 'Apotheke', 10, '#6fa58d', '#f2efe4')]],
    [1, 0, [vacantPlot('kino', 'Altes Kino', 13, 10, 6, 260, 'kino', '#7d6a8c')]],
    [0, 1, [lotPlot('grund-elm', 'Eckgrundstück Dana Street', 'gross')]],
  ],
  cupertino: [
    [0, 0, [lotPlot('grund-birke', 'Grundstück De Anza 3', 'klein')]],
    [1, 0, [vacantPlot('fabrik', 'Alte Fabrikhalle', 16, 12, 8, 0, 'fabrik', '#8a4a3a')]],
  ],
  menlo: [[1, 1, [lotPlot('grund-sued-1', 'Grundstück Ravenswood 17', 'klein')]]],
  sunnyvale: [
    [0, 0, [vacantPlot('coworking', 'Shared Office im Hinterhof', 10, 8, 5, 0, 'coworking', '#6f8a7a')]],
    [1, 0, [lotPlot('grund-sued-2', 'Grundstück Murphy Avenue 22', 'mittel')]],
  ],
};

const scatter = (i: number, j: number) => {
  const h = Math.imul(i * 73 + j * 151 + 11, 2654435761) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

const HOUSE_COLORS: [string, string][] = [['#b8c4c9', '#54606b'], ['#d3c4a2', '#7a4f3a'], ['#a9bfa4', '#5a5148'], ['#c7a9a0', '#54606b'], ['#cfd0c4', '#7a4f3a'], ['#b5c3d1', '#5a5148'], ['#d9c8a8', '#8a4438'], ['#bcae9e', '#54606b']];
const SHOP_COLORS: [string, string][] = [['#b5493f', '#f2efe4'], ['#5f7f93', '#e4792b'], ['#c58aa4', '#f2efe4'], ['#6fa58d', '#f2efe4'], ['#a7907a', '#2f6f62'], ['#7d6a8c', '#f8d34a']];
const OFFICE_COLORS: [string, string][] = [['#c8d2d0', '#2f6f62'], ['#b9c6d6', '#3f7fd0'], ['#d6cfc2', '#b5493f'], ['#c3cbd6', '#54606b']];

/** Womit eine Reihe aufgefüllt wird. Jede Stadt hat ihren Charakter: Wohnviertel, Hauptstrasse oder Bürocampus. */
function fillerFor(cityId: string, col: number, row: number, seed: number): Plot {
  const pick = <T,>(list: T[]) => list[Math.floor(scatter(seed, col * 7 + row * 13) * list.length)];
  const shopping = (cityId === 'paloalto' && row === 0 && col === 1) || (cityId === 'mountainview' && row === 0) || (cityId === 'sanjose' && row === 0) || (cityId === 'sunnyvale' && col === 0 && row === 0);
  const campus = (cityId === 'mountainview' && row === 1) || cityId === 'sunnyvale' || (cityId === 'sanjose' && row === 1) || (cityId === 'cupertino' && row === 1 && col === 1);
  if (shopping) {
    const [color, accent] = pick(SHOP_COLORS);
    return { kind: 'shop', name: 'Geschäft', w: 12, d: 13, bw: 10, bd: 9, color, accent };
  }
  if (campus) {
    const [color, accent] = pick(OFFICE_COLORS);
    return { kind: 'office', name: 'Bürohaus', w: 22, d: 15, bw: 20, bd: 11, color, accent };
  }
  const [color, accent] = pick(HOUSE_COLORS);
  return { kind: 'house', name: 'Wohnhaus', w: 14, d: 13, bw: 10, bd: 8, color, accent };
}

function buildParcels(): Parcel[] {
  const out: Parcel[] = [];
  for (const city of CITIES) {
    for (let col = 0; col < CITY_COLS; col++) {
      for (let row = 0; row < CITY_ROWS; row++) {
        const blockI = city.i + col * PITCH_I + ROAD + WALK;
        const blockJ = city.j + row * PITCH_J + ROAD + WALK;
        const street = city.streets[row + 1];
        const named = NAMED[city.id]?.find(([c, r]) => c === col && r === row)?.[2] ?? [];
        let cursor = blockI + 1;
        let seed = blockI * 3 + blockJ;
        const place = (plot: Plot, id: string) => {
          const j = blockJ + BLOCK_D - plot.d;
          const bw = plot.bw ?? 0;
          const bd = plot.bd ?? 0;
          const box = bw ? roomBox({ i: cursor, j, w: plot.w, d: plot.d }, bw, bd) : null;
          const size = plot.kind === 'lot' ? LOT_PLAN[plot.locationId === 'neubau-klein' ? 'klein' : plot.locationId === 'neubau-mittel' ? 'mittel' : 'gross'] : null;
          const entryI = box ? box.i + (plot.doorI ?? Math.floor(bw / 2)) : size ? roomBox({ i: cursor, j, w: plot.w, d: plot.d }, plot.w - 4, plot.d - FRONT_YARD - 3).i + size.doorI : cursor + Math.floor(plot.w / 2);
          out.push({
            id, name: plot.name ?? 'Grundstück', street, kind: plot.kind, i: cursor, j, w: plot.w, d: plot.d, entry: { i: entryI, j: blockJ + BLOCK_D },
            ...(box ? { building: { ...box, color: plot.color ?? '#c9b79a', accent: plot.accent ?? '#8a4438' } } : {}),
            ...(plot.price ? { price: plot.price } : {}), ...(plot.buildCost ? { buildCost: plot.buildCost } : {}), ...(plot.locationId ? { locationId: plot.locationId } : {}),
          });
          cursor += plot.w + 1;
        };
        for (const plot of named) place(plot, plot.id!);
        const end = blockI + BLOCK_W - 1;
        for (let n = 0; n < 12; n++) {
          const plot = fillerFor(city.id, col, row, seed + n);
          if (cursor + plot.w > end) break;
          place(plot, `${city.id}-${col}-${row}-${n}`);
        }
      }
    }
  }
  return out;
}

export const PARCELS: Parcel[] = buildParcels();
const PARCEL_BY_ID = new Map(PARCELS.map((p) => [p.id, p]));

/** Die beiden Räume des Elternhauses. Beide kosten nichts. */
export const HOME_ROOMS: LocationId[] = ['kinderzimmer', 'garage'];

export const parcelOfLocation = (locationId: LocationId): Parcel | undefined =>
  HOME_ROOMS.includes(locationId) ? parcelById('elternhaus') : PARCELS.find((p) => p.locationId === locationId);

export const startTown = (locationId: LocationId): TownState => {
  const site = parcelOfLocation(locationId) ?? parcelById('elternhaus')!;
  return { siteId: site.id, owned: [], rented: site.kind === 'vacant' ? [site.id] : [], built: [], furnished: [locationId] };
};

const PARCEL_AT = new Int32Array(TOWN_W * TOWN_D).fill(-1);
PARCELS.forEach((p, index) => {
  for (let i = p.i; i < p.i + p.w; i++) for (let j = p.j; j < p.j + p.d; j++) if (inside(i, j)) PARCEL_AT[at(i, j)] = index;
});

const coreParcelAt = (i: number, j: number): Parcel | null => (PARCEL_AT[at(i, j)] >= 0 ? PARCELS[PARCEL_AT[at(i, j)]] : null);

const coreCityOf = (i: number, j: number): City | null => CITIES.find((c) => i >= c.i - CITY_GAP / 2 && i < c.i + CITY_W + CITY_GAP / 2 && j >= c.j - 10 && j < c.j + CITY_D + 7) ?? null;

export const STREET_LABELS: { name: string; i: number; j: number }[] = [
  { name: 'Highway 101', i: 60, j: FREEWAY_J + 4 },
  { name: 'Highway 101', i: 200, j: FREEWAY_J + 4 },
  { name: 'Highway 101', i: 340, j: FREEWAY_J + 4 },
  { name: 'El Camino Real', i: 60, j: CAMINO_J + 2 },
  { name: 'El Camino Real', i: 200, j: CAMINO_J + 2 },
  { name: 'El Camino Real', i: 340, j: CAMINO_J + 2 },
  ...CITIES.flatMap((city) => city.streets.map((name, row) => ({ name, i: city.i + 26, j: city.j + row * PITCH_J + 2 }))),
];


export const inParcel = (p: Pick<Parcel, 'i' | 'j' | 'w' | 'd'>, t: TownTile) => t.i >= p.i && t.j >= p.j && t.i < p.i + p.w && t.j < p.j + p.d;

/** Bäume stehen auf freiem Gras und im Park, dicht in den Hügeln. Sie sehen auf jedem Rechner gleich aus. */
export const TREES: TownTile[] = (() => {
  const out: TownTile[] = [];
  for (let i = 0; i < TOWN_W; i++) {
    for (let j = 0; j < TOWN_D; j++) {
      if (coreKind(i, j) !== 'grass') continue;
      const inPlot = coreParcelAt(i, j);
      const chance = inPlot ? (inPlot.kind === 'park' ? 0.1 : 0) : j >= HILLS_J ? 0.22 : 0.035;
      if (scatter(i, j) < chance) out.push({ i, j });
    }
  }
  return out;
})();

/** Gebäude, Bäume und Wasser versperren den Weg. Freie Grundstücke darf man betreten. */
export const TOWN_BLOCKED: Set<string> = (() => {
  const blocked = new Set<string>(TREES.map((t) => `${t.i},${t.j}`));
  for (const p of PARCELS) {
    const b = p.building;
    if (!b) continue;
    for (let a = 0; a < b.w; a++) for (let c = 0; c < b.d; c++) blocked.add(`${b.i + a},${b.j + c}`);
  }
  for (let i = 0; i < TOWN_W; i++) for (let j = 0; j < BAY_D; j++) blocked.add(`${i},${j}`);
  return blocked;
})();

/* ---------- Die Welt rund um das Tal ---------- */

// Das Tal in der Mitte ist von Hand angelegt. Alles darum entsteht aus der Lage auf der Karte: Dieselbe Stelle
// sieht auf jedem Rechner gleich aus, gespeichert wird nur, was jemand besitzt oder baut.
export const REGION = 192;
export const WORLD_RADIUS = 283;
const LINE = 4;
const MAX_REGIONS = 48;

export const inTown = (t: TownTile) => Math.abs(t.i) < WORLD_RADIUS * REGION && Math.abs(t.j) < WORLD_RADIUS * REGION;

const hash = (a: number, b: number, salt = 0) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(salt, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function valueNoise(x: number, y: number, salt: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, salt);
  const b = hash(xi + 1, yi, salt);
  const c = hash(xi, yi + 1, salt);
  const d = hash(xi + 1, yi + 1, salt);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const fbm = (x: number, y: number, salt: number) => valueNoise(x, y, salt) * 0.6 + valueNoise(x * 2.3, y * 2.3, salt + 1) * 0.28 + valueNoise(x * 5.1, y * 5.1, salt + 2) * 0.12;

/** Abstand zum Tal in Feldern. */
const coreDistance = (i: number, j: number) => Math.hypot(Math.max(0, -i, i - TOWN_W), Math.max(0, -j, j - TOWN_D));

export type DecorKind = 'tree' | 'pine' | 'peak' | 'snowpeak' | 'cactus';
export type Biome = 'water' | 'beach' | 'rock' | 'snow' | 'sand' | 'forest' | 'grass' | 'field';

/** Die Landschaft an einer Stelle: Im Norden liegt das Meer, dazu Seen, Gebirge, Wälder und Wüste. */
export function biomeAt(i: number, j: number): Biome {
  // Kontinente und Ozeane, darauf Landmassen und Küsten. Am Tal ist flaches Land, und nördlich davon liegt seine Bucht.
  let height = fbm(i / 16000, j / 16000, 91) * 0.5 + fbm(i / 900, j / 900, 11) * 0.34 + fbm(i / 170, j / 170, 13) * 0.16;
  const near = coreDistance(i, j);
  const calm = Math.min(1, near / 140);
  height = 0.56 + (height - 0.56) * calm;
  if (j < 0) height -= Math.min(0.4, -j / 200) * Math.max(0, 1 - near / 900);
  if (height < 0.46) return 'water';
  if (height < 0.47) return 'beach';
  // Flüsse und Gebirge folgen Linien in einer eigenen Höhenkarte, darum ziehen sie sich durchs Land.
  if (near > 60 && Math.abs(fbm(i / 420, j / 420, 61) - 0.5) < 0.0042) return 'water';
  const line = valueNoise(i / 520, j / 520, 23) * 0.8 + valueNoise(i / 140, j / 140, 29) * 0.2;
  const ridge = Math.abs(line - 0.5) / Math.max(0.01, calm * Math.min(1, Math.max(0, (fbm(i / 1100, j / 1100, 71) - 0.42) * 8)));
  if (ridge < 0.018) return 'snow';
  if (ridge < 0.042) return 'rock';
  const moisture = fbm(i / 420, j / 420, 47);
  if (moisture < 0.4) return 'sand';
  if (moisture > 0.57) return 'forest';
  return 'grass';
}

const NAME_A = ['Apple', 'Cedar', 'Oak', 'Silver', 'Harvest', 'Pine', 'Maple', 'Stone', 'River', 'Sun', 'Bay', 'Golden', 'Eagle', 'Willow', 'Crystal', 'Copper', 'Elm', 'Red', 'Blue', 'Fox', 'Timber', 'Oasis', 'Clear', 'North', 'South', 'Amber', 'Aspen', 'Birch', 'Canyon', 'Cotton', 'Deer', 'Dry', 'East', 'Fern', 'Flint', 'Glen', 'Granite', 'Hazel', 'Heron', 'Iron', 'Juniper', 'Lark', 'Long', 'Marsh', 'Mesa', 'Mill', 'New', 'Old', 'Otter', 'Quail', 'Raven', 'Rock', 'Rose', 'Sage', 'Salt', 'Sand', 'Shady', 'Spring', 'Summer', 'Walnut', 'West', 'White', 'Wild', 'Wolf'];
const NAME_B = ['wood', 'ton', 'field', ' Creek', ' Valley', ' Peak', ' Junction', 'port', ' Springs', 'ville', ' Heights', 'dale', 'brook', ' Plains', ' Harbor', ' Ridge'];
const STREET_NAMES = ['Main Street', 'Oak Avenue', 'Market Street', 'Park Road', 'Mill Lane', 'First Street', 'Lake Drive', 'Hill Road', 'Station Road', 'Elm Street'];

export interface Settlement extends City {
  size: 'city' | 'town' | 'village';
  cols: number;
  rows: number;
  rx: number;
  ry: number;
  w: number;
  d: number;
}

const isCoreRegion = (rx: number, ry: number) => ry === 0 && rx >= 0 && rx * REGION < TOWN_W;

/** Ob und welche Siedlung in einem Abschnitt der Karte liegt. Auf dem Wasser und im Hochgebirge entsteht keine. */
export function settlementIn(rx: number, ry: number): Settlement | null {
  if (isCoreRegion(rx, ry) || Math.abs(rx) >= WORLD_RADIUS || Math.abs(ry) >= WORLD_RADIUS) return null;
  const roll = hash(rx, ry, 101);
  const size = roll < 0.14 ? 'city' : roll < 0.42 ? 'town' : roll < 0.72 ? 'village' : null;
  if (!size) return null;
  const cols = size === 'city' ? 3 : size === 'town' ? 2 : 1;
  const rows = cols;
  const w = cols * PITCH_I + ROAD + WALK * 2;
  const d = rows * PITCH_J + ROAD + WALK * 2;
  const i = rx * REGION + Math.floor((REGION - LINE - w) / 2) + LINE;
  const j = ry * REGION + Math.floor((REGION - LINE - d) / 2) + LINE;
  const middle = biomeAt(i + w / 2, j + d / 2);
  if (middle === 'water' || middle === 'snow' || middle === 'rock') return null;
  const name = NAME_A[Math.floor(hash(rx, ry, 7) * NAME_A.length)] + NAME_B[Math.floor(hash(rx, ry, 8) * NAME_B.length)];
  const streets = Array.from({ length: rows + 1 }, (_, n) => STREET_NAMES[(Math.floor(hash(rx, ry, 9) * STREET_NAMES.length) + n) % STREET_NAMES.length]);
  return { id: `w${rx}_${ry}`, name, i, j, streets, size, cols, rows, rx, ry, w, d };
}

export interface Decor {
  i: number;
  j: number;
  kind: 'tree' | 'pine' | 'peak' | 'snowpeak' | 'cactus';
}

interface Region {
  rx: number;
  ry: number;
  settlement: Settlement | null;
  kinds: Uint8Array;
  marks: Uint8Array;
  parcelIndex: Int16Array;
  solid: Uint8Array;
  parcels: Parcel[];
  decor: Decor[];
}

const KINDS: TileKind[] = ['grass', 'road', 'bridge', 'sidewalk', 'water', 'beach', 'sand', 'rock', 'snow', 'forest', 'field'];
const KIND_INDEX = Object.fromEntries(KINDS.map((k, n) => [k, n])) as Record<TileKind, number>;
const regions = new Map<string, Region>();

function plotsFor(settlement: Settlement, col: number, row: number, seed: number): Plot {
  const roll = hash(seed, col * 7 + row * 13, 31);
  const pick = <T,>(list: T[]) => list[Math.floor(hash(seed, row, 37) * list.length)];
  if (roll < 0.1) return { ...lotPlot('', 'Grundstück', roll < 0.04 ? 'klein' : roll < 0.08 ? 'mittel' : 'gross') };
  if (roll < 0.16) return roll < 0.13 ? vacantPlot('', 'Leerer Laden', 9, 7, 4, 60, 'eckladen', pick(SHOP_COLORS)[0]) : vacantPlot('', 'Altes Postamt', 11, 9, 5, 150, 'buero', '#9c8f7c');
  const business = settlement.size === 'city' ? 0.8 : settlement.size === 'town' ? 0.45 : 0.12;
  if (hash(seed, col, 41) < business) {
    if (settlement.size === 'city' && hash(seed, col, 43) < 0.45) {
      const [color, accent] = pick(OFFICE_COLORS);
      return { kind: 'office', name: 'Bürohaus', w: 22, d: 15, bw: 20, bd: 11, color, accent };
    }
    const [color, accent] = pick(SHOP_COLORS);
    return { kind: 'shop', name: 'Geschäft', w: 12, d: 13, bw: 10, bd: 9, color, accent };
  }
  const [color, accent] = pick(HOUSE_COLORS);
  return { kind: 'house', name: 'Wohnhaus', w: 14, d: 13, bw: 10, bd: 8, color, accent };
}

function makeParcel(plot: Plot, id: string, street: string, cursor: number, blockJ: number): Parcel {
  const j = blockJ + BLOCK_D - plot.d;
  const bw = plot.bw ?? 0;
  const box = bw ? roomBox({ i: cursor, j, w: plot.w, d: plot.d }, bw, plot.bd ?? 0) : null;
  const lotDoor = plot.kind === 'lot' ? plot.doorI ?? 0 : 0;
  const entryI = box ? box.i + (plot.doorI ?? Math.floor(bw / 2)) : plot.kind === 'lot' ? roomBox({ i: cursor, j, w: plot.w, d: plot.d }, plot.w - 4, plot.d - FRONT_YARD - 3).i + lotDoor : cursor + Math.floor(plot.w / 2);
  return {
    id, name: plot.name ?? 'Grundstück', street, kind: plot.kind, i: cursor, j, w: plot.w, d: plot.d, entry: { i: entryI, j: blockJ + BLOCK_D },
    ...(box ? { building: { ...box, color: plot.color ?? '#c9b79a', accent: plot.accent ?? '#8a4438' } } : {}),
    ...(plot.price ? { price: plot.price } : {}), ...(plot.buildCost ? { buildCost: plot.buildCost } : {}), ...(plot.locationId ? { locationId: plot.locationId } : {}),
  };
}

function buildRegion(rx: number, ry: number): Region {
  const size = REGION * REGION;
  const kinds = new Uint8Array(size);
  const marks = new Uint8Array(size);
  const parcelIndex = new Int16Array(size).fill(-1);
  const solid = new Uint8Array(size);
  const x0 = rx * REGION;
  const y0 = ry * REGION;
  const local = (i: number, j: number) => (j - y0) * REGION + (i - x0);
  const here = (i: number, j: number) => i >= x0 && j >= y0 && i < x0 + REGION && j < y0 + REGION;
  const settlement = settlementIn(rx, ry);
  // Felder um Dörfer und Kleinstädte, sonst die Landschaft.
  for (let j = y0; j < y0 + REGION; j++) {
    for (let i = x0; i < x0 + REGION; i++) {
      let biome: Biome = biomeAt(i, j);
      if (settlement) {
        const out = Math.hypot(Math.max(0, settlement.i - i, i - settlement.i - settlement.w), Math.max(0, settlement.j - j, j - settlement.j - settlement.d));
        // Gebaut wird auf festem Grund, auch wenn dort sonst Wasser oder Fels wäre.
        if (out === 0) biome = 'grass';
        else if (out < 26 && settlement.size !== 'city' && (biome === 'forest' || biome === 'grass' || biome === 'sand')) biome = 'field';
      }
      kinds[local(i, j)] = KIND_INDEX[biome];
    }
  }
  const paintRoad = (i: number, j: number) => {
    if (!here(i, j)) return;
    const was = KINDS[kinds[local(i, j)]];
    kinds[local(i, j)] = KIND_INDEX[was === 'water' || was === 'bridge' ? 'bridge' : 'road'];
  };
  const alongI = (from: number, to: number, j: number, width = ROAD) => {
    for (let i = from; i < to; i++) {
      for (let k = 0; k < width; k++) paintRoad(i, j + k);
      if (here(i, j + width / 2)) marks[local(i, j + width / 2)] |= MARK_LINE_I;
    }
  };
  const alongJ = (i: number, from: number, to: number, width = ROAD) => {
    for (let j = from; j < to; j++) {
      for (let k = 0; k < width; k++) paintRoad(i + k, j);
      if (here(i + width / 2, j)) marks[local(i + width / 2, j)] |= MARK_LINE_J;
    }
  };
  // Landstrassen verbinden alle Abschnitte, über Wasser als Brücke.
  alongI(x0, x0 + REGION, y0);
  alongJ(x0, y0, y0 + REGION);
  // Highway und El Camino laufen aus dem Tal hinaus.
  if (ry === 0) {
    for (const [from, to] of [[Math.max(x0, TOWN_W), x0 + REGION], [x0, Math.min(x0 + REGION, 0)]]) {
      alongI(from, to, FREEWAY_J, 8);
      alongI(from, to, CAMINO_J);
    }
  }
  if (settlement) {
    for (let r = 0; r <= settlement.rows; r++) alongI(settlement.i, settlement.i + settlement.w, settlement.j + r * PITCH_J);
    for (let c = 0; c <= settlement.cols; c++) alongJ(settlement.i + c * PITCH_I, settlement.j, settlement.j + settlement.d - WALK * 2);
    // Der Anschluss an die Landstrassen.
    alongJ(settlement.i, y0, settlement.j);
    alongI(x0, settlement.i, settlement.j);
  }
  // Gehwege nur, wo Häuser stehen. Über Land ist die Strasse für sich.
  if (settlement) {
    for (let j = settlement.j - WALK; j < settlement.j + settlement.d + WALK; j++) {
      for (let i = settlement.i - WALK; i < settlement.i + settlement.w + WALK; i++) {
        if (!here(i, j) || KINDS[kinds[local(i, j)]] === 'road' || KINDS[kinds[local(i, j)]] === 'bridge') continue;
        let near = false;
        for (let a = -WALK; a <= WALK && !near; a++) for (let b = -WALK; b <= WALK && !near; b++) near = here(i + a, j + b) && KINDS[kinds[local(i + a, j + b)]] === 'road';
        if (near) kinds[local(i, j)] = KIND_INDEX.sidewalk;
      }
    }
  }
  const parcels: Parcel[] = [];
  if (settlement) {
    for (let col = 0; col < settlement.cols; col++) {
      for (let row = 0; row < settlement.rows; row++) {
        const blockI = settlement.i + col * PITCH_I + ROAD + WALK;
        const blockJ = settlement.j + row * PITCH_J + ROAD + WALK;
        let cursor = blockI + 1;
        const end = blockI + BLOCK_W - 1;
        for (let n = 0; n < 12; n++) {
          const plot = plotsFor(settlement, col, row, hash(rx * 31 + col, ry * 17 + row, n) * 1e6 | 0);
          if (cursor + plot.w > end) break;
          const id = `w${rx}_${ry}_${col}_${row}_${n}`;
          const parcel = makeParcel(plot, id, settlement.streets[row + 1], cursor, blockJ);
          for (let a = parcel.i; a < parcel.i + parcel.w; a++) for (let b = parcel.j; b < parcel.j + parcel.d; b++) if (here(a, b)) parcelIndex[local(a, b)] = parcels.length;
          const house = parcel.building;
          if (house) for (let a = house.i; a < house.i + house.w; a++) for (let b = house.j; b < house.j + house.d; b++) if (here(a, b)) solid[local(a, b)] = 1;
          parcels.push(parcel);
          cursor += plot.w + 1;
        }
      }
    }
  }
  const decor: Decor[] = [];
  for (let j = y0; j < y0 + REGION; j++) {
    for (let i = x0; i < x0 + REGION; i++) {
      if (parcelIndex[local(i, j)] >= 0 || inside(i, j)) continue;
      const kind = KINDS[kinds[local(i, j)]];
      const roll = hash(i, j, 3);
      if (kind === 'forest' && roll < 0.22) decor.push({ i, j, kind: hash(i, j, 5) < 0.6 ? 'pine' : 'tree' });
      else if (kind === 'grass' && roll < 0.018) decor.push({ i, j, kind: 'tree' });
      else if (kind === 'sand' && roll < 0.012) decor.push({ i, j, kind: 'cactus' });
      else if ((kind === 'rock' || kind === 'snow') && i % 4 === 0 && j % 4 === 0 && roll < 0.6) {
        decor.push({ i, j, kind: kind === 'snow' ? 'snowpeak' : 'peak' });
        // Ein Berg ist breiter als ein Feld, Strassen führen trotzdem durch.
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (here(i + a, j + b) && KINDS[kinds[local(i + a, j + b)]] !== 'road') solid[local(i + a, j + b)] = 1;
      }
    }
  }
  for (const t of decor) solid[local(t.i, t.j)] = 1;
  return { rx, ry, settlement, kinds, marks, parcelIndex, solid, parcels, decor };
}

let lastRegion: Region | null = null;

function regionOf(rx: number, ry: number): Region {
  if (lastRegion?.rx === rx && lastRegion.ry === ry) return lastRegion;
  const key = `${rx},${ry}`;
  let region = regions.get(key);
  if (region) {
    regions.delete(key);
  } else {
    region = buildRegion(rx, ry);
  }
  regions.set(key, region);
  if (regions.size > MAX_REGIONS) regions.delete(regions.keys().next().value!);
  lastRegion = region;
  return region;
}

const regionAt = (i: number, j: number) => regionOf(Math.floor(i / REGION), Math.floor(j / REGION));
const localIndex = (r: Region, i: number, j: number) => (j - r.ry * REGION) * REGION + (i - r.rx * REGION);

export function tileKind(i: number, j: number): TileKind {
  if (inside(i, j)) return coreKind(i, j);
  const region = regionAt(i, j);
  return KINDS[region.kinds[localIndex(region, i, j)]];
}

/** Die Mittellinie einer Strasse an diesem Feld. */
export function laneMark(i: number, j: number): { alongI: boolean; alongJ: boolean } {
  if (inside(i, j)) return coreLane(i, j);
  const region = regionAt(i, j);
  const mark = region.marks[localIndex(region, i, j)];
  const crossing = tileKind(i - 3, j) === 'road' && tileKind(i + 3, j) === 'road' && tileKind(i, j - 3) === 'road' && tileKind(i, j + 3) === 'road';
  return { alongI: !crossing && Boolean(mark & MARK_LINE_I), alongJ: !crossing && Boolean(mark & MARK_LINE_J) };
}

export function parcelAt(i: number, j: number): Parcel | null {
  if (inside(i, j)) return coreParcelAt(i, j);
  const region = regionAt(i, j);
  const index = region.parcelIndex[localIndex(region, i, j)];
  return index >= 0 ? region.parcels[index] : null;
}

/** Findet auch Grundstücke, die erst beim Hinsehen entstehen. Ihre Kennung nennt den Abschnitt der Karte. */
export function parcelById(id: string): Parcel | undefined {
  const known = PARCEL_BY_ID.get(id);
  if (known) return known;
  const match = id.match(/^w(-?\d+)_(-?\d+)_/);
  return match ? regionOf(Number(match[1]), Number(match[2])).parcels.find((p) => p.id === id) : undefined;
}

const regionsIn = (i0: number, j0: number, i1: number, j1: number) => {
  const out: Region[] = [];
  for (let ry = Math.floor(j0 / REGION); ry <= Math.floor(j1 / REGION); ry++) for (let rx = Math.floor(i0 / REGION); rx <= Math.floor(i1 / REGION); rx++) out.push(regionOf(rx, ry));
  return out;
};

const overlaps = (p: Parcel, i0: number, j0: number, i1: number, j1: number) => p.i <= i1 && p.j <= j1 && p.i + p.w >= i0 && p.j + p.d >= j0;

/** Die Grundstücke in einem Ausschnitt. */
export function parcelsIn(i0: number, j0: number, i1: number, j1: number): Parcel[] {
  const core = i0 < TOWN_W && j0 < TOWN_D && i1 >= 0 && j1 >= 0 ? PARCELS.filter((p) => overlaps(p, i0, j0, i1, j1)) : [];
  return [...core, ...regionsIn(i0, j0, i1, j1).flatMap((r) => r.parcels.filter((p) => overlaps(p, i0, j0, i1, j1)))];
}

export function decorIn(i0: number, j0: number, i1: number, j1: number): Decor[] {
  const core: Decor[] = i0 < TOWN_W && j0 < TOWN_D && i1 >= 0 && j1 >= 0 ? TREES.filter((t) => t.i >= i0 && t.j >= j0 && t.i <= i1 && t.j <= j1).map((t) => ({ ...t, kind: 'tree' })) : [];
  return [...core, ...regionsIn(i0, j0, i1, j1).flatMap((r) => r.decor.filter((t) => t.i >= i0 && t.j >= j0 && t.i <= i1 && t.j <= j1))];
}

/** Wasser, Gebäude und Bäume versperren den Weg. Brücken führen hinüber. */
export function isBlocked(i: number, j: number): boolean {
  if (!inTown({ i, j })) return true;
  if (inside(i, j)) return TOWN_BLOCKED.has(`${i},${j}`);
  const region = regionAt(i, j);
  const at2 = localIndex(region, i, j);
  return KINDS[region.kinds[at2]] === 'water' || region.solid[at2] === 1;
}

const PATH_OFFSET = WORLD_RADIUS * REGION + 1;
const PATH_SPAN = PATH_OFFSET * 2 + 1;

/** Wege auf der offenen Karte. Die Suche bleibt begrenzt, denn geklickt wird im sichtbaren Ausschnitt. */
export function townPath(from: TownTile, to: TownTile, blocked: (i: number, j: number) => boolean, limit = 60_000): TownTile[] {
  if (from.i === to.i && from.j === to.j) return [];
  const seen = new Map<number, number>();
  const code = (i: number, j: number) => (i + PATH_OFFSET) * PATH_SPAN + (j + PATH_OFFSET);
  const start = code(from.i, from.j);
  seen.set(start, start);
  const queue = [start];
  const goal = code(to.i, to.j);
  for (let head = 0; head < queue.length && queue.length < limit; head++) {
    const current = queue[head];
    if (current === goal) {
      const path: TownTile[] = [];
      let at2 = current;
      while (at2 !== start) {
        path.unshift({ i: Math.floor(at2 / PATH_SPAN) - PATH_OFFSET, j: (at2 % PATH_SPAN) - PATH_OFFSET });
        at2 = seen.get(at2)!;
      }
      return path;
    }
    const i = Math.floor(current / PATH_SPAN) - PATH_OFFSET;
    const j = (current % PATH_SPAN) - PATH_OFFSET;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = code(i + a, j + b);
      if (seen.has(next)) continue;
      if (next !== goal && blocked(i + a, j + b)) continue;
      seen.set(next, current);
      queue.push(next);
    }
  }
  return [];
}

/** In welcher Stadt ein Feld liegt. */
export function cityOf(i: number, j: number): City | null {
  if (coreDistance(i, j) < 12) return coreCityOf(i, j);
  const settlement = settlementIn(Math.floor(i / REGION), Math.floor(j / REGION));
  if (!settlement) return null;
  return Math.hypot(Math.max(0, settlement.i - i, i - settlement.i - settlement.w), Math.max(0, settlement.j - j, j - settlement.j - settlement.d)) < 20 ? settlement : null;
}

/** Alle Orte in einem Ausschnitt, fürs Schnellreisen und die Karte. */
export function placesIn(i0: number, j0: number, i1: number, j1: number): (City & { entry: TownTile })[] {
  const out: (City & { entry: TownTile })[] = [];
  for (const city of CITIES) {
    if (city.i < i1 && city.j < j1 && city.i + CITY_W > i0 && city.j + CITY_D > j0) out.push({ ...city, entry: { i: city.i + 26, j: city.j + 4 } });
  }
  for (let ry = Math.floor(j0 / REGION); ry <= Math.floor(j1 / REGION); ry++) {
    for (let rx = Math.floor(i0 / REGION); rx <= Math.floor(i1 / REGION); rx++) {
      const s = settlementIn(rx, ry);
      if (s) out.push({ ...s, entry: { i: s.i + 8, j: s.j + PITCH_J + ROAD } });
    }
  }
  return out;
}

/** Ein Ort nach seiner Kennung, auch einer, der erst beim Hinsehen entsteht. */
export function placeById(id: string): (City & { entry: TownTile }) | null {
  const match = id.match(/^w(-?\d+)_(-?\d+)$/);
  if (!match) return null;
  const s = settlementIn(Number(match[1]), Number(match[2]));
  return s ? { ...s, entry: { i: s.i + 8, j: s.j + PITCH_J + ROAD } } : null;
}

/** Was die Übersichtskarte an einer Stelle zeigt: ohne Häuser, damit sie schnell entsteht. */
export function mapKind(i: number, j: number): TileKind {
  if (inside(i, j)) return coreKind(i, j);
  if (((i % REGION) + REGION) % REGION < LINE || ((j % REGION) + REGION) % REGION < LINE) return 'road';
  return biomeAt(i, j);
}

/** Woran die Figur gerade steht: im Grundstück oder direkt vor seinem Eingang. */
export function parcelNear(t: TownTile): Parcel | null {
  const close = parcelsIn(t.i - 2, t.j - 2, t.i + 2, t.j + 2);
  const atEntry = close.filter((p) => Math.abs(p.entry.i - t.i) + Math.abs(p.entry.j - t.j) <= 1);
  if (atEntry.length) return atEntry.sort((a, b) => Math.abs(a.entry.i - t.i) + Math.abs(a.entry.j - t.j) - (Math.abs(b.entry.i - t.i) + Math.abs(b.entry.j - t.j)))[0];
  return close.find((p) => inParcel(p, t)) ?? null;
}
