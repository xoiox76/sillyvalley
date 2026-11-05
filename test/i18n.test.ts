import assert from 'node:assert/strict';
import { test } from 'node:test';
import { en } from '../client/i18n/en.ts';
import { setDictionary, setLanguage, tr, translateStatics, translateValue } from '../client/i18n/translate.ts';
import { collectKeys } from '../scripts/i18n-keys.ts';

const statics = (...parts: string[]) => Object.freeze(parts) as readonly string[];

test('Englisch ist Standard, Deutsch zeigt die Texte unverändert', () => {
  setDictionary({ Bauen: 'Build', 'Du hast {} Punkte': 'You have {} points', Punkte: 'Points', '{} und {}': '{} and {}' });
  setLanguage('en');
  assert.equal(tr('Bauen'), 'Build');
  assert.equal(tr('Du hast 5 Punkte'), 'You have 5 points');
  assert.equal(tr('Nicht im Wörterbuch'), 'Nicht im Wörterbuch');
  assert.equal(tr('Bauen und Punkte'), 'Build and Points', 'Auch eingesetzte Werte werden übersetzt');
  setLanguage('de');
  assert.equal(tr('Bauen'), 'Bauen');
  setLanguage('en');
});

test('Vorlagen übersetzen Text und Attribute, aber keine Kennungen', () => {
  setDictionary({ Bauen: 'Build', 'Du hast {} Punkte': 'You have {} points', Zurück: 'Back' });
  setLanguage('en');
  const parts = translateStatics(statics('<button class="Bauen" data-id="', '" title="Zurück">Bauen</button><p>Du hast ', ' Punkte</p>'));
  assert.deepEqual(parts, ['<button class="Bauen" data-id="', '" title="Back">Build</button><p>You have ', ' points</p>']);
  assert.equal(translateValue('Bauen', '<a data-id="'), 'Bauen', 'Werte in Attributen bleiben, wie sie sind');
  assert.equal(translateValue('Bauen', '<a title="'), 'Build');
  assert.equal(translateValue('Bauen', '<p>'), 'Build');
  setDictionary(en);
});

test('Das Wörterbuch kennt jeden Text und behält alle eingesetzten Werte', () => {
  const missing = collectKeys().filter((key) => !(key in en));
  assert.deepEqual(missing, [], `Fehlt im Wörterbuch: ${missing.slice(0, 20).join(' | ')}`);
  const slots = (text: string) => text.split('{}').length;
  const broken = Object.entries(en).filter(([key, value]) => slots(key) !== slots(value));
  assert.deepEqual(broken, []);
});
