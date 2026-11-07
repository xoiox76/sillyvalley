import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillMarkdown } from '../shared/skillfile.ts';

test('SKILL.md: Name und Beschreibung kommen aus dem Kopf, der Kopf selbst nicht in die Anweisung', () => {
  const file = [
    '---',
    'name: sprint-planning',
    'description: "Plant einen Sprint aus dem Backlog. Nutzen, wenn ein Planning ansteht."',
    '---',
    '',
    '# Sprint planen',
    '',
    'Wähle wenige Zettel mit gemeinsamem Ziel.',
  ].join('\n');
  const skill = parseSkillMarkdown(file, 'SKILL.md');
  assert.equal(skill.title, 'Sprint planning');
  assert.equal(skill.description, 'Plant einen Sprint aus dem Backlog. Nutzen, wenn ein Planning ansteht.');
  assert.match(skill.instruction, /^Wann sie gilt: Plant einen Sprint/);
  assert.match(skill.instruction, /Wähle wenige Zettel/);
  assert.doesNotMatch(skill.instruction, /^---|name:/m, 'Der YAML-Kopf ist nicht Teil der Anweisung');
});

test('SKILL.md: mehrzeilige Beschreibung', () => {
  const file = ['---', 'name: cash-runway', 'description: >', '  Berechnet die Reichweite', '  des Geldes.', 'license: Apache-2.0', '---', 'Text.'].join('\n');
  const skill = parseSkillMarkdown(file, 'SKILL.md');
  assert.equal(skill.title, 'Cash runway');
  assert.equal(skill.description, 'Berechnet die Reichweite des Geldes.');
  assert.match(skill.instruction, /Text\.$/);
});

test('Markdown ohne Kopf: wie bisher, Titel aus der Überschrift oder dem Dateinamen', () => {
  assert.equal(parseSkillMarkdown('# Unser Schreibstil\n\nKurze Sätze.', 'stil.md').title, 'Unser Schreibstil');
  assert.equal(parseSkillMarkdown('Kurze Sätze.', 'stil.md').title, 'stil');
  assert.equal(parseSkillMarkdown('Kurze Sätze.', 'SKILL.md').title, 'Fähigkeit');
  assert.equal(parseSkillMarkdown('Kurze Sätze.', 'stil.md').instruction, 'Kurze Sätze.');
});
