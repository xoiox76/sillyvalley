// Produktvision und Business Case: wohin das Produkt soll und was es kosten darf.
// Auswahl statt Text, wo es geht. Beides ist optional und lässt sich später ändern.

export interface Choice {
  id: string;
  title: string;
}

export const PRODUCT_TYPES: Choice[] = [
  { id: 'webapp', title: 'Web-App' },
  { id: 'mobil', title: 'Mobile App' },
  { id: 'werkzeug', title: 'Werkzeug für die Kommandozeile' },
  { id: 'bibliothek', title: 'Bibliothek' },
  { id: 'website', title: 'Website mit Inhalten' },
  { id: 'spiel', title: 'Spiel' },
  { id: 'daten', title: 'Datenauswertung' },
  { id: 'intern', title: 'Internes Werkzeug' },
];

export const AUDIENCES: Choice[] = [
  { id: 'privat', title: 'Privatleute' },
  { id: 'firmen', title: 'Unternehmen' },
  { id: 'entwickler', title: 'Entwickler' },
  { id: 'vereine', title: 'Vereine und Verwaltung' },
  { id: 'selbst', title: 'Wir selbst' },
];

export const SUCCESS_MEASURES: Choice[] = [
  { id: 'prototyp', title: 'Ein lauffähiger Prototyp' },
  { id: 'nutzer', title: 'Aktive Nutzer' },
  { id: 'umsatz', title: 'Umsatz' },
  { id: 'zeit', title: 'Gesparte Zeit' },
  { id: 'qualitaet', title: 'Weniger Fehler' },
  { id: 'erkenntnis', title: 'Klarheit, ob die Idee trägt' },
];

export const WARN_LEVELS = [50, 70, 80, 90] as const;

export const LIMIT_ACTIONS: Choice[] = [
  { id: 'warnen', title: 'Nur warnen' },
  { id: 'anhalten', title: 'Neue Arbeit anhalten, bis ich entscheide' },
];

export interface ProductVision {
  productType: string | null;
  audiences: string[];
  /** Für wen genau, in einem Satz. Optional. */
  audienceNote: string;
  /** Welches Problem das Produkt löst, in einem Satz. */
  problem: string;
  /** Was das Produkt bewusst nicht macht. */
  nonGoals: string;
  successIds: string[];
  /** Eine Zielmarke, zum Beispiel "100 Nutzer bis Jahresende". Optional. */
  successNote: string;
}

export interface BusinessCase {
  /** Was das Produkt bringen soll, in einem Satz. */
  benefit: string;
  /** Erwarteter Erlös je Monat in Euro, null wenn keiner geplant ist. */
  revenueEurMonth: number | null;
  /** Ab diesem Anteil des KI-Budgets wird entschieden. */
  warnPercent: number;
  limitAction: 'warnen' | 'anhalten';
  /** Wann die Schwelle erreicht wurde. null: noch nicht. */
  reachedAt: number | null;
  /** Wann du nach dem Erreichen entschieden hast weiterzumachen. */
  confirmedAt: number | null;
}

export const VISION_FILE = 'wissen/vision.md';
export const BUSINESS_CASE_FILE = 'wissen/business-case.md';

const TEXT_MAX = 300;
const text = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, TEXT_MAX) : '');
const pick = (value: unknown, list: Choice[]) => (typeof value === 'string' && list.some((c) => c.id === value) ? value : null);
const pickMany = (value: unknown, list: Choice[]) =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && list.some((c) => c.id === v)))] : [];

/** Liest eine Vision aus Formulardaten. Ist nichts ausgefüllt, gibt es keine. */
export function cleanVision(input: unknown): ProductVision | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as Record<string, unknown>;
  const vision: ProductVision = {
    productType: pick(v.productType, PRODUCT_TYPES),
    audiences: pickMany(v.audiences, AUDIENCES),
    audienceNote: text(v.audienceNote),
    problem: text(v.problem),
    nonGoals: text(v.nonGoals),
    successIds: pickMany(v.successIds, SUCCESS_MEASURES),
    successNote: text(v.successNote),
  };
  const empty = !vision.productType && !vision.audiences.length && !vision.audienceNote && !vision.problem && !vision.nonGoals && !vision.successIds.length && !vision.successNote;
  return empty ? null : vision;
}

/** Liest einen Business Case. Ohne Nutzen und ohne Erlös gibt es keinen. */
export function cleanBusinessCase(input: unknown, previous: BusinessCase | null = null): BusinessCase | null {
  if (!input || typeof input !== 'object') return null;
  const b = input as Record<string, unknown>;
  const benefit = text(b.benefit);
  const revenue = Number(b.revenueEurMonth);
  const revenueEurMonth = b.revenueEurMonth !== null && b.revenueEurMonth !== '' && b.revenueEurMonth !== undefined && Number.isFinite(revenue) && revenue >= 0 ? Math.round(revenue * 100) / 100 : null;
  const warn = Number(b.warnPercent);
  const warnPercent = (WARN_LEVELS as readonly number[]).includes(warn) ? warn : 80;
  const limitAction = b.limitAction === 'anhalten' ? 'anhalten' : 'warnen';
  if (!benefit && revenueEurMonth === null) return null;
  // Wer die Schwelle anhebt, setzt die Prüfung zurück. Sonst bleibt sie, wie sie war.
  const keep = previous && previous.warnPercent >= warnPercent;
  return { benefit, revenueEurMonth, warnPercent, limitAction, reachedAt: keep ? previous.reachedAt : null, confirmedAt: keep ? previous.confirmedAt : null };
}

const titleOf = (list: Choice[], id: string | null) => list.find((c) => c.id === id)?.title ?? '';

/** Die Vision in wenigen Zeilen. So liest sie jeder Agent bei jedem Lauf mit. */
export function visionLines(vision: ProductVision): string[] {
  const audience = [vision.audiences.map((id) => titleOf(AUDIENCES, id)).join(', '), vision.audienceNote].filter(Boolean).join(': ');
  const success = [vision.successIds.map((id) => titleOf(SUCCESS_MEASURES, id)).join(', '), vision.successNote].filter(Boolean).join(': ');
  return [
    vision.productType ? `- Produkt: ${titleOf(PRODUCT_TYPES, vision.productType)}` : '',
    audience ? `- Für: ${audience}` : '',
    vision.problem ? `- Problem: ${vision.problem}` : '',
    success ? `- Erfolg heißt: ${success}` : '',
    vision.nonGoals ? `- Bewusst nicht: ${vision.nonGoals}` : '',
  ].filter(Boolean);
}

export function visionMarkdown(companyName: string, vision: ProductVision): string {
  return `# Produktvision von ${companyName}\n\nFestgelegt von der Firmenleitung. Richte deine Arbeit daran aus; was nicht dazu passt, sprich an.\n\n${visionLines(vision).join('\n')}\n`;
}

export function businessCaseMarkdown(companyName: string, bc: BusinessCase, budgetEur: number): string {
  const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
  const facts = [
    bc.benefit ? `- Nutzen: ${bc.benefit}` : '',
    bc.revenueEurMonth !== null ? `- Erwarteter Erlös: ${eur(bc.revenueEurMonth)} im Monat` : '',
    `- KI-Budget: ${eur(budgetEur)}`,
    `- Prüfung bei ${bc.warnPercent} % des Budgets: ${bc.limitAction === 'anhalten' ? 'neue Arbeit hält an, bis die Firmenleitung entscheidet' : 'Warnung an die Firmenleitung'}`,
  ].filter(Boolean);
  return [`# Business Case von ${companyName}`, '', ...facts, '', 'Arbeite so, dass der Nutzen die Kosten trägt. Teure Umwege sprichst du vorher an.', ''].join('\n');
}

/** Ob neue Arbeit wegen des Business Case wartet. */
export const businessCaseHolds = (bc: BusinessCase | null | undefined) => !!bc && bc.limitAction === 'anhalten' && bc.reachedAt !== null && bc.confirmedAt === null;
