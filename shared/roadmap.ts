// Die Roadmap: alle Aufgaben der Firma und wer sie verantwortet. Sie wird aus dem echten Stand berechnet und hat keinen eigenen.

import { noteLook } from './board.ts';
import type { Company } from './types.ts';

export type RoadmapPhase = 'jetzt' | 'naechstes' | 'spaeter' | 'erledigt';

export const ROADMAP_PHASES: { id: RoadmapPhase; title: string }[] = [
  { id: 'jetzt', title: 'Jetzt' },
  { id: 'naechstes', title: 'Als Nächstes' },
  { id: 'spaeter', title: 'Später' },
  { id: 'erledigt', title: 'Erledigt' },
];

export interface RoadmapRow {
  id: string;
  title: string;
  phase: RoadmapPhase;
  state: string;
  /** Wer verantwortlich ist. null: noch niemand. */
  ownerId: string | null;
  /** Für wen die Aufgabe gedacht ist, solange sie niemand hat. */
  wanted: string;
  /** Sprint, Projekt oder Tafel. */
  context: string;
  costEur: number | null;
  /** Der Auftrag dahinter, falls es einen gibt. */
  orderId: string | null;
}

const ORDER_STATE: Record<Company['orders'][number]['status'], string> = {
  running: 'In Arbeit', review: 'Wartet auf deine Abnahme', accepted: 'Abgenommen', rejected: 'Abgelehnt', failed: 'Fehlgeschlagen', stopped: 'Angehalten', limit: 'Limit erreicht',
};

export function roadmapRows(company: Pick<Company, 'orders' | 'runs' | 'mandates' | 'board' | 'sprints' | 'roles' | 'agents'>): RoadmapRow[] {
  const sprintName = (id: string | null | undefined) => {
    const sprint = (company.sprints ?? []).find((s) => s.id === id);
    return sprint ? `Sprint ${sprint.number}` : null;
  };
  const mandateName = (id: string | null | undefined) => {
    const mandate = company.mandates.find((m) => m.id === id);
    return mandate ? `Projekt: ${mandate.goal}` : null;
  };
  const cost = (filter: (run: Company['runs'][number]) => boolean) => company.runs.filter(filter).reduce((sum, r) => sum + r.costEur, 0);
  const rows: RoadmapRow[] = [];
  for (const order of company.orders) {
    const done = order.status === 'accepted' || order.status === 'rejected';
    rows.push({
      id: order.id, title: order.title, phase: done ? 'erledigt' : 'jetzt', state: ORDER_STATE[order.status],
      ownerId: order.stages.find((stage) => stage.kind === 'work')?.agentId ?? order.agentId, wanted: '',
      context: sprintName(order.sprintId) ?? mandateName(order.mandateId) ?? 'Einzelauftrag', costEur: cost((r) => r.orderId === order.id), orderId: order.id,
    });
  }
  for (const mandate of company.mandates) {
    rows.push({
      id: mandate.id, title: mandate.goal, phase: mandate.status === 'closed' ? 'erledigt' : 'jetzt',
      state: mandate.status === 'closed' ? 'Abgeschlossen' : mandate.status === 'planning' ? 'Wird geplant' : 'Läuft',
      ownerId: mandate.managerId, wanted: '', context: 'Projekt', costEur: cost((r) => r.mandateId === mandate.id), orderId: null,
    });
    for (const proposal of mandate.proposals) {
      if (proposal.status !== 'pending') continue;
      rows.push({ id: proposal.id, title: proposal.title, phase: 'naechstes', state: 'Wartet auf deine Freigabe', ownerId: proposal.team.work, wanted: '', context: `Projekt: ${mandate.goal}`, costEur: null, orderId: null });
    }
  }
  for (const note of company.board ?? []) {
    if (note.status !== 'open' && note.status !== 'later' && note.status !== 'sprint') continue;
    const sprint = note.status === 'sprint' ? (company.sprints ?? []).find((s) => s.noteIds.includes(note.id)) : null;
    rows.push({
      id: note.id, title: note.title, phase: note.status === 'open' ? 'naechstes' : note.status === 'later' ? 'spaeter' : 'jetzt',
      state: note.status === 'open' ? 'An der Tafel' : note.status === 'later' ? 'Zurückgelegt' : 'Im Sprint, noch nicht vergeben', ownerId: null,
      wanted: noteLook(company, { role: note.role, workerId: null, byAgentId: null }).role || note.role,
      context: sprintName(sprint?.id) ?? 'Tafel', costEur: null, orderId: null,
    });
  }
  return rows;
}
