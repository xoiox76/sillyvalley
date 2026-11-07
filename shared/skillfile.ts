// Eine Fähigkeit aus einer Markdown-Datei. Versteht auch eine SKILL.md im offenen Agent-Skills-Format:
// YAML-Kopf mit name und description, darunter die Anweisungen.

export interface SkillFile {
  title: string;
  description: string;
  instruction: string;
}

/** Liest den Kopf zwischen den beiden "---". Nur name und description zählen; mehrzeilige Werte mit > oder | gehen auch. */
function readFrontMatter(head: string): { name: string; description: string } {
  const out = { name: '', description: '' };
  const lines = head.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const match = lines[n].match(/^(name|description)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase() as 'name' | 'description';
    let value = match[2].trim();
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      // Mehrzeilig: alle folgenden eingerückten Zeilen gehören dazu.
      const parts: string[] = [];
      while (n + 1 < lines.length && /^\s+\S/.test(lines[n + 1])) parts.push(lines[++n].trim());
      value = parts.join(value.startsWith('|') ? '\n' : ' ');
    }
    out[key] = value.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  }
  return out;
}

export function parseSkillMarkdown(text: string, fileName: string): SkillFile {
  let body = text.replace(/^﻿/, '').trim();
  let name = '';
  let description = '';
  const front = body.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (front) {
    ({ name, description } = readFrontMatter(front[1]));
    body = body.slice(front[0].length).trim();
  }
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  // Skill-Namen sind meist klein und mit Bindestrich: "sprint-planning" wird "Sprint planning".
  const readable = (value: string) => value.replace(/[-_]+/g, ' ').replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  const stem = fileName.replace(/\.\w+$/, '');
  const title = (name ? readable(name) : heading || (/^skill$/i.test(stem) ? 'Fähigkeit' : stem)).slice(0, 60);
  // Die Beschreibung sagt, wann die Fähigkeit gilt. Sie steht vorn, damit der Agent sie mitliest.
  const instruction = [description ? `Wann sie gilt: ${description}` : '', body].filter(Boolean).join('\n\n');
  return { title, description, instruction };
}
