import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scaleBar } from '../client/world/worldmap.ts';

test('Die Maßstabsleiste wählt eine runde Strecke, die aufs Bild passt', () => {
  // Bei dieser Zoomstufe ist ein Feld 0,5 Bildpunkte breit: 100 Felder wären 50 Punkte.
  const bar = scaleBar(0.5);
  assert.equal(bar.meters, 100);
  assert.equal(bar.label, '100 m');
  assert.ok(bar.px >= 50 && bar.px <= 200);
  assert.equal(scaleBar(0.5).px, 50);
  // Weit herausgezoomt wird daraus ein Kilometer-Maßstab.
  const far = scaleBar(0.0025);
  assert.equal(far.label, '100 km');
  // Nah herangezoomt bleiben es Meter.
  assert.equal(scaleBar(20).label, '10 m');
});
