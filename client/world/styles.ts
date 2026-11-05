// Das Aussehen der Gebäude im Stadtbild. Es gibt 100 Wohnhaus-, 50 Laden- und 50 Bürotypen, dazu ein- bis
// mehrgeschossige Varianten. Welcher Typ an welchem Grundstück steht, wählt der Zufall je Stadt. Beim ersten
// Besuch bekommt die Stadt ihre Zufallszahl (siehe Engine.visitCity), danach bleibt sie unverändert.

import { cityOf, type Parcel } from '../../shared/town.ts';

export const HOUSE_TYPES = 100;
export const SHOP_TYPES = 50;
export const OFFICE_TYPES = 50;

export type RoofStyle = 'gable' | 'gambrel' | 'shed' | 'flat' | 'parapet';
const ROOFS: RoofStyle[] = ['gable', 'gambrel', 'shed', 'flat', 'parapet'];
/** Wandfarbe und Dachfarbe. */
const HOUSE_PALETTE: [string, string][] = [
  ['#b8c4c9', '#54606b'], ['#d3c4a2', '#7a4f3a'], ['#a9bfa4', '#5a5148'], ['#c7a9a0', '#54606b'], ['#cfd0c4', '#7a4f3a'],
  ['#b5c3d1', '#5a5148'], ['#d9c8a8', '#8a4438'], ['#bcae9e', '#54606b'], ['#e0d6c2', '#3f5a4a'], ['#c9d7cf', '#8a4438'],
];
const SHOP_WALLS: string[] = ['#b5493f', '#5f7f93', '#c58aa4', '#6fa58d', '#a7907a'];
const SHOP_ACCENTS: string[] = ['#f2efe4', '#e4792b', '#2f6f62', '#f8d34a', '#3f7fd0'];
const OFFICE_WALLS: string[] = ['#c8d2d0', '#b9c6d6', '#d6cfc2', '#c3cbd6', '#a9b8b3'];
const OFFICE_ACCENTS: string[] = ['#2f6f62', '#3f7fd0', '#b5493f', '#54606b', '#8a4438'];

export interface HouseLook {
  roof: RoofStyle;
  wall: string;
  roofColor: string;
  windows: 'tall' | 'wide';
}

export interface ShopLook {
  wall: string;
  accent: string;
  cornice: boolean;
}

export interface OfficeLook {
  wall: string;
  accent: string;
  crown: boolean;
}

/** Ein Typ ist eine feste Zahl; die 100 Zahlen ergeben 100 verschiedene Häuser. */
export function houseLook(type: number): HouseLook {
  const [wall, roofColor] = HOUSE_PALETTE[Math.floor(type / 5) % HOUSE_PALETTE.length];
  return { roof: ROOFS[type % 5], wall, roofColor, windows: type >= 50 ? 'wide' : 'tall' };
}

export function shopLook(type: number): ShopLook {
  return { wall: SHOP_WALLS[type % 5], accent: SHOP_ACCENTS[Math.floor(type / 5) % 5], cornice: type >= 25 };
}

export function officeLook(type: number): OfficeLook {
  return { wall: OFFICE_WALLS[type % 5], accent: OFFICE_ACCENTS[Math.floor(type / 5) % 5], crown: type >= 25 };
}

export type BuildingStyle =
  | { kind: 'house'; type: number; floors: number; look: HouseLook }
  | { kind: 'shop'; type: number; floors: number; look: ShopLook }
  | { kind: 'office'; type: number; floors: number; look: OfficeLook };

export type Fence = 'picket' | 'chain' | 'hedge' | 'wood';
export type Ground = 'dirt' | 'grass' | 'gravel';
const FENCES: Fence[] = ['picket', 'chain', 'hedge', 'wood'];
const GROUNDS: Ground[] = ['dirt', 'grass', 'gravel'];
export interface LotLook {
  fence: Fence;
  ground: Ground;
}

/** Ein Grundstück hat einen Zaun und einen Boden. Zwölf Kombinationen, von der Stadt zufällig verteilt. */
export function lotLook(p: Parcel): LotLook {
  const seed = mix(saltOf(p), textHash(p.id));
  return { fence: FENCES[seed % FENCES.length], ground: GROUNDS[Math.floor(seed / FENCES.length) % GROUNDS.length] };
}

/** Die Städte haben ihre Zufallszahl aus dem Spielstand. Unbesuchte Städte bleiben bei 0. */
let citySalts: Record<string, number> = {};
export const setCitySalts = (salts: Record<string, number>) => {
  citySalts = salts;
};

/** Namen, unter denen die Stadt generische Gebäude führt. Benannte Orte wie das Diner behalten ihr eigenes Aussehen. */
const GENERIC = new Set(['Wohnhaus', 'Geschäft', 'Bürohaus']);
export const isGeneric = (p: Parcel) => (p.kind === 'house' || p.kind === 'shop' || p.kind === 'office') && GENERIC.has(p.name) && Boolean(p.building);

function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 1597334677);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

function textHash(text: string): number {
  let h = 2166136261;
  for (let n = 0; n < text.length; n++) {
    h ^= text.charCodeAt(n);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Welches Gebäude an diesem Grundstück steht. Dieselbe Stadt mit derselben Zahl sieht immer gleich aus. */
const saltOf = (p: Parcel) => citySalts[cityOf(p.i, p.j)?.id ?? 'core'] ?? 0;

export function styleOf(p: Parcel): BuildingStyle {
  const seed = mix(saltOf(p), textHash(p.id));
  const floorsFrom = (min: number, count: number) => min + (mix(seed, 2) % count);
  if (p.kind === 'shop') {
    const type = mix(seed, 1) % SHOP_TYPES;
    return { kind: 'shop', type, floors: floorsFrom(1, 2), look: shopLook(type) };
  }
  if (p.kind === 'office') {
    const type = mix(seed, 1) % OFFICE_TYPES;
    return { kind: 'office', type, floors: floorsFrom(2, 4), look: officeLook(type) };
  }
  const type = mix(seed, 1) % HOUSE_TYPES;
  return { kind: 'house', type, floors: floorsFrom(1, 3), look: houseLook(type) };
}
