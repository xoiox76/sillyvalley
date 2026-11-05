// Eine Rolle als Markdown. So schreibt die Geschäftsführung sie am Laptop, und so lässt sie sich als Datei mitbringen.

import { MODELS, ROLES, SKILLS, modelById, roleById } from './catalog.ts';
import type { CompanyRole, CustomSkill } from './types.ts';

export const ROLE_TEMPLATE = `# Name der Rolle

Vorlage: Eigene Stelle
Modell: Haiku 5.5

## Aufgabe
Wofür ist diese Stelle da? Schreibe es so, als sprächest du die Person direkt an.

## Anforderungen
Was muss sie mitbringen oder beachten?

## Fähigkeiten
- Texte

## Eigene Fähigkeit: Unser Schreibstil
Wie soll die Person vorgehen? Das wird wörtlich zur Arbeitsanweisung.
`;

export interface ParsedRole {
  title: string;
  baseRoleId: string;
  modelId: string;
  color: string | null;
  task: string;
  requirements: string;
  skillIds: string[];
  customSkills: { title: string; instruction: string; source: 'datei' }[];
}

/** Liest die Rolle. Was nicht stimmt, steht als Satz im Fehler, damit man es im Text beheben kann. */
export function parseRole(text: string, firm: Pick<CustomSkill, 'id' | 'title'>[]): { role: ParsedRole } | { error: string } {
  const lines = text.replace(/\r/g, '').split('\n');
  const heading = lines.find((line) => /^#\s+\S/.test(line));
  const title = heading?.replace(/^#\s+/, '').trim() ?? '';
  if (!title) return { error: 'Es fehlt der Name: die erste Zeile mit einer Raute, zum Beispiel "# Redaktion".' };
  const sections: { name: string; body: string[] }[] = [{ name: '', body: [] }];
  for (const line of lines) {
    if (line === heading) continue;
    const match = line.match(/^##\s+(.+)$/);
    if (match) sections.push({ name: match[1].trim(), body: [] });
    else sections.at(-1)!.body.push(line);
  }
  const field = (name: string) => sections[0].body.find((line) => line.toLowerCase().startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? '';
  const baseName = field('vorlage') || 'Eigene Stelle';
  const base = ROLES.find((r) => r.title.toLowerCase() === baseName.toLowerCase());
  if (!base) return { error: `Die Vorlage "${baseName}" gibt es nicht. Möglich: ${ROLES.map((r) => r.title).join(', ')}.` };
  const modelName = field('modell');
  const model = modelName ? MODELS.find((m) => m.label.toLowerCase() === modelName.toLowerCase()) : modelById(base.modelId);
  if (!model) return { error: `Das Modell "${modelName}" gibt es nicht. Möglich: ${MODELS.map((m) => m.label).join(', ')}.` };
  const colorText = field('farbe');
  if (colorText && !/^#[0-9a-f]{6}$/i.test(colorText)) return { error: `Die Farbe "${colorText}" verstehe ich nicht. Schreibe sie so: #f7d774.` };
  const section = (name: string) => sections.find((s) => s.name.toLowerCase() === name)?.body.join('\n').trim() ?? '';
  const skillIds: string[] = [];
  for (const line of section('fähigkeiten').split('\n')) {
    const name = line.replace(/^\s*[-*]\s*/, '').trim();
    if (!name) continue;
    const id = SKILLS.find((s) => s.title.toLowerCase() === name.toLowerCase())?.id ?? firm.find((s) => s.title.toLowerCase() === name.toLowerCase())?.id;
    if (!id) return { error: `Die Fähigkeit "${name}" gibt es noch nicht. Beschreibe sie unter "## Eigene Fähigkeit: ${name}".` };
    skillIds.push(id);
  }
  const customSkills: ParsedRole['customSkills'] = [];
  for (const s of sections) {
    const match = s.name.match(/^eigene fähigkeit:\s*(.+)$/i);
    if (!match) continue;
    const name = match[1].trim();
    const known = firm.find((f) => f.title.toLowerCase() === name.toLowerCase());
    if (known) {
      skillIds.push(known.id);
      continue;
    }
    const instruction = s.body.join('\n').trim();
    if (!instruction) return { error: `Beschreibe unter "${s.name}", was die Fähigkeit können soll.` };
    customSkills.push({ title: name, instruction, source: 'datei' });
  }
  return { role: { title, baseRoleId: base.id, modelId: model.id, color: colorText ? colorText.toLowerCase() : null, task: section('aufgabe'), requirements: section('anforderungen'), skillIds: [...new Set(skillIds)], customSkills } };
}

/** Eine vorhandene Rolle zurück als Text. Eigene Fähigkeiten stehen als Name: Ihre Anweisung liegt als Datei im Arbeitsbereich. */
export function roleToMarkdown(role: CompanyRole, firm: Pick<CustomSkill, 'id' | 'title'>[]): string {
  const skills = role.skillIds.map((id) => SKILLS.find((s) => s.id === id)?.title ?? firm.find((s) => s.id === id)?.title ?? id);
  return [
    `# ${role.title}`, '',
    `Vorlage: ${roleById(role.baseRoleId)?.title ?? 'Eigene Stelle'}`,
    `Modell: ${modelById(role.modelId)?.label ?? role.modelId}`,
    ...(role.color ? [`Farbe: ${role.color}`] : []), '',
    '## Aufgabe', role.task, '',
    '## Anforderungen', role.requirements, '',
    '## Fähigkeiten', ...skills.map((name) => `- ${name}`), '',
  ].join('\n');
}

/** Schreibt die Farbe in den Text oder nimmt sie heraus. Der Rest bleibt, wie er ist. */
export function withRoleColor(text: string, color: string | null): string {
  const lines = text.split('\n').filter((line) => !/^farbe:/i.test(line));
  if (!color) return lines.join('\n');
  const after = lines.findIndex((line) => /^modell:/i.test(line));
  lines.splice(after >= 0 ? after + 1 : Math.min(1, lines.length), 0, `Farbe: ${color}`);
  return lines.join('\n');
}

/** Die Farbe, die gerade im Text steht. */
export const colorInText = (text: string) => text.split('\n').find((line) => /^farbe:/i.test(line))?.slice(6).trim().toLowerCase() ?? null;
