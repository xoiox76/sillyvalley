// Heimwege: Jeder Mitarbeiter wohnt in einem eigenen Haus in der Stadt. Ist es nah, geht er zu Fuß,
// sonst fährt er mit dem Auto, das tagsüber vor dem Büro und nachts vor seinem Haus parkt.

import { PARCELS, cityOf, parcelById, tileKind, type Parcel, type TownTile } from './town.ts';
import type { Agent, Company } from './types.ts';

/** Ab dieser Entfernung in Feldern fährt man mit dem Auto. */
export const DRIVE_FROM = 40;

const hash = (text: string) => {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

const staffOf = (company: Pick<Company, 'agents'>) => company.agents.filter((a) => a.hired && !a.firedAt);

/** Wohnhäuser, sortiert nach Nähe zum Büro. Bevorzugt in der Stadt des Büros, sonst überall. */
function housesNear(site: Parcel): Parcel[] {
  const city = cityOf(site.entry.i, site.entry.j);
  const houses = PARCELS.filter((p) => p.kind === 'house');
  const local = city ? houses.filter((p) => cityOf(p.entry.i, p.entry.j)?.id === city.id) : [];
  const pool = local.length >= 4 ? local : houses;
  const dist = (p: Parcel) => Math.abs(p.entry.i - site.entry.i) + Math.abs(p.entry.j - site.entry.j);
  return [...pool].sort((a, b) => dist(a) - dist(b) || a.id.localeCompare(b.id));
}

/**
 * Wer wo wohnt. Ein gespeichertes Haus bleibt, solange es niemand anderes hat. Wer noch keines hat, bekommt
 * ein freies, gestreut über nahe und ferne Häuser, damit einige laufen und andere fahren.
 */
export function homesOf(company: Pick<Company, 'agents' | 'town'>): Map<string, string> {
  const out = new Map<string, string>();
  const site = parcelById(company.town.siteId);
  if (!site) return out;
  const taken = new Set<string>();
  const staff = staffOf(company);
  for (const agent of staff) {
    if (agent.homeParcelId && !taken.has(agent.homeParcelId) && parcelById(agent.homeParcelId)?.kind === 'house') {
      out.set(agent.id, agent.homeParcelId);
      taken.add(agent.homeParcelId);
    }
  }
  const houses = housesNear(site);
  for (const agent of staff) {
    if (out.has(agent.id)) continue;
    const free = houses.filter((p) => !taken.has(p.id));
    if (!free.length) continue;
    // Gestreut über die nächsten Häuser: Die Hälfte der Auswahl liegt nah, die andere weiter weg.
    const window = Math.min(free.length, 24);
    const pick = free[hash(agent.id) % window];
    out.set(agent.id, pick.id);
    taken.add(pick.id);
  }
  return out;
}

export type CommuteMode = 'walk' | 'car';

export function commuteMode(from: TownTile, to: TownTile): CommuteMode {
  return Math.abs(from.i - to.i) + Math.abs(from.j - to.j) > DRIVE_FROM ? 'car' : 'walk';
}

/** Das erste Straßenfeld vor einem Eingang: dort hält das Auto. */
export function curbOf(entry: TownTile): TownTile | null {
  for (let k = 1; k <= 6; k++) {
    const t = { i: entry.i, j: entry.j + k };
    if (tileKind(t.i, t.j) === 'road') return t;
  }
  return null;
}

/** Parkplätze vor dem Büro: nebeneinander am Straßenrand, entlang der Front des Grundstücks. */
export function officeParking(site: Parcel, count: number): TownTile[] {
  const curb = curbOf(site.entry);
  if (!curb) return [];
  const spots: TownTile[] = [];
  for (let k = 0; spots.length < count && k < 40; k++) {
    // Abwechselnd links und rechts vom Eingang.
    // Ein Auto ist gut vier Meter lang: alle fünf Felder ein Platz.
    const off = (k % 2 === 0 ? 1 : -1) * (Math.floor(k / 2) * 5 + 4);
    const t = { i: curb.i + off, j: curb.j };
    if (tileKind(t.i, t.j) === 'road') spots.push(t);
  }
  return spots;
}

/** Felder, auf denen ein Auto fahren darf. */
export const drivable = (i: number, j: number) => {
  const kind = tileKind(i, j);
  return kind === 'road' || kind === 'bridge';
};

/** Felder, auf denen man zu Fuß gehen darf: Gehweg, Straße zum Überqueren, Wege auf Grundstücken. */
export const walkable = (i: number, j: number) => {
  const kind = tileKind(i, j);
  return kind === 'sidewalk' || kind === 'road' || kind === 'bridge' || kind === 'grass';
};

export type { Agent };
