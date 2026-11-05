// Die Oberfläche spricht Englisch, wer will Deutsch. Die Texte stehen auf Deutsch im Code, das Wörterbuch übersetzt sie
// beim Anzeigen. Werte aus laufenden Sätzen stehen im Wörterbuch als {}.

export type Language = 'en' | 'de';

const SLOT = '\u0001';
const TRANSLATED_ATTRIBUTES = /\b(title|aria-label|placeholder|alt)\s*=\s*"$/;

let language: Language = 'en';
let dictionary: Record<string, string> = {};
let patterns: { regex: RegExp; target: string }[] = [];
let memo = new Map<string, string>();
let statics = new WeakMap<readonly string[], readonly string[]>();

const quote = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function setDictionary(entries: Record<string, string>): void {
  dictionary = entries;
  patterns = Object.entries(entries)
    .filter(([key]) => key.includes('{}'))
    // Längere Muster sind genauer und kommen zuerst an die Reihe.
    .sort((a, b) => b[0].length - a[0].length)
    .map(([key, target]) => ({ regex: new RegExp(`^${key.split('{}').map(quote).join('([\\s\\S]*?)')}$`), target }));
  reset();
}

function reset(): void {
  memo = new Map();
  statics = new WeakMap();
}

export function setLanguage(next: Language): void {
  language = next;
  globalThis.document?.documentElement?.setAttribute('lang', next);
  reset();
}

export const getLanguage = () => language;
export const locale = () => (language === 'de' ? 'de-DE' : 'en-US');

/** Ein fertiger Text, auch einer vom Server mit eingesetzten Werten. Was nicht im Wörterbuch steht, bleibt, wie es ist. */
export function tr(text: string): string {
  if (language === 'de' || !text || !/\p{L}/u.test(text)) return text;
  const known = memo.get(text);
  if (known !== undefined) return known;
  // Angehängte Teile wie ", 1. OG" kommen mit ihrem Trennzeichen an.
  const lead = /^[\s,;:·]+/.exec(text)?.[0] ?? '';
  if (lead && lead.length < text.length) return lead + tr(text.slice(lead.length));
  const trimmed = text.trim();
  let out = text;
  const exact = dictionary[trimmed];
  if (exact !== undefined) {
    out = text.replace(trimmed, exact);
  } else if (trimmed.length < 400) {
    for (const { regex, target } of patterns) {
      const match = regex.exec(trimmed);
      if (!match) continue;
      let slot = 1;
      out = text.replace(trimmed, target.replace(/\{\}/g, () => tr(match[slot++] ?? '')));
      break;
    }
  }
  // Zusammengesetzte Zeilen wie "Neubau · 14 × 9 Felder · 1 Abteilung": jeder Teil für sich.
  if (out === text && trimmed.includes(' · ')) out = text.replace(trimmed, trimmed.split(' · ').map(tr).join(' · '));
  else if (out === text && trimmed.includes(', ')) {
    const parts = trimmed.split(', ');
    if (parts.length <= 4 && parts.some((part) => dictionary[part] !== undefined)) out = text.replace(trimmed, parts.map(tr).join(', '));
  }
  if (memo.size > 8000) memo.clear();
  memo.set(text, out);
  return out;
}

/** Zerlegt eine Vorlage in Text zwischen den Tags und übersetzbare Attribute. Wird auch vom Prüfskript genutzt. */
export function templateSegments(joined: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const add = (from: number, to: number) => {
    while (from < to && /\s/.test(joined[from])) from++;
    while (to > from && /\s/.test(joined[to - 1])) to--;
    if (from < to && /\p{L}/u.test(joined.slice(from, to))) out.push({ from, to });
  };
  let at = 0;
  while (at < joined.length) {
    const open = joined.indexOf('<', at);
    add(at, open < 0 ? joined.length : open);
    if (open < 0) break;
    let quoted = false;
    let cursor = open + 1;
    for (; cursor < joined.length; cursor++) {
      const c = joined[cursor];
      if (c === '"') {
        if (!quoted && TRANSLATED_ATTRIBUTES.test(joined.slice(open, cursor + 1))) {
          const end = joined.indexOf('"', cursor + 1);
          if (end > 0) {
            add(cursor + 1, end);
            cursor = end;
            continue;
          }
        }
        quoted = !quoted;
      } else if (c === '>' && !quoted) {
        break;
      }
    }
    at = cursor + 1;
  }
  return out;
}

export const SLOT_MARK = SLOT;

/** Die festen Teile einer html-Vorlage in der gewählten Sprache. Die Werte behalten ihre Reihenfolge. */
export function translateStatics(parts: readonly string[]): readonly string[] {
  if (language === 'de') return parts;
  const known = statics.get(parts);
  if (known) return known;
  const joined = parts.join(SLOT);
  let out = '';
  let last = 0;
  for (const { from, to } of templateSegments(joined)) {
    const key = joined.slice(from, to).split(SLOT).join('{}');
    const target = dictionary[key];
    out += joined.slice(last, from) + (target === undefined ? joined.slice(from, to) : target.split('{}').join(SLOT));
    last = to;
  }
  out += joined.slice(last);
  let result = out.split(SLOT);
  // Stimmt die Zahl der Werte nicht, bleibt die Vorlage lieber, wie sie ist, als Werte zu verlieren.
  if (result.length !== parts.length) result = [...parts];
  statics.set(parts, result);
  return result;
}

const SKIPPED = /=\s*"[^"]*$/;

/** Ein Wert in einer Vorlage. In Attributen stehen Dateinamen und Kennungen, die stimmen müssen. */
export function translateValue(value: string, before: string): string {
  if (SKIPPED.test(before) && !/\b(title|aria-label|placeholder|alt)\s*=\s*"[^"]*$/.test(before)) return value;
  return tr(value);
}
