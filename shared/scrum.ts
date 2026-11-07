// Scrum: Wer es freischaltet, wie viel ein Sprint gebunden hat und was das Board zeigt.
// Das Board wird aus dem echten Stand von Zetteln und Aufträgen berechnet, es hat keinen eigenen.

import { agentTitle } from './catalog.ts';
import type { Agent, BoardItem, Company, Order, Sprint } from './types.ts';

/** Die Vorlage zählt, und eine eigene Rolle, die so heisst. */
export const isScrumMaster = (agent: Agent) => agent.roleId === 'scrum' || /scrum/i.test(agentTitle(agent));

export const scrumMaster = (company: Pick<Company, 'agents'>): Agent | null =>
  company.agents.find((a) => a.hired && !a.firedAt && isScrumMaster(a)) ?? null;

export const isProductOwner = (agent: Agent) => agent.roleId === 'po' || /product owner/i.test(agentTitle(agent));

export const productOwner = (company: Pick<Company, 'agents'>): Agent | null =>
  company.agents.find((a) => a.hired && !a.firedAt && isProductOwner(a)) ?? null;

/** Wer das Planning hält: der Scrum Master, sonst der Product Owner. */
export const sprintPlanner = (company: Pick<Company, 'agents'>): Agent | null => scrumMaster(company) ?? productOwner(company);

/** Das Backlog in der Reihenfolge des Product Owners. Noch nicht Eingeordnetes kommt danach, in der alten Reihenfolge. */
export const byRank = <T extends { rank?: number }>(items: T[]): T[] =>
  items.map((item, index) => ({ item, index })).sort((a, b) => (a.item.rank ?? 1e9) - (b.item.rank ?? 1e9) || a.index - b.index).map((x) => x.item);

/** Es läuft immer nur ein Sprint. */
export const openSprint = (company: Pick<Company, 'sprints'>): Sprint | null => (company.sprints ?? []).find((s) => s.status !== 'closed') ?? null;

export type SprintColumn = 'offen' | 'arbeit' | 'abnahme' | 'fertig';
export const SPRINT_COLUMNS: { id: SprintColumn; title: string }[] = [
  { id: 'offen', title: 'Offen' },
  { id: 'arbeit', title: 'In Arbeit' },
  { id: 'abnahme', title: 'Abnahme' },
  { id: 'fertig', title: 'Fertig' },
];

const columnOf = (order: Order | null): SprintColumn => {
  if (!order) return 'offen';
  if (order.status === 'review') return 'abnahme';
  if (order.status === 'accepted' || order.status === 'rejected') return 'fertig';
  return 'arbeit';
};

export interface SprintRow {
  note: BoardItem;
  order: Order | null;
  column: SprintColumn;
}

export function sprintRows(company: Pick<Company, 'board' | 'orders'>, sprint: Sprint): SprintRow[] {
  return sprint.noteIds.flatMap((id) => {
    const note = company.board.find((n) => n.id === id);
    if (!note || note.status === 'dropped' || note.status === 'open' || note.status === 'later') return [];
    const order = company.orders.find((o) => o.id === note.orderId) ?? null;
    return [{ note, order, column: columnOf(order) }];
  });
}

/** Laufende Aufträge binden ihr ganzes Limit, alle anderen, was sie wirklich gekostet haben. */
export function sprintCommitted(company: Pick<Company, 'orders' | 'runs'>, sprint: Sprint): number {
  return company.orders.filter((o) => o.sprintId === sprint.id).reduce((sum, order) => {
    const spent = company.runs.filter((r) => r.orderId === order.id).reduce((total, r) => total + r.costEur, 0);
    return sum + (order.status === 'running' ? Math.max(order.limitEur, spent) : spent);
  }, 0);
}
