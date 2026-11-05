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
