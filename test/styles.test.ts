import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PARCELS, parcelsIn, placesIn, REGION, type Parcel } from '../shared/town.ts';
import { HOUSE_TYPES, OFFICE_TYPES, SHOP_TYPES, houseLook, lotLook, officeLook, setCitySalts, shopLook, styleOf } from '../client/world/styles.ts';

test('Es gibt 100 Wohnhaus-, 50 Laden- und 50 Bürotypen, und jeder ist verschieden', () => {
  const houses = new Set(Array.from({ length: HOUSE_TYPES }, (_, t) => JSON.stringify(houseLook(t))));
  const shops = new Set(Array.from({ length: SHOP_TYPES }, (_, t) => JSON.stringify(shopLook(t))));
  const offices = new Set(Array.from({ length: OFFICE_TYPES }, (_, t) => JSON.stringify(officeLook(t))));
  assert.equal(houses.size, 100);
  assert.equal(shops.size, 50);
  assert.equal(offices.size, 50);
});

test('Jede Stadt zieht ihre Gebäude aus dem Zufall, mit fester Zahl immer gleich', () => {
  const parcels = PARCELS.filter((p) => p.building && (p.kind === 'house' || p.kind === 'shop' || p.kind === 'office'));
  const pick = (salt: number) => {
    setCitySalts({ paloalto: salt });
    return parcels.map((p: Parcel) => JSON.stringify(styleOf(p)));
  };
  const a = pick(7);
  assert.deepEqual(pick(7), a, 'Dieselbe Zahl ergibt dasselbe Bild');
  assert.notDeepEqual(pick(8), a, 'Eine andere Zahl ergibt eine andere Stadt');
  setCitySalts({});
});

test('Geschosse liegen in den vorgesehenen Bereichen', () => {
  setCitySalts({});
  const sample = placesIn(-40 * REGION, -40 * REGION, 40 * REGION, 40 * REGION).filter((p) => p.id.startsWith('w')).slice(0, 80);
  const generated = sample.flatMap((p) => parcelsIn(p.i, p.j, p.i + 60, p.j + 60)).filter((p) => p.building);
  assert.ok(generated.length > 50);
  for (const parcel of generated) {
    const style = styleOf(parcel);
    if (style.kind === 'house') assert.ok(style.floors >= 1 && style.floors <= 3);
    if (style.kind === 'shop') assert.ok(style.floors >= 1 && style.floors <= 2);
    if (style.kind === 'office') assert.ok(style.floors >= 2 && style.floors <= 5);
  }
});

test('Grundstücke wechseln Zaun und Boden, und jede Stadt verteilt sie anders', () => {
  const lots = PARCELS.filter((p) => p.kind === 'lot');
  const sample = Array.from({ length: 400 }, (_, n) => ({ ...lots[n % lots.length], id: `probe-${n}` }) as Parcel);
  setCitySalts({});
  const plain = new Set(sample.map((p) => JSON.stringify(lotLook(p))));
  assert.ok(plain.size >= 10, `Zwölf Kombinationen, gesehen: ${plain.size}`);
  setCitySalts({ paloalto: 4242 });
  const other = sample.map((p) => JSON.stringify(lotLook(p)));
  setCitySalts({});
  assert.notDeepEqual(other, sample.map((p) => JSON.stringify(lotLook(p))));
});
