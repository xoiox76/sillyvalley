// Liest die Subagents eines eingebundenen Projekts (.claude/agents/*.md). Nur lesen: Das Projekt bleibt unverändert.

import fs from 'node:fs';
import path from 'node:path';
import type { ProjectAgent } from '../shared/types.ts';
import { safeResolve } from './workspace.ts';

const AGENTS_DIR = path.join('.claude', 'agents');
/** Was ein Mitarbeiter im Spiel überhaupt haben kann. Alles andere bleibt gesperrt, auch wenn die Datei es verlangt. */
const GAME_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
const MODEL_ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1',
};
const MAX_FILE_CHARS = 20000;

const unquote = (text: string) => text.trim().replace(/^(["'])(.*)\1$/, '$2');

/** Das Frontmatter ist YAML, doch hier kommen nur einfache Schlüssel vor. Listen und Textblöcke werden mitgelesen. */
function parseFrontmatter(block: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let key = '';
  for (const line of block.split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) {
      out[key] = [...(Array.isArray(out[key]) ? out[key] : []), unquote(item[1])];
      continue;
    }
    const pair = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (pair) {
      key = pair[1];
      out[key] = /^[>|]/.test(pair[2]) ? '' : unquote(pair[2]);
    } else if (key && /^\s+\S/.test(line) && typeof out[key] === 'string') {
      out[key] = `${out[key]} ${line.trim()}`.trim();
    }
  }
  return out;
}

export interface ParsedSubagent extends ProjectAgent {
  instruction: string;
}

export function parseSubagent(text: string, file: string): ParsedSubagent | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const meta = parseFrontmatter(match[1].replace(/\r/g, ''));
  const name = typeof meta.name === 'string' && meta.name ? meta.name : path.basename(file, '.md');
  const instruction = match[2].trim();
  const listed = meta.tools;
  const tools = Array.isArray(listed) ? listed : typeof listed === 'string' && listed ? listed.split(',').map((t) => t.trim()).filter(Boolean) : null;
  const wanted = typeof meta.model === 'string' ? meta.model.trim().toLowerCase() : '';
  return {
    name,
    file,
    description: typeof meta.description === 'string' ? meta.description : '',
    modelId: MODEL_ALIASES[wanted] ?? null,
    // Wer ausdrücklich keine Schreibwerkzeuge bekommen hat, soll sie auch hier nicht bekommen.
    readOnly: Boolean(tools) && !tools!.some((t) => t === 'Write' || t === 'Edit'),
    // Ohne Liste erbt ein Subagent alles, also auch Befehle. Die gibt es im Spiel nicht.
    wantsCommands: !tools || tools.includes('Bash'),
    blockedTools: (tools ?? []).filter((t) => !GAME_TOOLS.includes(t)),
    chars: instruction.length,
    adoptedBy: null,
    instruction,
  };
}

export function listSubagents(projectDir: string): ParsedSubagent[] {
  const dir = path.join(projectDir, AGENTS_DIR);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ParsedSubagent[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const rel = path.join(AGENTS_DIR, entry.name);
    // Ein Symlink aus dem Projekt heraus zählt nicht: safeResolve weist ihn ab.
    const real = safeResolve(projectDir, rel);
    if (!real || fs.statSync(real).size > MAX_FILE_CHARS * 4) continue;
    const parsed = parseSubagent(fs.readFileSync(real, 'utf8'), rel.split(path.sep).join('/'));
    if (parsed && parsed.instruction && parsed.instruction.length <= MAX_FILE_CHARS) out.push(parsed);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
