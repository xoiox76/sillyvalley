// Was an der Tafel hängt. Server, Ansicht und Welt lesen dieselbe Liste, damit das Bild dem Stand entspricht.

import { ROLES } from './catalog.ts';
import type { Company, CompanyRole } from './types.ts';

export interface BoardNote {
  id: string;
  title: string;
  /** Wer den Zettel angehängt hat. */
  byAgentId: string | null;
  kind: 'idee' | 'vorschlag' | 'eigen';
  mandateId: string | null;
  /** Für wen der Zettel gedacht ist, in Worten. */
  role: string;
  /** Wer ihn bearbeiten soll, wenn das schon feststeht. */
  workerId: string | null;
}

export const NOTE_COLORS = ['#f7d774', '#8fd6e8', '#f29ab1', '#a8e6a1', '#f5ad6b', '#c9b2f0', '#7fe0c8', '#ee9f8f'];
/** Ein Zettel ohne Rolle. */
const NO_ROLE_COLOR = '#efe9d8';

export const roleColor = (company: Pick<Company, 'roles'>, role: CompanyRole) => role.color ?? NOTE_COLORS[Math.max(0, company.roles.indexOf(role)) % NOTE_COLORS.length];

/** Zettel der Agenten und offene Vorschläge aus Projekten. */
export function boardNotes(company: Pick<Company, 'board' | 'mandates'>): BoardNote[] {
  const ideas: BoardNote[] = (company.board ?? []).filter((n) => n.status === 'open').map((n) => ({ id: n.id, title: n.title, byAgentId: n.byAgentId, kind: n.byAgentId ? 'idee' : 'eigen', mandateId: null, role: n.role, workerId: null }));
  const proposals: BoardNote[] = company.mandates.flatMap((m) => m.proposals.filter((p) => p.status === 'pending').map((p): BoardNote => ({ id: p.id, title: p.title, byAgentId: m.managerId, kind: 'vorschlag', mandateId: m.id, role: '', workerId: p.team.work })));
  return [...proposals, ...ideas];
}

/** Was im Büro an der Wand hängt: auch Zettel im Sprint, solange sie niemand abgeholt hat. */
export function wallNotes(company: Pick<Company, 'board' | 'mandates'>): BoardNote[] {
  const planned: BoardNote[] = (company.board ?? []).filter((n) => n.status === 'sprint').map((n) => ({ id: n.id, title: n.title, byAgentId: n.byAgentId, kind: n.byAgentId ? 'idee' : 'eigen', mandateId: null, role: n.role, workerId: null }));
  return [...boardNotes(company), ...planned];
}

/** Wer einen Zettel abgeholt hat: die Person, die jetzt daran arbeitet. Weggeworfene holt niemand. */
export function noteTaker(company: Pick<Company, 'board' | 'mandates' | 'orders'>, noteId: string): string | null {
  const item = (company.board ?? []).find((n) => n.id === noteId);
  const proposal = company.mandates.flatMap((m) => m.proposals).find((p) => p.id === noteId);
  const orderId = item?.orderId ?? proposal?.orderId ?? null;
  const order = company.orders.find((o) => o.id === orderId);
  if (order) return order.stages[0]?.agentId ?? null;
  return company.mandates.find((m) => m.id === item?.mandateId)?.managerId ?? null;
}

/** Zu welcher Rolle ein Zettel gehört: die genannte, sonst die Rolle der vorgesehenen Person, sonst die des Verfassers. */
export function noteLook(company: Pick<Company, 'roles' | 'agents'>, note: Pick<BoardNote, 'role' | 'workerId' | 'byAgentId'>): { role: string; color: string; ink: string } {
  const roles = company.roles ?? [];
  const look = (role: string, color: string) => ({ role, color, ink: noteInk(color) });
  const ofRole = (role: CompanyRole) => look(role.title, roleColor({ roles }, role));
  const ofAgent = (id: string | null) => {
    const agent = company.agents.find((a) => a.id === id);
    if (!agent) return null;
    const own = roles.find((r) => r.id === agent.companyRoleId);
    if (own) return ofRole(own);
    const index = ROLES.findIndex((r) => r.id === agent.roleId);
    return index < 0 ? null : look(agent.job?.title || ROLES[index].title, NOTE_COLORS[index % NOTE_COLORS.length]);
  };
  const wanted = note.role.trim().toLowerCase();
  if (wanted) {
    const named = roles.find((r) => r.title.toLowerCase() === wanted) ?? roles.find((r) => r.title.toLowerCase().includes(wanted) || wanted.includes(r.title.toLowerCase()));
    if (named) return ofRole(named);
    const person = company.agents.find((a) => a.name.toLowerCase() === wanted);
    const byPerson = person && ofAgent(person.id);
    if (byPerson) return byPerson;
    const index = ROLES.findIndex((r) => r.title.toLowerCase() === wanted);
    if (index >= 0) return look(ROLES[index].title, NOTE_COLORS[index % NOTE_COLORS.length]);
  }
  return ofAgent(note.workerId) ?? ofAgent(note.byAgentId) ?? look('', NO_ROLE_COLOR);
}

/** Dunkle Schrift auf hellen Zetteln, helle auf dunklen. */
export function noteInk(color: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 120 ? '#33261a' : '#fbf6ea';
}

const scale = (color: string, factor: number) => `#${[1, 3, 5].map((at) => Math.round(parseInt(color.slice(at, at + 2), 16) * factor).toString(16).padStart(2, '0')).join('')}`;
/** Die dunklere Kante eines Zettels an der Tafel. */
export const noteEdge = (color: string) => scale(color, 0.8);
