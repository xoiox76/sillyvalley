// Zonen: Räume aus Wänden und Türen, denen der Spieler einen Zweck und einen Namen gibt.
import { floorOf, itemsOnFloor, roomOf } from './building.ts';
import { blockedSet, meetingSeats, regionOf, type Seat, type Tile } from './layout.ts';
import type { Company, PlacedItem, Zone, ZoneKind } from './types.ts';

type ZoneCompany = Pick<Company, 'locationId' | 'town' | 'placed' | 'zones'>;

const key = (t: Tile) => `${t.i},${t.j}`;

export const ZONE_KINDS: { kind: ZoneKind; title: string }[] = [
  { kind: 'meeting', title: 'Besprechungsraum' },
  { kind: 'break', title: 'Pausenraum' },
  { kind: 'other', title: 'Eigener Raum' },
];

export const ZONE_COLORS: Record<ZoneKind, string> = { meeting: '#5eeac0', break: '#f8b62d', other: '#9fb0c8' };

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
