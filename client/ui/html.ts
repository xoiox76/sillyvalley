// Kleine Vorlagen statt eines Frameworks. Jeder eingesetzte Wert wird maskiert, denn vieles
// davon stammt von Agenten. morph gleicht das DOM ab, damit Eingaben und Fokus erhalten bleiben,
// auch wenn während eines Laufs mehrmals pro Sekunde neue Zustände eintreffen.

export class Safe {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function toHtml(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(toHtml).join('');
  return escapeHtml(String(value));
}

/** Die Oberfläche schreibt ss statt ß. Das betrifft nur die Anzeige, Ergebnisse und Dateien bleiben, wie sie sind. */
export const withoutEszett = (text: string) => text.replace(/ß/g, 'ss').replace(/ẞ/g, 'SS');

/** Steht der Wert in einem Attribut? Dort können Dateinamen stehen, die stimmen müssen. */
const inAttribute = (before: string) => /=\s*"[^"]*$/.test(before);

export function html(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = withoutEszett(strings[0]);
  values.forEach((value, index) => {
    const text = toHtml(value);
    out += (inAttribute(strings[index]) ? text : withoutEszett(text)) + withoutEszett(strings[index + 1]);
  });
  return new Safe(out);
}

function morphNode(from: Node, to: Node): void {
  if (from.nodeType === Node.TEXT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  if (from.nodeType !== Node.ELEMENT_NODE) return;
  const a = from as HTMLElement;
  const b = to as HTMLElement;
  for (const attr of [...a.attributes]) {
    if (!b.hasAttribute(attr.name) && attr.name !== 'open') a.removeAttribute(attr.name);
  }
  for (const attr of [...b.attributes]) {
    if (a.getAttribute(attr.name) !== attr.value) a.setAttribute(attr.name, attr.value);
  }
  if (a.tagName === 'IFRAME') return;
  morphChildren(a, b);
}

const sameKind = (a: Node, b: Node) =>
  a.nodeType === b.nodeType &&
  a.nodeName === b.nodeName &&
  (a as HTMLElement).dataset?.key === (b as HTMLElement).dataset?.key;

function morphChildren(from: Element, to: Element): void {
  const next = [...to.childNodes];
  let cursor = from.firstChild;
  for (const node of next) {
    if (cursor && sameKind(cursor, node)) {
      morphNode(cursor, node);
      cursor = cursor.nextSibling;
    } else {
      // Gleicher Schlüssel weiter hinten? Dann verschieben, sonst neu einsetzen.
      const key = (node as HTMLElement).dataset?.key;
      const match = key ? [...from.children].find((c) => (c as HTMLElement).dataset.key === key && c.nodeName === node.nodeName) : null;
      if (match) {
        from.insertBefore(match, cursor);
        morphNode(match, node);
      } else {
        from.insertBefore(node, cursor);
      }
    }
  }
  while (cursor) {
    const after = cursor.nextSibling;
    from.removeChild(cursor);
    cursor = after;
  }
}

export function morph(target: Element, content: Safe): void {
  const template = document.createElement('template');
  template.innerHTML = content.value;
  morphChildren(target, template.content as unknown as Element);
}
