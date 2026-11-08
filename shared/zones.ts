// Zonen: Räume aus Wänden und Türen, denen der Spieler einen Zweck und einen Namen gibt.
import { floorOf, itemsOnFloor, roomOf } from './building.ts';
import { FLAT, blockedSet, meetingSeats, regionOf, type Heights, type Seat, type Tile } from './layout.ts';
import type { Company, FloorStyle, PlacedItem, Zone, ZoneKind } from './types.ts';

type ZoneCompany = Pick<Company, 'locationId' | 'town' | 'placed' | 'zones'>;

const key = (t: Tile) => `${t.i},${t.j}`;

export const ZONE_KINDS: { kind: ZoneKind; title: string }[] = [
  { kind: 'meeting', title: 'Besprechungsraum' },
  { kind: 'break', title: 'Sozialbereich' },
  { kind: 'gaming', title: 'Gaming-Raum' },
  { kind: 'lobby', title: 'Lobby' },
  { kind: 'ceo', title: 'Chefbüro' },
  { kind: 'other', title: 'Eigener Raum' },
];

export const ZONE_COLORS: Record<ZoneKind, string> = { meeting: '#5eeac0', break: '#f8b62d', gaming: '#b07cf0', lobby: '#6fb3ff', ceo: '#e5534b', other: '#9fb0c8' };

export const FLOOR_STYLES: { style: FloorStyle; title: string }[] = [
  { style: 'holz', title: 'Holz' },
  { style: 'teppich', title: 'Teppich' },
  { style: 'fliesen', title: 'Fliesen' },
  { style: 'beton', title: 'Beton' },
  { style: 'parkett', title: 'Parkett' },
  { style: 'marmor', title: 'Marmor' },
  { style: 'teppichRot', title: 'Roter Teppich' },
  { style: 'linoleum', title: 'Linoleum' },
];

const paintKey = (floor: number, t: Tile) => `${floor}:${t.i},${t.j}`;

/** Der Boden eines Feldes: erst der einzeln verlegte, dann der des benannten Raums. undefined: der Boden des Hauses. */
export function floorStyleAt(company: Pick<Company, 'floorPaint'>, floor: number, tile: Tile): FloorStyle | undefined {
  return company.floorPaint?.[paintKey(floor, tile)];
}

/** Verlegt einen Belag auf Feldern. null nimmt ihn wieder weg. */
export function paintFloorTiles(company: Pick<Company, 'floorPaint'>, floor: number, tiles: Tile[], style: FloorStyle | null): void {
  const paint = { ...(company.floorPaint ?? {}) };
  for (const t of tiles) {
    if (style) paint[paintKey(floor, t)] = style;
    else delete paint[paintKey(floor, t)];
  }
  company.floorPaint = paint;
}

/** Höhe eines Feldes in Stufen. */
export function heightAt(company: Pick<Company, 'floorHeight'>, floor: number, tile: Tile): number {
  return company.floorHeight?.[paintKey(floor, tile)] ?? 0;
}

/** Die Höhen einer Etage als Funktion. Ohne Podeste flach. */
export function heightsOf(company: Pick<Company, 'floorHeight'>, floor: number): Heights {
  const prefix = `${floor}:`;
  if (!Object.keys(company.floorHeight ?? {}).some((k) => k.startsWith(prefix))) return FLAT;
  return (t) => heightAt(company, floor, t);
}

/** Setzt Felder auf eine Höhe. 0 entfernt das Podest. */
export function setTileHeights(company: Pick<Company, 'floorHeight'>, floor: number, tiles: Tile[], level: number): void {
  const next = { ...(company.floorHeight ?? {}) };
  for (const t of tiles) {
    if (level) next[paintKey(floor, t)] = level;
    else delete next[paintKey(floor, t)];
  }
  company.floorHeight = next;
}

/** Alle einzeln verlegten Felder einer Etage. */
export function paintedTiles(company: Pick<Company, 'floorPaint'>, floor: number): { i: number; j: number; style: FloorStyle }[] {
  const prefix = `${floor}:`;
  return Object.entries(company.floorPaint ?? {})
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, style]) => {
      const [i, j] = k.slice(prefix.length).split(',').map(Number);
      return { i, j, style };
    });
}

/** Wohin freie Agenten gern gehen, und woran sie sich dort aufhalten. */
export const LOUNGE_SPOTS: Partial<Record<ZoneKind, string[]>> = { break: ['coffee', 'sofa', 'beanbag'], gaming: ['arcade', 'beanbag', 'sofa'] };

/** Die Felder eines Raums um ein Feld, auf einer Etage. */
export function regionAt(company: ZoneCompany, floor: number, tile: Tile): Set<string> {
  return regionOf(roomOf(company, floor), itemsOnFloor(company.placed, floor), tile);
}

export function zoneTiles(company: ZoneCompany, zone: Zone): Set<string> {
  return regionAt(company, floorOf(zone), { i: zone.i, j: zone.j });
}

/** Die Zone, zu der ein Feld gehört. Ein Raum hat höchstens eine. */
export function zoneAt(company: ZoneCompany, floor: number, tile: Tile): Zone | undefined {
  return (company.zones ?? []).find((z) => floorOf(z) === floor && zoneTiles(company, z).has(key(tile)));
}

/** Ein eigener Raum: Der Eingang des Stockwerks liegt nicht darin. Sonst wäre es das ganze Büro. */
export function isSeparateRoom(company: ZoneCompany, floor: number, tile: Tile): boolean {
  return !regionAt(company, floor, tile).has(key(roomOf(company, floor).door));
}

/**
 * Ob ein Besprechungstisch nutzbar ist: Er steht in einer Besprechungszone, und alle vier Plätze
 * rundherum liegen im selben Raum und sind frei.
 */
export function tableReady(company: ZoneCompany, table: PlacedItem): boolean {
  const floor = floorOf(table);
  const zone = zoneAt(company, floor, { i: table.i, j: table.j });
  if (zone?.kind !== 'meeting') return false;
  const tiles = zoneTiles(company, zone);
  const blocked = blockedSet(roomOf(company, floor), itemsOnFloor(company.placed, floor));
  return roomSeats(table).every((s) => tiles.has(key(s.tile)) && !blocked.has(key(s.tile)));
}

/** Wo Besprechungen stattfinden können: der fertige Glasraum oder ein nutzbarer Besprechungstisch. */
export function meetingRooms(company: ZoneCompany): PlacedItem[] {
  return company.placed.filter((p) => p.kind === 'meeting' || (p.kind === 'table' && tableReady(company, p)));
}

/** Die vier Plätze um einen Tisch. Beim Glasraum stehen sie im Raum, beim Tisch rundherum. */
export function roomSeats(item: Pick<PlacedItem, 'kind' | 'i' | 'j' | 'rot'>): Seat[] {
  return item.kind === 'table' ? meetingSeats({ i: item.i - 1, j: item.j - 1, rot: item.rot }) : meetingSeats(item);
}
