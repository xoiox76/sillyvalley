// Sammelt alle Texte, die auf dem Bildschirm landen können, damit das Wörterbuch vollständig bleibt.
// Aufruf: node scripts/i18n-keys.ts

import fs from 'node:fs';
import path from 'node:path';
import { SLOT_MARK, templateSegments } from '../client/i18n/translate.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCES = ['client/ui', 'client/world', 'shared', 'server/engine.ts', 'server/http.ts', 'server/settings.ts', 'server/commands.ts', 'server/git.ts', 'server/workspace.ts', 'server/providers/anthropic.ts', 'server/providers/codex.ts', 'server/providers/compatible.ts', 'server/providers/workspace-tools.ts'];
const IGNORED_FILES = /(client\/world\/(pixel|art|characters)\.ts|shared\/layout\.ts)$/;
const TECHNICAL = /^[a-z_./:@#%-][\w./:@#%-]*$|^[A-Z][a-z]+[A-Z]\w*$|^[A-Z_]+$|^[a-z-]+(\s+[a-z-]+)*$|^https?:|^--|^rgba?\(|^\.|^\[|<\/?[a-z]+[\s>]|=>/;

function filesIn(entry: string): string[] {
  const full = path.join(ROOT, entry);
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full).filter((f) => f.endsWith('.ts')).map((f) => path.join(full, f));
}

const looksLikeText = (text: string) => {
  const t = text.trim();
  if (t.length < 2 || !/\p{L}/u.test(t) || TECHNICAL.test(t)) return false;
  return /[A-ZÄÖÜ]/.test(t[0]) || /[äöüß]/.test(t) || t.includes(' ');
};

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r' };

/** Liest Zeichenketten und Vorlagen aus dem Quelltext. Ein Parser wäre genauer, aber das Prüfen darf nichts installieren. */
function scan(source: string, onString: (text: string) => void, onTemplate: (parts: string[], tagged: boolean) => void): void {
  let at = 0;
  const readString = (quote: string) => {
    let out = '';
    at++;
    while (at < source.length && source[at] !== quote) {
      if (source[at] === '\\') {
        at++;
        out += ESCAPES[source[at]] ?? source[at];
      } else {
        out += source[at];
      }
      at++;
    }
    at++;
    return out;
  };
  const readTemplate = (tagged: boolean) => {
    const parts = [''];
    at++;
    while (at < source.length && source[at] !== '`') {
      if (source[at] === '\\') {
        at++;
        parts[parts.length - 1] += ESCAPES[source[at]] ?? source[at];
        at++;
      } else if (source[at] === '$' && source[at + 1] === '{') {
        at += 2;
        code('}');
        at++;
        parts.push('');
      } else {
        parts[parts.length - 1] += source[at];
        at++;
      }
    }
    at++;
    onTemplate(parts, tagged);
  };
  const code = (until: string | null) => {
    let depth = 0;
    let previous = '';
    while (at < source.length) {
      const c = source[at];
      if (until && c === until && depth === 0) return;
      if (c === '{') depth++;
      if (c === '}') depth--;
      if (c === '/' && source[at + 1] === '/') {
        at = source.indexOf('\n', at);
        if (at < 0) return;
      } else if (c === '/' && source[at + 1] === '*') {
        at = source.indexOf('*/', at) + 2;
      } else if (c === '/' && /[(,=:[!&|?{};\n]|^$/.test(previous)) {
        // Ein regulärer Ausdruck.
        at++;
        let inClass = false;
        while (at < source.length && (source[at] !== '/' || inClass)) {
          if (source[at] === '\\') at++;
          else if (source[at] === '[') inClass = true;
          else if (source[at] === ']') inClass = false;
          at++;
        }
        at++;
        previous = '/';
      } else if (c === "'" || c === '"') {
        onString(readString(c));
        previous = c;
      } else if (c === '`') {
        readTemplate(source.slice(Math.max(0, at - 4), at) === 'html');
        previous = '`';
      } else {
        if (!/\s/.test(c)) previous = c;
        at++;
      }
    }
  };
  code(null);
}

export function collectKeys(): string[] {
  const keys = new Set<string>();
  for (const entry of SOURCES) {
    for (const file of filesIn(entry)) {
      if (IGNORED_FILES.test(file)) continue;
      const source = fs.readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*(import|export \* from|\} from) /.test(line)).join('\n');
      scan(source, (text) => {
        if (looksLikeText(text)) keys.add(text.trim());
      }, (parts, tagged) => {
        if (tagged) {
          const joined = parts.join(SLOT_MARK);
          for (const { from, to } of templateSegments(joined)) {
            const key = joined.slice(from, to).split(SLOT_MARK).join('{}');
            if (key.replace(/\{\}/g, '').trim().length > 1 && /\p{L}/u.test(key.replace(/\{\}/g, ''))) keys.add(key);
          }
        } else {
          const key = parts.join('{}').trim();
          if (looksLikeText(key.replace(/\{\}/g, 'x')) && key.replace(/\{\}/g, '').trim().length > 1) keys.add(key);
        }
      });
    }
  }
  return [...keys].sort();
}

if (process.argv[1] === import.meta.filename) process.stdout.write(`${JSON.stringify(collectKeys())}\n`);
