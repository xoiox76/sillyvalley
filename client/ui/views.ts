// Alle Ansichten als reine Funktionen des Spielstands. Aktionen laufen über data-action in game.ts.

import {
  DEFAULT_CEO, FURNITURE, isProp, staffOf, LOOK_OPTIONS, MODELS, PRICES_AS_OF, PROVIDERS, ROLES, RULES, SKILLS, costFromUsage, furnitureByKind,
  BASE_CONTEXT_TOKENS, agentTitle, estimateStepUsd, estimateTokensOfChars, locationById, modelById, roleById, skillById, skillTitle,
} from '../../shared/catalog.ts';
import { deskDepartment } from '../../shared/layout.ts';
import { NOTE_COLORS, boardNotes, noteLook, roleColor, type BoardNote } from '../../shared/board.ts';
import { colorInText } from '../../shared/roleMarkdown.ts';
import { ROADMAP_PHASES, roadmapRows } from '../../shared/roadmap.ts';
import { CONNECTION_KINDS, OPENAI_PRICES_AS_OF, connectionKind } from '../../shared/providers.ts';
import { SPRINT_COLUMNS, openSprint, scrumMaster, sprintCommitted, sprintRows } from '../../shared/scrum.ts';
import { EXTEND_COST, SHAFT_COST, buildLimits, buildingAt, floorCost, floorName, floorOf, isShaft, roomAt, roomOf } from '../../shared/building.ts';
import type { Agent, BoardItem, CommandRequest, Company, CompanyRole, Contract, CustomSkill, Department, LiveKind, Look, Mandate, Meeting, Order, Pool, ProjectAgent, Proposal, Run, Snapshot, Sprint, Stage, StageKind, Team } from '../../shared/types.ts';
import { HOME_ROOMS, TOWN_NAME, parcelById, type Parcel } from '../../shared/town.ts';
import { portraitUrl } from '../world/characters.ts';
import type { FileEntry } from './api.ts';
import { api } from './api.ts';
import { ORDER_STATUS, RUN_KIND, RUN_STATUS, count, duration, eur, eurFree, eurFrom, fxNote, percent, time, untilTime, usd } from './format.ts';
import { Safe, html } from './html.ts';

export interface HireDraft {
  roleId: string;
  /** Gesetzt: Die Einstellung folgt einer Rolle, die du definiert hast. Stelle und Fähigkeiten kommen von dort. */
  companyRoleId: string | null;
  skillIds: string[];
  modelId: string;
  name: string;
  look: Look;
  /** Gewählter Arbeitsplatz. null: der erste freie. */
  deskId: string | null;
  /** Neue Fähigkeiten dieser Ausschreibung: beschrieben oder als Datei. */
  customSkills: { key: string; title: string; instruction: string; source: CustomSkill['source'] }[];
  /** Zeichenzahl von Titel, Aufgabe und Anforderungen, für die Anzeige von Kontext und Kosten. */
  textChars: Record<string, number>;
  skillError: string;
  error: string;
  busy: boolean;
}

export interface NoteDraft {
  error: string;
  busy: boolean;
  /** Ein vorhandener Zettel, der geändert wird. */
  note?: BoardItem;
}

export type LaptopApp = 'hilfe' | 'nachrichten' | 'browser' | 'roadmap' | 'dateien' | 'akten' | 'rollen' | 'sprint' | 'einstellungen';

export interface FilesDraft {
  /** null: der Schreibtisch von PineappleOS, kein Programm offen. */
  app: LaptopApp | null;
  /** Woher der Browser geöffnet wurde. Dorthin führt Zurück. */
  browserFrom: LaptopApp | null;
  /** Wechselt beim Neuladen, damit die Seite wirklich neu lädt. */
  browserKey: number;
  /** Die Änderungen des offenen Auftrags im Repo. null: noch nicht geladen. */
  diff: string | null;
  /** Welcher Anbieter gerade verbunden wird. */
  connectionKind: string;
  /** Die offene Mail in der Post: der Auftrag dahinter. */
  mailId: string | null;
  /** Der Filter der Roadmap: eine Person, 'niemand' oder null für alle. */
  roadmapOwner: string | null;
  /** Die offene Datei im Programm Dateien, samt fertigem Text für die Vorschau. */
  filePath: string | null;
  fileDoc: string | null;
  agentId: string | null;
  /** Das Rollenprogramm: welche Rolle offen ist, null für eine neue. */
  roleId: string | null;
  roleText: string;
  /** Wechselt mit jedem geladenen Text, damit das Eingabefeld ihn übernimmt. */
  roleKey: number;
  roleError: string;
  roleNote: string;
}

export interface TeamDraft {
  id: string | null;
  name: string;
  purpose: string;
  memberIds: string[];
  leadId: string | null;
  error: string;
  busy: boolean;
}

export interface DepartmentDraft {
  i: number;
  j: number;
  w: number;
  d: number;
  error: string;
  busy: boolean;
}

export type SelfStartMode = 'none' | 'upto' | 'all';

export interface MandateDraft {
  /** Vorbelegt, wenn das Projekt von einem Zettel kommt. */
  goal?: string;
  notes?: string;
  noteId?: string | null;
  teamId: string | null;
  textChars: number;
  managerId: string;
  mode: SelfStartMode;
  webAccess: boolean;
  error: string;
  busy: boolean;
}

export interface OrderTeamDraft {
  plan: string | null;
  work: string;
  check: string | null;
}

export interface MeetingDraft {
  teamId: string | null;
  participantIds: string[];
  moderatorId: string;
  error: string;
  busy: boolean;
}

export interface OrderDraft {
  /** Gewähltes Team: Die Stufen bieten dann nur dessen Mitglieder an. */
  teamId: string | null;
  /** Zeichen von Ziel, Hinweisen und Kriterien, für die Anzeige von Kontext und Kosten. */
  textChars: number;
  team: OrderTeamDraft;
  title?: string;
  notes?: string;
  /** Der Zettel von der Tafel, aus dem dieser Auftrag wird. */
  noteId?: string | null;
  criteria: { key: string; text: string }[];
  /** Der zuletzt vorgeschlagene Satz Kriterien. Solange er unverändert ist, folgt er der Arbeitsstufe. */
  suggestion: string[];
  webAccess: boolean;
  error: string;
  busy: boolean;
}

export interface ViewerState {
  files: string[];
  path: string;
  markdown: string | null;
  title: string;
}

const LIVE_TEXT: Record<LiveKind, string> = {
  idle: 'Frei',
  starting: 'Startet',
  thinking: 'Denkt nach',
  answering: 'Antwortet',
  reading: 'Liest',
  writing: 'Schreibt',
  searching: 'Recherchiert',
  waiting: 'Wartet auf Kontingent',
  handoff: 'Übergibt',
  meeting: 'In Besprechung',
  review: 'Wartet auf dich',
  done: 'Fertig',
  limit: 'Limit erreicht',
  error: 'Fehler',
  stopped: 'Gestoppt',
};

const portraitCache = new Map<string, string>();
export function portrait(look: Look): string {
  const key = JSON.stringify(look);
  if (!portraitCache.has(key)) portraitCache.set(key, portraitUrl(look));
  return portraitCache.get(key)!;
}

const agentSpent = (company: Company, id: string) => company.runs.filter((r) => r.agentId === id).reduce((sum, r) => sum + r.costEur, 0);
const orderSpent = (company: Company, order: Order) => company.runs.filter((r) => r.orderId === order.id).reduce((sum, r) => sum + r.costEur, 0);
const activeRun = (company: Company, agentId: string) => company.runs.find((r) => r.agentId === agentId && r.status === 'running');

function pricePerMillion(modelId: string, eurPerUsd: number): Safe {
  const price = modelById(modelId)?.price;
  if (!price) return html``;
  return html`${eur(price.input * eurPerUsd)} / ${eur(price.output * eurPerUsd)}`;
}

function liveChip(agent: Agent): Safe {
  return html`<span class="chip chip-${agent.live.kind}">${LIVE_TEXT[agent.live.kind]}</span>`;
}

function meter(value: number, max: number, label: string): Safe {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return html`<div class="meter" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(share * 100)}">
    <div class="meter-fill ${share >= 1 ? 'over' : ''}" style="width:${share * 100}%"></div>
  </div>`;
}

/* ---------- Kontext und Kosten ---------- */

const tokenCount = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio.` : n.toLocaleString('de-DE'));

/** Belegung: gemessen, sobald der Agent einmal gelaufen ist, sonst die gemessene Grundlast eines neuen Agenten. */
const agentContextTokens = (agent: Agent) => agent.context?.tokens ?? BASE_CONTEXT_TOKENS;

function contextLine(agent: Agent, newTokens: number, fx: number, label?: string): Safe {
  const model = modelById(agent.modelId);
  const window = model?.contextWindow ?? 0;
  const used = agentContextTokens(agent);
  const after = used + newTokens;
  const share = window ? after / window : 0;
  return html`<div class="context-line" data-key="ctx-${label ?? ''}${agent.id}">
    <div class="spent-line"><span>${label ? html`${label}: ` : null}<strong>${agent.name}</strong>, ${model?.label}</span><span class="num">${tokenCount(after)} von ${tokenCount(window)}</span></div>
    ${meter(after, window, `Kontext von ${agent.name}`)}
    <small class="hint-small">${agent.context ? 'Gemessen beim letzten Lauf' : 'Noch nicht gemessen, Grundlast geschätzt'}${newTokens ? `, dazu rund ${tokenCount(newTokens)} aus diesem Text` : ''}. Jeder Schritt <span class="num">${eurFrom(estimateStepUsd(agent.modelId, used, newTokens) * fx)}</span>${share >= 0.8 ? html`. <strong class="warn">Das Gedächtnis ist fast voll.</strong>` : ''}</small>
  </div>`;
}

/** Die kurze Fassung im Fußbereich: Sie bleibt beim Tippen immer sichtbar, auch wenn das Fenster schmal ist. */
function contextStrip(entries: { who: string; used: number; window: number; stepEur: number }[]): Safe {
  return html`<p class="context-strip" aria-live="off">${entries.map((e) => html`<span data-key="${e.who}"><strong>${e.who}</strong> <span class="num">${tokenCount(e.used)} von ${tokenCount(e.window)}</span> Kontext, je Schritt <span class="num">${eurFrom(e.stepEur)}</span></span>`)}</p>`;
}

const agentStrip = (agent: Agent, newTokens: number, fx: number) => ({
  who: agent.name,
  used: agentContextTokens(agent) + newTokens,
  window: modelById(agent.modelId)?.contextWindow ?? 0,
  stepEur: estimateStepUsd(agent.modelId, agentContextTokens(agent), newTokens) * fx,
});

const COST_NOTE = 'Das ist die Untergrenze je Schritt: Der Kontext wird gelesen, neuer Text geschrieben. Die Antwort kostet zusätzlich, ihre Länge kennt vorher niemand. Abgerechnet wird, was gemessen ist.';

/** Durchschnitt der echten Läufe eines Mitarbeiters. Vorstellungsgespräche zählen nicht als Arbeit. */
function averageRunEur(company: Company, agentId: string): number | null {
  const runs = company.runs.filter((r) => r.agentId === agentId && r.status !== 'running' && r.kind !== 'interview');
  return runs.length ? runs.reduce((sum, r) => sum + r.costEur, 0) / runs.length : null;
}

function teamPicker(company: Company, chosen: string | null, action: string): Safe | null {
  if (!company.teams.length) return null;
  return html`<fieldset class="field"><legend>Team</legend>
    <div class="toggle-row" role="radiogroup" aria-label="Team">
      <button type="button" class="toggle ${chosen === null ? 'on' : ''}" role="radio" aria-checked="${chosen === null}" data-action="${action}" data-id="">Alle</button>
      ${company.teams.map((t) => html`<button type="button" class="toggle ${t.id === chosen ? 'on' : ''}" role="radio" aria-checked="${t.id === chosen}" data-action="${action}" data-id="${t.id}" title="${t.purpose}">${t.name}</button>`)}
    </div>
  </fieldset>`;
}

/* ---------- Team ---------- */

export const departmentOfAgent = (company: Company, agent: Agent): Department | null =>
  deskDepartment(company.departments, company.placed.find((p) => p.id === agent.deskId));

const freeDesks = (company: Company, department: Department | null) => {
  const taken = new Set(company.agents.map((a) => a.deskId));
  return company.placed.filter((p) => p.kind === 'desk' && !taken.has(p.id) && deskDepartment(company.departments, p)?.id === (department?.id ?? undefined));
};

function agentRow(company: Company, agent: Agent, selectedId: string | null): Safe {
  return html`<li data-key="${agent.id}">
    <button class="agent-row ${agent.id === selectedId ? 'selected' : ''}" data-action="select-agent" data-id="${agent.id}">
      <img class="portrait" src="${portrait(agent.look)}" alt="" />
      <span class="agent-row-text">
        <strong>${agent.name}</strong>
        <small>${agentTitle(agent)}, ${modelById(agent.modelId)?.label}</small>
      </span>
      <span class="agent-row-end">${liveChip(agent)}<small class="num">${eur(agentSpent(company, agent.id))}</small></span>
    </button>
  </li>`;
}

/* ---------- Befehle mit Freigabe ---------- */

const COMMAND_STATUS: Record<CommandRequest['status'], string> = {
  pending: 'Wartet auf dich', running: 'Läuft', done: 'Fertig', failed: 'Fehlgeschlagen', stopped: 'Gestoppt', declined: 'Abgelehnt', cancelled: 'Verfallen',
};

function commandCard(request: CommandRequest, projectDir: string | null): Safe {
  const pending = request.status === 'pending';
  return html`<li class="command command-${request.status}" data-key="${request.id}">
    <div class="proposal-head"><strong>${request.agentName} möchte das ausführen</strong><span class="chip chip-command-${request.status}">${COMMAND_STATUS[request.status]}</span></div>
    <pre class="command-text">${request.command}</pre>
    ${request.reason ? html`<p class="hint">Grund laut ${request.agentName}: ${request.reason}</p>` : null}
    ${pending ? html`
      <small class="hint-small">Im Ordner ${projectDir ?? 'des Projekts'}, mit deinen Rechten, ohne Absicherung und ohne Rückgängig.</small>
      ${request.risks.length ? html`<ul class="defects command-risks">${request.risks.map((risk, index) => html`<li data-key="${index}">${risk}</li>`)}</ul>` : html`<small class="hint-small">Keine Warnung erkannt. Das heißt nicht, dass er harmlos ist: Lies ihn trotzdem.</small>`}
      <label class="visually-hidden" for="note-${request.id}">Begründung für die Ablehnung</label>
      <input id="note-${request.id}" data-command-note maxlength="500" autocomplete="off" placeholder="Begründung bei Ablehnung (optional)" />
      <div class="btn-row">
        <button class="btn" data-action="decline-command" data-id="${request.id}">Ablehnen</button>
        <button class="btn btn-danger" data-action="approve-command" data-id="${request.id}">Genau diesen Befehl ausführen</button>
      </div>` : null}
    ${request.status === 'running' ? html`<button class="btn btn-small" data-action="stop-command" data-id="${request.id}">Stoppen</button>` : null}
    ${request.status === 'declined' && request.declineNote ? html`<p class="hint">Begründung: ${request.declineNote}</p>` : null}
    ${['done', 'failed', 'stopped'].includes(request.status) ? html`<details class="activity"><summary>Ausgabe, Code ${request.exitCode ?? 'unbekannt'}${request.durationMs !== null ? `, ${duration(request.durationMs)}` : ''}</summary><pre class="command-output">${request.output || '(keine Ausgabe)'}</pre>${request.truncated ? html`<small class="hint-small">Nur das Ende der Ausgabe.</small>` : null}</details>` : null}
  </li>`;
}

/** Offene Anträge stehen oben. Sie sind das Einzige, was den Agenten gerade aufhält. */
function commandsSection(s: Snapshot): Safe | null {
  const { company } = s;
  if (!company.commands.length) return null;
  const open = company.commands.filter((c) => c.status === 'pending' || c.status === 'running').reverse();
  const past = company.commands.filter((c) => c.status !== 'pending' && c.status !== 'running').slice(-5).reverse();
  return html`<section class="commands" data-key="commands">
    <h3>Befehle</h3>
    ${open.length ? html`<ul class="proposals">${open.map((c) => commandCard(c, company.projectDir))}</ul>` : null}
    ${past.length ? html`<details class="activity"><summary>Letzte Befehle</summary><ul class="proposals">${past.map((c) => commandCard(c, company.projectDir))}</ul></details>` : null}
  </section>`;
}

export function teamPanel(s: Snapshot, selectedId: string | null, selectedDepartment: string | null): Safe {
  const { company, seats, system } = s;
  const free = seats.total - seats.used;
  const canHire = system.provider.available && free > 0;
  const selected = company.agents.find((a) => a.id === selectedId) ?? null;
  const groups: { department: Department | null; agents: Agent[] }[] = [
    ...(company.departments.length ? [{ department: null, agents: staffOf(company).filter((a) => !departmentOfAgent(company, a)) }] : []),
    ...company.departments.map((department) => ({ department, agents: staffOf(company).filter((a) => departmentOfAgent(company, a)?.id === department.id) })),
  ];
  return html`
    <div class="panel-head"><h2>Team</h2><span class="panel-sub">${seats.used} von ${seats.total} Plätzen belegt</span></div>
    ${staffOf(company).length === 0 ? html`
      <p class="empty">Noch niemand eingestellt.</p>` : null}
    ${ceoSection(s)}
    ${commandsSection(s)}
    ${company.departments.length === 0
      ? html`<ul class="agent-list">${staffOf(company).map((agent) => agentRow(company, agent, selectedId))}</ul>`
      : groups.map((group) => {
        const pool = s.pools.find((p) => p.id === (group.department?.id ?? null))!;
        const open = group.department && group.department.id === selectedDepartment;
        return html`<section class="dept" data-key="dept-${group.department?.id ?? 'allgemein'}">
          <button class="dept-head ${open ? 'selected' : ''}" data-action="select-department" data-id="${group.department?.id ?? ''}" ${group.department ? '' : 'disabled'}>
            <span class="dept-dot" style="background:${group.department?.color ?? '#9db2c9'}"></span>
            <span class="dept-text"><strong>${pool.name}</strong><small>${group.agents.length === 1 ? '1 Person' : `${group.agents.length} Leute`}, ${eurFree(pool.remainingEur)} frei von ${eur(pool.budgetEur)}</small></span>
          </button>
          ${open && group.department ? departmentDetail(s, group.department, pool) : null}
          ${group.agents.length ? html`<ul class="agent-list">${group.agents.map((agent) => agentRow(company, agent, selectedId))}</ul>` : html`<p class="hint">${group.department ? 'Noch niemand hier. Stelle jemanden auf einen Platz in diesem Bereich ein oder rücke einen Schreibtisch hinein.' : 'Alle sitzen in Abteilungen.'}</p>`}
        </section>`;
      })}
    <button class="btn ${staffOf(company).length ? '' : 'btn-primary'} btn-wide" data-action="open-hire" ${canHire ? '' : 'disabled'}>Stelle ausschreiben</button>
    ${!system.provider.available ? html`<p class="hint">${system.provider.error}</p>`
      : free <= 0 ? html`<p class="hint">Kein freier Arbeitsplatz. Stelle unter Bauen einen Schreibtisch auf.</p>` : null}
    ${teamsSection(s)}
    ${meetingsSection(s)}
    ${selected ? agentDetail(s, selected) : null}`;
}

/** Die Subagents des eingebundenen Projekts, bereit zum Übernehmen. Einstellen bleibt eine Entscheidung mit echtem Gespräch. */
function projectAgentsSection(s: Snapshot, list: ProjectAgent[]): Safe | null {
  const { company, seats, system } = s;
  if (!company.projectDir) return null;
  const free = seats.total - seats.used;
  const fx = system.fx.eurPerUsd;
  const open = list.filter((a) => !a.adoptedBy);
  return html`<section class="meetings" data-key="project-agents">
    <div class="section-head"><h3>Bewerbungen aus dem Projektordner</h3><span class="panel-sub">${list.length ? `${open.length} von ${list.length} noch frei` : ''}</span></div>
    ${!list.length ? html`<p class="hint">Im Projekt liegen keine Subagents unter .claude/agents/.</p>` : html`
      ${free <= 0 && open.length ? html`<p class="hint">Kein freier Schreibtisch. Jede übernommene Rolle braucht einen Platz: Stelle unter Bauen einen auf.</p>` : null}
      <ul class="order-list">
        ${list.map((a) => html`<li data-key="${a.file}" class="project-agent">
          <div class="team-head"><strong>${a.name}</strong>${a.adoptedBy ? html`<span class="chip chip-done">Übernommen: ${a.adoptedBy}</span>` : null}</div>
          <details class="activity"><summary>${a.description.slice(0, 90)}${a.description.length > 90 ? '…' : ''}</summary><p class="job-text">${a.description}</p><small>${a.file}, rund ${tokenCount(estimateTokensOfChars(a.chars))} Tokens Anweisung</small></details>
          <div class="toggle-row">
            ${a.readOnly ? html`<span class="chip">Nur lesen, wie in der Datei</span>` : null}
            ${a.wantsCommands ? html`<span class="chip chip-review" title="Der Agent beantragt, du gibst jeden Befehl einzeln frei.">Befehle nur mit deiner Freigabe</span>` : null}
            ${a.blockedTools.filter((t) => t !== 'Bash').map((t) => html`<span class="chip" data-key="${t}" title="Dieses Werkzeug gibt es im Spiel nicht.">Ohne ${t}</span>`)}
          </div>
          ${a.adoptedBy ? null : html`<div class="btn-row project-adopt">
            <label class="visually-hidden" for="model-${a.name}">Modell für ${a.name}</label>
            <select id="model-${a.name}" class="model-select" data-project-model>
              ${MODELS.map((m) => html`<option value="${m.id}" ${m.id === (a.modelId ?? 'claude-sonnet-5-5') ? 'selected' : ''}>${m.label}, ${(m.price.input * fx).toLocaleString('de-DE', { maximumFractionDigits: 2 })} / ${(m.price.output * fx).toLocaleString('de-DE', { maximumFractionDigits: 2 })} €</option>`)}
            </select>
            <button class="btn btn-small" data-action="adopt-agent" data-file="${a.file}" ${free > 0 && system.provider.available ? '' : 'disabled'}>Einstellen</button>
          </div>`}
        </li>`)}
      </ul>
      <p class="hint">Die Anweisung aus der Datei wird wörtlich zum Profil. Das Einstellen ist ein echtes Vorstellungsgespräch, höchstens ${eur(RULES.interviewLimitEur)}. Befehle beantragt der Agent, und du gibst jeden einzeln frei. Gehalt: Eingabe / Ausgabe je Mio. Tokens.</p>`}
  </section>`;
}

const CEO_TOPS = ['#f8b62d', '#e5534b', '#2fa58f', '#3f7fd0', '#b05cc6', '#2a3347', '#e8edf0', '#6d4a30'];

/** Du selbst. Klicken oder die Pfeiltasten bewegen die Figur im Büro und in der Stadt. */
function ceoSection(s: Snapshot): Safe {
  const ceo = s.company.ceo ?? DEFAULT_CEO;
  return html`<details class="ceo-box" data-key="ceo">
    <summary><img class="portrait portrait-small" src="${portrait(ceo.look)}" alt="" /><span><strong>${ceo.name}</strong> <small>Geschäftsführung</small></span></summary>
    <form class="inline-form" data-form="ceo">
      <label class="visually-hidden" for="ceo-name">Dein Name</label>
      <input id="ceo-name" name="name" maxlength="20" autocomplete="off" value="${ceo.name}" />
      <button class="btn btn-small">Speichern</button>
    </form>
    <div class="look-row"><span>Haar</span>${LOOK_OPTIONS.hair.map((h) => html`<button type="button" class="swatch-text ${ceo.look.hair === h ? 'on' : ''}" data-action="ceo-look" data-field="hair" data-value="${h}" data-key="${h}">${h}</button>`)}</div>
    <div class="look-row"><span>Farbe</span>${LOOK_OPTIONS.hairColor.map((c) => html`<button type="button" class="swatch ${ceo.look.hairColor === c ? 'on' : ''}" style="background:${c}" data-action="ceo-look" data-field="hairColor" data-value="${c}" data-key="${c}" aria-label="Haarfarbe ${c}"></button>`)}</div>
    <div class="look-row"><span>Haut</span>${LOOK_OPTIONS.skin.map((c) => html`<button type="button" class="swatch ${ceo.look.skin === c ? 'on' : ''}" style="background:${c}" data-action="ceo-look" data-field="skin" data-value="${c}" data-key="${c}" aria-label="Hautton ${c}"></button>`)}</div>
    <div class="look-row"><span>Kleidung</span>${CEO_TOPS.map((c) => html`<button type="button" class="swatch ${ceo.look.top === c ? 'on' : ''}" style="background:${c}" data-action="ceo-look" data-field="top" data-value="${c}" data-key="${c}" aria-label="Kleidung ${c}"></button>`)}</div>
    <div class="look-row"><span>Brille</span><button type="button" class="swatch-text ${ceo.look.glasses ? 'on' : ''}" data-action="ceo-glasses">${ceo.look.glasses ? 'ja' : 'nein'}</button></div>
    <p class="hint">Im Büro und in der Stadt läufst du per Klick oder mit den Pfeiltasten.</p>
  </details>`;
}

/** Solange ein laufender Server noch den alten Stand liefert, bleibt die Oberfläche bedienbar. */
const rolesOf = (company: Company): CompanyRole[] => company.roles ?? [];

/** Fähigkeiten auswählen oder neu anlegen. Gleich beim Einstellen und beim Definieren einer Rolle. */
function skillsField(firm: CustomSkill[], draft: Pick<HireDraft, 'skillIds' | 'customSkills' | 'skillError'>): Safe {
  return html`<fieldset class="field"><legend>Fähigkeiten</legend>
    <div class="toggle-row">
      ${[...SKILLS, ...firm].map((skill) => html`<button type="button" class="toggle ${draft.skillIds.includes(skill.id) ? 'on' : ''}" data-action="hire-skill" data-id="${skill.id}" data-key="${skill.id}" title="${'blurb' in skill ? skill.blurb : 'Eigene Fähigkeit der Firma'}" aria-pressed="${draft.skillIds.includes(skill.id)}">${skill.title}</button>`)}
    </div>
    ${draft.customSkills.length ? html`<ul class="custom-skills">${draft.customSkills.map((skill) => html`<li data-key="${skill.key}">
      <span><strong>${skill.title}</strong> <small>${skill.source === 'datei' ? 'Datei' : 'beschrieben'}, rund ${tokenCount(estimateTokensOfChars(skill.instruction.length))} Tokens</small></span>
      <button type="button" class="icon-btn" data-action="hire-skill-remove" data-id="${skill.key}" aria-label="${skill.title} entfernen">×</button>
    </li>`)}</ul>` : null}
    <details class="skill-add" data-key="skill-add">
      <summary>Eigene Fähigkeit hinzufügen</summary>
      <label class="field"><span>Name</span><input data-skill="title" maxlength="60" autocomplete="off" placeholder="Zum Beispiel: Unser Schreibstil" /></label>
      <label class="field"><span>Beschreibung</span><textarea data-skill="instruction" rows="3" maxlength="${RULES.skillTextMax}" placeholder="Wie soll die Person vorgehen? Das wird wörtlich zur Arbeitsanweisung."></textarea></label>
      <div class="btn-row"><button type="button" class="btn btn-small" data-action="hire-skill-add">Hinzufügen</button>
        <label class="btn btn-small">Markdown-Datei wählen<input class="visually-hidden" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" data-action="hire-skill-file" /></label></div>
      ${draft.skillError ? html`<p class="form-error" role="alert">${draft.skillError}</p>` : null}
      <p class="hint">Sie landet wörtlich im Profil und wird bei jedem Lauf mitgelesen. Nimm nur Dateien, denen du vertraust. Die festen Grenzen gelten trotzdem: nur der Arbeitsbereich, keine Befehle, nichts nach außen.</p>
    </details>
  </fieldset>`;
}

function teamsSection(s: Snapshot): Safe {
  const { company } = s;
  const hired = company.agents.filter((a) => a.hired);
  const members = (team: Team) => team.memberIds.map((id) => company.agents.find((a) => a.id === id)).filter((a): a is Agent => Boolean(a));
  return html`<section class="meetings" data-key="teams">
    <div class="section-head"><h3>Teams</h3><button class="btn btn-small" data-action="open-team" ${hired.length ? '' : 'disabled'}>Team zusammenstellen</button></div>
    ${company.teams.length ? html`<ul class="order-list">
      ${company.teams.map((team) => {
        const lead = company.agents.find((a) => a.id === team.leadId);
        const tasks = company.mandates.filter((m) => m.teamId === team.id && m.status !== 'closed');
        return html`<li data-key="${team.id}" class="team-row">
        <div class="team-head"><strong>${team.name}</strong>
          <span class="team-faces">${members(team).map((a) => html`<img class="portrait portrait-tiny" src="${portrait(a.look)}" alt="${a.name}" title="${a.name}, ${agentTitle(a)}" data-key="${a.id}" />`)}</span></div>
        ${team.purpose ? html`<small>${team.purpose}</small>` : null}
        <small>${lead ? `Leitung: ${lead.name}` : 'Noch keine Teamleitung'}</small>
        ${tasks.length ? html`<ul class="team-tasks">${tasks.map((m) => {
          const pending = m.proposals.filter((p) => p.status === 'pending').length + m.contracts.filter((c) => c.status === 'pending').length;
          return html`<li data-key="${m.id}"><button type="button" class="text-btn" data-action="open-team-task" data-id="${m.id}">${m.goal}</button> <span class="chip chip-mandate-${pending ? 'pending' : m.status}">${pending ? `${pending} wartet auf dich` : MANDATE_STATUS[m.status]}</span></li>`;
        })}</ul>` : null}
        <div class="btn-row">
          <button class="btn btn-primary btn-small" data-action="open-mandate" data-team="${team.id}">Projekt geben</button>
          <button class="btn btn-small" data-action="open-order" data-team="${team.id}" title="Du besetzt selbst, wer plant, arbeitet und prüft.">Einzelauftrag</button>
          <button class="btn btn-small" data-action="open-team" data-id="${team.id}">Bearbeiten</button>
        </div>
      </li>`;
      })}
    </ul>` : html`<p class="hint">Stelle aus deinen Leuten Teams zusammen. Gib ihnen Projekte: Die Teamleitung verteilt die Arbeit an die Passenden, und du gibst frei.</p>`}
  </section>`;
}

export function teamModal(s: Snapshot, draft: TeamDraft): Safe {
  const { company } = s;
  const hired = company.agents.filter((a) => a.hired);
  const chosen = hired.filter((a) => draft.memberIds.includes(a.id));
  return html`
    <header class="modal-head"><div><h2>${draft.id ? 'Team bearbeiten' : 'Team zusammenstellen'}</h2><p class="modal-sub">Wer arbeitet zusammen, und wofür?</p></div>
      <button class="icon-btn" data-action="close-modal" aria-label="Schließen">×</button></header>
    <form class="modal-body panel-form" data-form="team">
      <label class="field"><span>Name</span><input name="name" maxlength="40" required autocomplete="off" value="${draft.name}" placeholder="Zum Beispiel: Produktteam" /></label>
      <label class="field"><span>Wofür ist das Team da? (optional)</span><textarea name="purpose" rows="2" maxlength="2000" placeholder="Die Teamleitung liest das, wenn sie ein Projekt verteilt.">${draft.purpose}</textarea></label>
      <fieldset class="field"><legend>Mitarbeiter</legend>
        <div class="slot-options">
          ${hired.map((a) => html`<button type="button" class="slot-option ${draft.memberIds.includes(a.id) ? 'selected' : ''}" aria-pressed="${draft.memberIds.includes(a.id)}" data-action="team-toggle" data-id="${a.id}" data-key="${a.id}" title="${a.skillIds.map((id) => skillTitle(company.customSkills, id)).join(', ') || 'Keine besonderen Fähigkeiten'}">
            <img class="portrait portrait-small" src="${portrait(a.look)}" alt="" />
            <span class="slot-name"><strong>${a.name}</strong><small>${agentTitle(a)}, ${modelById(a.modelId)?.label}</small></span>
          </button>`)}
        </div>
      </fieldset>
      ${chosen.length ? html`<fieldset class="field"><legend>Teamleitung</legend>
        <div class="toggle-row" role="radiogroup" aria-label="Teamleitung">
          ${chosen.map((a) => html`<button type="button" class="toggle ${a.id === draft.leadId ? 'on' : ''}" role="radio" aria-checked="${a.id === draft.leadId}" data-action="team-lead" data-id="${a.id}" data-key="${a.id}">${a.name}</button>`)}
        </div>
        <p class="hint">Sie nimmt Projekte entgegen und verteilt die Arbeit nach Rollen und Fähigkeiten im Team. Die Planung ist ein echter Lauf. Freigabe und Abnahme bleiben bei dir.</p>
      </fieldset>` : null}
      ${draft.error ? html`<p class="form-error" role="alert">${draft.error}</p>` : null}
      <div class="btn-row">
        ${draft.id ? html`<button type="button" class="btn" data-action="delete-team" data-id="${draft.id}">Auflösen</button>` : null}
        <button class="btn" type="button" data-action="close-modal">Abbrechen</button>
        <button class="btn btn-primary" ${draft.busy || !draft.memberIds.length ? 'disabled' : ''}>Speichern</button>
      </div>
    </form>`;
}

function departmentDetail(s: Snapshot, department: Department, pool: Pool): Safe {
  const { company } = s;
  const members = company.agents.filter((a) => a.hired && departmentOfAgent(company, a)?.id === department.id);
  const general = s.pools.find((p) => p.id === null)!;
  const active = company.mandates.filter((m) => m.departmentId === department.id && m.status !== 'closed').length;
  return html`
    <div class="detail dept-detail" data-key="detail">
      <div class="spent-line"><span>Budget der Abteilung</span><span class="num">${eur(pool.spentEur + pool.reservedEur)} belegt von ${eur(pool.budgetEur)}</span></div>
      ${meter(pool.spentEur + pool.reservedEur, pool.budgetEur, 'Budget der Abteilung')}
      <form class="inline-form" data-form="department-budget" data-id="${department.id}">
        <label class="visually-hidden" for="dept-budget-${department.id}">Budget in Euro</label>
        <input id="dept-budget-${department.id}" class="num" name="budget" type="number" min="0" step="0.1" value="${department.budgetEur}" />
        <button class="btn btn-small">Budget ändern</button>
      </form>
      <p class="hint">Was die Abteilung bekommt, fehlt im allgemeinen Budget (dort noch ${eurFree(general.remainingEur)} frei). Wessen Schreibtisch im Bereich steht, gehört dazu.</p>
      <div class="btn-row">
        <button class="btn btn-primary btn-small" data-action="open-mandate" data-department="${department.id}" ${members.length ? '' : 'disabled'}>Projekt geben</button>
        <button class="btn btn-small" data-action="redo-department" data-id="${department.id}">Neu abstecken</button>
        <button class="btn btn-small" data-action="open-file" data-path="${department.knowledgeDir}/abteilung.md">Wissen der Abteilung</button>
        <button class="btn btn-small" data-action="dissolve-department" data-id="${department.id}" ${active ? 'disabled' : ''}>Auflösen</button>
      </div>
    </div>`;
}

/* ---------- Besprechungen ---------- */

const MEETING_STATUS: Record<Meeting['status'], string> = {
  running: 'Läuft',
  decision: 'Wartet auf dich',
  closed: 'Beendet',
  stopped: 'Angehalten',
  limit: 'Limit erreicht',
  failed: 'Fehler',
};

const meetingSpent = (company: Company, meeting: Meeting) => company.runs.filter((r) => r.meetingId === meeting.id).reduce((sum, r) => sum + r.costEur, 0);

function meetingsSection(s: Snapshot): Safe {
  const { company, system } = s;
  const hired = company.agents.filter((a) => a.hired);
  const rooms = company.placed.filter((p) => p.kind === 'meeting');
  const meetings = [...company.meetings].reverse();
  const free = rooms.some((room) => !company.meetings.some((m) => m.status === 'running' && m.roomId === room.id));
  const can = system.provider.available && hired.length >= RULES.meetingMinParticipants && free;
  const hint = !rooms.length ? 'Für Besprechungen braucht es einen Besprechungsraum. Stelle ihn unter Bauen auf.'
    : hired.length < RULES.meetingMinParticipants ? 'Für eine Besprechung braucht es mindestens zwei Leute.'
    : !free ? 'Der Besprechungsraum ist gerade belegt.' : '';
  return html`
    <section class="meetings" data-key="meetings">
      <h3>Besprechungen</h3>
      <button class="btn btn-wide" data-action="open-meeting" ${can ? '' : 'disabled'}>Besprechung einberufen</button>
      ${hint ? html`<p class="hint">${hint}</p>` : null}
      ${meetings.length ? html`<ul class="order-list">
        ${meetings.map((m) => html`<li data-key="${m.id}">
          <button class="order-row" data-action="select-meeting" data-id="${m.id}">
            <span class="order-row-text"><strong>${m.topic}</strong><small>${m.participantIds.map((id) => company.agents.find((a) => a.id === id)?.name).filter(Boolean).join(', ')}</small></span>
            <span class="agent-row-end"><span class="chip chip-meeting-${m.status}">${MEETING_STATUS[m.status]}</span><small class="num">${eur(meetingSpent(company, m))}</small></span>
          </button></li>`)}
      </ul>` : null}
    </section>`;
}

export function meetingPanel(s: Snapshot, meeting: Meeting): Safe {
  const { company } = s;
  const agentOf = (id: string) => company.agents.find((a) => a.id === id);
  const spent = meetingSpent(company, meeting);
  const running = meeting.status === 'running';
  const order = [...meeting.participantIds.filter((id) => id !== meeting.moderatorId), meeting.moderatorId];
  const speaker = agentOf(order[meeting.speakerIndex]);
  const speakerBusyElsewhere = running && !meeting.turnActive && company.runs.some((r) => r.agentId === speaker?.id && r.status === 'running');
  const status = !running ? MEETING_STATUS[meeting.status] : speakerBusyElsewhere ? `Wartet auf ${speaker?.name}` : `${speaker?.name} ${speaker?.live.kind === 'meeting' ? 'ist an der Reihe' : speaker?.live.detail ?? ''}`;
  const rounds: number[] = [...new Set(meeting.turns.map((t) => t.round))];
  const paused = meeting.status === 'stopped' || meeting.status === 'limit' || meeting.status === 'failed';
  const outcome = meeting.outcome;
  return html`
    <div class="panel-head"><h2>Besprechung</h2><button class="text-btn" data-action="back-team">Zurück zum Team</button></div>
    <div class="problem"><span class="problem-mark" aria-hidden="true">!</span><strong>${meeting.topic}</strong></div>
    ${meeting.notes ? html`<p class="hint">${meeting.notes}</p>` : null}
    <section class="participants">
      <h3>Teilnehmende</h3>
      <ul>
        ${meeting.participantIds.map((id) => {
          const agent = agentOf(id);
          if (!agent) return null;
          const speaks = running && meeting.turnActive && order[meeting.speakerIndex] === id;
          return html`<li data-key="${id}" class="participant ${speaks ? 'speaking' : ''}">
            <img class="portrait portrait-small" src="${portrait(agent.look)}" alt="" />
            <span class="stage-text"><strong>${agent.name}</strong><small>${id === meeting.moderatorId ? 'Moderation' : agentTitle(agent)}, ${modelById(agent.modelId)?.label}</small></span>
            ${speaks ? html`<span class="chip chip-thinking">Spricht</span>` : null}
          </li>`;
        })}
      </ul>
    </section>
    ${rounds.map((round) => html`<section class="turns" data-key="round-${round}">
      <h3>Runde ${round} von ${meeting.maxRounds}</h3>
      <ul>
        ${meeting.turns.filter((t) => t.round === round).map((turn) => {
          const agent = agentOf(turn.agentId);
          return html`<li data-key="${turn.id}"><details class="turn">
            <summary>${agent ? html`<img class="portrait portrait-tiny" src="${portrait(agent.look)}" alt="" />` : null}<span><strong>${agent?.name}:</strong> ${turn.short}</span></summary>
            <p>${turn.text}</p>
          </details></li>`;
        })}
      </ul>
    </section>`)}
    ${running && !rounds.includes(meeting.round) ? html`<p class="hint">Runde ${meeting.round} von ${meeting.maxRounds} beginnt.</p>` : null}
    <p class="live-line">${status}</p>
    <div class="spent-line"><span>Erfasst</span><span class="num">${eur(spent)} von ${eur(meeting.limitEur)}</span></div>
    ${meter(spent, meeting.limitEur, 'Limit der Besprechung')}
    ${outcome ? html`<section class="verdict ${outcome.agreed ? 'verdict-ok' : 'verdict-open'}" data-key="outcome">
      <h4>${outcome.agreed ? 'Vorschlag des Teams' : 'Vorschlag ohne Einigung'}</h4>
      <p>${outcome.proposal}</p>
      ${outcome.openPoints.length ? html`<h4>Offene Punkte</h4><ul class="defects">${outcome.openPoints.map((point, index) => html`<li data-key="${index}">${point}</li>`)}</ul>` : null}
    </section>` : null}
    ${outcome?.steps.length ? html`<section class="steps" data-key="steps">
      <h3>Nächste Schritte</h3>
      <ul>${outcome.steps.map((step, index) => html`<li data-key="${index}" class="step-row">
        <span class="stage-text"><span>${step.task}</span>${step.role ? html`<small>${step.role}</small>` : null}</span>
        <button class="btn btn-small" data-action="step-order" data-meeting="${meeting.id}" data-index="${index}">Als Auftrag planen</button>
      </li>`)}</ul>
    </section>` : null}
    ${meeting.status === 'decision' ? html`
      <div class="btn-row">
        <button class="btn btn-primary" data-action="decide-meeting" data-id="${meeting.id}" data-decision="accept">Beschließen</button>
        <button class="btn" data-action="decide-meeting" data-id="${meeting.id}" data-decision="reject">Verwerfen</button>
        <button class="btn" data-action="meeting-round" data-id="${meeting.id}">Noch eine Runde</button>
      </div>
      <p class="hint">Ein Beschluss landet im Firmenwissen. Dein Team hält sich bei späteren Aufträgen daran.</p>` : null}
    ${meeting.decision ? html`<p class="hint">${meeting.decision === 'accepted' ? 'Beschlossen. Dein Team findet es unter wissen/beschluesse.md.' : 'Verworfen. Das Protokoll bleibt erhalten.'}</p>` : null}
    ${paused ? html`
      <form class="revise-form" data-form="meeting-resume" data-id="${meeting.id}">
        <label class="inline-field"><span>Limit erhöhen um Euro</span><input class="num" name="addLimit" type="number" min="0" step="any" value="${meeting.status === 'limit' ? meeting.limitEur : 0}" /></label>
        <div class="btn-row"><button class="btn btn-primary">Fortsetzen</button><button type="button" class="btn" data-action="decide-meeting" data-id="${meeting.id}" data-decision="reject">Beenden</button></div>
      </form>` : null}
    <div class="btn-row">
      <button class="btn ${running ? 'btn-primary' : ''}" data-action="open-file" data-path="${meeting.protocolFile}">Protokoll öffnen</button>
      ${running ? html`<button class="btn" data-action="stop-meeting" data-id="${meeting.id}">Stoppen</button>` : null}
    </div>`;
}

export function meetingModal(s: Snapshot, draft: MeetingDraft): Safe {
  const { company, money } = s;
  const hired = company.agents.filter((a) => a.hired);
  const chosen = hired.filter((a) => draft.participantIds.includes(a.id));
  const limit = Math.ceil(chosen.reduce((sum, a) => sum + suggestedLimit(a.modelId), 0) * 50) / 100;
  return html`
    <header class="modal-head"><div><h2>Besprechung einberufen</h2><p class="modal-sub">Mehrere Köpfe, ein Thema, begrenzte Runden</p></div>
      <button class="icon-btn" data-action="close-modal" aria-label="Schließen">×</button></header>
    <form class="modal-body order-grid" data-form="meeting">
      <div class="order-main">
        <label class="field"><span>Worum geht es?</span><input name="topic" maxlength="140" required autocomplete="off" placeholder="Zum Beispiel: Welche Funktion bauen wir zuerst?" /></label>
        <label class="field"><span>Hinweise (optional)</span><textarea name="notes" rows="3" maxlength="4000" placeholder="Was soll das Team wissen?"></textarea></label>
        <fieldset class="field"><legend>So läuft es ab</legend>
          <p class="hint">Alle sprechen nacheinander und sehen, was vor ihnen gesagt wurde. Die Moderation spricht zuletzt und fasst zusammen. Am Ende steht ein Vorschlag, und du entscheidest.</p>
          <p class="hint">In einer Besprechung wird nur gelesen. Niemand ändert Dateien.</p>
        </fieldset>
      </div>
      <aside class="order-side">
        ${teamPicker(company, draft.teamId, 'meeting-team')}
        <fieldset class="field"><legend>Teilnehmende</legend>
          <div class="slot-options">
            ${hired.map((a) => html`<button type="button" class="slot-option ${draft.participantIds.includes(a.id) ? 'selected' : ''}" aria-pressed="${draft.participantIds.includes(a.id)}" data-action="meeting-toggle" data-id="${a.id}" title="${agentTitle(a)}">
              <img class="portrait portrait-small" src="${portrait(a.look)}" alt="" />
              <span class="slot-name"><strong>${a.name}</strong><small>${agentTitle(a)}</small></span>
            </button>`)}
          </div>
          <p class="hint">Zwei bis ${RULES.meetingMaxParticipants} Leute passen in den Raum.</p>
        </fieldset>
        <fieldset class="field"><legend>Moderation</legend>
          <div class="slot-options" role="radiogroup" aria-label="Moderation">
            ${chosen.map((a) => html`<button type="button" class="slot-option ${a.id === draft.moderatorId ? 'selected' : ''}" role="radio" aria-checked="${a.id === draft.moderatorId}" data-action="meeting-moderator" data-id="${a.id}">
              <img class="portrait portrait-small" src="${portrait(a.look)}" alt="" />
              <span class="slot-name"><strong>${a.name}</strong></span>
            </button>`)}
          </div>
        </fieldset>
        <fieldset class="field"><legend>Grenzen</legend>
          <label class="inline-field"><span>Runden</span><input class="num" name="rounds" type="number" min="1" max="${RULES.meetingMaxRounds}" step="1" value="2" /></label>
          <label class="inline-field"><span>Limit in Euro</span><input class="num" name="limit" type="number" min="0.001" step="any" value="${limit}" required /></label>
          <p class="hint">Frei im KI-Budget: <span class="num">${eurFree(money.remainingEur)}</span>. Das Limit verteilt sich gleichmäßig, damit alle zu Wort kommen.</p>
        </fieldset>
      </aside>
      <footer class="modal-foot">
        <p class="hint">${s.system.provider.billing === 'api' ? 'Der Start löst bezahlte KI-Arbeit aus.' : 'Der Start löst echte KI-Arbeit aus und verbraucht dein Kontingent.'}</p>
        ${draft.error ? html`<p class="form-error" role="alert">${draft.error}</p>` : null}
        <button class="btn" type="button" data-action="close-modal">Abbrechen</button>
        <button class="btn btn-primary" ${draft.busy || chosen.length < RULES.meetingMinParticipants || !draft.moderatorId ? 'disabled' : ''}>Besprechung starten</button>
      </footer>
    </form>`;
}

function agentDetail(s: Snapshot, agent: Agent): Safe {
  const { company } = s;
  const run = activeRun(company, agent.id);
  return html`
    <section class="detail" data-key="agent-${agent.id}">
      <h3>${agent.name} <small>${agentTitle(agent)}</small></h3>
      <p class="live-line">${agent.live.detail}</p>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="open-order" data-id="${agent.id}" ${run || !agent.hired ? 'disabled' : ''}>Auftrag geben</button>
        <button class="btn" data-action="open-mandate" data-manager="${agent.id}" ${run || !agent.hired ? 'disabled' : ''}>Projekt geben</button>
        ${run ? html`<button class="btn" data-action="stop-run" data-id="${run.id}">Stoppen</button>` : null}
      </div>
      ${workHistory(company, agent)}
      <h4>Gespräch</h4>
      <ul class="chat">
        ${agent.chat.slice(-12).map((line, index) => {
          const intro = company.runs.find((r) => r.id === line.runId)?.kind === 'interview';
          return html`<li data-key="${line.at}-${index}" class="chat-${line.from}"><strong>${line.from === 'agent' ? agent.name : 'Du'}</strong> <small>${intro ? 'Vorstellung, ' : ''}${time(line.at)}</small><p>${line.text}</p></li>`;
        })}
      </ul>
      ${agent.hired ? html`<div class="btn-row">
        ${(company.board ?? []).some((n) => n.status === 'open') ? html`<button class="btn btn-small" data-action="take-note" data-id="${agent.id}" ${run ? 'disabled' : ''}>${agent.name}, hol dir eine Aufgabe von der Tafel</button>` : null}
        <button class="btn btn-small" data-action="ask-next" data-id="${agent.id}" ${run ? 'disabled' : ''}>${agent.name}, häng deine Vorschläge an die Tafel</button>
      </div>` : null}
      ${agent.hired ? html`<form class="chat-form" data-form="chat" data-id="${agent.id}">
        <label class="visually-hidden" for="chat-${agent.id}">Nachricht an ${agent.name}</label>
        <input id="chat-${agent.id}" name="text" autocomplete="off" maxlength="1000" placeholder="${agent.name} ansprechen" ${run ? 'disabled' : ''} />
        <button class="btn" ${run ? 'disabled' : ''}>Senden</button>
      </form>
      <p class="hint">Jede Antwort ist ein echter Lauf mit höchstens ${eur(RULES.chatLimitEur)}.</p>
      <div class="btn-row"><button class="btn btn-small" data-action="open-agent-file" data-id="${agent.id}">Akte öffnen</button></div>` : null}
    </section>`;
}

/** Aufträge laufen nicht über das Gespräch, darum stehen sie hier. */
function workHistory(company: Company, agent: Agent): Safe | null {
  // Was gerade ansteht. Alles Erledigte steht in der Akte.
  const orders = company.orders.filter((o) => !['accepted', 'rejected'].includes(o.status) && o.stages.some((stage) => stage.agentId === agent.id));
  const projects = company.mandates.filter((m) => m.managerId === agent.id && m.status !== 'closed');
  if (!orders.length && !projects.length) return null;
  return html`<h4>Gerade</h4>
    <ul class="order-list" data-key="work-history">
      ${projects.slice(-3).reverse().map((m) => html`<li data-key="${m.id}"><button class="order-row" data-action="open-team-task" data-id="${m.id}"><span class="order-row-text"><strong>${m.goal}</strong><small>Projekt</small></span><span class="chip chip-mandate-${m.status}">${MANDATE_STATUS[m.status]}</span></button></li>`)}
      ${orders.slice(-5).reverse().map((o) => html`<li data-key="${o.id}"><button class="order-row" data-action="open-work" data-id="${o.id}"><span class="order-row-text"><strong>${o.title}</strong><small>${o.summary ? `${o.summary.replace(/\s+/g, ' ').slice(0, 90)}…` : 'Auftrag'}</small></span><span class="chip chip-order-${o.status}">${ORDER_STATUS[o.status]}</span></button></li>`)}
    </ul>`;
}

/* ---------- Mitarbeiterakten ---------- */

/** Was auf deine Entscheidung wartet. Das Bewerben aus dem Projektordner zählt nur, solange jemand frei ist. */
export function openMessages(s: Snapshot): number {
  const { company } = s;
  return company.commands.filter((c) => c.status === 'pending').length
    + company.mandates.reduce((sum, m) => sum + m.proposals.filter((p) => p.status === 'pending').length + m.contracts.filter((c) => c.status === 'pending').length, 0)
    + company.orders.filter((o) => o.status === 'review').length
    + (company.sprints ?? []).filter((sprint) => sprint.status === 'proposed').length;
}

/** Die Programme auf dem Laptop. Sprint erscheint, sobald die Firma Scrum arbeitet. */
function laptopApps(s: Snapshot, files: FileEntry[]): { id: LaptopApp; title: string; hint: string; glyph: string; badge: number }[] {
  const { company } = s;
  const sprint = openSprint(company);
  return [
    { id: 'nachrichten', title: 'Post', hint: 'Ergebnisse und alles, was auf deine Entscheidung wartet', glyph: '@', badge: openMessages(s) },
    { id: 'browser', title: 'Browser', hint: 'Ergebnisse direkt auf dem Laptop ansehen', glyph: '◎', badge: 0 },
    { id: 'roadmap', title: 'Roadmap', hint: 'Alle Aufgaben und wer sie verantwortet', glyph: '»', badge: 0 },
    { id: 'dateien', title: 'Dateien', hint: `Dateien der Firma, ${files.length} insgesamt`, glyph: '▤', badge: 0 },
    { id: 'akten', title: 'Akten', hint: 'Mitarbeiterakten mit Kosten und Ergebnissen', glyph: '☰', badge: 0 },
    { id: 'rollen', title: 'Rollen', hint: 'Rollen als Markdown definieren', glyph: '#', badge: 0 },
    ...(scrumMaster(company) || sprint || (company.sprints ?? []).length
      ? [{ id: 'sprint' as const, title: 'Sprint', hint: sprint ? `Sprint ${sprint.number}: ${SPRINT_STATUS[sprint.status]}` : 'Kein Sprint offen', glyph: '▦', badge: 0 }]
      : []),
    { id: 'hilfe', title: 'Tastenkürzel', hint: 'Alle Tastenkürzel des Spiels', glyph: '?', badge: 0 },
    { id: 'einstellungen', title: 'Einstellungen', hint: 'Anbieter und Modelle verbinden', glyph: '*', badge: 0 },
  ];
}

const SPRINT_STATUS: Record<Sprint['status'], string> = { planning: 'Planning läuft', proposed: 'wartet auf dich', running: 'läuft', review: 'beendet', closed: 'abgeschlossen' };

function appIcon(app: { id: LaptopApp; glyph: string; badge: number }): Safe {
  return html`<span class="os-icon os-icon-${app.id}" aria-hidden="true">${app.glyph}${app.badge ? html`<b class="os-badge">${app.badge}</b>` : null}</span>`;
}

/** Der Laptop am Chefplatz: Schreibtisch, Programme, Dock. Ein Programm ist zugleich offen. */
export function laptopModal(s: Snapshot, draft: FilesDraft, projectAgents: ProjectAgent[], files: FileEntry[], folds: WorkspaceFolds, companyId: string, confirmFire: string | null = null): Safe {
  const apps = laptopApps(s, files);
  const open = apps.find((app) => app.id === draft.app) ?? null;
  const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const content = (id: LaptopApp) =>
    id === 'nachrichten' ? messagesApp(s, projectAgents, draft, companyId)
    : id === 'hilfe' ? shortcutsApp()
    : id === 'browser' ? browserApp(s, draft, files, companyId)
    : id === 'roadmap' ? roadmapApp(s, draft)
    : id === 'einstellungen' ? settingsApp(s, draft)
    : id === 'rollen' ? rolesApp(s, draft)
    : id === 'dateien' ? shellApp(s, draft, files, folds, companyId)
    : id === 'sprint' ? sprintApp(s)
    : filesApp(s, draft, confirmFire);
  return html`<div class="os">
    <header class="os-bar">
      <div class="os-brand"><span class="os-logo" aria-hidden="true"></span><strong>PineappleOS</strong></div>
      <span class="os-active">${open?.title ?? 'Schreibtisch'}</span>
      <span class="os-clock num">${time}</span>
      <button class="os-shut" data-action="close-modal">Zuklappen</button>
    </header>
    <div class="os-desk">
      ${open ? null : html`<ul class="os-icons" data-key="os-icons">${apps.map((app) => html`<li data-key="${app.id}"><button class="os-launch" data-action="laptop-app" data-id="${app.id}" title="${app.hint}">${appIcon(app)}<span>${app.title}</span></button></li>`)}</ul>`}
      ${open ? html`<section class="os-window" data-key="win-${open.id}" aria-label="${open.title}">
        <div class="os-title"><button class="os-close" data-action="laptop-home" aria-label="${open.title} schliessen"></button><strong>${open.title}</strong></div>
        <div class="os-content">${content(open.id)}</div>
      </section>` : null}
    </div>
    <nav class="os-dock" aria-label="Programme">
      ${apps.map((app) => html`<button class="os-dock-app ${app.id === draft.app ? 'on' : ''}" data-key="${app.id}" data-action="laptop-app" data-id="${app.id}" title="${app.title}" aria-label="${app.title}" aria-pressed="${app.id === draft.app}">${appIcon(app)}</button>`)}
    </nav>
  </div>`;
}

const SHORTCUTS: { title: string; keys: [string, string][] }[] = [
  { title: 'Im Büro und in der Stadt', keys: [
    ['Pfeiltasten oder W A S D', 'laufen'],
    ['+ und -', 'zoomen, auch mit dem Mausrad'],
    ['0', 'Ansicht zurücksetzen'],
    ['Ziehen mit der Maus', 'Ansicht verschieben'],
    ['Bild auf, Bild ab', 'Etage wechseln'],
    ['Enter', 'am Chefplatz sitzend den Laptop öffnen'],
  ] },
  { title: 'Im Bau-Modus', keys: [
    ['Klick oder Enter', 'abstellen'],
    ['R oder Rechtsklick', 'drehen, beim Aufgang die Seite wählen'],
    ['I', 'ins Inventar legen'],
    ['Entf oder Rücktaste', 'löschen, ein zweiter Druck bestätigt'],
    ['Esc', 'abbrechen'],
  ] },
  { title: 'Fenster und Laptop', keys: [
    ['Esc', 'im Browser zurück, sonst das Fenster schliessen'],
  ] },
  { title: 'In der Mac-App', keys: [
    ['Cmd + R', 'neu laden'],
    ['Cmd + F', 'Vollbild'],
    ['Cmd + M', 'ins Dock'],
    ['Cmd + H', 'ausblenden'],
    ['Cmd + W oder Cmd + Q', 'beenden'],
  ] },
];

function shortcutsApp(): Safe {
  return html`<div class="modal-body shortcuts">${SHORTCUTS.map((group) => html`<section data-key="${group.title}"><h3>${group.title}</h3>
    <ul class="key-legend">${group.keys.map(([key, text]) => html`<li data-key="${key}"><kbd>${key}</kbd> ${text}</li>`)}</ul></section>`)}</div>`;
}

/** Der Browser des Laptops. Ergebnisse laufen hier abgeschirmt, und nichts öffnet ein neues Fenster ausserhalb des Spiels. */
function browserApp(s: Snapshot, draft: FilesDraft, files: FileEntry[], companyId: string): Safe {
  const path = draft.filePath;
  const pages = files.filter((f) => /\.html?$/i.test(f.path));
  return html`<div class="browser">
    <div class="browser-bar">
      <button class="btn btn-small" data-action="browser-back" ${draft.browserFrom ? '' : 'disabled'} aria-label="Zurück">←</button>
      <button class="btn btn-small" data-action="browser-reload" ${path ? '' : 'disabled'} aria-label="Neu laden">↻</button>
      <span class="browser-address">${path ?? 'Startseite'}</span>
      ${path ? html`<button class="btn btn-small" data-action="browser-home">Startseite</button>` : null}
    </div>
    ${path
      ? html`<div class="browser-page" data-key="seite-${draft.browserKey}">${fileContent(companyId, path, draft.fileDoc, s.system.artifactPort)}</div>`
      : html`<div class="modal-body"><h3>Ergebnisse zum Öffnen</h3>
        ${pages.length ? html`<ul class="mail-list">${pages.map((f) => html`<li data-key="${f.path}"><button class="mail-row browser-link" data-action="browser-open" data-path="${f.path}"><span class="mail-subject">${f.path}</span></button></li>`)}</ul>` : html`<p class="hint">Noch keine HTML-Ergebnisse.</p>`}
      </div>`}
  </div>`;
}

/** Der Dateimanager: alles, was die Firma hat, und was sich davon starten lässt. */
function shellApp(s: Snapshot, draft: FilesDraft, files: FileEntry[], folds: WorkspaceFolds, companyId: string): Safe {
  const path = draft.filePath && files.some((f) => f.path === draft.filePath) ? draft.filePath : null;
  const ext = path?.split('.').pop()?.toLowerCase() ?? '';
  const runnable = ext === 'html' || ext === 'htm';
  return html`<div class="modal-body shell-grid">
    <nav class="shell-tree" aria-label="Dateien">
      ${s.company.projectDir ? html`<p class="hint">Projektordner: <code>projekt/</code></p>` : null}
      ${files.length ? folderView(fileTree(files), folds, files.length <= WORKSPACE_FEW_FILES, 'shell-open', path) : html`<p class="hint">Noch keine Dateien.</p>`}
    </nav>
    <section class="shell-view">
      ${path ? html`
        <div class="md-bar"><strong class="shell-name">${path}</strong>
          <span class="btn-row">
            ${runnable ? html`<button class="btn btn-primary btn-small" data-action="browser-open" data-path="${path}">Im Browser öffnen</button>` : null}
            <a class="btn btn-small" href="${api.fileUrl(companyId, path, true)}" download>Laden</a>
          </span></div>
        <div class="viewer-body shell-preview">${fileContent(companyId, path, draft.fileDoc, s.system.artifactPort)}</div>`
      : html`<p class="hint">Wähle links eine Datei. Eine HTML-Datei lässt sich hier starten, abgeschirmt vom Spiel.</p>`}
    </section>
  </div>`;
}

/** Das Scrum-Programm: Planning, Entscheidung, Board, Abschluss. */
function sprintApp(s: Snapshot): Safe {
  const { company } = s;
  const master = scrumMaster(company);
  const sprint = openSprint(company);
  const past = (company.sprints ?? []).filter((x) => x.status === 'closed').reverse();
  const nameOf = (id: string) => company.agents.find((a) => a.id === id)?.name ?? 'Jemand';
  const backlog = (company.board ?? []).filter((n) => n.status === 'open');
  const body = !sprint ? html`
    <form class="panel-form" data-form="sprint-plan" data-key="sprint-plan">
      <h3>Sprint ${(company.sprints ?? []).length + 1} planen</h3>
      ${master ? html`<p class="hint">${master.name} wählt aus ${backlog.length === 1 ? '1 Zettel' : `${backlog.length} Zetteln`} im Backlog. Das Planning ist ein echter Lauf, höchstens ${eur(RULES.planningLimitEur)}.</p>` : html`<p class="form-error">Stelle dafür einen Scrum Master ein.</p>`}
      <label class="field"><span>Budgetrahmen für die Aufträge (€)</span><input name="budget" type="number" min="0.01" step="0.01" value="0.50" required /></label>
      <label class="field"><span>Hinweis (optional)</span><textarea name="hint" rows="2" maxlength="1000"></textarea></label>
      <div class="btn-row"><button class="btn btn-primary" ${master && backlog.length ? '' : 'disabled'}>Planning starten</button></div>
    </form>`
  : sprint.status === 'planning' ? html`<div data-key="sprint-planning"><h3>Sprint ${sprint.number}</h3><p class="live-line">${nameOf(sprint.scrumMasterId)} ${company.agents.find((a) => a.id === sprint.scrumMasterId)?.live.detail ?? 'plant'}</p></div>`
  : sprint.status === 'proposed' ? sprintDecision(s, sprint)
  : sprintBoard(s, sprint);
  return html`<div class="modal-body sprint-app">
    ${body}
    ${past.length ? html`<section data-key="sprint-past"><h3>Bisherige Sprints</h3><ul class="order-list">${past.map((x) => {
      const rows = sprintRows(company, x);
      const retro = company.meetings.find((m) => m.id === x.retroMeetingId);
      return html`<li data-key="${x.id}" class="team-row"><div class="team-head"><strong>Sprint ${x.number}: ${x.goal}</strong><span class="num">${eur(sprintCommitted(company, x))} von ${eur(x.budgetEur)}</span></div>
        <small>${rows.filter((r) => r.order?.status === 'accepted').length} von ${rows.length} Zetteln abgenommen.</small>
        ${retro ? html`<div><button class="btn btn-small" data-action="shell-show" data-path="${retro.protocolFile}">Protokoll der Retrospektive</button></div>` : null}</li>`;
    })}</ul></section>` : null}
  </div>`;
}

function sprintDecision(s: Snapshot, sprint: Sprint): Safe {
  const { company } = s;
  const backlog = company.board.filter((n) => n.status === 'open');
  const master = company.agents.find((a) => a.id === sprint.scrumMasterId)?.name ?? 'Jemand';
  return html`<form class="panel-form" data-form="sprint-start" data-id="${sprint.id}" data-key="sprint-${sprint.id}">
    <h3>Sprint ${sprint.number}: Vorschlag von ${master}</h3>
    ${sprint.error ? html`<p class="form-error">${sprint.error} Du kannst den Sprint selbst festlegen.</p>` : null}
    ${sprint.reason ? html`<p class="job-text">${sprint.reason}</p>` : null}
    <label class="field"><span>Ziel</span><input name="goal" maxlength="300" required autocomplete="off" value="${sprint.goal}" /></label>
    <label class="field"><span>Budgetrahmen (€)</span><input name="budget" type="number" min="0.01" step="0.01" required value="${sprint.budgetEur}" /></label>
    <fieldset class="field"><legend>Zettel im Sprint (höchstens ${RULES.sprintNotesMax})</legend>
      <ul class="sprint-pick">${backlog.map((n) => {
        const look = noteLook(company, { role: n.role, workerId: null, byAgentId: n.byAgentId });
        return html`<li data-key="${n.id}"><label><input type="checkbox" name="note" value="${n.id}" ${sprint.noteIds.includes(n.id) ? 'checked' : ''} /><span class="role-swatch" style="background:${look.color}"></span><span>${n.title}${look.role ? html` <small>${look.role}</small>` : null}</span></label></li>`;
      })}</ul>
    </fieldset>
    <p class="hint">Der Rahmen begrenzt die Limits der Aufträge im Sprint. Aufträge vergibst du danach selbst.</p>
    <div class="btn-row">
      <button class="btn btn-primary">Sprint starten</button>
      <button type="button" class="btn" data-action="sprint-discard" data-id="${sprint.id}">Verwerfen</button>
    </div>
  </form>`;
}

function sprintBoard(s: Snapshot, sprint: Sprint): Safe {
  const { company } = s;
  const rows = sprintRows(company, sprint);
  const committed = sprintCommitted(company, sprint);
  const running = sprint.status === 'running';
  const retro = company.meetings.find((m) => m.id === sprint.retroMeetingId) ?? null;
  const staff = staffOf(company).filter((a) => a.hired && !a.firedAt);
  return html`<div data-key="sprintlauf-${sprint.id}" class="sprint-run">
    <div class="section-head"><h3>Sprint ${sprint.number}: ${sprint.goal}</h3><span class="panel-sub">${SPRINT_STATUS[sprint.status]}</span></div>
    <div class="spent-line"><span>Gebunden</span><span class="num">${eur(committed)} von ${eur(sprint.budgetEur)}</span></div>
    ${meter(committed, sprint.budgetEur, 'Budgetrahmen des Sprints')}
    <div class="sprint-board">${SPRINT_COLUMNS.map((column) => {
      const cards = rows.filter((r) => r.column === column.id);
      return html`<section class="sprint-col" data-key="${column.id}"><h4>${column.title} <small class="num">${cards.length}</small></h4>
        <ul>${cards.map(({ note, order }) => {
          const look = noteLook(company, { role: note.role, workerId: order?.stages[0]?.agentId ?? null, byAgentId: note.byAgentId });
          const worker = company.agents.find((a) => a.id === order?.agentId)?.name;
          return html`<li data-key="${note.id}"><div class="zettel sprint-card" style="background:${look.color};color:${look.ink}" ${order ? '' : html`data-note="${note.id}"`}>
            <span class="zettel-title">${note.title}</span>
            <small>${worker ?? look.role}${order?.status === 'rejected' ? ' · abgelehnt' : ''}</small>
            ${order ? html`<button class="sprint-link" data-action="open-work" data-id="${order.id}">Auftrag öffnen</button>`
            : running ? html`<span class="sprint-actions"><button class="sprint-link" data-action="note-order" data-id="${note.id}">Vergeben</button><button class="sprint-link" data-action="note-unsprint" data-sprint="${sprint.id}" data-id="${note.id}">Ins Backlog</button></span>` : null}
          </div></li>`;
        })}</ul></section>`;
    })}</div>
    ${running ? html`<ul class="tafel-staff sprint-staff" aria-label="Zettel hierher ziehen">${staff.map((a) => html`<li data-key="${a.id}" class="tafel-agent" data-drop-agent="${a.id}"><img class="portrait portrait-small" src="${portrait(a.look)}" alt="" /><span class="tafel-agent-text"><strong>${a.name}</strong><small>${agentTitle(a)}</small><small>${a.live.detail || 'Frei'}</small></span></li>`)}</ul>
      <p class="hint">Offene Zettel auf eine Person ziehen. Sie beginnt sofort, das Limit zählt gegen den Rahmen.</p>` : null}
    <div class="btn-row">
      ${running ? html`<button class="btn" data-action="sprint-end" data-id="${sprint.id}">Sprint beenden</button>` : null}
      ${sprint.status === 'review' && !retro ? html`<button class="btn btn-primary" data-action="sprint-retro" data-id="${sprint.id}">Retrospektive starten</button>` : null}
      ${retro ? html`<button class="btn" data-action="shell-show" data-path="${retro.protocolFile}">Protokoll der Retrospektive</button>` : null}
      ${sprint.status === 'review' && retro?.status !== 'running' ? html`<button class="btn" data-action="sprint-close" data-id="${sprint.id}">Sprint abschliessen</button>` : null}
    </div>
    ${retro?.status === 'decision' && retro.outcome ? html`<section class="detail" data-key="retro-decision"><h4>Vorschlag aus der Retrospektive</h4><p class="job-text">${retro.outcome.proposal}</p>
      <div class="btn-row"><button class="btn btn-primary btn-small" data-action="decide-meeting" data-id="${retro.id}" data-decision="accept">Beschliessen</button><button class="btn btn-small" data-action="decide-meeting" data-id="${retro.id}" data-decision="reject">Verwerfen</button></div></section>` : null}
    ${sprint.status === 'review' ? html`<p class="hint">${retro ? (retro.status === 'running' ? 'Die Retrospektive läuft im Besprechungsraum.' : retro.status === 'decision' ? 'Ein Beschluss steht danach im Firmenwissen und im nächsten Planning.' : 'Die Retrospektive ist beendet.') : `Die Retrospektive ist eine echte Besprechung im Besprechungsraum, höchstens ${eur(RULES.retroLimitEur)}. Ein Beschluss steht danach im Firmenwissen.`}</p>` : null}
  </div>`;
}

/** Ein Diff, Zeile für Zeile eingefärbt. */
function diffView(text: string): Safe {
  const kind = (line: string) => (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') ? 'head' : line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '');
  return html`<pre class="diff">${text.split('\n').slice(0, 4000).map((line) => html`<span class="diff-${kind(line)}">${line}\n</span>`)}</pre>`;
}

/** Was der Auftrag im Repo geändert hat. Hinaus geht es erst mit einem Klick von dir. */
function gitBox(s: Snapshot, order: Order, draft: FilesDraft): Safe {
  const git = order.git!;
  const repo = s.company.repo;
  const decided = order.status === 'accepted' || order.status === 'rejected';
  const nothing = decided && !git.commit;
  return html`<section class="git-box" data-key="git-${order.id}">
    <h4>Repo</h4>
    <p class="hint">Branch <code>${git.branch}</code>${nothing ? (order.status === 'rejected' ? ' wurde mit der Ablehnung gelöscht.' : ' enthielt keine Änderung und wurde gelöscht.') : git.commit ? `, Commit ${git.commit.slice(0, 7)}.` : ', noch nicht committet.'}</p>
    ${nothing ? null : html`<div class="btn-row">
      <button class="btn btn-small" data-action="git-diff" data-id="${order.id}">${draft.diff === null ? 'Änderungen zeigen' : 'Änderungen neu laden'}</button>
      ${order.status === 'accepted' && git.commit && repo?.remote ? html`
        ${git.pushedAt ? null : html`<button class="btn btn-small" data-action="git-push" data-id="${order.id}">Branch hochladen</button>`}
        ${git.prUrl ? html`<a class="btn btn-small" href="${git.prUrl}" target="_blank" rel="noopener">Pull Request öffnen</a>` : html`<button class="btn btn-primary btn-small" data-action="git-pr" data-id="${order.id}">Pull Request erstellen</button>`}` : null}
    </div>`}
    ${order.status === 'review' ? html`<p class="hint">Abnehmen committet nur auf diesen Branch. Hochladen entscheidest du danach. Ablehnen löscht ihn.</p>` : null}
    ${order.status === 'accepted' && git.commit && !repo?.remote ? html`<p class="hint">Dieses Repo hat kein Ziel zum Hochladen. Der Commit bleibt lokal auf dem Branch.</p>` : null}
    ${git.pushedAt ? html`<p class="hint">Hochgeladen am ${time(git.pushedAt)}.</p>` : null}
    ${draft.diff !== null && !nothing ? (draft.diff ? diffView(draft.diff) : html`<p class="hint">Keine Änderungen.</p>`) : null}
  </section>`;
}

/** Eine Ergebnis-Mail: Was geliefert wurde, die Datei zum Prüfen und die Freigabe. */
function mailView(s: Snapshot, order: Order, draft: FilesDraft, companyId: string): Safe {
  const { company, system } = s;
  const sender = company.agents.find((a) => a.id === (order.stages.find((stage) => stage.kind === 'work')?.agentId ?? order.agentId));
  const results = resultFiles(order);
  const path = results.some((f) => f.path === draft.filePath) ? draft.filePath! : results[0]?.path ?? null;
  const ext = path?.split('.').pop()?.toLowerCase() ?? '';
  const check = order.stages.find((stage) => stage.kind === 'check');
  return html`<div class="modal-body mail" data-key="mail-${order.id}">
    <div class="btn-row"><button class="btn btn-small" data-action="mail-close">Zurück zur Post</button></div>
    <header class="mail-head">
      ${sender ? html`<img class="portrait portrait-small" src="${portrait(sender.look)}" alt="" />` : null}
      <div><strong>Ergebnis: ${order.title}</strong>
        <small>Von ${sender?.name ?? 'Jemand'}${sender ? `, ${agentTitle(sender)}` : ''}. Kosten ${eur(orderSpent(company, order))}. ${order.status === 'review' ? 'Wartet auf deine Freigabe.' : ORDER_STATUS[order.status]}</small></div>
    </header>
    ${order.summary ? html`<div class="job-text mail-text">${order.summary}</div>` : null}
    ${check?.verdict ? verdictBox(company, check) : null}
    ${results.length ? html`<h4>Anhang</h4>
      <div class="file-tabs">${results.map((file) => html`<button class="toggle ${file.path === path ? 'on' : ''}" data-key="${file.path}" data-action="shell-open" data-path="${file.path}">${file.path.split('/').pop()}</button>`)}
        ${path && (ext === 'html' || ext === 'htm') ? html`<button class="btn btn-primary btn-small" data-action="browser-open" data-path="${path}">Im Browser öffnen</button>` : null}</div>` : null}
    ${path ? html`<div class="viewer-body mail-preview">${fileContent(companyId, path, draft.filePath === path ? draft.fileDoc : null, system.artifactPort)}</div>` : null}
    ${order.git ? gitBox(s, order, draft) : null}
    ${order.status === 'review' ? html`<section class="detail" data-key="mail-decide">${reviewControls(s, order)}</section>` : null}
  </div>`;
}

/** Anbieter verbinden. Der Schlüssel geht einmal zum Server und kommt nie zurück. */
function settingsApp(s: Snapshot, draft: FilesDraft): Safe {
  const { system, company } = s;
  const connections = system.connections ?? [];
  const kind = connectionKind(draft.connectionKind) ?? CONNECTION_KINDS[0];
  const used = (id: string) => company.agents.filter((a) => a.hired && !a.firedAt && a.modelId === id).map((a) => a.name);
  return html`<div class="modal-body settings">
    <section data-key="connected"><h3>Verbunden</h3>
      <ul class="order-list">
        <li class="team-row" data-key="anthropic">
          <div class="team-head"><strong>Anthropic</strong><span class="chip">${system.provider.available ? 'Verbunden' : 'Nicht erreichbar'}</span></div>
          <small>${system.provider.available ? `${system.provider.account ?? ''}${system.provider.version ? `, CLI ${system.provider.version}` : ''}` : system.provider.error ?? ''}. Modelle: ${MODELS.filter((m) => m.providerId === 'anthropic').map((m) => m.label).join(', ')}.</small>
        </li>
        ${connections.map((c) => html`<li class="team-row" data-key="${c.id}">
          <div class="team-head"><strong>${c.label}</strong><button class="btn btn-small" data-action="connection-remove" data-id="${c.id}">Trennen</button></div>
          <small>${c.baseUrl}${c.keyEnd ? `, Schlüssel endet auf ${c.keyEnd}` : ''}, geprüft ${time(c.checkedAt)}. ${c.available.length} Modelle beim Anbieter.</small>
          ${c.models.length ? html`<table class="roadmap-table settings-models"><thead><tr><th>Modell</th><th class="num">Eingabe</th><th class="num">Cache</th><th class="num">Ausgabe</th><th></th></tr></thead><tbody>
            ${c.models.map((m) => html`<tr data-key="${m.id}"><td>${m.label}${used(m.id).length ? html` <small>${used(m.id).join(', ')}</small>` : null}</td><td class="num">$${m.input}</td><td class="num">$${m.cached}</td><td class="num">$${m.output}</td>
              <td><button class="sprint-link" data-action="connection-model-remove" data-id="${c.id}" data-remote="${m.remote}">Entfernen</button></td></tr>`)}
          </tbody></table>` : html`<p class="hint">Noch kein Modell. Füge eines hinzu, dann lässt es sich beim Einstellen wählen.</p>`}
          <form class="settings-add" data-form="connection-model" data-id="${c.id}" data-key="add-${c.id}">
            <label class="field"><span>Modell</span>${c.available.length
              ? html`<select name="remote" required>${c.available.filter((id) => !c.models.some((m) => m.remote === id)).map((id) => html`<option value="${id}" data-key="${id}">${id}</option>`)}</select>`
              : html`<input name="remote" required autocomplete="off" />`}</label>
            <label class="field"><span>Eingabe, $/Mio.</span><input name="input" type="number" min="0" step="any" required value="${connectionKind(c.kind)?.local ? '0' : ''}" /></label>
            <label class="field"><span>Cache, $/Mio.</span><input name="cached" type="number" min="0" step="any" value="${connectionKind(c.kind)?.local ? '0' : ''}" /></label>
            <label class="field"><span>Ausgabe, $/Mio.</span><input name="output" type="number" min="0" step="any" required value="${connectionKind(c.kind)?.local ? '0' : ''}" /></label>
            <label class="field"><span>Kontext, Tokens</span><input name="contextWindow" type="number" min="1000" step="1000" value="128000" /></label>
            <button class="btn btn-small">Hinzufügen</button>
          </form>
        </li>`)}
      </ul>
    </section>
    <section data-key="repo"><h3>Repo dieser Firma</h3>
      ${company.repo ? html`<ul class="order-list"><li class="team-row">
        <div class="team-head"><strong>${company.repo.remote ?? 'Nur lokal'}</strong><button class="btn btn-small" data-action="repo-disconnect">Trennen</button></div>
        <small>${company.repo.dir}, Hauptbranch ${company.repo.branch}. ${company.orders.filter((o) => o.git?.commit && !o.git.pushedAt).length} Branches warten aufs Hochladen.</small>
      </li></ul>` : html`<form class="panel-form" data-form="repo">
        <label class="field"><span>Ordner oder Adresse</span><input name="source" required autocomplete="off" spellcheck="false" placeholder="/Pfad/zum/Repo oder https://…" /></label>
        <div class="btn-row"><button class="btn btn-primary">Verbinden</button></div>
      </form>`}
      <p class="hint">Jeder Auftrag bekommt einen eigenen Branch und Arbeitsordner, dein Checkout bleibt unberührt. Agenten bedienen kein Git und bekommen keinen Zugang. Commit, Hochladen und Pull Request führt das Spiel erst nach deiner Entscheidung aus, mit deinen Git-Zugangsdaten auf diesem Mac.</p>
    </section>
    <section data-key="add"><h3>Anbieter verbinden</h3>
      <div class="toggle-row">${CONNECTION_KINDS.map((k) => html`<button type="button" class="toggle ${k.id === kind.id ? 'on' : ''}" data-key="${k.id}" data-action="connection-kind" data-id="${k.id}" aria-pressed="${k.id === kind.id}">${k.label}</button>`)}</div>
      <form class="panel-form" data-form="connection" data-key="form-${kind.id}">
        <input type="hidden" name="kind" value="${kind.id}" />
        ${kind.id === 'custom' ? html`<label class="field"><span>Name</span><input name="label" autocomplete="off" maxlength="40" /></label>
          <label class="field"><span>Adresse (OpenAI-kompatibel)</span><input name="baseUrl" required autocomplete="off" placeholder="https://example.com/v1" /></label>` : html`<p class="hint">${kind.baseUrl}</p>`}
        ${kind.needsKey || kind.id === 'custom' ? html`<label class="field"><span>API-Schlüssel${kind.needsKey ? '' : ' (optional)'}</span><input name="apiKey" type="password" autocomplete="off" spellcheck="false" ${kind.needsKey ? 'required' : ''} /></label>` : null}
        ${kind.id === 'openai' ? html`<p class="hint">Die Modelle GPT-6 Luna, GPT-6.1 Terra, GPT-6.1 Sol und GPT-6 Astra kommen mit den offiziellen Preisen vom ${OPENAI_PRICES_AS_OF}, soweit dein Konto sie anbietet. Abgerechnet wird über dein API-Konto, nicht über ein Abo.</p>` : null}
        <p class="hint">Der Schlüssel bleibt auf diesem Mac, in einer Datei, die nur dein Benutzer lesen darf. Agenten bekommen ihn nicht. Der Anbieter wird beim Verbinden einmal nach seinen Modellen gefragt.</p>
        <div class="btn-row"><button class="btn btn-primary">Verbinden</button></div>
      </form>
    </section>
    <section data-key="limits"><h3>Was du wissen solltest</h3>
      <ul class="facts-list">
        <li>Agenten dieser Anbieter haben nur Dateiwerkzeuge im Arbeitsbereich: kein Bash, keine Websuche, keine Befehle.</li>
        <li>Kosten werden aus den gemeldeten Tokens und den eingetragenen Preisen berechnet. Die Rechnung stellt der Anbieter.</li>
        <li>Lokale Modelle müssen Werkzeugaufrufe können, sonst entsteht keine Datei.</li>
      </ul>
    </section>
  </div>`;
}

function roadmapApp(s: Snapshot, draft: FilesDraft): Safe {
  const { company } = s;
  const rows = roadmapRows(company);
  const staff = company.agents.filter((a) => rows.some((r) => r.ownerId === a.id && r.phase !== 'erledigt'));
  const nameOf = (id: string) => company.agents.find((a) => a.id === id)?.name ?? 'Jemand';
  const open = rows.filter((r) => r.phase !== 'erledigt');
  const shown = rows.filter((r) => draft.roadmapOwner === null || (draft.roadmapOwner === 'niemand' ? r.ownerId === null : r.ownerId === draft.roadmapOwner));
  const chip = (id: string | null, label: string, n: number) => html`<button class="toggle ${draft.roadmapOwner === id ? 'on' : ''}" data-key="owner-${id ?? 'alle'}" data-action="roadmap-owner" data-id="${id ?? ''}" aria-pressed="${draft.roadmapOwner === id}">${label} · ${n}</button>`;
  return html`<div class="modal-body roadmap">
    <div class="toggle-row" role="group" aria-label="Nach Verantwortlichen filtern">
      ${chip(null, 'Alle', open.length)}
      ${staff.map((a) => chip(a.id, a.name, open.filter((r) => r.ownerId === a.id).length))}
      ${open.some((r) => r.ownerId === null) ? chip('niemand', 'Noch niemand', open.filter((r) => r.ownerId === null).length) : null}
    </div>
    ${ROADMAP_PHASES.map((phase) => {
      const list = shown.filter((r) => r.phase === phase.id);
      if (!list.length) return null;
      return html`<section data-key="${phase.id}"><h3>${phase.title} <small class="num">${list.length}</small></h3>
        <table class="roadmap-table"><thead><tr><th>Aufgabe</th><th>Verantwortlich</th><th>Stand</th><th>Gehört zu</th><th class="num">Kosten</th></tr></thead>
        <tbody>${list.map((r) => html`<tr data-key="${r.id}">
          <td>${r.orderId ? html`<button class="sprint-link" data-action="${r.state === 'Wartet auf deine Abnahme' ? 'mail-open' : 'open-work'}" data-id="${r.orderId}">${r.title}</button>` : r.title}</td>
          <td>${r.ownerId ? nameOf(r.ownerId) : r.wanted ? `Noch niemand, passt zu ${r.wanted}` : 'Noch niemand'}</td>
          <td>${r.state}${r.prUrl ? html` <a class="sprint-link" href="${r.prUrl}" target="_blank" rel="noopener">Pull Request</a>` : null}</td><td>${r.context}${r.branch ? html`<br /><code>${r.branch}</code>` : null}</td><td class="num">${r.costEur === null ? '' : eur(r.costEur)}</td></tr>`)}</tbody></table></section>`;
    })}
    ${rows.length ? null : html`<p class="hint">Noch keine Aufgaben. Hänge Zettel an die Tafel oder vergib einen Auftrag.</p>`}
  </div>`;
}

function messagesApp(s: Snapshot, projectAgents: ProjectAgent[], draft: FilesDraft, companyId: string): Safe {
  const { company } = s;
  const commands = company.commands.filter((c) => c.status === 'pending' || c.status === 'running');
  const contracts = company.mandates.flatMap((m) => m.contracts.filter((c) => c.status === 'pending').map((c) => ({ c, m })));
  const proposals = company.mandates.flatMap((m) => m.proposals.filter((p) => p.status === 'pending').map((p) => ({ p, m })));
  const reviews = company.orders.filter((o) => o.status === 'review');
  const nameOf = (id: string) => company.agents.find((a) => a.id === id)?.name ?? 'Jemand';
  const sprintProposal = (company.sprints ?? []).find((x) => x.status === 'proposed') ?? null;
  const empty = !sprintProposal && !commands.length && !contracts.length && !proposals.length && !reviews.length && !(company.projectDir && projectAgents.some((a) => !a.adoptedBy));
  const done = company.orders.filter((o) => o.status === 'accepted' || o.status === 'rejected').slice(-10).reverse();
  const open = company.orders.find((o) => o.id === draft.mailId && o.files.length + (o.summary ? 1 : 0) > 0) ?? null;
  if (open) return mailView(s, open, draft, companyId);
  const mailRow = (o: Order) => html`<li data-key="${o.id}"><button class="mail-row ${o.status === 'review' ? 'unread' : ''}" data-action="mail-open" data-id="${o.id}">
    <strong>${nameOf(o.stages.find((stage) => stage.kind === 'work')?.agentId ?? o.agentId)}</strong>
    <span class="mail-subject">Ergebnis: ${o.title}</span>
    <small class="mail-state">${o.status === 'review' ? 'Zur Freigabe' : ORDER_STATUS[o.status]}</small>
  </button></li>`;
  return html`<div class="modal-body os-messages">
    ${empty ? html`<p class="hint">Keine neue Post.</p>` : null}
    ${reviews.length ? html`<section data-key="m-reviews"><h3>Zur Freigabe</h3><ul class="mail-list">${reviews.map(mailRow)}</ul></section>` : null}
    ${sprintProposal ? html`<section data-key="m-sprint"><h3>Sprint</h3><ul class="order-list"><li class="team-row">
      <div class="team-head"><strong>Sprint ${sprintProposal.number}${sprintProposal.goal ? `: ${sprintProposal.goal}` : ''}</strong><span class="num">${eur(sprintProposal.budgetEur)}</span></div>
      <small>${nameOf(sprintProposal.scrumMasterId)} schlägt ${sprintProposal.noteIds.length === 1 ? '1 Zettel' : `${sprintProposal.noteIds.length} Zettel`} vor.</small>
      <div class="btn-row"><button class="btn btn-primary btn-small" data-action="laptop-app" data-id="sprint">Entscheiden</button></div>
    </li></ul></section>` : null}
    ${commands.length ? html`<section data-key="m-commands"><h3>Befehle</h3><ul class="proposals">${commands.map((c) => commandCard(c, company.projectDir))}</ul></section>` : null}
    ${contracts.length ? html`<section data-key="m-contracts"><h3>Verträge</h3><ul class="order-list">${contracts.map(({ c, m }) => html`<li data-key="${c.id}" class="team-row">
      <div class="team-head"><strong>${nameOf(m.managerId)} möchte ${c.name} einstellen</strong></div>
      ${c.reason ? html`<small>${c.reason}</small>` : null}
      <div class="btn-row"><button class="btn btn-primary btn-small" data-action="open-contract" data-mandate="${m.id}" data-id="${c.id}">Vertrag lesen</button></div>
    </li>`)}</ul></section>` : null}
    ${proposals.length ? html`<section data-key="m-proposals"><h3>Freigaben</h3><ul class="order-list">${proposals.map(({ p, m }) => html`<li data-key="${p.id}" class="team-row">
      <div class="team-head"><strong>${p.title}</strong><span class="num">${eur(p.limitEur)}</span></div>
      <small>${nameOf(m.managerId)} schlägt das für ${nameOf(p.team.work)} vor, im Projekt „${m.goal}".${p.reason ? ` ${p.reason}` : ''}</small>
      <div class="btn-row">
        <button class="btn btn-primary btn-small" data-action="approve-proposal" data-mandate="${m.id}" data-id="${p.id}">Freigeben</button>
        <button class="btn btn-small" data-action="decline-proposal" data-mandate="${m.id}" data-id="${p.id}">Ablehnen</button>
      </div>
    </li>`)}</ul></section>` : null}
    ${done.length ? html`<section data-key="m-done"><h3>Erledigt</h3><ul class="mail-list">${done.map(mailRow)}</ul></section>` : null}
    ${projectAgentsSection(s, projectAgents)}
  </div>`;
}

/** Das Rollenprogramm: Eine Rolle ist ein Markdown-Text. */
function rolesApp(s: Snapshot, draft: FilesDraft): Safe {
  const { company, seats, system } = s;
  const roles = rolesOf(company);
  const open = roles.find((r) => r.id === draft.roleId) ?? null;
  const canHire = system.provider.available && seats.total > seats.used;
  return html`<div class="modal-body files-grid">
    <nav class="files-list" aria-label="Rollen">
      <button class="btn btn-small btn-wide" data-action="role-new">Neue Rolle aus Vorlage</button>
      <ul class="agent-list">${roles.map((r) => {
        const holders = company.agents.filter((a) => a.companyRoleId === r.id).length;
        return html`<li data-key="${r.id}"><button class="agent-row ${r.id === draft.roleId ? 'selected' : ''}" data-action="role-open" data-id="${r.id}" aria-pressed="${r.id === draft.roleId}">
          <span class="role-swatch" style="background:${roleColor(company, r)}"></span><span class="agent-row-text"><strong>${r.title}</strong><small>${holders === 1 ? '1 Person' : `${holders} Leute`}</small></span>
        </button></li>`;
      })}</ul>
    </nav>
    <section class="md-editor">
      <div class="md-bar"><strong>${open ? `${open.title}.md` : 'Neue Rolle.md'}</strong>
        <label class="btn btn-small">Datei laden<input class="visually-hidden" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" data-action="role-md-file" /></label>
      </div>
      <label class="visually-hidden" for="role-md">Rolle als Markdown</label>
      <textarea id="role-md" class="md-text" data-role-md data-key="md-${draft.roleKey}" rows="20" spellcheck="false" maxlength="30000">${draft.roleText}</textarea>
      <div class="role-colors" role="group" aria-label="Farbe der Zettel">
        <span>Zettel</span>
        ${NOTE_COLORS.map((color) => html`<button type="button" class="role-color ${colorInText(draft.roleText) === color ? 'on' : ''}" style="background:${color}" data-action="role-color" data-color="${color}" aria-label="Farbe ${color}" aria-pressed="${colorInText(draft.roleText) === color}"></button>`)}
        <button type="button" class="btn btn-small" data-action="role-color" data-color="">Voreinstellung</button>
      </div>
      ${draft.roleError ? html`<p class="form-error" role="alert">${draft.roleError}</p>` : null}
      ${draft.roleNote ? html`<p class="hint">${draft.roleNote}</p>` : null}
      <div class="btn-row">
        <button class="btn btn-primary btn-small" data-action="role-save">Speichern</button>
        ${open ? html`<button class="btn btn-small" data-action="open-hire" data-role="${open.id}" ${canHire ? '' : 'disabled'} title="${canHire ? '' : 'Dafür brauchst du einen freien Schreibtisch.'}">Einstellen</button>
        <button class="btn btn-small" data-action="role-delete" data-id="${open.id}" title="Wer die Rolle hat, behält Stelle und Fähigkeiten.">Löschen</button>` : null}
      </div>
      <p class="hint">Vorlage: ${ROLES.map((r) => r.title).join(', ')}. Modell: ${MODELS.map((m) => m.label).join(', ')}. Farbe: #rrggbb oder oben wählen.</p>
    </section>
  </div>`;
}

function filesApp(s: Snapshot, draft: FilesDraft, confirmFire: string | null): Safe {
  const { company } = s;
  const current = staffOf(company).filter((a) => a.hired);
  const former = company.agents.filter((a) => a.firedAt);
  const selected = company.agents.find((a) => a.id === draft.agentId) ?? current[0] ?? former[0] ?? null;
  const row = (a: Agent) => html`<li data-key="${a.id}"><button class="agent-row ${a.id === selected?.id ? 'selected' : ''}" data-action="files-agent" data-id="${a.id}" aria-pressed="${a.id === selected?.id}">
    <img class="portrait portrait-small" src="${portrait(a.look)}" alt="" />
    <span class="agent-row-text"><strong>${a.name}</strong><small>${agentTitle(a)}</small></span>
    <small class="num">${eur(agentSpent(company, a.id))}</small>
  </button></li>`;
  return html`<div class="modal-body files-grid">
      <nav class="files-list" aria-label="Mitarbeiter">
        <p class="hint">${current.length === 1 ? '1 Person' : `${current.length} Leute`}, zusammen ${eur(current.reduce((sum, a) => sum + agentSpent(company, a.id), 0))}</p>
        <ul class="agent-list">${current.map(row)}</ul>
        ${former.length ? html`<h4>Ehemalige</h4><ul class="agent-list">${former.map(row)}</ul>` : null}
        ${current.length || former.length ? null : html`<p class="hint">Noch niemand eingestellt.</p>`}
      </nav>
      ${selected ? agentFile(s, selected, confirmFire) : null}
    </div>`;
}

function agentFile(s: Snapshot, agent: Agent, confirmFire: string | null): Safe {
  const { company, system } = s;
  const runs = company.runs.filter((r) => r.agentId === agent.id && r.status !== 'running');
  const spent = agentSpent(company, agent.id);
  const work = company.orders.filter((o) => o.stages.some((stage) => stage.agentId === agent.id)).reverse();
  const accepted = work.filter((o) => o.status === 'accepted').length;
  const brought = agent.startSkillIds ?? agent.skillIds;
  const learned = agent.skillIds.filter((id) => !brought.includes(id));
  const average = averageRunEur(company, agent.id);
  const model = modelById(agent.modelId);
  const run = activeRun(company, agent.id);
  const otherSkills = [...SKILLS, ...company.customSkills].filter((skill) => !agent.skillIds.includes(skill.id));
  return html`<article class="file-card" data-key="file-${agent.id}">
    <div class="team-head"><span class="file-name"><img class="portrait" src="${portrait(agent.look)}" alt="" /><span><strong>${agent.name}</strong><small>${agentTitle(agent)}${agent.firedAt ? `, gekündigt am ${time(agent.firedAt)}` : ''}</small></span></span></div>
    <h4>Stelle</h4>
    <dl class="facts">
      <div><dt>Rolle</dt><dd>${agentTitle(agent)}</dd></div>
      ${company.departments.length ? html`<div><dt>Abteilung</dt><dd>${departmentOfAgent(company, agent)?.name ?? 'Allgemein'}</dd></div>` : null}
      <div><dt>Modell</dt><dd>${PROVIDERS.find((p) => p.id === agent.providerId)?.label}, ${model?.label}</dd></div>
    </dl>
    ${agent.origin ? html`<p class="hint">Aus dem Projekt: ${agent.origin.file}.${agent.origin.readOnly ? ' Nur lesen, wie in der Datei.' : ''}${agent.origin.wantsCommands ? ' Befehle kann er beantragen, du gibst jeden einzeln frei.' : ''}</p>` : null}
    ${agent.job?.task ? html`<h4>Aufgabe</h4><p class="job-text">${agent.job.task}</p>` : null}
    ${agent.job?.requirements ? html`<h4>Anforderungen</h4><p class="job-text">${agent.job.requirements}</p>` : null}

    <h4>Kosten</h4>
    <dl class="facts">
      <div><dt>Bisher verbraucht</dt><dd class="num">${eur(spent)}</dd></div>
      <div><dt>Läufe</dt><dd class="num">${count(runs.length)}</dd></div>
      ${average !== null ? html`<div><dt>Je Lauf im Schnitt, ohne Vorstellung</dt><dd class="num">${eur(average)}</dd></div>` : null}
      <div><dt>Gehalt mit ${model?.label ?? agent.modelId}, je Mio. Tokens</dt><dd class="num">${pricePerMillion(agent.modelId, system.fx.eurPerUsd)}</dd></div>
      <div><dt>Eingestellt</dt><dd class="num">${time(agent.hiredAt)}</dd></div>
    </dl>

    <h4>Gedächtnis</h4>
    <dl class="facts"><div><dt>Session</dt><dd><code title="${agent.sessionId}">${agent.sessionId.slice(0, 8)}</code></dd></div></dl>
    ${contextLine(agent, 0, system.fx.eurPerUsd)}

    <h4>Fähigkeiten</h4>
    <dl class="facts">
      <div><dt>Mitgebracht</dt><dd>${brought.map((id) => skillTitle(company.customSkills, id)).join(', ') || 'keine'}</dd></div>
      <div><dt>Dazugelernt</dt><dd>${learned.map((id) => skillTitle(company.customSkills, id)).join(', ') || 'noch nichts'}</dd></div>
    </dl>

    ${agent.firedAt ? null : html`<h4>Teams</h4>
    ${company.teams.length ? html`<div class="toggle-row">${company.teams.map((team) => {
      const on = team.memberIds.includes(agent.id);
      return html`<button type="button" class="toggle ${on ? 'on' : ''}" aria-pressed="${on}" data-action="files-team" data-id="${team.id}" data-agent="${agent.id}" data-key="${team.id}">${team.name}${team.leadId === agent.id ? ' (Leitung)' : ''}</button>`;
    })}</div>` : html`<p class="hint">Noch kein Team. Lege im Team-Tab eines an.</p>`}`}

    <h4>Ergebnisse${work.length ? ` (${accepted} von ${work.length} abgenommen)` : ''}</h4>
    ${work.length ? html`<ul class="file-results">${work.map((order) => {
      const own = order.stages.filter((stage) => stage.agentId === agent.id);
      const files = [...new Set(own.flatMap((stage) => stage.files))].filter((f) => !/pruefung-\d+\.md$/.test(f));
      const cost = company.runs.filter((r) => r.orderId === order.id && r.agentId === agent.id).reduce((sum, r) => sum + r.costEur, 0);
      return html`<li data-key="${order.id}">
        <div class="team-head"><strong>${order.title}</strong><span class="chip chip-order-${order.status}">${ORDER_STATUS[order.status]}</span></div>
        <small>${own.map((stage) => STAGE_TITLE[stage.kind]).join(', ')}, ${eur(cost)}</small>
        ${files.length ? html`<div class="toggle-row">${files.map((f) => html`<button type="button" class="text-btn" data-action="open-file" data-path="${f}" data-key="${f}">${f.split('/').pop()}</button>`)}</div>` : null}
      </li>`;
    })}</ul>` : html`<p class="hint">Noch keine Aufträge.</p>`}
      ${agent.hired ? html`<details class="activity" data-key="job-edit-${agent.id}">
        <summary>Stelle und Fähigkeiten ändern</summary>
        <form class="revise-form" data-form="job" data-id="${agent.id}">
          <label class="field"><span>Stellentitel</span><input name="title" maxlength="60" autocomplete="off" value="${agent.job?.title ?? ''}" placeholder="${roleById(agent.roleId)?.title}" /></label>
          <label class="field"><span>Konkrete Aufgabe</span><textarea name="task" rows="3" maxlength="${RULES.jobTextMax}">${agent.job?.task ?? ''}</textarea></label>
          <label class="field"><span>Anforderungen</span><textarea name="requirements" rows="2" maxlength="${RULES.jobTextMax}">${agent.job?.requirements ?? ''}</textarea></label>
          <button class="btn btn-small">Stelle speichern</button>
        </form>
        <form class="revise-form" data-form="agent-skill" data-id="${agent.id}">
          <label class="field"><span>Neue Fähigkeit: Name</span><input name="title" maxlength="60" autocomplete="off" placeholder="Zum Beispiel: Unser Schreibstil" /></label>
          <label class="field"><span>Beschreibung</span><textarea name="instruction" rows="3" maxlength="${RULES.skillTextMax}" placeholder="Was soll ${agent.name} können und wie vorgehen?"></textarea></label>
          <label class="field"><span>Oder als Markdown-Datei</span><input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" data-action="agent-skill-file" data-id="${agent.id}" /></label>
          <button class="btn btn-small">Fähigkeit hinzufügen</button>
        </form>
        ${otherSkills.length ? html`<div class="toggle-row">${otherSkills.map((skill) => html`<button class="toggle" data-action="agent-skill-add" data-agent="${agent.id}" data-id="${skill.id}" data-key="${skill.id}" title="Zu ${agent.name} hinzufügen">+ ${skill.title}</button>`)}</div>` : null}
        <p class="hint">${agent.name} erfährt Änderungen mit dem nächsten Lauf. Eine einmal mitgeteilte Fähigkeit bleibt im Gedächtnis und lässt sich nicht zurücknehmen.</p>
      </details>` : null}
    ${agent.hired && !agent.firedAt ? html`      <div class="btn-row"><button class="btn btn-small ${confirmFire === agent.id ? 'btn-danger' : ''}" data-action="fire-agent" data-id="${agent.id}" ${run ? 'disabled' : ''}>${confirmFire === agent.id ? `${agent.name} wirklich kündigen?` : 'Kündigen'}</button></div>
      ${confirmFire === agent.id ? html`<p class="hint">Der Schreibtisch wird frei, das Gedächtnis geht verloren. Verlauf, Kosten und Ergebnisse bleiben.</p>` : null}` : null}
  </article>`;
}

/* ---------- Mitarbeiter einstellen ---------- */

export function hireModal(s: Snapshot, draft: HireDraft): Safe {
  const fx = s.system.fx.eurPerUsd;
  const role = roleById(draft.roleId)!;
  const firm = s.company.customSkills;
  const defined = rolesOf(s.company).find((r) => r.id === draft.companyRoleId) ?? null;
  const chars = defined ? defined.title.length + defined.task.length + defined.requirements.length : Object.values(draft.textChars).reduce((sum, n) => sum + n, 0);
  const skillText = draft.customSkills.reduce((sum, skill) => sum + skill.instruction.length, 0)
    + firm.filter((skill) => draft.skillIds.includes(skill.id)).reduce((sum, skill) => sum + skill.instruction.length, 0);
  const added = estimateTokensOfChars(chars + skillText);
  const total = BASE_CONTEXT_TOKENS + added;
  const chosen = modelById(draft.modelId)!;
  return html`
    <header class="modal-head"><div><h2>Stelle ausschreiben</h2><p class="modal-sub">Was soll die neue Kraft tun, und was muss sie dafür können?</p></div>
      <button class="icon-btn" data-action="close-modal" aria-label="Schließen">×</button></header>
    <form class="modal-body hire-grid" data-form="hire">
      <div class="hire-main">
        ${rolesOf(s.company).length ? html`<fieldset class="field"><legend>Deine Rollen</legend>
          <div class="pick-grid">
            ${rolesOf(s.company).map((r) => html`<button type="button" class="pick ${r.id === draft.companyRoleId ? 'selected' : ''}" data-action="hire-company-role" data-id="${r.id}" data-key="${r.id}" aria-pressed="${r.id === draft.companyRoleId}">
              <strong>${r.title}</strong><small>${r.task.slice(0, 70) || `${r.skillIds.length} Fähigkeiten`}</small></button>`)}
          </div>
        </fieldset>` : null}
        ${defined ? html`<section class="role-summary" data-key="role-summary">
          ${defined.task ? html`<p class="job-text">${defined.task}</p>` : null}
          ${defined.requirements ? html`<p class="job-text">${defined.requirements}</p>` : null}
          ${defined.skillIds.length ? html`<div class="toggle-row">${defined.skillIds.map((id) => html`<span class="chip" data-key="${id}">${skillTitle(firm, id)}</span>`)}</div>` : html`<p class="hint">Diese Rolle hat keine Fähigkeiten.</p>`}
          <button type="button" class="text-btn" data-action="hire-company-role" data-id="">Stattdessen eine einzelne Stelle ausschreiben</button>
        </section>` : html`<fieldset class="field" data-key="role-base"><legend>${rolesOf(s.company).length ? 'Oder eine einzelne Stelle' : 'Rolle'}</legend>
          <div class="pick-grid">
            ${ROLES.map((r) => html`<button type="button" class="pick ${r.id === draft.roleId ? 'selected' : ''}" data-action="hire-role" data-id="${r.id}" data-key="${r.id}" aria-pressed="${r.id === draft.roleId}">
              <strong>${r.title}</strong><small>${r.blurb}</small></button>`)}
          </div>
        </fieldset>
        <label class="field" data-key="job-title"><span>Stellentitel (optional)</span><input name="jobTitle" data-measure="title" maxlength="60" autocomplete="off" placeholder="${role.id === 'frei' ? 'Zum Beispiel: Newsletter-Redaktion' : role.title}" /></label>
        <label class="field" data-key="job-task"><span>Konkrete Aufgabe</span><textarea name="jobTask" data-measure="task" rows="3" maxlength="${RULES.jobTextMax}" placeholder="Wofür ist diese Person da? Zum Beispiel: Du betreust den monatlichen Newsletter für Vereinsvorstände."></textarea></label>
        <label class="field" data-key="job-req"><span>Anforderungen (optional)</span><textarea name="jobRequirements" data-measure="requirements" rows="2" maxlength="${RULES.jobTextMax}" placeholder="Was muss die Person mitbringen oder beachten?"></textarea></label>
        ${skillsField(firm, draft)}`}
        <fieldset class="field"><legend>Modell und Gehalt</legend>
          <div class="model-table" role="radiogroup" aria-label="Modell">
            <div class="model-row model-row-head" aria-hidden="true"><span></span><span>Gehalt: Eingabe / Ausgabe je Mio. Tokens · je Schritt</span></div>
            ${MODELS.map((m) => html`<button type="button" class="model-row ${m.id === draft.modelId ? 'selected' : ''}" role="radio" aria-checked="${m.id === draft.modelId}" data-action="hire-model" data-id="${m.id}">
              <span class="model-name"><strong>${m.label}</strong><small>${m.blurb} Kontext ${tokenCount(m.contextWindow)}, Antwort bis ${tokenCount(m.maxOutput)} Tokens.</small></span>
              <span class="num">${pricePerMillion(m.id, fx)}<small class="model-step"> · ${eurFrom(estimateStepUsd(m.id, total, 0) * fx)}</small></span>
            </button>`)}
          </div>
          <p class="hint">Anbieter: Anthropic. Listenpreise vom ${new Date(PRICES_AS_OF).toLocaleDateString('de-DE')}. ${fxNote(s.system.fx)}</p>
        </fieldset>
      </div>
      <aside class="hire-side">
        <section class="context-box" aria-label="Kontext und Kosten">
          <h3>Kontext und Kosten</h3>
          <div class="spent-line"><span>Startkontext mit ${chosen.label}</span><span class="num">${tokenCount(total)} von ${tokenCount(chosen.contextWindow)}</span></div>
          ${meter(total, chosen.contextWindow, 'Startkontext')}
          <dl class="facts">
            <div><dt>Grundlast, gemessen</dt><dd class="num">rund ${tokenCount(BASE_CONTEXT_TOKENS)}</dd></div>
            <div><dt>Stelle und eigene Fähigkeiten, geschätzt</dt><dd class="num">rund ${tokenCount(added)}</dd></div>
            <div><dt>Gehalt je Mio. Tokens</dt><dd class="num">${pricePerMillion(chosen.id, fx)}</dd></div>
            <div><dt>Erster Schritt, Schreiben in den Cache</dt><dd class="num">${eurFrom(estimateStepUsd(chosen.id, 0, total) * fx)}</dd></div>
            <div><dt>Jeder weitere Schritt, Lesen</dt><dd class="num">${eurFrom(estimateStepUsd(chosen.id, total, 0) * fx)}</dd></div>
          </dl>
          <p class="hint">${COST_NOTE}</p>
        </section>
        <div class="card-preview">
          <img class="portrait portrait-big" src="${portrait({ ...draft.look, top: role.top })}" alt="Vorschau" />
          <label class="field"><span>Name</span><input name="name" maxlength="20" value="${draft.name}" autocomplete="off" required /></label>
          <div class="look-row"><span>Haar</span>
            ${LOOK_OPTIONS.hair.map((h) => html`<button type="button" class="swatch-text ${draft.look.hair === h ? 'on' : ''}" data-action="hire-look" data-field="hair" data-value="${h}">${h}</button>`)}
          </div>
          <div class="look-row"><span>Farbe</span>
            ${LOOK_OPTIONS.hairColor.map((c) => html`<button type="button" class="swatch ${draft.look.hairColor === c ? 'on' : ''}" style="background:${c}" data-action="hire-look" data-field="hairColor" data-value="${c}" aria-label="Haarfarbe ${c}"></button>`)}
          </div>
          <div class="look-row"><span>Haut</span>
            ${LOOK_OPTIONS.skin.map((c) => html`<button type="button" class="swatch ${draft.look.skin === c ? 'on' : ''}" style="background:${c}" data-action="hire-look" data-field="skin" data-value="${c}" aria-label="Hautton ${c}"></button>`)}
          </div>
          <label class="check"><input type="checkbox" data-action="hire-glasses" ${draft.look.glasses ? 'checked' : ''} /> Brille</label>
        </div>
        ${s.company.departments.length ? html`<fieldset class="field"><legend>Arbeitsplatz</legend>
          <div class="toggle-row">
            ${[null, ...s.company.departments].map((department) => {
              const desks = freeDesks(s.company, department);
              const on = desks.some((d) => d.id === draft.deskId);
              return html`<button type="button" class="toggle ${on ? 'on' : ''}" data-action="hire-desk" data-id="${desks[0]?.id ?? ''}" ${desks.length ? '' : 'disabled'} aria-pressed="${on}">${department?.name ?? 'Allgemein'} <small>(${desks.length} frei)</small></button>`;
            })}
          </div>
          <p class="hint">Der Platz legt die Abteilung fest, und damit Budget und Wissen.</p>
        </fieldset>` : null}
      </aside>
      <footer class="modal-foot">
        ${contextStrip([{ who: chosen.label, used: total, window: chosen.contextWindow, stepEur: estimateStepUsd(chosen.id, 0, total) * fx }])}
        <p class="hint">Zur Einstellung gehört ein echtes Vorstellungsgespräch, ein kurzer Lauf mit höchstens ${eur(RULES.interviewLimitEur)}. Scheitert es, wird niemand eingestellt.</p>
        ${draft.error ? html`<p class="form-error" role="alert">${draft.error}</p>` : null}
        <button class="btn" type="button" data-action="close-modal">Abbrechen</button>
        <button class="btn btn-primary" ${draft.busy ? 'disabled' : ''}>Einstellen</button>
      </footer>
    </form>`;
}

/* ---------- Auftrag planen ---------- */

const SUGGESTED_LIMIT: Record<string, number> = {
  'claude-haiku-5-5': 0.25, 'claude-sonnet-5-5': 1, 'claude-opus-5-5': 2, 'claude-fable-5-1': 4,
};
export const suggestedLimit = (modelId: string) => SUGGESTED_LIMIT[modelId] ?? RULES.defaultOrderLimitEur;

const STAGE_TITLE: Record<StageKind, string> = { plan: 'Planen', work: 'Arbeiten', check: 'Prüfen' };
const STAGE_HINT: Record<StageKind, string> = {
  plan: 'Schreibt einen Plan für die nächste Stufe. Kann entfallen.',
  work: 'Erstellt das Ergebnis.',
  check: 'Prüft gegen die Abnahme und darf nur lesen. Kann entfallen.',
};

function slotPicker(kind: StageKind, chosen: string | null, hired: Agent[], team: OrderTeamDraft, company: Company): Safe {
  const optional = kind !== 'work';
  return html`<div class="slot" data-key="slot-${kind}">
    <div class="slot-head"><strong>${STAGE_TITLE[kind]}</strong><small>${STAGE_HINT[kind]}</small></div>
    <div class="slot-options" role="radiogroup" aria-label="${STAGE_TITLE[kind]}">
      ${optional ? html`<button type="button" class="slot-option slot-none ${chosen === null ? 'selected' : ''}" role="radio" aria-checked="${chosen === null}" data-action="order-slot" data-slot="${kind}" data-id="">Entfällt</button>` : null}
      ${hired.map((a) => {
        const blocked = kind === 'check' && a.id === team.work;
        const working = company.runs.some((r) => r.agentId === a.id && r.status === 'running');
        return html`<button type="button" class="slot-option ${a.id === chosen ? 'selected' : ''}" role="radio" aria-checked="${a.id === chosen}" data-action="order-slot" data-slot="${kind}" data-id="${a.id}" ${blocked ? 'disabled' : ''} title="${blocked ? `${a.name} arbeitet an diesem Auftrag und kann sich nicht selbst prüfen.` : working ? `${a.name} arbeitet gerade. Die Stufe wartet dann.` : `${agentTitle(a)}, ${modelById(a.modelId)?.label}`}">
          <img class="portrait portrait-small" src="${portrait(a.look)}" alt="" />
          <span class="slot-name"><strong>${a.name}</strong><small>${modelById(a.modelId)?.label}${working ? ', beschäftigt' : ''}</small></span>
        </button>`;
      })}
    </div>
  </div>`;
}

export function orderModal(s: Snapshot, draft: OrderDraft): Safe {
  const { company, money } = s;
  const everyone = company.agents.filter((a) => a.hired);
  const chosenTeam = company.teams.find((t) => t.id === draft.teamId);
  const hired = chosenTeam ? everyone.filter((a) => chosenTeam.memberIds.includes(a.id)) : everyone;
  const team = draft.team;
  const nameOf = (id: string | null) => hired.find((a) => a.id === id)?.name;
  const chosen = [team.plan, team.work, team.check].flatMap((id) => (id ? [hired.find((a) => a.id === id)] : [])).filter((a): a is Agent => Boolean(a));
  const limit = Math.round(chosen.reduce((sum, a) => sum + suggestedLimit(a.modelId), 0) * 100) / 100;
  const stages = [
    ...(team.plan ? [{ title: 'Planen', who: nameOf(team.plan) }] : []),
    { title: 'Arbeiten', who: nameOf(team.work) },
    ...(team.check ? [{ title: 'Prüfen', who: nameOf(team.check) }] : []),
    { title: 'Abnahme', who: 'Du' },
  ];
  const single = hired.length < 2;
  return html`
    <header class="modal-head"><div><h2>Auftrag planen</h2><p class="modal-sub">Firma: ${company.name}</p></div>
      <button class="icon-btn" data-action="close-modal" aria-label="Schließen">×</button></header>
    <form class="modal-body order-grid" data-form="order">
      <div class="order-main">
        <label class="field"><span>Ziel</span><input name="title" data-measure="order" maxlength="140" required autocomplete="off" value="${draft.title ?? ''}" placeholder="Zum Beispiel: Klickbaren Prototyp erstellen" /></label>
        <label class="field"><span>Hinweise (optional)</span><textarea name="notes" data-measure="order" rows="2" maxlength="4000" placeholder="Was soll dein Team zusätzlich wissen?">${draft.notes ?? ''}</textarea></label>
        <fieldset class="field"><legend>Abnahme</legend>
          <p class="hint">Woran erkennst du, dass das Ergebnis passt? Dein Team sieht diese Punkte, du entscheidest am Ende.${draft.suggestion.length && draft.criteria.map((c) => c.text).join('\n') === draft.suggestion.join('\n') ? ` Vorschlag passend zur Rolle ${roleById(hired.find((a) => a.id === team.work)?.roleId ?? '')?.title ?? ''}: ändere, streiche oder ergänze.` : ''}</p>
          <ul class="criteria">
            ${draft.criteria.map((c) => html`<li data-key="${c.key}">
              <span class="tick" aria-hidden="true"></span>
              <input data-criterion="${c.key}" value="${c.text}" maxlength="200" aria-label="Abnahmekriterium" placeholder="Abnahmekriterium" />
              <button type="button" class="icon-btn" data-action="order-remove-criterion" data-id="${c.key}" aria-label="Kriterium entfernen">×</button>
            </li>`)}
          </ul>
          <button type="button" class="btn btn-small" data-action="order-add-criterion">Kriterium hinzufügen</button>
        </fieldset>
        <fieldset class="field"><legend>Ablauf</legend>
          <ol class="track track-plan">
            ${stages.map((stage, index) => html`<li class="${index === 0 ? 'on' : ''}">${stage.title}<small>${stage.who}</small></li>`)}
          </ol>
        </fieldset>
        <fieldset class="field"><legend>Grenzen</legend>
          <label class="check"><input type="checkbox" data-action="order-web" ${draft.webAccess ? 'checked' : ''} /> Darf im Web recherchieren</label>
          <p class="hint">Immer gesperrt: Dateien außerhalb des Arbeitsbereichs, Programme ausführen, deine verbundenen Konten, Senden und Veröffentlichen.</p>
        </fieldset>
      </div>
      <aside class="order-side">
        ${teamPicker(company, draft.teamId, 'order-team')}
        <fieldset class="field"><legend>${chosenTeam ? `Besetzung aus ${chosenTeam.name}` : 'Besetzung'}</legend>
          <div class="slots">
            ${slotPicker('plan', team.plan, hired, team, company)}
            ${slotPicker('work', team.work, hired, team, company)}
            ${slotPicker('check', team.check, hired, team, company)}
          </div>
          ${single ? html`<p class="hint">Für Planung und Prüfung brauchst du mehr Leute. Stelle sie im Team ein.</p>` : null}
        </fieldset>
        <fieldset class="field context-box"><legend>Kontext und Kosten</legend>
          ${([['Planen', team.plan], ['Arbeiten', team.work], ['Prüfen', team.check]] as const).map(([label, id]) => {
            const agent = hired.find((a) => a.id === id);
            return agent ? contextLine(agent, estimateTokensOfChars(draft.textChars), s.system.fx.eurPerUsd, label) : null;
          })}
          <p class="hint">${COST_NOTE}</p>
        </fieldset>
        <fieldset class="field"><legend>Auftragsdetails</legend>
          <label class="inline-field"><span>Auftragslimit in Euro</span>
            <input class="num" name="limit" type="number" min="0.001" step="any" value="${limit}" required /></label>
          <label class="inline-field"><span>Max. Korrekturrunden</span>
            <input class="num" name="revisions" type="number" min="0" max="5" step="1" value="${RULES.defaultMaxRevisions}" /></label>
          <p class="hint">Frei im KI-Budget: <span class="num">${eurFree(money.remainingEur)}</span>. ${stages.length > 2 ? 'Jede Stufe darf höchstens die Hälfte des Restlimits nutzen, die letzte den Rest.' : ''}</p>
        </fieldset>
      </aside>
      <footer class="modal-foot">
        ${contextStrip(([team.plan, team.work, team.check] as const).flatMap((id) => {
          const agent = hired.find((a) => a.id === id);
          return agent ? [agentStrip(agent, estimateTokensOfChars(draft.textChars), s.system.fx.eurPerUsd)] : [];
        }))}
        <p class="hint">${s.system.provider.billing === 'api' ? 'Der Start löst bezahlte KI-Arbeit aus.' : 'Der Start löst echte KI-Arbeit aus und verbraucht dein Kontingent.'}</p>
        ${draft.error ? html`<p class="form-error" role="alert">${draft.error}</p>` : null}
        <button class="btn" type="button" data-action="close-modal">Abbrechen</button>
        <button class="btn btn-primary" ${draft.busy || !team.work ? 'disabled' : ''}>Auftrag starten</button>
      </footer>
    </form>`;
}

/* ---------- Abteilung abstecken ---------- */

export function departmentModal(s: Snapshot, draft: DepartmentDraft): Safe {
  const general = s.pools.find((p) => p.id === null)!;
  const suggested = Math.max(0, Math.floor(Math.min(general.remainingEur / 2, 1) * 100) / 100);
  return html`
    <header class="modal-head"><div><h2>Abteilung abstecken</h2><p class="modal-sub">${draft.w} × ${draft.d} Felder, ${RULES.departmentCost} Baupunkte</p></div>
      <button class="icon-btn" data-action="close-modal" aria-label="Schließen">×</button></header>
    <form class="modal-body panel-form" data-form="department">
      <label class="field"><span>Name</span><input name="name" maxlength="30" required autocomplete="off" placeholder="Zum Beispiel: Produkt" /></label>
      <label class="field"><span>Eigenes Budget in Euro</span><input class="num" name="budget" type="number" min="0" step="0.05" value="${suggested}" /></label>
      <p class="hint">Das Budget kommt aus dem allgemeinen KI-Budget (${eurFree(general.remainingEur)} frei) und steht nur dieser Abteilung zu. Du kannst es später ändern.</p>
      <p class="hint">Wessen Schreibtischplatz im Bereich liegt, gehört zur Abteilung. Sie bekommt eine eigene Wissensablage unter wissen/.</p>
      ${draft.error ? html`<p class="form-error" role="alert">${draft.error}</p>` : null}
      <div class="btn-row"><button class="btn" type="button" data-action="close-modal">Abbrechen</button><button class="btn btn-primary" ${draft.busy ? 'disabled' : ''}>Abteilung gründen</button></div>
    </form>`;
}

/* ---------- Projekt ---------- */

const MANDATE_STATUS: Record<Mandate['status'], string> = { planning: 'Plant', active: 'Offen', closed: 'Abgeschlossen' };
const PROPOSAL_STATUS: Record<Proposal['status'], string> = { pending: 'Wartet auf dich', started: 'Gestartet', declined: 'Abgelehnt', invalid: 'Nicht zugelassen' };
const CONTRACT_STATUS: Record<Contract['status'], string> = { pending: 'Wartet auf Unterschrift', signed: 'Unterzeichnet', declined: 'Abgelehnt', invalid: 'Nicht zugelassen' };

export interface ContractView {
  mandateId: string;
  contract: Contract;
  markdown: string | null;
  busy: boolean;
  error: string;
}

/** Der Vertrag als Dokument mit der Unterschrift der Geschäftsführung darunter. Ohne sie wird niemand eingestellt. */
export function contractModal(s: Snapshot, view: ContractView): Safe {
  const { company } = s;
  const mandate = company.mandates.find((m) => m.id === view.mandateId);
  const taken = new Set(company.agents.map((a) => a.deskId));
  const desks = company.placed.filter((p) => p.kind === 'desk' && !taken.has(p.id) && (deskDepartment(company.departments, p)?.id ?? null) === (mandate?.departmentId ?? null));
  const pending = view.contract.status === 'pending';
  const departmentName = company.departments.find((d) => d.id === mandate?.departmentId)?.name;
  return html`
    <header class="modal-head"><div><h2>Arbeitsvertrag: ${view.contract.name}</h2><p class="modal-sub">${CONTRACT_STATUS[view.contract.status]}</p></div>
      <button class="icon-btn" data-action="close-modal" aria-label="Schließen">×</button></header>
    <div class="viewer-body">
      <iframe class="viewer-frame" title="Vertrag" sandbox="allow-same-origin" srcdoc="${view.markdown ?? ''}" data-key="${view.contract.id}-${view.contract.status}"></iframe>
    </div>
    <footer class="modal-foot">
      ${pending ? html`<p class="hint">${desks.length ? `Arbeitsplatz: ein freier Schreibtisch${departmentName ? ` in der Abteilung ${departmentName}` : ''}. Mit deiner Unterschrift beginnt das echte Vorstellungsgespräch (höchstens ${eur(RULES.interviewLimitEur)}).` : `Kein freier Arbeitsplatz${departmentName ? ` in der Abteilung ${departmentName}` : ''}. Stelle unter Bauen einen Schreibtisch auf, dann kannst du unterzeichnen.`}</p>` : html`<p class="hint">${view.contract.status === 'signed' ? 'Unterzeichnet. Die Person gehört zum Team.' : 'Dieser Vertrag ist nicht mehr offen.'}</p>`}
      ${view.error ? html`<p class="form-error" role="alert">${view.error}</p>` : null}
      ${pending ? html`<label class="inline-field contract-name"><span>Name</span><input name="contractName" maxlength="20" value="${view.contract.name}" autocomplete="off" /></label>
      <button class="btn" data-action="decline-contract" data-mandate="${view.mandateId}" data-id="${view.contract.id}" ${view.busy ? 'disabled' : ''}>Ablehnen</button>
      <button class="btn btn-primary" data-action="sign-contract" data-mandate="${view.mandateId}" data-id="${view.contract.id}" ${view.busy || !desks.length ? 'disabled' : ''}>Als Geschäftsführung unterzeichnen</button>` : html`<button class="btn btn-primary" data-action="close-modal">Schließen</button>`}
    </footer>`;
}
const mandateSpent = (company: Company, mandate: Mandate) => company.runs.filter((r) => r.mandateId === mandate.id).reduce((sum, r) => sum + r.costEur, 0);

export function mandateModal(s: Snapshot, draft: MandateDraft): Safe {
  const { company } = s;
  const hired = company.agents.filter((a) => a.hired);
  const manager = hired.find((a) => a.id === draft.managerId) ?? null;
  const department = manager ? departmentOfAgent(company, manager) : null;
  const pool = s.pools.find((p) => p.id === (department?.id ?? null))!;
  const chosenTeam = company.teams.find((t) => t.id === draft.teamId);
  const team = chosenTeam ? hired.filter((a) => chosenTeam.memberIds.includes(a.id)) : department ? hired.filter((a) => departmentOfAgent(company, a)?.id === department.id) : hired;
  const budget = Math.max(0.01, Math.floor(Math.min(pool.remainingEur / 2, 1) * 100) / 100);
  const modes: { id: SelfStartMode; title: string; blurb: string }[] = [
    { id: 'none', title: 'Nur vorschlagen', blurb: 'Jeden Auftrag gibst du einzeln frei.' },
    { id: 'upto', title: 'Kleine Aufträge selbst starten', blurb: 'Bis zu einem Limit je Auftrag startet der Manager allein, darüber fragt er dich.' },
    { id: 'all', title: 'Im Budget frei entscheiden', blurb: 'Der Manager startet jeden Auftrag im Budget selbst. Du nimmst nur die Ergebnisse ab.' },
  ];
  return html`
    <header class="modal-head"><div><h2>${chosenTeam ? `Projekt für ${chosenTeam.name}` : 'Projekt geben'}</h2><p class="modal-sub">${chosenTeam ? 'Die Teamleitung verteilt die Arbeit an die Passenden im Team. Was startet, entscheidest du.' : 'Ein Ziel, ein Budget, ein Manager, der es in Aufträge zerlegt'}</p></div>
      <button class="icon-btn" data-action="close-modal" aria-label="Schließen">×</button></header>
    <form class="modal-body order-grid" data-form="mandate">
      <div class="order-main">
        <label class="field"><span>Ziel</span><input name="goal" data-measure="mandate" maxlength="160" required autocomplete="off" value="${draft.goal ?? ''}" placeholder="Zum Beispiel: Eine erste Landingpage für die App" /></label>
        <label class="field"><span>Hinweise (optional)</span><textarea name="notes" data-measure="mandate" rows="3" maxlength="4000" placeholder="Was soll der Manager wissen?">${draft.notes ?? ''}</textarea></label>
        <fieldset class="field"><legend>Freigabe-Stufe</legend>
          <div class="approval" role="radiogroup" aria-label="Freigabe-Stufe">
            ${modes.map((m) => html`<button type="button" class="pick ${draft.mode === m.id ? 'selected' : ''}" role="radio" aria-checked="${draft.mode === m.id}" data-action="mandate-mode" data-id="${m.id}"><strong>${m.title}</strong><small>${m.blurb}</small></button>`)}
          </div>
          ${draft.mode === 'upto' ? html`<label class="inline-field"><span>Selbst starten bis Euro je Auftrag</span><input class="num" name="selfStart" type="number" min="0" step="any" value="${Math.round(budget * 20) / 100}" /></label>` : null}
          <p class="hint">Immer bei dir: Einstellen, Abnahme der Ergebnisse, alles nach außen. Der Manager kann nur lesen und planen.</p>
        </fieldset>
        <fieldset class="field"><legend>Grenzen</legend>
          <label class="check"><input type="checkbox" data-action="mandate-web" ${draft.webAccess ? 'checked' : ''} /> Die Aufträge dürfen im Web recherchieren</label>
        </fieldset>
      </div>
      <aside class="order-side">
        <fieldset class="field"><legend>${chosenTeam ? 'Teamleitung' : 'Manager'}</legend>
          <div class="slot-options" role="radiogroup" aria-label="Manager">
            ${(chosenTeam ? team : hired).map((a) => {
              const working = company.runs.some((r) => r.agentId === a.id && r.status === 'running');
              return html`<button type="button" class="slot-option ${a.id === draft.managerId ? 'selected' : ''}" role="radio" aria-checked="${a.id === draft.managerId}" data-action="mandate-manager" data-id="${a.id}" ${working ? 'disabled' : ''} title="${working ? `${a.name} arbeitet gerade.` : ''}">
                <img class="portrait portrait-small" src="${portrait(a.look)}" alt="" />
                <span class="slot-name"><strong>${a.name}</strong><small>${agentTitle(a)}${company.departments.length ? `, ${departmentOfAgent(company, a)?.name ?? 'Allgemein'}` : ''}</small></span>
              </button>`;
            })}
          </div>
          <p class="hint">${manager ? `${manager.name} kann einplanen: ${team.map((a) => a.name).join(', ')}${chosenTeam ? ` (Team ${chosenTeam.name})` : department ? ` (Abteilung ${department.name})` : ' (ganze Firma)'}.` : 'Wähle, wer das Projekt leitet.'}</p>
        </fieldset>
        ${teamPicker(company, draft.teamId, 'mandate-team')}
        ${manager ? html`<fieldset class="field context-box"><legend>Kontext und Kosten</legend>
          ${contextLine(manager, estimateTokensOfChars(draft.textChars), s.system.fx.eurPerUsd, 'Manager')}
          <p class="hint">${COST_NOTE}</p>
        </fieldset>` : null}
        <fieldset class="field"><legend>Budget</legend>
          <label class="inline-field"><span>Budget des Projekts in Euro</span><input class="num" name="budget" type="number" min="0.01" step="any" value="${budget}" required /></label>
          <p class="hint">Frei in ${pool.name === 'Allgemein' && !company.departments.length ? 'deinem KI-Budget' : `„${pool.name}“`}: <span class="num">${eurFree(pool.remainingEur)}</span>. Das Projekt hält sein Budget, bis du es abschließt. Die Planung selbst kostet daraus bis zu ${eur(RULES.manageLimitEur)} je Runde.</p>
        </fieldset>
      </aside>
      <footer class="modal-foot">
        ${manager ? contextStrip([agentStrip(manager, estimateTokensOfChars(draft.textChars), s.system.fx.eurPerUsd)]) : null}
        <p class="hint">${s.system.provider.billing === 'api' ? 'Der Start löst bezahlte KI-Arbeit aus.' : 'Der Start löst echte KI-Arbeit aus und verbraucht dein Kontingent.'}</p>
        ${draft.error ? html`<p class="form-error" role="alert">${draft.error}</p>` : null}
        <button class="btn" type="button" data-action="close-modal">Abbrechen</button>
        <button class="btn btn-primary" ${draft.busy || !manager ? 'disabled' : ''}>${chosenTeam ? 'Projekt geben' : 'Projekt starten'}</button>
      </footer>
    </form>`;
}

function mandatesSection(s: Snapshot, selectedId: string | null): Safe | null {
  const { company } = s;
  const anyone = company.agents.some((a) => a.hired);
  const selected = company.mandates.find((m) => m.id === selectedId) ?? null;
  const list = [...company.mandates].reverse();
  return html`<section class="mandates" data-key="mandates">
    <div class="section-head"><h3>Projekte</h3><button class="btn btn-small" data-action="open-mandate" ${anyone ? '' : 'disabled'}>Projekt geben</button></div>
    ${!list.length ? html`<p class="hint">Ein Projekt überträgt ein Ziel mit Budget an einen Manager. Er zerlegt es in Aufträge, du gibst frei oder lässt ihn im Budget selbst starten.</p>` : null}
    ${selected ? mandateDetail(s, selected) : null}
    ${list.length ? html`<ul class="order-list">
      ${list.map((m) => {
        const manager = company.agents.find((a) => a.id === m.managerId);
        const pending = m.proposals.filter((p) => p.status === 'pending').length + m.contracts.filter((c) => c.status === 'pending').length;
        return html`<li data-key="${m.id}">
          <button class="order-row ${m.id === selectedId ? 'selected' : ''}" data-action="select-mandate" data-id="${m.id}">
            <span class="order-row-text"><strong>${m.goal}</strong><small>${company.teams.find((t) => t.id === m.teamId) ? `Team ${company.teams.find((t) => t.id === m.teamId)!.name}, ` : ''}${manager?.name ?? '?'}${company.departments.length ? `, ${company.departments.find((d) => d.id === m.departmentId)?.name ?? 'Allgemein'}` : ''}</small></span>
            <span class="agent-row-end"><span class="chip chip-mandate-${pending ? 'pending' : m.status}">${pending ? `${pending} Freigabe${pending > 1 ? 'n' : ''} offen` : MANDATE_STATUS[m.status]}</span><small class="num">${eur(mandateSpent(company, m))} von ${eur(m.budgetEur)}</small></span>
          </button></li>`;
      })}
    </ul>` : null}
  </section>`;
}

function mandateDetail(s: Snapshot, mandate: Mandate): Safe {
  const { company } = s;
  const manager = company.agents.find((a) => a.id === mandate.managerId);
  const nameOf = (id: string | null) => company.agents.find((a) => a.id === id)?.name ?? '';
  const spent = mandateSpent(company, mandate);
  const planning = company.runs.find((r) => r.mandateId === mandate.id && r.kind === 'manage' && r.status === 'running');
  const pending = mandate.proposals.some((p) => p.status === 'pending') || mandate.contracts.some((c) => c.status === 'pending');
  const self = mandate.selfStartUpToEur;
  const approval = self <= 0 ? 'Jeder Auftrag braucht deine Freigabe.' : self >= mandate.budgetEur ? 'Startet im Budget selbst.' : `Startet bis ${eur(self)} je Auftrag selbst.`;
  const rounds = [...mandate.rounds].reverse();
  return html`
    <section class="detail" data-key="mandate-${mandate.id}">
      <h3>${mandate.goal}</h3>
      <dl class="facts">
        <div><dt>Manager</dt><dd>${manager?.name ?? '?'}${mandate.departmentId ? `, ${company.departments.find((d) => d.id === mandate.departmentId)?.name ?? ''}` : ''}</dd></div>
        <div><dt>Freigabe-Stufe</dt><dd>${approval}</dd></div>
        <div><dt>Stand</dt><dd>${planning ? `${manager?.name} ${manager?.live.detail ?? 'plant'}` : MANDATE_STATUS[mandate.status]}</dd></div>
      </dl>
      <div class="spent-line"><span>Verbrauch des Projekts</span><span class="num">${eur(spent)} von ${eur(mandate.budgetEur)}</span></div>
      ${meter(spent, mandate.budgetEur, 'Budget des Projekts')}
      ${mandate.lastError ? html`<p class="form-error">${mandate.lastError}</p>` : null}
      ${rounds.map((round) => html`<section class="round" data-key="round-${round.round}">
        <h4>Planungsrunde ${round.round}${round.done ? ', Ziel laut Manager erreicht' : ''}</h4>
        <blockquote class="summary">${round.summary}</blockquote>
        ${round.open ? html`<p class="hint">Offen: ${round.open}</p>` : null}
        <ul class="proposals">
          ${mandate.proposals.filter((p) => p.round === round.round).map((p) => {
            const order = company.orders.find((o) => o.id === p.orderId);
            const team = [p.team.plan ? `Planen ${nameOf(p.team.plan)}` : '', `Arbeiten ${nameOf(p.team.work)}`, p.team.check ? `Prüfen ${nameOf(p.team.check)}` : ''].filter(Boolean).join(', ');
            return html`<li data-key="${p.id}" class="proposal proposal-${p.status}">
              <div class="proposal-head"><strong>${p.title}</strong><span class="chip chip-proposal-${p.status}">${order ? ORDER_STATUS[order.status] : PROPOSAL_STATUS[p.status]}</span></div>
              <small>${team} · Limit ${eur(p.limitEur)}</small>
              ${p.invalidReason ? html`<p class="form-error">${p.invalidReason}</p>` : null}
              ${p.status === 'pending' ? html`
                ${p.notes ? html`<p class="hint">${p.notes}</p>` : null}
                <ul class="criteria criteria-done">${p.criteria.map((c, index) => html`<li data-key="${index}">${c}</li>`)}</ul>
                ${p.reason ? html`<p class="hint">Begründung: ${p.reason}</p>` : null}
                <div class="btn-row">
                  <button class="btn btn-primary btn-small" data-action="approve-proposal" data-mandate="${mandate.id}" data-id="${p.id}">Freigeben</button>
                  <button class="btn btn-small" data-action="decline-proposal" data-mandate="${mandate.id}" data-id="${p.id}">Ablehnen</button>
                </div>` : null}
              ${order ? html`<button class="text-btn" data-action="select-order" data-id="${order.id}">Auftrag ansehen</button>` : null}
            </li>`;
          })}
        </ul>
        ${mandate.contracts.some((c) => c.round === round.round) ? html`<h4>Vorgeschlagene Einstellungen</h4>
        <ul class="proposals">
          ${mandate.contracts.filter((c) => c.round === round.round).map((c) => html`<li data-key="${c.id}" class="proposal proposal-${c.status}">
            <div class="proposal-head"><strong>${c.name}</strong><span class="chip chip-proposal-${c.status}">${CONTRACT_STATUS[c.status]}</span></div>
            <small>${roleById(c.roleId)?.title ?? c.roleId}, ${modelById(c.modelId)?.label ?? c.modelId}${c.skillIds.length ? `, ${c.skillIds.map((id) => skillById(id)?.title).join(', ')}` : ''}</small>
            ${c.invalidReason ? html`<p class="form-error">${c.invalidReason}</p>` : null}
            ${c.reason ? html`<p class="hint">${c.reason}</p>` : null}
            <div class="btn-row"><button class="btn btn-small ${c.status === 'pending' ? 'btn-primary' : ''}" data-action="open-contract" data-mandate="${mandate.id}" data-id="${c.id}">Vertrag ${c.status === 'pending' ? 'lesen und unterzeichnen' : 'ansehen'}</button></div>
          </li>`)}
        </ul>` : null}
      </section>`)}
      <div class="btn-row">
        ${mandate.status === 'active' ? html`<button class="btn ${pending ? '' : 'btn-primary'}" data-action="plan-mandate" data-id="${mandate.id}" ${pending ? 'disabled' : ''} title="${pending ? 'Entscheide zuerst über die offenen Vorschläge.' : ''}">Weiterplanen lassen</button>` : null}
        ${planning ? html`<button class="btn" data-action="stop-run" data-id="${planning.id}">Planung stoppen</button>` : null}
        ${mandate.status === 'active' ? html`<button class="btn" data-action="close-mandate" data-id="${mandate.id}">Abschließen</button>` : null}
        <button class="btn" data-action="open-file" data-path="${mandate.file}">Akte öffnen</button>
      </div>
      ${mandate.status === 'active' ? html`<p class="hint">Das Projekt hält ${eur(Math.max(0, mandate.budgetEur - spent))} seines Budgets, bis du es abschließt.</p>` : null}
    </section>`;
}

/* ---------- Projekte ---------- */

const STAGE_STATUS: Record<Stage['status'], string> = {
  waiting: 'Wartet',
  running: 'Läuft',
  done: 'Fertig',
  failed: 'Fehler',
  stopped: 'Gestoppt',
  limit: 'Limit erreicht',
};

function stageRows(company: Company, order: Order): Safe {
  const stageRuns = (stage: Stage) => company.runs.filter((r) => r.orderId === order.id && r.stageKind === stage.kind);
  const running = order.status === 'running';
  return html`<ol class="stages">
    ${order.stages.map((stage, index) => {
      const agent = company.agents.find((a) => a.id === stage.agentId);
      const cost = stageRuns(stage).reduce((sum, r) => sum + r.costEur, 0);
      const current = index === order.stageIndex;
      const untouched = stage.status === 'waiting' && !(current && running);
      const queued = current && running && stage.status === 'waiting';
      const busyElsewhere = queued && company.runs.some((r) => r.agentId === stage.agentId && r.status === 'running');
      const label = busyElsewhere ? `Wartet auf ${agent?.name}` : queued ? 'Startet' : untouched ? '' : STAGE_STATUS[stage.status];
      return html`<li data-key="${stage.id}" class="stage-row ${current && running ? 'stage-now' : ''}">
        ${agent ? html`<img class="portrait portrait-small" src="${portrait(agent.look)}" alt="" />` : null}
        <span class="stage-text"><strong>${STAGE_TITLE[stage.kind]}</strong><small>${agent?.name}</small></span>
        <span class="stage-end">${label ? html`<span class="chip chip-stage-${busyElsewhere ? 'waiting' : stage.status}">${label}</span>` : null}<small class="num">${cost ? eur(cost) : ''}</small></span>
      </li>`;
    })}
    <li class="stage-row ${order.status === 'review' ? 'stage-now' : ''}" data-key="abnahme">
      <span class="stage-you" aria-hidden="true">Du</span>
      <span class="stage-text"><strong>Abnahme</strong><small>Deine Entscheidung</small></span>
      <span class="stage-end">${order.status === 'review' ? html`<span class="chip chip-order-review">Wartet auf dich</span>`
        : order.status === 'accepted' ? html`<span class="chip chip-order-accepted">Abgenommen</span>`
        : order.status === 'rejected' ? html`<span class="chip">Abgelehnt</span>` : null}</span>
    </li>
  </ol>`;
}

function verdictBox(company: Company, stage: Stage): Safe {
  const verdict = stage.verdict!;
  const checker = company.agents.find((a) => a.id === stage.agentId);
  return html`<section class="verdict ${verdict.passed ? 'verdict-ok' : 'verdict-no'}" data-key="verdict-${verdict.round}">
    <h4>Prüfung ${verdict.round} von ${checker?.name}: ${verdict.passed ? 'bestanden' : 'nicht bestanden'}</h4>
    ${verdict.summary ? html`<p>${verdict.summary}</p>` : null}
    ${verdict.defects.length ? html`<ul class="defects">${verdict.defects.map((d, index) => html`<li data-key="${index}">${d}</li>`)}</ul>` : null}
    <button class="text-btn" data-action="open-file" data-path="${verdict.file}">Bericht öffnen</button>
  </section>`;
}

/** Ab dieser Zahl beginnt der Arbeitsbereich eingeklappt: Ergebnisse und Aufträge sollen nicht unter Dateien verschwinden. */
const WORKSPACE_FEW_FILES = 12;

/** Wer etwas auf- oder zugeklappt hat, behält das. Sonst entscheidet die Menge der Dateien. */
export interface WorkspaceFolds {
  [path: string]: boolean;
}

interface FileFolder {
  path: string;
  name: string;
  folders: FileFolder[];
  files: FileEntry[];
  count: number;
}

function fileTree(files: FileEntry[]): FileFolder {
  const root: FileFolder = { path: '', name: '', folders: [], files: [], count: 0 };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    node.count++;
    parts.slice(0, -1).forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/');
      let next = node.folders.find((f) => f.path === path);
      if (!next) {
        next = { path, name, folders: [], files: [], count: 0 };
        node.folders.push(next);
      }
      next.count++;
      node = next;
    });
    node.files.push(file);
  }
  return root;
}

function folderView(node: FileFolder, folds: WorkspaceFolds, few: boolean, action = 'open-file', selected: string | null = null): Safe {
  return html`<ul class="file-list">
    ${node.folders.map((folder) => {
      const open = folds[folder.path] ?? few;
      return html`<li data-key="dir-${folder.path}">
        <button type="button" class="file-row file-folder" data-action="toggle-fold" data-id="${folder.path}" aria-expanded="${open}"><span><span class="fold-mark" aria-hidden="true">${open ? '▾' : '▸'}</span> ${folder.name}/</span><small class="num">${folder.count}</small></button>
        ${open ? html`<div class="file-nested">${folderView(folder, folds, few, action, selected)}</div>` : null}
      </li>`;
    })}
    ${node.files.map((f) => html`<li data-key="${f.path}"><button class="file-row ${f.path === selected ? 'selected' : ''}" data-action="${action}" data-path="${f.path}" title="${f.path}"><span>${f.path.split('/').pop()}</span><small class="num">${(f.size / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB</small></button></li>`)}
  </ul>`;
}

export function noteModal(draft: NoteDraft): Safe {
  const note = draft.note;
  return html`
    <header class="modal-head"><div><h2>${note ? 'Zettel ändern' : 'Neuer Zettel'}</h2></div>
      <button class="icon-btn" data-action="close-modal" aria-label="Schließen">×</button></header>
    <form class="modal-body panel-form" data-form="note">
      <label class="field"><span>Aufgabe</span><input name="title" maxlength="140" required autocomplete="off" value="${note?.title ?? ''}" placeholder="Zum Beispiel: Preise der Konkurrenz vergleichen" /></label>
      <label class="field"><span>Hinweis (optional)</span><textarea name="notes" rows="2" maxlength="1000">${note?.notes ?? ''}</textarea></label>
      <label class="field"><span>Wer passt dazu? (optional)</span><input name="role" maxlength="60" autocomplete="off" value="${note?.role ?? ''}" placeholder="Rolle oder Name" /></label>
      <label class="field"><span>Abnahme (optional, je Zeile ein Punkt)</span><textarea name="criteria" rows="3" maxlength="1000">${note?.criteria.join('\n') ?? ''}</textarea></label>
      <p class="hint">Der Zettel kostet nichts. Vergeben wird er erst durch dich.</p>
      ${draft.error ? html`<p class="form-error" role="alert">${draft.error}</p>` : null}
      <div class="btn-row">
        <button class="btn" type="button" data-action="close-modal">Abbrechen</button>
        <button class="btn btn-primary" ${draft.busy ? 'disabled' : ''}>${note ? 'Speichern' : 'An die Tafel'}</button>
      </div>
    </form>`;
}

/** Die Tafel: was Agenten vorschlagen und noch niemand bekommen hat. */
function boardSection(s: Snapshot, noteId: string | null): Safe {
  const { company } = s;
  const notes = boardNotes({ board: company.board ?? [], mandates: company.mandates });
  const later = (company.board ?? []).filter((n) => n.status === 'later');
  const selected = notes.find((n) => n.id === noteId) ?? null;
  const nameOf = (id: string | null) => (id ? company.agents.find((a) => a.id === id)?.name ?? 'Jemand' : 'Du');
  return html`<section class="tafel" data-key="tafel">
    <div class="section-head"><h3>${scrumMaster(company) ? 'Tafel · Backlog' : 'Tafel'}</h3><span class="panel-sub">${notes.length === 1 ? '1 Zettel' : `${notes.length} Zettel`}</span></div>
    <ul class="tafel-board">
      ${notes.map((note, index) => html`<li data-key="${note.id}"><button class="zettel zettel-${note.kind} ${note.id === noteId ? 'selected' : ''}" style="--tilt:${(index % 5) - 2}deg;background:${noteLook(company, note).color};color:${noteLook(company, note).ink}" data-action="select-note" data-id="${note.id}" aria-pressed="${note.id === noteId}" ${note.kind === 'vorschlag' ? '' : html`data-note="${note.id}"`}>
        <span class="zettel-title">${note.title}</span><small>${noteLook(company, note).role || nameOf(note.byAgentId)}${note.kind === 'vorschlag' ? ' · Vorschlag' : ''}</small>
      </button></li>`)}
      <li data-key="neu"><button class="zettel zettel-neu" data-action="open-note">+ Zettel</button></li>
    </ul>
    ${later.length ? html`<details class="tafel-later" data-key="tafel-later"><summary>Für später · ${later.length}</summary>
      <ul class="plain-list">${later.map((n) => html`<li data-key="${n.id}" class="later-row"><span>${n.title}</span>
        <button class="btn btn-small" data-action="note-edit" data-id="${n.id}">Ändern</button>
        <button class="btn btn-small" data-action="note-back" data-id="${n.id}">An die Tafel</button>
      </li>`)}</ul></details>` : null}
    ${notes.some((n) => n.kind !== 'vorschlag') && staffOf(company).some((a) => a.hired) ? html`<ul class="tafel-staff" aria-label="Zettel hierher ziehen">
      ${staffOf(company).filter((a) => a.hired).map((a) => html`<li data-key="${a.id}" class="tafel-agent" data-drop-agent="${a.id}"><img class="portrait portrait-small" src="${portrait(a.look)}" alt="" />
        <span class="tafel-agent-text"><strong>${a.name}</strong><small>${agentTitle(a)}</small><small>${a.live.detail || 'Frei'}</small></span>
        <button class="btn btn-small" data-action="open-agent-file" data-id="${a.id}">Akte</button></li>`)}
    </ul>
    <p class="hint">Zettel auf eine Person ziehen, hier oder im Büro: Sie holt ihn ab und beginnt. Das Limit richtet sich nach ihrem Modell.</p>` : null}
    ${openSprint(company) ? html`<button class="btn btn-small btn-wide" data-action="open-sprint-app" data-key="tafel-sprint">Sprint ${openSprint(company)!.number}: ${SPRINT_STATUS[openSprint(company)!.status]}</button>` : scrumMaster(company) ? html`<button class="btn btn-small btn-wide" data-action="open-sprint-app" data-key="tafel-sprint">Sprint planen</button>` : null}
    ${selected ? noteDetail(s, selected) : null}
  </section>`;
}

function noteDetail(s: Snapshot, note: BoardNote): Safe {
  const { company } = s;
  const author = note.byAgentId ? company.agents.find((a) => a.id === note.byAgentId)?.name ?? 'Jemand' : 'dir';
  if (note.kind === 'vorschlag') {
    const mandate = company.mandates.find((m) => m.id === note.mandateId)!;
    const proposal = mandate.proposals.find((p) => p.id === note.id)!;
    const worker = company.agents.find((a) => a.id === proposal.team.work)?.name ?? '?';
    return html`<div class="detail" data-key="note-${note.id}">
      <h4>${proposal.title}</h4>
      <p class="hint">Vorschlag von ${author} im Projekt „${mandate.goal}". Arbeiten: ${worker}. Limit: ${eur(proposal.limitEur)}.</p>
      ${proposal.notes ? html`<p class="job-text">${proposal.notes}</p>` : null}
      <ul class="facts">${proposal.criteria.map((c, i) => html`<li data-key="${i}">${c}</li>`)}</ul>
      <div class="btn-row">
        <button class="btn btn-primary btn-small" data-action="approve-proposal" data-mandate="${mandate.id}" data-id="${proposal.id}">Freigeben</button>
        <button class="btn btn-small" data-action="decline-proposal" data-mandate="${mandate.id}" data-id="${proposal.id}">Ablehnen</button>
      </div>
    </div>`;
  }
  const item = company.board.find((n) => n.id === note.id)!;
  const anyone = company.agents.some((a) => a.hired);
  return html`<div class="detail" data-key="note-${note.id}">
    <h4>${item.title}</h4>
    <p class="hint">Von ${author}${item.role ? `. Passt zu: ${item.role}` : ''}.</p>
    <p class="note-field"><strong>Hinweis</strong> ${item.notes || 'Keiner.'}</p>
    ${item.criteria.length ? html`<div class="note-field"><strong>Abnahme</strong><ul class="facts">${item.criteria.map((c, i) => html`<li data-key="${i}">${c}</li>`)}</ul></div>` : html`<p class="note-field"><strong>Abnahme</strong> Keine. Beim Vergeben werden Punkte zur Rolle vorgeschlagen.</p>`}
    <div class="btn-row">
      <button class="btn btn-primary btn-small" data-action="note-order" data-id="${item.id}" ${anyone ? '' : 'disabled'}>Als Auftrag vergeben</button>
      <button class="btn btn-small" data-action="note-project" data-id="${item.id}" ${anyone ? '' : 'disabled'}>Als Projekt ans Team</button>
      <button class="btn btn-small" data-action="note-edit" data-id="${item.id}">Ändern</button>
      <button class="btn btn-small" data-action="note-later" data-id="${item.id}">Für später</button>
      <button class="btn btn-small" data-action="note-drop" data-id="${item.id}">Ablehnen</button>
    </div>
  </div>`;
}

export function projectsPanel(s: Snapshot, orderId: string | null, mandateId: string | null, files: FileEntry[], folds: WorkspaceFolds = {}, noteId: string | null = null): Safe {
  const { company } = s;
  const anyone = company.agents.some((a) => a.hired);
  const selected = company.orders.find((o) => o.id === orderId) ?? null;
  const ordered = [...company.orders].reverse();
  return html`
    <div class="panel-head"><h2>Projekte</h2><span class="panel-sub">${company.orders.length === 1 ? '1 Auftrag' : `${company.orders.length} Aufträge`}</span></div>
    <button class="btn ${company.orders.length ? '' : 'btn-primary'} btn-wide" data-action="open-order" ${anyone ? '' : 'disabled'}>Auftrag planen</button>
    ${!anyone ? html`<p class="hint">Stelle zuerst jemanden ein. Aufträge bearbeiten echte Mitarbeiter.</p>` : null}
    ${commandsSection(s)}
    ${boardSection(s, noteId)}
    ${anyone || company.mandates.length ? mandatesSection(s, mandateId) : null}
    ${selected ? orderDetail(s, selected) : null}
    <ul class="order-list">
      ${ordered.map((order) => {
        const names = order.stages.map((stage) => company.agents.find((a) => a.id === stage.agentId)?.name).filter(Boolean);
        const mandate = company.mandates.find((m) => m.id === order.mandateId);
        return html`<li data-key="${order.id}">
          <button class="order-row ${order.id === orderId ? 'selected' : ''}" data-action="select-order" data-id="${order.id}">
            <span class="order-row-text"><strong>${order.title}</strong><small>${names.join(', ')}${mandate ? ` · ${order.startedBy === 'manager' ? 'gestartet' : 'geplant'} von ${company.agents.find((a) => a.id === mandate.managerId)?.name ?? 'Manager'}` : ''}</small></span>
            <span class="agent-row-end"><span class="chip chip-order-${order.status}">${ORDER_STATUS[order.status]}</span><small class="num">${eur(orderSpent(company, order))}</small></span>
          </button></li>`;
      })}
    </ul>
    ${workspaceSection(company, files, folds)}`;
}

function workspaceSection(company: Company, files: FileEntry[], folds: WorkspaceFolds): Safe {
  const few = files.length <= WORKSPACE_FEW_FILES;
  const open = folds['/'] ?? few;
  return html`<section class="workspace" data-key="workspace">
      <button type="button" class="fold-head" data-action="toggle-fold" data-id="/" aria-expanded="${open}"><h3><span class="fold-mark" aria-hidden="true">${open ? '▾' : '▸'}</span> Arbeitsbereich</h3><small class="num">${files.length === 1 ? '1 Datei' : `${count(files.length)} Dateien`}</small></button>
      ${open ? html`
        ${company.projectDir ? html`<p class="hint">Eingebundener Projektordner: <code>${company.projectDir}</code>, für dein Team als <code>projekt/</code> sichtbar.${navigator.platform.startsWith('Mac') ? html` <button class="text-btn" data-action="reveal-file" data-path="projekt">Im Ordner zeigen</button>` : null}</p>` : null}
        ${files.length === 0 ? html`<p class="hint">Noch keine Dateien.</p>` : folderView(fileTree(files), folds, few)}` : null}
    </section>`;
}

/** Wer welche Datei geliefert hat. Berichte der Prüfung sind unter ihrem Urteil verlinkt. */
function resultFiles(order: Order): { path: string; label: string }[] {
  const stageOf = (path: string) => order.stages.find((stage) => stage.files.includes(path));
  return order.files
    .filter((path) => !/\/pruefung-\d+\.md$/.test(path))
    .map((path) => ({ path, label: stageOf(path)?.kind === 'plan' ? 'Plan' : 'Ergebnis' }));
}

function orderDetail(s: Snapshot, order: Order): Safe {
  const { company } = s;
  const runs = company.runs.filter((r) => r.orderId === order.id);
  const run = runs.at(-1);
  const spent = orderSpent(company, order);
  const running = order.status === 'running';
  const pending = order.status === 'review' || order.status === 'limit' || order.status === 'stopped' || order.status === 'failed';
  const check = order.stages.find((stage) => stage.kind === 'check');
  const verdict = check?.verdict ?? null;
  const results = resultFiles(order);
  const multi = order.stages.length > 1;
  return html`
    <section class="detail" data-key="order-${order.id}">
      <h3>${order.title}</h3>
      ${stageRows(company, order)}
      <div class="spent-line"><span>Verbrauch</span><span class="num">${eur(spent)} von ${eur(order.limitEur)}</span></div>
      ${meter(spent, order.limitEur, 'Auftragslimit')}
      ${spent > order.limitEur ? html`<p class="hint">Das Limit wurde überschritten, weil der laufende Schritt erst danach beendet werden konnte.</p>` : null}
      ${order.maxRevisions ? html`<p class="hint">Korrekturrunden: ${order.revisionsUsed} von ${order.maxRevisions} genutzt</p>` : null}
      ${run?.status === 'running' && run.agentId && company.agents.find((a) => a.id === run.agentId) ? html`<p class="live-line">${run.agentName}: ${company.agents.find((a) => a.id === run.agentId)?.live.detail}</p>` : null}
      ${run?.error ? html`<p class="form-error">${run.error}</p>` : null}
      ${results.length ? html`
        <h4>Dateien</h4>
        <ul class="file-list">
          ${results.map((file) => html`<li data-key="${file.path}"><button class="file-row file-row-result" data-action="open-result" data-order="${order.id}" data-path="${file.path}"><span>${file.path.split('/').pop()}</span><small>${multi ? `${file.label}, ` : ''}Öffnen</small></button></li>`)}
        </ul>
        ${order.savedFromText ? html`<p class="hint">Die Arbeitsstufe hat keine Datei angelegt. Die Antwort wurde als Datei gesichert.</p>` : null}` : null}
      ${order.summary && !running ? html`<blockquote class="summary">${order.summary}</blockquote>` : null}
      ${verdict && check ? verdictBox(company, check) : null}
      ${pending ? reviewControls(s, order) : null}
      ${order.status === 'accepted' || order.status === 'rejected' ? html`
        <ul class="criteria criteria-done">
          ${order.criteria.map((c, index) => html`<li data-key="${index}">${c.checked ? 'Erfüllt' : 'Offen'}: ${c.text}</li>`)}
        </ul>` : null}
      ${running ? html`<button class="btn btn-wide" data-action="stop-order" data-id="${order.id}">Stoppen</button>` : null}
      ${run ? activityLog(run) : null}
    </section>`;
}

/** Abnehmen, ablehnen, nachbessern. Im Projekte-Tab und in der Post dasselbe. */
function reviewControls(s: Snapshot, order: Order): Safe {
  const { company } = s;
  const agent = company.agents.find((a) => a.id === order.agentId);
  const check = order.stages.find((stage) => stage.kind === 'check');
  const verdict = check?.verdict ?? null;
  const revisionsLeft = order.maxRevisions - order.revisionsUsed;
  return html`
        <h4>Abnahme</h4>
        <ul class="criteria criteria-check">
          ${order.criteria.map((c, index) => {
            const rated = verdict?.criteria[index];
            return html`<li data-key="${index}"><label class="check"><input type="checkbox" data-criterion-check="${index}" /> <span>${c.text}${rated ? html`<small class="rated ${rated.met ? 'rated-ok' : 'rated-no'}" title="${rated.reason}">${check && company.agents.find((a) => a.id === check.agentId)?.name}: ${rated.met ? 'erfüllt' : 'nicht erfüllt'}</small>` : null}</span></label></li>`;
          })}
        </ul>
        <div class="btn-row">
          <button class="btn btn-primary" data-action="accept-order" data-id="${order.id}" ${order.files.length ? '' : 'disabled'}>Abnehmen, +${RULES.buildPointsPerAcceptedOrder} Baupunkte</button>
          <button class="btn" data-action="reject-order" data-id="${order.id}">Ablehnen</button>
        </div>
        <form class="revise-form" data-form="revise" data-id="${order.id}">
          ${order.status === 'review' ? (order.maxRevisions === 0 ? html`<p class="hint">Für diesen Auftrag sind keine Korrekturrunden vorgesehen.</p>` : html`
            <label class="field"><span>Korrektur (noch ${revisionsLeft} von ${order.maxRevisions})</span>
              <textarea name="feedback" rows="2" maxlength="2000" placeholder="Was soll geändert werden?" ${revisionsLeft <= 0 ? 'disabled' : ''}></textarea></label>
            <button class="btn" ${revisionsLeft <= 0 ? 'disabled' : ''}>Korrektur anfordern</button>`)
          : html`
            <label class="field"><span>Hinweis zum Weitermachen (optional)</span><textarea name="feedback" rows="2" maxlength="2000"></textarea></label>
            <label class="inline-field"><span>Limit erhöhen um Euro</span><input class="num" name="addLimit" type="number" min="0" step="any" value="${order.status === 'limit' ? order.limitEur : 0}" /></label>
            <button class="btn">Weitermachen bei ${agent?.name}</button>`}
        </form>`;
}

function activityLog(run: Run): Safe {
  const entries = run.activity.slice(-8).reverse();
  return html`<details class="activity" data-key="activity-${run.id}">
    <summary>Was ${run.agentName} zuletzt getan hat</summary>
    <ul>${entries.map((entry, index) => html`<li data-key="${entry.at}-${index}" class="activity-${entry.kind}">${entry.label}</li>`)}</ul>
  </details>`;
}

/* ---------- Finanzen ---------- */

export function financePanel(s: Snapshot): Safe {
  const { company, money, system } = s;
  const runs = [...company.runs].reverse();
  const billing = runs[0]?.billing ?? system.provider.billing;
  const byAgent = new Map<string, number>();
  for (const run of company.runs) byAgent.set(run.agentName, (byAgent.get(run.agentName) ?? 0) + run.costEur);
  const plan = system.plan;
  return html`
    <div class="panel-head"><h2>Finanzen</h2></div>
    <section class="budget">
      <div class="budget-big"><span>Frei</span><strong class="num">${eurFree(money.remainingEur)}</strong></div>
      ${meter(money.spentEur + money.reservedEur, company.budgetEur, 'KI-Budget belegt')}
      <dl class="facts">
        <div><dt>KI-Budget</dt><dd class="num">${eur(company.budgetEur)}</dd></div>
        <div><dt>Verbraucht</dt><dd class="num">${eur(money.spentEur)}</dd></div>
        <div><dt>Für laufende Arbeit reserviert</dt><dd class="num">${eur(money.reservedEur)}</dd></div>
      </dl>
      <form class="inline-form" data-form="budget">
        <label class="visually-hidden" for="budget-input">KI-Budget in Euro</label>
        <input id="budget-input" class="num" name="budget" type="number" min="0" step="0.5" value="${company.budgetEur}" />
        <button class="btn btn-small">Budget ändern</button>
      </form>
    </section>
    <div class="note">
      ${billing === 'api' ? html`<strong>Über API-Schlüssel abgerechnet.</strong> <span>Diese Beträge werden dir tatsächlich berechnet.</span>`
        : billing === 'test' ? html`<strong>Test-Attrappe.</strong> <span>Diese Beträge sind nicht echt.</span>`
        : html`<strong>Dein Abo trägt die Kosten.</strong> <span>Pro Token wird nichts abgebucht. Die Euro-Werte zeigen, was diese echte Arbeit zum API-Listenpreis kosten würde, und das KI-Budget begrenzt genau diesen Wert.</span>`}
      <small>${fxNote(system.fx)}</small>
    </div>
    ${company.departments.length ? html`<section class="pools" data-key="pools">
      <h3>Budgetverteilung</h3>
      ${s.pools.map((pool) => html`<div class="pool" data-key="${pool.id ?? 'allgemein'}">
        <div class="spent-line"><span><span class="dept-dot" style="background:${company.departments.find((d) => d.id === pool.id)?.color ?? '#9db2c9'}"></span> ${pool.name}</span><span class="num">${eurFree(pool.remainingEur)} frei von ${eur(pool.budgetEur)}</span></div>
        ${meter(pool.spentEur + pool.reservedEur, pool.budgetEur, `Budget ${pool.name}`)}
        <small class="hint-small">Verbraucht ${eur(pool.spentEur)}, reserviert ${eur(pool.reservedEur)}</small>
      </div>`)}
      <p class="hint">Jede Ausgabe hat genau eine Quelle: das Projekt, die Abteilung des Bearbeiters oder das allgemeine Budget.</p>
    </section>` : null}
    ${plan ? html`
      <section class="plan">
        <h3>Abo-Kontingent</h3>
        ${plan.fiveHour ? html`<div class="spent-line"><span>Aktuelles 5-Stunden-Fenster</span><span class="num">${percent(plan.fiveHour.utilization)}</span></div>${meter(plan.fiveHour.utilization, 1, '5-Stunden-Fenster')}<small class="hint-small">Erneuert sich ${untilTime(plan.fiveHour.resetsAt)}</small>` : null}
        ${plan.sevenDay ? html`<div class="spent-line"><span>Aktuelle Woche</span><span class="num">${percent(plan.sevenDay.utilization)}</span></div>${meter(plan.sevenDay.utilization, 1, 'Woche')}<small class="hint-small">Erneuert sich ${untilTime(plan.sevenDay.resetsAt)}</small>` : null}
        <small class="hint-small">Laut Anbieter, Stand ${time(plan.at)}.</small>
      </section>` : null}
    ${byAgent.size > 1 ? html`<section><h3>Nach Mitarbeiter</h3>
      <dl class="facts">${[...byAgent].map(([name, value]) => html`<div data-key="${name}"><dt>${name}</dt><dd class="num">${eur(value)}</dd></div>`)}</dl></section>` : null}
    <section class="ledger">
      <h3>Verbrauchsbuch</h3>
      ${runs.length === 0 ? html`<p class="hint">Noch keine Buchungen. Hier steht künftig jeder einzelne Lauf.</p>` : null}
      <ul>${runs.map((run) => ledgerRow(company.id, run))}</ul>
    </section>`;
}

function ledgerRow(companyId: string, run: Run): Safe {
  const model = modelById(run.modelUsed ?? run.model);
  const u = run.usage;
  const computed = model ? costFromUsage(model.price, u) : null;
  const matches = computed !== null && Math.abs(computed - run.costUsd) < Math.max(1e-6, run.costUsd * 0.01);
  const price = model?.price;
  const row = (label: string, tokens: number, rate?: number) =>
    tokens ? html`<tr><th scope="row">${label}</th><td class="num">${count(tokens)}</td><td class="num">${rate?.toLocaleString('de-DE')} $</td><td class="num">${usd((tokens * (rate ?? 0)) / 1e6)}</td></tr>` : null;
  return html`<li data-key="${run.id}">
    <details class="ledger-row">
      <summary>
        <span class="ledger-who"><strong>${run.agentName}</strong><small>${run.stageKind && run.stageKind !== 'work' ? STAGE_TITLE[run.stageKind] : RUN_KIND[run.kind]}, ${time(run.startedAt)}</small></span>
        <span class="ledger-amount"><strong class="num">${run.status === 'running' ? 'läuft, ' : ''}${eur(run.costEur)}</strong><small>${RUN_STATUS[run.status]}</small></span>
      </summary>
      <div class="ledger-detail">
        <table>
          <thead><tr><th scope="col">Art</th><th scope="col">Tokens</th><th scope="col">Pro Mio.</th><th scope="col">Betrag</th></tr></thead>
          <tbody>
            ${row('Eingabe', u.input, price?.input)}
            ${row('Ausgabe', u.output, price?.output)}
            ${row('Aus dem Cache gelesen', u.cacheRead, price?.read)}
            ${row('In den Cache geschrieben, 5 Min.', u.cacheWrite5m, price?.write5m)}
            ${row('In den Cache geschrieben, 1 Std.', u.cacheWrite1h, price?.write1h)}
          </tbody>
        </table>
        <dl class="facts">
          <div><dt>${run.costSource === 'gemeldet' ? 'Vom Anbieter gemeldet' : 'Aus gezählten Tokens berechnet'}</dt><dd class="num">${usd(run.costUsd)}</dd></div>
          ${run.costSource === 'gemeldet' && computed !== null ? html`<div><dt>Nachrechnung aus den Tokens</dt><dd class="num">${matches ? 'stimmt überein' : `${usd(computed)}, weicht ab`}</dd></div>` : null}
          <div><dt>In Euro</dt><dd class="num">${eur(run.costEur)}</dd></div>
          <div><dt>Limit dieses Laufs</dt><dd class="num">${eur(run.limitEur)}</dd></div>
          <div><dt>Modell</dt><dd>${model?.label ?? run.modelUsed ?? run.model}</dd></div>
          ${run.durationMs !== null ? html`<div><dt>Dauer</dt><dd class="num">${duration(run.durationMs)}${run.turns ? `, ${run.turns} Schritte` : ''}</dd></div>` : null}
          ${run.denied ? html`<div><dt>Abgewiesene Zugriffe</dt><dd class="num">${run.denied}</dd></div>` : null}
          <div><dt>Session</dt><dd><code title="${run.sessionId}">${run.sessionId.slice(0, 8)}</code></dd></div>
        </dl>
        ${run.costSource === 'berechnet' && run.status !== 'running' ? html`<p class="hint">Dieser Lauf endete ohne Abschlussmeldung. Der Betrag ist aus den mitgezählten Tokens berechnet, die Ausgabe der letzten Nachricht ist anhand des empfangenen Textes geschätzt.</p>` : null}
        ${!matches && run.costSource === 'gemeldet' && run.webAccess ? html`<p class="hint">Der Anbieterwert enthält zusätzlich die Kosten der Websuche.</p>` : null}
        <a class="text-link" href="${api.logUrl(companyId, run.id)}" target="_blank" rel="noopener">Rohprotokoll dieses Laufs öffnen</a>
      </div>
    </details>
  </li>`;
}

/* ---------- Bauen ---------- */

/** Anbau und Stockwerke: nur am eigenen Haus und nur, was das Grundstück hergibt. */
function buildingSection(s: Snapshot): Safe {
  const { company, system } = s;
  const limits = buildLimits(company.locationId);
  if (!limits) return html`<section class="detail" data-key="building"><h3>Anbau</h3><p class="hint">Anbauen und Stockwerke gehen nur am eigenen Neubau.</p></section>`;
  const house = buildingAt(company.town, company.town.siteId);
  const room = roomOf(company);
  const can = (cost: number) => system.unlimitedBuild || company.buildPoints >= cost;
  const row = (kind: string, title: string, note: string, cost: number, open: boolean) => html`<li data-key="${kind}">
    <button class="catalog-row" data-action="expand" data-id="${kind}" ${open && can(cost) ? '' : 'disabled'}>
      <span class="catalog-name"><strong>${title}</strong><small>${open ? note : 'Mehr gibt das Grundstück nicht her.'}</small></span><span class="num">${open ? cost : ''}</span>
    </button></li>`;
  const nextFloor = floorCost(house.floors);
  const shaftRow = (kind: 'stairs' | 'lift', title: string, note: string, cost: number, withFloor: boolean) => html`<li data-key="${kind}-${withFloor}">
    <button class="catalog-row" data-action="build-shaft" data-id="${kind}" data-floor="${withFloor ? '1' : ''}" ${can(cost) ? '' : 'disabled'}>
      <span class="catalog-name"><strong>${title}</strong><small>${note}</small></span><span class="num">${cost}</span>
    </button></li>`;
  return html`<section class="detail" data-key="building">
    <h3>Anbau</h3>
    <p class="hint">${room.w} × ${room.d} Felder, ${house.floors === 1 ? '1 Etage' : `${house.floors} Etagen`}. Möglich: ${room.w - house.w + limits.w} × ${room.d - house.d + limits.d} Felder, ${limits.floors} Etagen.</p>
    <ul class="catalog">
      ${row('breiter', 'Breiter', 'Ein Feld mehr, auf jeder Etage.', EXTEND_COST, house.w < limits.w)}
      ${row('tiefer', 'Tiefer', 'Ein Feld mehr, auf jeder Etage.', EXTEND_COST, house.d < limits.d)}
      ${house.shafts.length
        ? html`${row('etage', 'Stockwerk', 'Eine Etage mehr.', nextFloor, house.floors < limits.floors)}
          ${shaftRow('stairs', 'Weitere Treppe', 'Kürzere Wege. Steht auf jeder Etage.', SHAFT_COST.stairs, false)}
          ${shaftRow('lift', 'Fahrstuhl', 'Kürzere Wege. Steht auf jeder Etage.', SHAFT_COST.lift, false)}`
        : house.floors < limits.floors
          ? html`${shaftRow('stairs', 'Stockwerk mit Treppe', 'Wähle den Platz für den Aufgang.', nextFloor + SHAFT_COST.stairs, true)}
            ${shaftRow('lift', 'Stockwerk mit Fahrstuhl', 'Wähle den Platz für den Aufgang.', nextFloor + SHAFT_COST.lift, true)}`
          : row('etage', 'Stockwerk', '', 0, false)}
    </ul>
    ${house.floors > 1 ? html`<p class="hint">Etage wechseln: <kbd>Bild auf</kbd>, <kbd>Bild ab</kbd> oder Klick auf die Treppe.</p>` : null}
  </section>`;
}

export function buildPanel(s: Snapshot, buildKind: string | null, moving: boolean, message: string, anchored: boolean, inventoryId: string | null = null, confirmDelete: string | null = null): Safe {
  const fromInventory = Boolean(inventoryId);
  const deletable = moving || fromInventory;
  const { company } = s;
  const zone = buildKind === 'department';
  const info = buildKind && !zone ? furnitureByKind(buildKind as never) : null;
  const shaft = info ? isShaft(info.kind) : false;
  const rotates = info ? !isProp(info.kind) || (shaft && !moving) : false;
  return html`
    <div class="panel-head"><h2>Büro ausbauen</h2></div>
    <div class="points"><span class="points-icon" aria-hidden="true"></span><span>Baupunkte:</span><strong class="num">${s.system.unlimitedBuild ? '∞' : company.buildPoints}</strong>${s.system.unlimitedBuild ? html`<small class="hint">Schalter zum Ausprobieren, Bauen kostet nichts</small>` : null}</div>
    ${zone ? html`
      <section class="detail">
        <h3>Abteilung abstecken</h3>
        <p class="hint">${anchored ? 'Klicke jetzt die gegenüberliegende Ecke.' : 'Klicke die erste Ecke des Bereichs im Büro.'} Mindestens ${RULES.departmentMinSize} × ${RULES.departmentMinSize} Felder, nicht über anderen Abteilungen.</p>
        ${message ? html`<p class="form-error">${message}</p>` : null}
        <p class="hint"><kbd>Esc</kbd> abbrechen</p>
      </section>` : null}
    ${info ? html`
      <section class="detail">
        <h3>${moving ? `${info.title} umstellen` : info.title}</h3>
        <p class="hint">${shaft && moving ? `Steht auf jeder Etage und bleibt an seinem Platz. Entfernen geht, solange ein zweiter Aufgang steht.` : shaft ? `${info.size}, auf jeder Etage an derselben Stelle. Das gelbe Feld davor bleibt frei. Fahre mit der Maus auf ein Feld im Büro.` : `${info.size}. ${moving ? 'Umstellen ist kostenlos.' : fromInventory ? 'Aus dem Inventar, kostenlos.' : `Kosten: ${info.cost} Baupunkte.`} Fahre mit der Maus auf ein Feld im Büro.${rotates ? '' : ' Dieser Gegenstand lässt sich nicht drehen.'}`}${info.kind === 'meeting' ? ' Beim Besprechungsraum legt das fest, wo die Tür sitzt.' : ''}</p>
        ${message ? html`<p class="form-error">${message}</p>` : null}
        ${confirmDelete && deletable ? html`<p class="form-error" role="alert">Wirklich löschen? Noch einmal <kbd>Entf</kbd> drückt es endgültig weg, ohne Erstattung.</p>` : null}
        <ul class="key-legend">
          ${shaft && moving ? null : html`<li><kbd>Klick</kbd> oder <kbd>Enter</kbd> abstellen</li>`}
          ${rotates ? html`<li><kbd>R</kbd> ${shaft ? 'Seite wählen' : 'drehen'}</li>` : null}
          ${moving && !shaft ? html`<li><kbd>I</kbd> ins Inventar</li>` : null}
          ${deletable ? html`<li><kbd>Entf</kbd> löschen</li>` : null}
          <li><kbd>Esc</kbd> abbrechen</li>
        </ul>
      </section>` : zone ? null : html`<p class="hint">Wähle ein Möbelstück oder klicke einen Gegenstand im Büro an, auch alles, was schon im Raum stand. Dann geht alles über die Tastatur. Ein Rechtsklick dreht direkt an Ort und Stelle.</p>`}
    ${(company.inventory ?? []).length ? html`<section class="detail" data-key="inventory">
      <h3>Inventar</h3>
      <ul class="catalog">
        ${company.inventory.map((stored) => html`<li data-key="${stored.id}">
          <button class="catalog-row ${inventoryId === stored.id ? 'selected' : ''}" data-action="inventory-pick" data-id="${stored.id}">
            <span class="catalog-name"><strong>${furnitureByKind(stored.kind).title}</strong><small>${furnitureByKind(stored.kind).size}</small></span><span class="num">frei</span>
          </button></li>`)}
      </ul>
      <p class="hint">Anklicken und neu platzieren ist kostenlos. Löschen gibt keine Baupunkte zurück.</p>
    </section>` : null}
    <ul class="catalog">
      ${FURNITURE.map((f) => html`<li data-key="${f.kind}">
        <button class="catalog-row ${f.kind === buildKind && !moving && !fromInventory ? 'selected' : ''}" data-action="build-pick" data-id="${f.kind}" ${(!s.system.unlimitedBuild && company.buildPoints < f.cost) || (f.kind === 'ceoDesk' && [...company.placed, ...(company.inventory ?? [])].some((p) => p.kind === 'ceoDesk')) ? 'disabled' : ''}>
          <span class="catalog-name"><strong>${f.title}</strong><small>${f.blurb}</small></span><span class="num">${f.cost}</span>
        </button></li>`)}
      <li data-key="department">
        <button class="catalog-row ${zone ? 'selected' : ''}" data-action="build-pick" data-id="department" ${!s.system.unlimitedBuild && company.buildPoints < RULES.departmentCost ? 'disabled' : ''}>
          <span class="catalog-name"><strong>Abteilung</strong><small>Ein Bereich mit eigenem Team, Budget und Wissen.</small></span><span class="num">${RULES.departmentCost}</span>
        </button></li>
    </ul>
    ${buildingSection(s)}
    ${company.departments.length ? html`<section class="detail" data-key="zones">
      <h3>Abteilungen</h3>
      <ul class="dept-list">${company.departments.map((d) => html`<li data-key="${d.id}">
        <span><span class="dept-dot" style="background:${d.color}"></span> ${d.name}, ${d.w} × ${d.d} Felder${floorOf(d) ? `, ${floorName(floorOf(d))}` : ''}</span>
        <span class="btn-row"><button class="btn btn-small" data-action="redo-department" data-id="${d.id}">Neu abstecken</button>
        <button class="btn btn-small" data-action="dissolve-department" data-id="${d.id}">Auflösen</button></span></li>`)}</ul>
      <p class="hint">Rücke einen Schreibtisch in einen Bereich hinein oder heraus, um jemanden umzusetzen.</p>
    </section>` : null}
    <p class="hint">Mehr Platz: Läden und Grundstücke gibt es draußen in der Stadt.</p>
    <p class="hint hint-note">Baupunkte sind keine Euro. Du verdienst sie nur, wenn du ein Ergebnis abnimmst, nie durch Verbrauch.</p>`;
}

/* ---------- Ergebnis ansehen ---------- */

/** Die Vorschau einer Datei. HTML läuft abgeschirmt auf dem eigenen Port. */
function fileContent(companyId: string, path: string, doc: string | null, artifactPort: number): Safe {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md' || ext === 'txt' || ext === 'csv' || ext === 'json') return html`<iframe class="viewer-frame" title="Ergebnis" sandbox="allow-same-origin" srcdoc="${doc ?? ''}" data-key="${path}"></iframe>`;
  if (ext === 'html' || ext === 'htm') return html`<iframe class="viewer-frame" title="Ergebnis" sandbox="allow-scripts allow-same-origin allow-forms" src="${api.artifactUrl(artifactPort, companyId, path)}" data-key="${path}"></iframe>`;
  if (['png', 'jpg', 'jpeg', 'gif'].includes(ext)) return html`<img class="viewer-image" src="${api.fileUrl(companyId, path)}" alt="${path}" />`;
  return html`<p class="empty">Diese Datei lässt sich hier nicht anzeigen. Lade sie herunter.</p>`;
}

export function viewerModal(companyId: string, viewer: ViewerState, artifactPort: number): Safe {
  const ext = viewer.path.split('.').pop()?.toLowerCase() ?? '';
  const artifact = api.artifactUrl(artifactPort, companyId, viewer.path);
  return html`
    <header class="modal-head"><div><h2>${viewer.path.split('/').pop()}</h2><p class="modal-sub">${viewer.title}</p></div>
      <button class="icon-btn" data-action="close-modal" aria-label="Schließen">×</button></header>
    ${viewer.files.length > 1 ? html`<div class="file-tabs">${viewer.files.map((path) => html`<button class="toggle ${path === viewer.path ? 'on' : ''}" data-action="viewer-file" data-path="${path}">${path.split('/').pop()}</button>`)}</div>` : null}
    <div class="viewer-body">${fileContent(companyId, viewer.path, viewer.markdown, artifactPort)}</div>
    <footer class="modal-foot">
      ${ext === 'html' || ext === 'htm' ? html`<a class="btn" href="${artifact}" target="_blank" rel="noopener">Im neuen Tab öffnen</a>` : null}
      <a class="btn" href="${api.fileUrl(companyId, viewer.path, true)}" download>Herunterladen</a>
      ${navigator.platform.startsWith('Mac') ? html`<button class="btn" data-action="reveal-file" data-path="${viewer.path}">Im Ordner zeigen</button>` : null}
      <button class="btn btn-primary" data-action="close-modal">Schließen</button>
    </footer>`;
}

/* ---------- Oben, unten, erste Schritte ---------- */

export function topBar(s: Snapshot): Safe {
  const { company, money, system } = s;
  const low = money.remainingEur < company.budgetEur * 0.1;
  return html`
    <a class="logo" href="#" data-action="to-start" aria-label="Zur Firmenauswahl">Silly Vailley</a>
    <span class="bar-sep"></span>
    <strong class="company-name">${company.name}</strong>
    <span class="bar-sep"></span>
    <button class="budget-pill ${low ? 'low' : ''}" data-action="tab" data-id="finanzen">KI-Budget: <span class="num">${eurFree(money.remainingEur)}</span> frei</button>
    <span class="bar-grow"></span>
    ${system.plan?.fiveHour ? html`<span class="plan-pill" title="Abo-Kontingent laut Anbieter">Kontingent ${percent(system.plan.fiveHour.utilization)}</span>` : null}
    <span class="provider-pill ${system.provider.available ? '' : 'off'}">${system.provider.label}${system.provider.account ? `, ${system.provider.account}` : ''}</span>`;
}

export function liveNote(s: Snapshot, disconnected: boolean): Safe {
  if (disconnected) return html`<span class="live-note off">Keine Verbindung zum Server. Angezeigt wird der letzte bekannte Stand.</span>`;
  if (s.system.provider.testDouble) return html`<span class="live-note off">Test-Attrappe, keine echten Agenten</span>`;
  if (!s.system.provider.available) return html`<span class="live-note off">Kein Agenten-Anbieter verfügbar</span>`;
  return html`<span class="live-note">Live · gemessener Verbrauch</span>`;
}

export function roomChips(s: Snapshot, viewFloor = 0, ceoSeated = false): Safe {
  const loc = roomOf(s.company);
  const building = buildingAt(s.company.town, s.company.town.siteId);
  const pending = s.company.mandates.reduce((sum, m) => sum + m.proposals.filter((p) => p.status === 'pending').length + m.contracts.filter((c) => c.status === 'pending').length, 0);
  const commands = s.company.commands.filter((c) => c.status === 'pending').length;
  return html`<div class="chip-room">${loc.title} · ${loc.w} × ${loc.d} Felder${s.company.departments.length ? ` · ${s.company.departments.length === 1 ? '1 Abteilung' : `${s.company.departments.length} Abteilungen`}` : ''}</div>
    ${pending ? html`<div class="chip-room chip-pending">${pending === 1 ? 'Ein Vorschlag wartet' : `${pending} Vorschläge warten`} auf deine Freigabe</div>` : null}
    ${commands ? html`<button class="btn btn-door btn-attention" data-action="tab-team">${commands === 1 ? 'Ein Befehl wartet' : `${commands} Befehle warten`} auf deine Freigabe</button>` : null}
    ${building.floors > 1 ? html`<div class="floor-switch" role="group" aria-label="Etage">
      ${Array.from({ length: building.floors }, (_, floor) => {
        const people = s.company.agents.filter((a) => !a.firedAt && floorOf(s.company.placed.find((p) => p.id === a.deskId) ?? {}) === floor).length;
        return html`<button class="btn btn-door ${floor === viewFloor ? 'on' : ''}" aria-pressed="${floor === viewFloor}" data-action="set-floor" data-id="${floor}" data-key="${floor}" title="Bild auf und Bild ab wechseln die Etage">${floorName(floor)}${people ? ` · ${people}` : ''}</button>`;
      })}
    </div>` : null}
    ${ceoSeated ? html`<button class="btn btn-door btn-primary" data-action="open-files">Laptop${openMessages(s) ? ` · ${openMessages(s)}` : ''}</button>` : null}
    <div class="chip-seats">Arbeitsplätze: ${s.seats.used}/${s.seats.total}</div>`;
}

/* ---------- Stadt ---------- */

export function townChips(s: Snapshot): Safe {
  const site = parcelById(s.company.town.siteId);
  return html`<div class="chip-room">${TOWN_NAME} · Baupunkte: <span class="num">${s.system.unlimitedBuild ? '∞' : s.company.buildPoints}</span></div>
    <button class="btn btn-door" data-action="go-inside">Zurück ins Büro${site ? html` <small>(${site.name})</small>` : null}</button>
    <div class="chip-seats">Klicke auf die Stadt oder laufe mit den Pfeiltasten</div>`;
}

/** Was man hier tun kann, erscheint erst, wenn die Figur davor steht. */
export function townCard(s: Snapshot, parcel: Parcel | null): Safe | null {
  if (!parcel) return null;
  const { company, system } = s;
  const { town } = company;
  const here = town.siteId === parcel.id;
  const can = (cost: number) => system.unlimitedBuild || company.buildPoints >= cost;
  const room = parcel.locationId ? roomAt(parcel.locationId, buildingAt(town, parcel.id)) : null;
  const size = room ? `${room.w} × ${room.d} Felder` : '';
  const action = (kind: string, label: string, cost: number, primary = true, locationId?: string) => html`<button class="btn btn-small ${primary ? 'btn-primary' : ''}" data-action="town-action" data-town="${kind}" data-id="${parcel.id}" ${locationId ? html`data-location="${locationId}"` : ''} ${can(cost) ? '' : 'disabled'}>${label}</button>`;
  const inside = html`<button class="btn btn-small btn-primary" data-action="go-inside">Hineingehen</button>`;
  let facts: Safe | null = null;
  let buttons: Safe | null = null;
  if (parcel.kind === 'home') {
    const rooms = HOME_ROOMS.filter((id) => id !== company.locationId);
    buttons = html`${here ? inside : null}${rooms.map((id) => action('move', `In ${id === 'garage' ? 'die Garage' : 'das Kinderzimmer'} ziehen`, 0, !here, id))}`;
    facts = here ? html`<p class="hint">Hier sitzt deine Firma: ${locationById(company.locationId).title}.</p>` : html`<p class="hint">Kostenlos.</p>`;
  } else if (parcel.kind === 'vacant') {
    const rented = town.rented.includes(parcel.id);
    facts = html`<p class="hint">${size}.${rented ? ' Du hast den Mietvertrag.' : html` Miete: <span class="num">${parcel.price}</span> Baupunkte.`}</p>`;
    buttons = here ? inside : rented ? action('move', 'Einziehen', 0) : action('rent', `Anmieten für ${parcel.price} Baupunkte`, parcel.price ?? 0);
  } else if (parcel.kind === 'lot') {
    const owned = town.owned.includes(parcel.id);
    const built = town.built.includes(parcel.id);
    facts = html`<p class="hint">${built ? `Dein Neubau: ${size}.` : owned ? `Dein Grundstück. Bau: ${size}, ${parcel.buildCost} Baupunkte.` : `Kaufpreis: ${parcel.price} Baupunkte. Später möglich: Neubau mit ${size} für ${parcel.buildCost} Baupunkte.`}</p>`;
    buttons = here ? inside : built ? action('move', 'Einziehen', 0) : owned ? action('build', `Bauen für ${parcel.buildCost} Baupunkte`, parcel.buildCost ?? 0) : action('buy', `Kaufen für ${parcel.price} Baupunkte`, parcel.price ?? 0);
  }
  return html`<section class="town-card" aria-live="polite" data-key="${parcel.id}">
    <h2>${parcel.name}</h2>
    <small>${parcel.street}${parcel.kind === 'shop' ? ', geöffnet' : ''}</small>
    ${facts}
    ${buttons ? html`<div class="btn-row">${buttons}</div>` : null}
    ${parcel.kind === 'vacant' || parcel.kind === 'lot' ? html`<p class="hint">Bezahlt wird in Baupunkten, nicht aus dem KI-Budget.</p>` : null}
  </section>`;
}

export function notices(list: { id: string; level: string; text: string }[]): Safe {
  return html`${list.map((n) => html`<div class="toast toast-${n.level}" role="status" data-key="${n.id}"><span>${n.text}</span>
    <button class="icon-btn" data-action="dismiss-toast" data-id="${n.id}" aria-label="Schließen">×</button></div>`)}`;
}
