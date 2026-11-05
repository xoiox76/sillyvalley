// Anbau und Stockwerke. Server, Ansicht und Welt rechnen mit denselben Grössen.

import { locationById, type LocationInfo } from './catalog.ts';
import { checkPlacement, footprint, inBounds, occupiedTiles, type PlacementCheck, type Tile } from './layout.ts';
import type { Building, Company, FurnitureKind, LocationId, PlacedItem, Rotation, Shaft, TownState } from './types.ts';

export interface BuildLimits {
  /** Felder, um die das Haus höchstens breiter und tiefer werden kann. */
  w: number;
  d: number;
  floors: number;
}

/** Was das Grundstück hergibt. Gemietete Läden und das Elternhaus gehören dir nicht und stehen hier nicht. */
const LIMITS: Partial<Record<LocationId, BuildLimits>> = {
  'neubau-klein': { w: 3, d: 2, floors: 2 },
  'neubau-mittel': { w: 3, d: 3, floors: 3 },
  'neubau-gross': { w: 4, d: 3, floors: 4 },
};

export const buildLimits = (locationId: string): BuildLimits | null => LIMITS[locationId as LocationId] ?? null;

export const EXTEND_COST = 50;
/** Jedes Stockwerk kostet mehr als das darunter. */
export const floorCost = (floor: number) => 150 * floor;

export const SHAFT_COST: Record<Shaft['kind'], number> = { stairs: 40, lift: 120 };
export const isShaft = (kind: FurnitureKind | string): kind is Shaft['kind'] => kind === 'stairs' || kind === 'lift';

const NO_BUILDING: Building = { w: 0, d: 0, floors: 1, shafts: [] };

export const buildingAt = (town: Pick<TownState, 'buildings'>, siteId: string): Building => town.buildings?.[siteId] ?? NO_BUILDING;

/** Der Grundriss einer Etage. Oben kommt man über die Treppe an, und der Platz davor bleibt immer frei. */
export function roomAt(locationId: LocationId, building: Building, floor = 0): LocationInfo {
  const loc = locationById(locationId);
  const w = loc.w + building.w;
  const first = building.shafts[0]?.landing;
  // Die Tür bleibt in der Wand zur Strasse: Baut man nach vorn an, wandert sie mit.
  const groundDoor = { i: loc.door.i, j: loc.door.j + building.d };
  return { ...loc, w, d: loc.d + building.d, door: floor > 0 && first ? first : groundDoor, keep: building.shafts.map((s) => s.landing) };
}

/** Jeder Standort hat seinen eigenen Bereich an Etagen: 0 bis 99 der Firmensitz, ab 100 der erste weitere und so fort. */
export const SITE_STEP = 100;
export const storeyOf = (floor: number) => floor % SITE_STEP;
export const siteBase = (floor: number) => floor - storeyOf(floor);

/** Welcher Standort zu einer Etage gehört. */
export function siteAt(company: Pick<Company, 'locationId' | 'town'>, floor = 0): { siteId: string; locationId: LocationId } {
  const extra = floor >= SITE_STEP ? company.town.extra?.[Math.floor(floor / SITE_STEP) - 1] : null;
  return extra ?? { siteId: company.town.siteId, locationId: company.locationId };
}

/** Das Erdgeschoss eines Standorts, oder null, wenn die Firma dort noch nicht arbeitet. */
export function baseFloorOf(company: Pick<Company, 'town'>, siteId: string): number | null {
  if (company.town.siteId === siteId) return 0;
  const index = company.town.extra?.findIndex((s) => s.siteId === siteId) ?? -1;
  return index < 0 ? null : (index + 1) * SITE_STEP;
}

export function roomOf(company: Pick<Company, 'locationId' | 'town'>, floor = 0): LocationInfo {
  const site = siteAt(company, floor);
  return roomAt(site.locationId, buildingAt(company.town, site.siteId), storeyOf(floor));
}

export const floorOf = (item: { floor?: number }) => item.floor ?? 0;
export const itemsOnFloor = (items: PlacedItem[], floor: number) => items.filter((p) => floorOf(p) === floor);
export const floorName = (floor: number) => (floor % 100 === 0 ? 'EG' : `${floor % 100}. OG`);

/** Das Feld vor einem Aufgang. Die Drehung wählt die Seite. */
export function shaftLanding(kind: Shaft['kind'], i: number, j: number, rot: Rotation): Tile {
  const { w, d } = footprint(kind);
  return [{ i: i + w, j }, { i, j: j + d }, { i: i - 1, j }, { i, j: j - 1 }][rot];
}

/** Ein Aufgang geht durch alle Etagen. Er muss also überall passen, und der Platz davor muss überall frei sein. */
export function checkShaft(company: Pick<Company, 'locationId' | 'town' | 'placed'>, shaft: { kind: Shaft['kind']; i: number; j: number; rot: Rotation }): PlacementCheck {
  const building = buildingAt(company.town, company.town.siteId);
  const landing = shaftLanding(shaft.kind, shaft.i, shaft.j, shaft.rot);
  for (let floor = 0; floor < building.floors; floor++) {
    const base = roomAt(company.locationId, building, floor);
    if (!inBounds(base, landing)) return { ok: false, reason: 'Davor muss ein freies Feld im Raum liegen. Drehen wählt die Seite.' };
    const items = itemsOnFloor(company.placed, floor);
    if (items.some((p) => occupiedTiles(p).some((t) => t.i === landing.i && t.j === landing.j))) return { ok: false, reason: `Davor muss ein Feld frei bleiben${building.floors > 1 ? ` (${floorName(floor)})` : ''}. Drehen wählt die Seite.` };
    const room = { ...base, keep: [...(base.keep ?? []), landing] };
    const check = checkPlacement(room, items, { kind: shaft.kind, i: shaft.i, j: shaft.j, rot: 0 });
    if (!check.ok) return { ok: false, reason: building.floors > 1 ? `${floorName(floor)}: ${check.reason}` : check.reason };
  }
  return { ok: true, reason: '' };
}
