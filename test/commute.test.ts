import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRIVE_FROM, commuteMode, curbOf, drivable, homesOf, officeParking } from '../shared/commute.ts';
import { parcelById, startTown, tileKind } from '../shared/town.ts';
import type { Agent, Company } from '../shared/types.ts';

const agent = (id: string, extra: Partial<Agent> = {}) => ({ id, hired: true, firedAt: null, ...extra }) as Agent;
const company = (agents: Agent[]) => ({ agents, town: startTown('garage') }) as Pick<Company, 'agents' | 'town'>;

test('Jeder Mitarbeiter wohnt in einem eigenen Wohnhaus, neue bekommen ein neues', () => {
  const two = homesOf(company([agent('a'), agent('b')]));
  assert.equal(two.size, 2);
  assert.notEqual(two.get('a'), two.get('b'), 'Niemand teilt sich ein Haus');
  for (const id of two.values()) assert.equal(parcelById(id)?.kind, 'house');
  const three = homesOf(company([agent('a', { homeParcelId: two.get('a') }), agent('b', { homeParcelId: two.get('b') }), agent('c')]));
  assert.equal(three.get('a'), two.get('a'), 'Wer ein Haus hat, behält es');
  assert.ok(![two.get('a'), two.get('b')].includes(three.get('c')), 'Der Neue bekommt ein neues Haus');
  const fired = homesOf(company([agent('a'), { ...agent('x'), firedAt: 1 }]));
  assert.ok(!fired.has('x'), 'Wer gekündigt ist, wohnt hier nicht mehr');
});

test('Zu Fuß bei kurzen Wegen, mit dem Auto bei weiten', () => {
  assert.equal(commuteMode({ i: 0, j: 0 }, { i: 10, j: 5 }), 'walk');
  assert.equal(commuteMode({ i: 0, j: 0 }, { i: DRIVE_FROM, j: 1 }), 'car');
});

test('Parkplätze liegen auf der Straße vor dem Büro', () => {
  const site = parcelById(startTown('garage').siteId)!;
  const curb = curbOf(site.entry);
  assert.ok(curb && tileKind(curb.i, curb.j) === 'road');
  const spots = officeParking(site, 4);
  assert.equal(spots.length, 4);
  assert.equal(new Set(spots.map((s) => `${s.i},${s.j}`)).size, 4, 'Jeder Platz einmal');
  for (const s of spots) assert.ok(drivable(s.i, s.j));
});
