import type { Fx, OrderStatus, Run, RunStatus } from '../../shared/types.ts';

/** Kleine Beträge bleiben lesbar: Ein Haiku-Lauf kostet oft nur Bruchteile eines Cents. */
export function eur(n: number): string {
  const digits = n > 0 && n < 0.01 ? 4 : 2;
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`;
}

/** Für Schätzungen, die Untergrenzen sind. Winzige Beträge sollen nicht wie null aussehen. */
export const eurFrom = (n: number) => (n > 0 && n < 0.0001 ? 'unter 0,0001 €' : `ab ${eur(n)}`);

/** Freies Budget wird abgerundet: Es soll nie mehr anzeigen, als wirklich da ist. */
export const eurFree = (n: number) => eur(Math.floor(n * 100) / 100);

export const usd = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 6, maximumFractionDigits: 6 })} $`;
export const count = (n: number) => n.toLocaleString('de-DE');
export const percent = (n: number) => `${Math.round(n * 100)} %`;

export const time = (ms: number) =>
  new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function duration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toLocaleString('de-DE', { maximumFractionDigits: 1 })} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export function untilTime(ms: number): string {
  const minutes = Math.round((ms - Date.now()) / 60000);
  if (minutes <= 0) return 'gleich';
  if (minutes < 90) return `in ${minutes} min`;
  const hours = minutes / 60;
  if (hours < 36) return `in ${Math.round(hours)} h`;
  return `in ${Math.round(hours / 24)} Tagen`;
}

export const ORDER_STATUS: Record<OrderStatus, string> = {
  running: 'In Arbeit',
  review: 'Wartet auf Abnahme',
  accepted: 'Abgenommen',
  rejected: 'Abgelehnt',
  failed: 'Fehlgeschlagen',
  stopped: 'Gestoppt',
  limit: 'Limit erreicht',
};

export const RUN_STATUS: Record<RunStatus, string> = {
  running: 'läuft',
  success: 'fertig',
  limit: 'Limit erreicht',
  error: 'Fehler',
  stopped: 'gestoppt',
  timeout: 'Zeitlimit',
  interrupted: 'unterbrochen',
};

export const RUN_KIND: Record<Run['kind'], string> = {
  interview: 'Vorstellungsgespräch',
  order: 'Auftrag',
  revision: 'Korrektur',
  chat: 'Gespräch',
  meeting: 'Besprechung',
  manage: 'Planung eines Projekts',
  help: 'Hilfe für einen Kollegen', planning: 'Planning',
};

export function fxNote(fx: Fx): string {
  const rate = (1 / fx.eurPerUsd).toLocaleString('de-DE', { maximumFractionDigits: 4 });
  if (fx.source === 'ersatzwert') return 'Kein Wechselkurs abrufbar, 1 $ wird als 1 € angesetzt.';
  return `EZB-Referenzkurs vom ${new Date(fx.date).toLocaleDateString('de-DE')}: 1 € = ${rate} $`;
}
