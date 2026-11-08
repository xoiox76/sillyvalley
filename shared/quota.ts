// Das Abo-Kontingent, wie es der Agenten-Prozess meldet. Ist es aufgebraucht, haben die Mitarbeiter dieses Abos Feierabend.

import type { PlanStatus } from './types.ts';

/** Bis wann das Kontingent leer ist, oder null, wenn gearbeitet werden kann. */
export function quotaClosedUntil(plan: PlanStatus | null | undefined, now: number): number | null {
  if (plan?.status !== 'rejected') return null;
  const windows = [plan.fiveHour, plan.sevenDay].filter((w): w is NonNullable<typeof w> => Boolean(w));
  const full = windows.filter((w) => w.utilization >= 1);
  const known = (full.length ? full : windows).map((w) => w.resetsAt).filter((t) => t > 0);
  // Meldet der Anbieter keinen Zeitpunkt, versucht es die Firma nach einer Stunde wieder.
  const until = known.length ? Math.max(...known) : plan.at + 3_600_000;
  return until > now ? until : null;
}

/* ---------- Tageslicht: Das Büro zeigt, wie viel vom Nutzungsguthaben noch übrig ist ---------- */

/** Ab diesem Verbrauch ist Nacht. */
export const NIGHT_AT = 0.98;
/** Ab diesem Verbrauch gehen die Mitarbeiter heim, weil es dunkel ist. */
export const HOME_AT = 0.99;

/** Die Tageszeiten nach Verbrauch, wie sie die Leitung festgelegt hat. Bis zu dieser Grenze gilt die jeweilige Zeit. */
export const DAY_PHASES: { until: number; name: string; dark: number }[] = [
  { until: 0.3, name: 'Heller Tag', dark: 0 },
  { until: 0.5, name: 'Nachmittag', dark: 0.15 },
  { until: 0.65, name: 'Später Nachmittag', dark: 0.3 },
  { until: 0.9, name: 'Früher Abend', dark: 0.6 },
  { until: NIGHT_AT, name: 'Spätabend', dark: 0.85 },
  { until: Infinity, name: 'Nacht', dark: 1 },
];

/** Verbrauch des Abos, 0 bis 1: das vollere der beiden Fenster. null, wenn kein Abo gemeldet ist. */
export function quotaUsed(plan: PlanStatus | null | undefined): number | null {
  const windows = [plan?.fiveHour, plan?.sevenDay].filter((w): w is NonNullable<typeof w> => Boolean(w));
  if (!windows.length) return null;
  return Math.max(...windows.map((w) => w.utilization));
}

export function dayPhase(used: number): string {
  return DAY_PHASES.find((p) => used < p.until)!.name;
}

/** Wie dunkel es ist, 0 Tag bis 1 Nacht. Innerhalb jeder Tageszeit stetig, damit nichts springt. */
export function darkness(used: number): number {
  if (used >= NIGHT_AT) return 1;
  let from = 0;
  let level = 0;
  for (const p of DAY_PHASES) {
    if (used < p.until) {
      const t = (used - from) / (p.until - from);
      return level + (p.dark - level) * Math.max(0, Math.min(1, t));
    }
    from = p.until;
    level = p.dark;
  }
  return 1;
}

export const isNight = (used: number) => used >= HOME_AT;
