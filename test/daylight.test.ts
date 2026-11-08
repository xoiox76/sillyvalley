import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOME_AT, darkness, dayPhase, isNight, quotaUsed } from '../shared/quota.ts';

test('Tageszeiten nach Verbrauch, wie festgelegt', () => {
  assert.equal(dayPhase(0.1), 'Heller Tag');
  assert.equal(dayPhase(0.29), 'Heller Tag');
  assert.equal(dayPhase(0.4), 'Nachmittag');
  assert.equal(dayPhase(0.6), 'Später Nachmittag');
  assert.equal(dayPhase(0.8), 'Früher Abend');
  assert.equal(dayPhase(0.95), 'Spätabend');
  assert.equal(dayPhase(0.98), 'Nacht');
  assert.equal(darkness(0.3), 0, 'Bis 30 % ist heller Tag');
  for (let u = 0; u < 0.98; u += 0.01) assert.ok(darkness(u + 0.01) >= darkness(u), `Es wird stetig dunkler bei ${u}`);
  assert.ok(darkness(0.5) > 0 && darkness(0.5) < darkness(0.8));
  assert.equal(darkness(0.98), 1);
  assert.ok(!isNight(0.985), 'Nach Hause erst bei 99 %');
  assert.ok(isNight(HOME_AT));
});
test('Verbrauch des Abos: das vollere Fenster zählt', () => {
  assert.equal(quotaUsed(null), null);
  assert.equal(quotaUsed({ status: 'allowed', at: 0, fiveHour: { utilization: 0.4, resetsAt: 0 }, sevenDay: { utilization: 0.7, resetsAt: 0 } } as never), 0.7);
});
