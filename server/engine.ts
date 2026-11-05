// Spielregeln und Laufsteuerung. Jede Aktion des Spielers landet hier und wird entweder
// mit einer klaren Begründung abgewiesen oder als echter Agenten-Lauf ausgeführt.

import { execFileSync } from 'node:child_process';
import { quotaClosedUntil } from '../shared/quota.ts';
import * as git from './git.ts';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CEO, LOOK_OPTIONS, DEPARTMENT_COLORS, FURNITURE, LOCATIONS, isProp, staffOf, MODELS, ROLES, RULES, SKILLS, commandRisks, furnitureByKind, locationById, modelById, roleById, skillById } from '../shared/catalog.ts';
import type { Settings } from './settings.ts';
import { openSprint, scrumMaster, sprintCommitted, sprintRows } from '../shared/scrum.ts';
import { checkDepartment, checkPlacement, deskDepartment } from '../shared/layout.ts';
import { SITE_STEP, baseFloorOf, siteAt, storeyOf, EXTEND_COST, SHAFT_COST, buildLimits, buildingAt, checkShaft, floorCost, floorOf, isShaft, itemsOnFloor, roomAt, roomOf, shaftLanding } from '../shared/building.ts';
import { CITIES, HOME_ROOMS, parcelById, parcelOfLocation, placeById, startTown } from '../shared/town.ts';
import type {
  CompanyRepo, OrderGit,
  Sprint,
  Agent, AgentLive, AgentOrigin, BoardItem, Building, CommandRequest, HelpRequest, Shaft, Company, CompanyRole, CompanySummary, Contract, Criterion, CustomSkill, Department, FurnitureKind, Job, Fx, LiveKind, Look, LocationId, Mandate, Meeting, Money,
  Order, PlacedItem, PlanStatus, Pool, ProjectAgent, Proposal, ProviderInfo, Rotation, Run, RunKind, Snapshot, Stage, StageKind, SystemInfo, Team, Verdict,
} from '../shared/types.ts';
import { emptyUsage } from '../shared/types.ts';
import type { FxSource } from './fx.ts';
import {
  DECISIONS_FILE, languageRule, ORDER_STATE, parsePlanning, planningPrompt, planningSchema, retroNotes, agentProfile, checkPrompt, commandFeedback, continuePrompt, contractText, decisionEntry, interviewPrompt, jobUpdate, managePrompt, manageSchema, mandateFile, meetingPrompt,
  meetingProtocol, meetingSchema, parseMeetingTurn, parsePlan, parseVerdict, planPrompt, reworkPrompt, revisionPrompt, speakingOrder, stageLabel,
  verdictReport, verdictSchema, workPrompt, type Briefing, HANDOVER_RULES, NOTE_RULES, colleagueLine, handoverDeniedNote, handoverNote, helpFeedback, helpPrompt, helpRules,
} from './prompts.ts';
import type { Provider, ProviderEvent, RunHandle } from './providers/types.ts';
import { parseCommandRequest, parseHandover, parseHelp, parseNotes, runCommand, type CommandHandle, type CommandResult } from './commands.ts';
import { listSubagents } from './subagents.ts';
import { BRANCHES_DIR, READ_DIR, changedFiles, ensureWorkspace, listAll, listFiles, resolveIn, slugify, snapshotFiles, type FileSnapshot, type Roots } from './workspace.ts';
import os from 'node:os';

export class GameError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const shortId = () => randomUUID().slice(0, 8);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Haiku-Aufträge kosten oft unter einem Cent, deshalb dürfen Limits auch so klein sein. */
const roundLimit = (n: number) => Math.round(n * 10000) / 10000;
const MAX_ACTIVITY = 300;
const MAX_TEXT = 40000;
const MAX_NOTICES = 8;
const DONE_SHOWN_MS = 8000;
const HANDOFF_SHOWN_MS = 6000;

type Listener = (snapshot: Snapshot) => void;

export interface RoleInput {
  title?: string;
  task?: string;
  requirements?: string;
  baseRoleId?: string;
  skillIds?: string[];
  modelId?: string;
  color?: string | null;
  customSkills?: { title: string; instruction: string; source?: CustomSkill['source'] }[];
}

export class Engine {
  private companies = new Map<string, Company>();
  private handles = new Map<string, RunHandle>();
  private commandHandles = new Map<string, CommandHandle>();
  private listeners = new Map<string, Set<Listener>>();
  private emitTimers = new Map<string, NodeJS.Timeout>();
  /** Wie lange der Neue bei jedem Kollegen bleibt. 0: Er lernt alle sofort kennen und läuft nicht. */
  tourStepMs = 3500;
  private saveTimers = new Map<string, NodeJS.Timeout>();
  /** Verbindungen zu weiteren Anbietern. In Tests ohne API leer. */
  settings: Settings | null = null;
  private providerInfo: ProviderInfo;
  private fxNow: Fx = { eurPerUsd: 1, date: '', source: 'ersatzwert' };
  private plan: PlanStatus | null = null;
  private quotaTimer: NodeJS.Timeout | null = null;
  /** Agenten, deren Lauf gerade anläuft. So kann keine Stufe dazwischenrutschen. */
  private starting = new Set<string>();
  /** Nach dem Herunterfahren schreibt kein nachlaufender Timer (Fertig-Anzeige, Übergabe) mehr auf die Platte. */
  private closed = false;
  private readonly dataDir: string;
  private readonly provider: Provider;
  private readonly fxSource: FxSource;
  private readonly artifactPort: number;
  /** Zum Ausprobieren: Bauen kostet nichts. Nur per Schalter beim Start, und die Oberfläche zeigt es. */
  private readonly unlimitedBuild: boolean;

  constructor(dataDir: string, provider: Provider, fxSource: FxSource, artifactPort = 0, unlimitedBuild = false) {
    this.dataDir = dataDir;
    this.provider = provider;
    this.fxSource = fxSource;
    this.artifactPort = artifactPort;
    this.unlimitedBuild = unlimitedBuild;
    this.providerInfo = {
      id: provider.id, label: 'Anthropic', available: false, version: null,
      billing: null, account: null, error: 'Wird geprüft.', testDouble: false,
    };
  }

  /* ---------- Start und Wiederherstellung ---------- */

  async init(): Promise<void> {
    fs.mkdirSync(this.companiesDir(), { recursive: true });
    try {
      this.plan = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'plan.json'), 'utf8'));
    } catch {
      // Noch kein Kontingentstand bekannt
    }
    this.scheduleQuotaWake();
    for (const entry of fs.readdirSync(this.companiesDir(), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const company: Company = JSON.parse(fs.readFileSync(this.companyFile(entry.name), 'utf8'));
        this.recover(company);
        this.companies.set(company.id, company);
      } catch (err) {
        console.warn(`Firma ${entry.name} konnte nicht geladen werden: ${(err as Error).message}`);
      }
    }
    this.providerInfo = await this.provider.detect();
    this.fxNow = await this.fxSource.get();
  }

  /** Ein Lauf, der beim letzten Beenden noch aktiv war, läuft nicht mehr. Die Figur darf nichts anderes zeigen. */
  private recover(company: Company): void {
    let touched = migrateOrders(company);
    company.meetings ??= [];
    company.departments ??= [];
    company.mandates ??= [];
    company.projectDir ??= null;
    // Alte Spielstände: Was fest eingebaut war, steht danach als normaler Gegenstand im Raum.
    const propsWereFixed = !company.town?.furnished;
    company.town ??= startTown(company.locationId);
    company.customSkills ??= [];
    company.commands ??= [];
    // Ein Befehl läuft nicht über einen Neustart hinweg. Offene Anträge bleiben, doch ihr Auftrag steht jetzt still.
    for (const request of company.commands) {
      if (request.status !== 'running') continue;
      touched = true;
      request.status = 'stopped';
      request.output += `${request.output ? '\n' : ''}Abgebrochen, weil das Spiel beendet wurde. Ob der Befehl fertig wurde, ist nicht bekannt.`;
      this.appendCommandLog(company, request, 'abgebrochen');
    }
    company.teams ??= [];
    company.roles ??= [];
    company.inventory ??= [];
    company.board ??= [];
    company.helps ??= [];
    company.sprints ??= [];
    // Alter Wortlaut im Spielstand: Das Ergebnis liegt jetzt in der Post.
    for (const agent of company.agents) if (agent.live?.kind === 'review') agent.live.detail = 'Ergebnis liegt in deiner Post';
    for (const sprint of company.sprints) {
      if (sprint.status !== 'planning') continue;
      touched = true;
      sprint.status = 'proposed';
      sprint.error = 'Das Planning wurde unterbrochen, weil Silly Valley beendet wurde.';
    }
    // Eine Anfrage läuft nicht über einen Neustart hinweg. Wer gewartet hat, macht ohne Antwort weiter.
    for (const help of company.helps) {
      if (help.status !== 'queued' && help.status !== 'running') continue;
      touched = true;
      help.status = 'failed';
      help.delivered = true;
      const waiting = company.orders.find((o) => o.helpId === help.id);
      if (waiting) waiting.helpId = null;
    }
    if (propsWereFixed) {
      company.town.furnished = [company.locationId];
      company.placed.push(...this.propsOf(company.locationId));
      touched = true;
    }
    for (const team of company.teams) team.leadId ??= null;
    for (const mandate of company.mandates) for (const contract of mandate.contracts ?? []) contract.companyRoleId ??= null;
    for (const agent of company.agents) {
      agent.companyRoleId ??= null;
      agent.firedAt ??= null;
      // Bei alten Spielständen ist nicht mehr bekannt, was später dazukam. Es zählt als mitgebracht.
      agent.startSkillIds ??= [...agent.skillIds];
      // Eine Kennenlernrunde läuft nicht über einen Neustart hinweg. Danach kennt jeder alle.
      agent.knownIds = company.agents.filter((a) => a.id !== agent.id && !a.firedAt).map((a) => a.id);
      agent.job ??= null;
      agent.origin ??= null;
      agent.briefedSkillIds ??= [...agent.skillIds];
      agent.jobPending ??= false;
      agent.context ??= null;
    }
    if (company.projectDir && !fs.existsSync(company.projectDir)) {
      this.notify(company, 'error', `Der Projektordner ${company.projectDir} ist nicht mehr da. Ohne ihn startet kein Lauf.`);
    }
    for (const mandate of company.mandates) {
      mandate.contracts ??= [];
      mandate.teamId ??= null;
      if (mandate.status !== 'planning') continue;
      touched = true;
      mandate.status = 'active';
      mandate.lastError = 'Die Planung wurde unterbrochen, weil Silly Valley beendet wurde.';
      this.notify(company, 'info', `Projekt "${mandate.goal}": Die Planung wurde beim Neustart unterbrochen. Du kannst sie erneut anstoßen.`);
    }
    for (const meeting of company.meetings) {
      if (meeting.status !== 'running') continue;
      touched = true;
      meeting.status = 'stopped';
      meeting.turnActive = false;
      this.notify(company, 'info', `Die Besprechung "${meeting.topic}" wurde beim Neustart angehalten. Du kannst sie fortsetzen.`);
    }
    for (const agent of company.agents) {
      // Nach einem Neustart läuft nichts mehr. Wer auf etwas gewartet hat, zeigt den Stand neu.
      if (agent.live.kind === 'done' || agent.live.kind === 'handoff' || agent.live.kind === 'waiting') this.setIdleOrPending(company, agent);
    }
    for (const run of company.runs) {
      if (run.status !== 'running') continue;
      touched = true;
      run.status = 'interrupted';
      run.endedAt = Date.now();
      run.costSource = 'berechnet';
      run.error = 'Der Lauf wurde unterbrochen, weil Silly Valley beendet wurde. Der Verbrauch ist aus den bis dahin gezählten Tokens berechnet.';
      this.killOrphan((run as Run & { pid?: number }).pid);
      this.appendLedger(company, run);
      const agent = company.agents.find((a) => a.id === run.agentId);
      if (run.kind === 'interview') {
        company.agents = company.agents.filter((a) => a.id !== run.agentId);
        continue;
      }
      if (run.orderId) {
        const order = company.orders.find((o) => o.id === run.orderId);
        if (order) {
          order.status = 'stopped';
          order.stages[order.stageIndex].status = 'stopped';
          order.files = this.orderFiles(company, order);
        }
      }
      if (agent) this.setIdleOrPending(company, agent);
    }
    // Ein Auftrag zwischen zwei Stufen startet nach einem Neustart nicht von selbst weiter:
    // Ohne den Menschen darf kein neuer Verbrauch entstehen.
    for (const order of company.orders) {
      if (order.status !== 'running') continue;
      touched = true;
      order.status = 'stopped';
      order.stages[order.stageIndex].status = 'stopped';
      this.cancelOrderCommand(company, order);
      this.notify(company, 'info', `"${order.title}" wurde beim Neustart angehalten. Du kannst ihn fortsetzen.`);
    }
    if (touched) this.persistNow(company);
  }

  /** Geänderte Verbindungen erreichen alle offenen Spielstände. */
  settingsChanged(): void {
    for (const company of this.companies.values()) this.touch(company);
  }

  /** Ein Modell oder eine Verbindung bleibt, solange jemand damit angestellt ist. */
  assertModelFree(prefix: string): void {
    for (const company of this.companies.values()) {
      const agent = company.agents.find((a) => a.hired && !a.firedAt && a.modelId.startsWith(prefix));
      if (agent) throw new GameError(`${agent.name} (${company.name}) arbeitet mit diesem Modell. Kündige zuerst oder stelle jemand anderen ein.`);
    }
  }

  private killOrphan(pid?: number): void {
    if (!pid) return;
    try {
      const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
      if (command.includes('claude') && command.includes('--strict-mcp-config')) process.kill(pid, 'SIGTERM');
    } catch {
      // Prozess existiert nicht mehr
    }
  }

  shutdown(): void {
    this.closed = true;
    for (const handle of this.handles.values()) handle.stop('stopped');
    for (const handle of this.commandHandles.values()) handle.stop();
    for (const timer of [...this.saveTimers.values(), ...this.emitTimers.values()]) clearTimeout(timer);
    this.saveTimers.clear();
    this.emitTimers.clear();
    for (const company of this.companies.values()) this.persistNow(company);
  }

  /* ---------- Pfade und Speicher ---------- */

  private companiesDir = () => path.join(this.dataDir, 'companies');
  private companyDir = (id: string) => path.join(this.companiesDir(), id);
  private companyFile = (id: string) => path.join(this.companyDir(id), 'company.json');
  workspaceOf = (id: string) => path.join(this.companyDir(id), 'workspace');
  rawLogOf = (id: string, runId: string) => path.join(this.companyDir(id), 'runs', `${runId}.jsonl`);

  /** Arbeitsbereich und eingebundenes Projekt. Nur diese beiden Orte darf ein Agent berühren und die Oberfläche zeigen. */
  rootsOf(id: string): Roots {
    const company = this.require(id);
    return { workspace: this.workspaceOf(id), projectDir: company.projectDir ?? null };
  }

  /** Löst einen Pfad der Oberfläche auf; "projekt/..." führt in das eingebundene Projekt. null, wenn er hinausführt. */
  resolvePath(id: string, rel: string): string | null {
    return resolveIn(this.rootsOf(id), rel);
  }

  private persistNow(company: Company): void {
    const file = this.companyFile(company.id);
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(company, null, 1));
    fs.renameSync(temp, file);
  }

  /** Das Verbrauchsbuch wird nur ergänzt, nie umgeschrieben. */
  private appendLedger(company: Company, run: Run): void {
    const line = {
      runId: run.id, at: run.endedAt, agent: run.agentName, kind: run.kind, stage: run.stageKind ?? null, orderId: run.orderId, meetingId: run.meetingId ?? null,
      departmentId: run.departmentId ?? null, mandateId: run.mandateId ?? null, status: run.status,
      model: run.modelUsed ?? run.model, usage: run.usage, costUsd: run.costUsd, costSource: run.costSource,
      fx: run.fx, costEur: run.costEur, billing: run.billing, sessionId: run.sessionId,
    };
    fs.appendFileSync(path.join(this.companyDir(company.id), 'ledger.jsonl'), `${JSON.stringify(line)}\n`);
  }

  private touch(company: Company): void {
    if (this.closed) return;
    if (!this.emitTimers.has(company.id)) {
      this.emitTimers.set(company.id, setTimeout(() => {
        this.emitTimers.delete(company.id);
        const set = this.listeners.get(company.id);
        if (set?.size) {
          const snapshot = this.snapshot(company.id);
          for (const listener of set) listener(snapshot);
        }
      }, 80));
    }
    if (!this.saveTimers.has(company.id)) {
      this.saveTimers.set(company.id, setTimeout(() => {
        this.saveTimers.delete(company.id);
        this.persistNow(company);
      }, 400));
    }
  }

  subscribe(companyId: string, listener: Listener): () => void {
    this.require(companyId);
    const set = this.listeners.get(companyId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(companyId, set);
    return () => set.delete(listener);
  }

  /* ---------- Lesen ---------- */

  hasCompany = (id: string) => this.companies.has(id);

  private require(id: string): Company {
    const company = this.companies.get(id);
    if (!company) throw new GameError('Diese Firma gibt es nicht.', 404);
    return company;
  }

  private agentOf(company: Company, id: string): Agent {
    const agent = company.agents.find((a) => a.id === id);
    if (!agent) throw new GameError('Diesen Mitarbeiter gibt es nicht.', 404);
    return agent;
  }

  private orderOf(company: Company, id: string): Order {
    const order = company.orders.find((o) => o.id === id);
    if (!order) throw new GameError('Diesen Auftrag gibt es nicht.', 404);
    return order;
  }

  /** Jede Reservierung mit dem Budget, aus dem sie kommt. Daraus entstehen Gesamtsumme und Teilbudgets ohne Doppelzählung. */
  private reservations(company: Company): { departmentId: string | null; amount: number }[] {
    const out: { departmentId: string | null; amount: number }[] = [];
    for (const run of company.runs) {
      if (run.status === 'running' && !run.orderId && !run.meetingId) out.push({ departmentId: run.departmentId ?? null, amount: Math.max(0, run.limitEur - run.costEur) });
    }
    // Ein laufender Auftrag hält sein ganzes Restlimit, auch zwischen zwei Stufen. Eine Besprechung ebenso.
    for (const order of company.orders) {
      if (order.status === 'running') out.push({ departmentId: order.departmentId ?? null, amount: this.orderReserved(company, order) });
    }
    for (const meeting of company.meetings) {
      if (meeting.status === 'running') out.push({ departmentId: meeting.departmentId ?? null, amount: Math.max(0, meeting.limitEur - this.meetingSpent(company, meeting)) });
    }
    // Ein Projekt hält den Teil seines Budgets, der noch keinem Auftrag zugeteilt ist. Seine Aufträge halten ihren eigenen Teil selbst.
    for (const mandate of company.mandates) {
      if (mandate.status !== 'closed') out.push({ departmentId: mandate.departmentId, amount: Math.max(0, this.mandateFree(company, mandate)) });
    }
    return out;
  }

  private orderReserved = (company: Company, order: Order) => Math.max(0, order.limitEur - this.orderSpent(company, order));

  private mandateSpent = (company: Company, mandate: Mandate) =>
    company.runs.filter((r) => r.mandateId === mandate.id).reduce((sum, r) => sum + r.costEur, 0);

  /** Was im Projekt noch nicht verbraucht und keinem laufenden Auftrag oder Planungslauf zugeteilt ist. */
  mandateFree(company: Company, mandate: Mandate): number {
    let committed = this.mandateSpent(company, mandate);
    for (const order of company.orders) if (order.mandateId === mandate.id && order.status === 'running') committed += this.orderReserved(company, order);
    for (const run of company.runs) if (run.mandateId === mandate.id && run.kind === 'manage' && run.status === 'running') committed += Math.max(0, run.limitEur - run.costEur);
    return mandate.budgetEur - committed;
  }

  money(company: Company): Money {
    const spent = company.runs.reduce((sum, r) => sum + r.costEur, 0);
    const reserved = this.reservations(company).reduce((sum, r) => sum + r.amount, 0);
    return { spentEur: spent, reservedEur: reserved, remainingEur: company.budgetEur - spent - reserved };
  }

  /** Das allgemeine Budget ist, was nach den Abteilungen bleibt. Jedes Teilbudget trägt nur, was ihm zugeordnet ist. */
  pools(company: Company): Pool[] {
    const reservations = this.reservations(company);
    const pool = (id: string | null, name: string, budgetEur: number): Pool => {
      const spentEur = company.runs.filter((r) => (r.departmentId ?? null) === id).reduce((sum, r) => sum + r.costEur, 0);
      const reservedEur = reservations.filter((r) => r.departmentId === id).reduce((sum, r) => sum + r.amount, 0);
      return { id, name, budgetEur, spentEur, reservedEur, remainingEur: budgetEur - spentEur - reservedEur };
    };
    const assigned = company.departments.reduce((sum, d) => sum + d.budgetEur, 0);
    return [pool(null, 'Allgemein', company.budgetEur - assigned), ...company.departments.map((d) => pool(d.id, d.name, d.budgetEur))];
  }

  private poolOf(company: Company, departmentId: string | null): Pool {
    return this.pools(company).find((p) => p.id === departmentId)!;
  }

  system(): SystemInfo {
    return { subscriptions: this.settings?.subscriptions() ?? [], anthropicKeyEnd: this.settings?.anthropicKeyEnd() ?? null, connections: this.settings?.views() ?? [], extraModels: this.settings?.models() ?? [], provider: this.providerInfo, fx: this.fxNow, plan: this.plan, artifactPort: this.artifactPort, unlimitedBuild: this.unlimitedBuild };
  }

  async refreshSystem(): Promise<SystemInfo> {
    this.providerInfo = await this.provider.detect();
    this.fxNow = await this.fxSource.get();
    return this.system();
  }

  snapshot(id: string): Snapshot {
    const company = this.require(id);
    const desks = company.placed.filter((p) => p.kind === 'desk').length;
    return { company, money: this.money(company), pools: this.pools(company), seats: { used: staffOf(company).length, total: desks }, system: this.system() };
  }

  summaries(): CompanySummary[] {
    return [...this.companies.values()]
      .map((c) => ({
        id: c.id, name: c.name, idea: c.idea, locationId: c.locationId, siteId: c.town.siteId, createdAt: c.createdAt, projectDir: c.projectDir ?? null,
        team: staffOf(c).length, spentEur: this.money(c).spentEur, budgetEur: c.budgetEur,
        runningAgents: new Set(c.runs.filter((r) => r.status === 'running').map((r) => r.agentId)).size,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  files(companyId: string) {
    return listAll(this.rootsOf(companyId));
  }

  /* ---------- Firma ---------- */

  /** Ein Projektordner muss ein echter, bestehender Ordner sein, der weder Silly Valley selbst noch das ganze Zuhause ist. */
  private checkProjectDir(input: string | null | undefined): string | null {
    const given = input?.trim();
    if (!given) return null;
    if (!path.isAbsolute(given)) throw new GameError('Gib den vollständigen Pfad des Projektordners an, beginnend mit /.');
    let real: string;
    try {
      real = fs.realpathSync(given);
    } catch {
      throw new GameError('Diesen Ordner gibt es nicht.');
    }
    if (!fs.statSync(real).isDirectory()) throw new GameError('Der Projektpfad muss ein Ordner sein, keine Datei.');
    const data = fs.realpathSync(this.dataDir);
    const home = fs.realpathSync(os.homedir());
    const within = (a: string, b: string) => a === b || a.startsWith(`${b}${path.sep}`);
    if (real === path.parse(real).root || real === home) throw new GameError('Das ganze Zuhause oder die ganze Platte kann kein Projekt sein. Wähle einen Projektordner.');
    if (within(real, data) || within(data, real)) throw new GameError('Der Projektordner darf nicht die Daten von Silly Valley enthalten oder darin liegen.');
    return real;
  }

  createCompany(input: { name: string; idea: string; locationId: LocationId; budgetEur: number; projectDir?: string | null }): Company {
    const name = input.name?.trim();
    const idea = input.idea?.trim();
    if (!name) throw new GameError('Gib deiner Firma einen Namen.');
    if (!idea) throw new GameError('Beschreibe die Idee, an der deine Firma arbeiten soll.');
    const location = LOCATIONS.find((l) => l.id === input.locationId);
    if (!location || location.moveCost !== null) throw new GameError('Gründe im Kinderzimmer oder in der Garage.');
    if (!(input.budgetEur > 0)) throw new GameError('Das KI-Budget muss größer als 0 € sein.');
    const projectDir = this.checkProjectDir(input.projectDir);
    const repoDir = projectDir && git.isRepoRoot(projectDir) ? projectDir : null;

    const id = `${slugify(name)}-${shortId()}`;
    const company: Company = {
      id, name, idea, locationId: location.id, createdAt: Date.now(), projectDir, town: startTown(location.id), budgetEur: round2(input.budgetEur),
      buildPoints: RULES.startBuildPoints,
      placed: [...location.startItems.map((item) => ({ ...item, id: shortId() })), ...this.propsOf(location.id)], inventory: [], board: [], helps: [], sprints: [],
      departments: [], customSkills: [], roles: [], teams: [], commands: [], agents: [], orders: [], meetings: [], mandates: [], runs: [], notices: [],
    };
    fs.mkdirSync(path.join(this.companyDir(id), 'runs'), { recursive: true });
    const workspace = this.workspaceOf(id);
    ensureWorkspace(workspace);
    fs.writeFileSync(path.join(workspace, 'wissen', 'idee.md'), `# ${name}\n\n${idea}\n${projectDir ? `\nDie Firma arbeitet an dem bestehenden Projekt unter ${projectDir}.\n` : ''}`);
    this.companies.set(id, company);
    this.persistNow(company);
    // Ein Git-Repo wird gleich als solches verbunden. So arbeitet von Anfang an jeder Auftrag auf einem eigenen Branch.
    if (repoDir) {
      try {
        company.repo = { dir: repoDir, remote: git.remoteUrl(repoDir), branch: git.defaultBranch(repoDir), connectedAt: Date.now() };
        this.syncRead(company);
      } catch {
        company.repo = null;
      }
    }
    return company;
  }

  setBudget(companyId: string, budgetEur: number): void {
    const company = this.require(companyId);
    const general = this.poolOf(company, null);
    if (!(budgetEur >= 0)) throw new GameError('Das Budget darf nicht negativ sein.');
    const assigned = company.budgetEur - general.budgetEur;
    if (budgetEur < assigned + general.spentEur + general.reservedEur) {
      throw new GameError(assigned > 0
        ? 'Das Budget kann nicht unter das sinken, was Abteilungen zugeteilt und allgemein verbraucht oder reserviert ist.'
        : 'Das Budget kann nicht unter den bereits verbrauchten und reservierten Betrag sinken.');
    }
    company.budgetEur = round2(budgetEur);
    this.touch(company);
  }

  /* ---------- Abteilungen ---------- */

  private departmentOf(company: Company, id: string): Department {
    const department = company.departments.find((d) => d.id === id);
    if (!department) throw new GameError('Diese Abteilung gibt es nicht.', 404);
    return department;
  }

  /** Die Abteilung eines Mitarbeiters folgt seinem Schreibtisch. */
  departmentOfAgent(company: Company, agent: Agent): Department | null {
    return deskDepartment(company.departments, company.placed.find((p) => p.id === agent.deskId));
  }

  private membersOf(company: Company, department: Department | null): Agent[] {
    return company.agents.filter((a) => a.hired && this.departmentOfAgent(company, a)?.id === (department?.id ?? undefined));
  }

  createDepartment(companyId: string, input: { name: string; floor?: number; i: number; j: number; w: number; d: number; budgetEur: number }): Department {
    const company = this.require(companyId);
    const name = input.name?.trim();
    if (!name) throw new GameError('Gib der Abteilung einen Namen.');
    if (company.departments.some((d) => d.name.toLowerCase() === name.toLowerCase())) throw new GameError(`Die Abteilung "${name}" gibt es schon.`);
    this.assertBuildPoints(company, RULES.departmentCost);
    const departmentFloor = this.checkFloor(company, input.floor);
    const check = checkDepartment(roomOf(company, departmentFloor), company.departments.filter((d) => floorOf(d) === departmentFloor), input);
    if (!check.ok) throw new GameError(check.reason);
    const budgetEur = round2(input.budgetEur ?? 0);
    if (!(budgetEur >= 0)) throw new GameError('Das Budget darf nicht negativ sein.');
    const general = this.poolOf(company, null);
    if (budgetEur > general.remainingEur + 1e-9) {
      throw new GameError(`Im allgemeinen Budget sind nur ${general.remainingEur.toFixed(2).replace('.', ',')} € frei, die eine Abteilung bekommen kann.`);
    }
    const dir = `wissen/${slugify(name)}`;
    const department: Department = {
      id: `d${shortId()}`, name, ...(departmentFloor ? { floor: departmentFloor } : {}), i: input.i, j: input.j, w: input.w, d: input.d,
      color: DEPARTMENT_COLORS[company.departments.length % DEPARTMENT_COLORS.length], budgetEur, knowledgeDir: dir, createdAt: Date.now(),
    };
    const workspace = this.workspaceOf(companyId);
    fs.mkdirSync(path.join(workspace, dir), { recursive: true });
    fs.writeFileSync(path.join(workspace, dir, 'abteilung.md'), `# Abteilung ${name}\n\nWissen dieser Abteilung. Was hier liegt, lesen ihre Mitarbeiter bei jedem Auftrag.\n`);
    company.departments.push(department);
    this.spendBuildPoints(company, RULES.departmentCost);
    this.touch(company);
    return department;
  }

  updateDepartment(companyId: string, departmentId: string, input: { name?: string; budgetEur?: number; floor?: number; i?: number; j?: number; w?: number; d?: number }): void {
    const company = this.require(companyId);
    const department = this.departmentOf(company, departmentId);
    // Neu abstecken: Wer dann im Bereich sitzt, gehört dazu. Wissen und Budget bleiben, wie sie sind.
    if (input.i !== undefined) {
      const rect = { id: department.id, i: input.i, j: input.j ?? 0, w: input.w ?? 0, d: input.d ?? 0 };
      const floor = this.checkFloor(company, input.floor ?? floorOf(department));
      const check = checkDepartment(roomOf(company, floor), company.departments.filter((d) => floorOf(d) === floor), rect);
      if (!check.ok) throw new GameError(check.reason);
      Object.assign(department, { i: rect.i, j: rect.j, w: rect.w, d: rect.d });
      if (floor) department.floor = floor;
      else delete department.floor;
    }
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new GameError('Gib der Abteilung einen Namen.');
      if (company.departments.some((d) => d.id !== department.id && d.name.toLowerCase() === name.toLowerCase())) throw new GameError(`Die Abteilung "${name}" gibt es schon.`);
      department.name = name;
    }
    if (input.budgetEur !== undefined) {
      const budgetEur = round2(input.budgetEur);
      if (!(budgetEur >= 0)) throw new GameError('Das Budget darf nicht negativ sein.');
      const own = this.poolOf(company, department.id);
      if (budgetEur < own.spentEur + own.reservedEur - 1e-9) throw new GameError('Das Budget kann nicht unter das sinken, was die Abteilung verbraucht und reserviert hat.');
      const general = this.poolOf(company, null);
      if (budgetEur - department.budgetEur > general.remainingEur + 1e-9) {
        throw new GameError(`Im allgemeinen Budget sind nur ${general.remainingEur.toFixed(2).replace('.', ',')} € frei.`);
      }
      department.budgetEur = budgetEur;
    }
    this.touch(company);
  }

  /** Auflösen gibt das Budget zurück. Die Wissensablage bleibt, Baupunkte kommen nicht zurück. */
  dissolveDepartment(companyId: string, departmentId: string): void {
    const company = this.require(companyId);
    const department = this.departmentOf(company, departmentId);
    const busy = company.orders.some((o) => o.departmentId === department.id && o.status === 'running')
      || company.meetings.some((m) => m.departmentId === department.id && m.status === 'running')
      || company.mandates.some((m) => m.departmentId === department.id && m.status !== 'closed')
      || company.runs.some((r) => r.departmentId === department.id && r.status === 'running');
    if (busy) throw new GameError('In dieser Abteilung läuft noch etwas. Warte oder stoppe es zuerst.');
    company.departments = company.departments.filter((d) => d.id !== department.id);
    this.touch(company);
  }

  private notify(company: Company, level: 'info' | 'error', text: string): void {
    company.notices = [...company.notices, { id: shortId(), at: Date.now(), level, text }].slice(-MAX_NOTICES);
  }

  /* ---------- Einstellen ---------- */

  private busy = (company: Company, agentId: string) =>
    this.starting.has(agentId) || company.runs.some((r) => r.agentId === agentId && r.status === 'running')
      || company.commands.some((c) => c.agentId === agentId && c.status === 'running');

  /** Jede Ausgabe hat genau eine Quelle: ein Projekt, eine Abteilung oder das allgemeine Budget. Dort muss sie hineinpassen. */
  private assertCanSpend(company: Company, limitEur: number, scope: { departmentId?: string | null; mandateId?: string | null } = {}): void {
    // Ist die Anthropic-CLI weg, arbeiten verbundene Anbieter trotzdem. Das Limit prüft dann der jeweilige Lauf.
    if (!this.providerInfo.available && !this.settings?.models().length) {
      throw new GameError(this.providerInfo.error ?? 'Der KI-Anbieter ist nicht erreichbar.', 503);
    }
    // Vor dem Anlegen prüfen, nicht erst beim Start: Sonst bliebe ein Auftrag ohne Lauf zurück.
    if (company.projectDir && !fs.existsSync(company.projectDir)) {
      throw new GameError(`Der Projektordner ${company.projectDir} ist nicht mehr da. Ohne ihn startet kein Lauf.`);
    }
    const fmt = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
    if (scope.mandateId) {
      const mandate = this.mandateOf(company, scope.mandateId);
      const free = this.mandateFree(company, mandate);
      if (limitEur > free + 1e-9) throw new GameError(`Das Budget des Projekts reicht nicht: ${fmt(Math.max(0, free))} frei, ${fmt(limitEur)} benötigt.`);
      return;
    }
    const pool = this.poolOf(company, scope.departmentId ?? null);
    if (limitEur > pool.remainingEur + 1e-9) {
      const where = pool.id ? `Das Budget der Abteilung "${pool.name}"` : company.departments.length ? 'Das allgemeine KI-Budget' : 'Das KI-Budget';
      throw new GameError(`${where} reicht nicht: ${fmt(Math.max(0, pool.remainingEur))} frei, ${fmt(limitEur)} benötigt.`);
    }
  }

  async hire(companyId: string, input: {
    name: string; roleId?: string; companyRoleId?: string | null; skillIds?: string[]; modelId?: string; look: Look; deskId?: string | null; origin?: AgentOrigin | null;
    job?: Partial<Job> | null; customSkills?: { title: string; instruction: string; source?: CustomSkill['source'] }[];
  }): Promise<Agent> {
    const company = this.require(companyId);
    const name = input.name?.trim();
    if (!name) throw new GameError('Gib deinem neuen Mitarbeiter einen Namen.');
    if (staffOf(company).some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new GameError(`${name} arbeitet schon hier.`);
    // Eine definierte Rolle legt Stelle und Fähigkeiten fest. Das Modell bleibt beim Einstellen wählbar.
    const companyRole = input.companyRoleId ? this.companyRoleOf(company, input.companyRoleId) : null;
    const roleId = companyRole?.baseRoleId ?? input.roleId ?? '';
    if (!roleById(roleId)) throw new GameError('Wähle eine Rolle.');
    const model = modelById(input.modelId ?? companyRole?.modelId ?? '');
    if (!model) throw new GameError('Wähle ein Modell.');
    const job = companyRole ? { title: companyRole.title, task: companyRole.task, requirements: companyRole.requirements } : this.checkJob(input.job);
    const fresh = (input.customSkills ?? []).map((skill) => this.checkSkill(company, skill));
    const known = [...(companyRole?.skillIds ?? []), ...(input.skillIds ?? [])].filter((id) => skillById(id) || company.customSkills.some((s) => s.id === id));

    const taken = new Set(company.agents.map((a) => a.deskId));
    const desk = input.deskId
      ? company.placed.find((p) => p.id === input.deskId && p.kind === 'desk')
      : company.placed.find((p) => p.kind === 'desk' && !taken.has(p.id));
    if (!desk) throw new GameError('Kein freier Arbeitsplatz. Stelle zuerst einen Schreibtisch auf.');
    if (taken.has(desk.id)) throw new GameError('Dieser Arbeitsplatz ist schon besetzt.');
    const department = deskDepartment(company.departments, desk);
    this.assertCanSpend(company, RULES.interviewLimitEur, { departmentId: department?.id ?? null });

    // Erst jetzt, wo die Einstellung durchgeht, entstehen die Fähigkeiten der Firma.
    const created = fresh.map((skill) => this.addCustomSkill(company, skill));
    const skillIds = [...new Set([...known, ...created.map((skill) => skill.id)])];
    const now = Date.now();
    const agent: Agent = {
      id: shortId(), name, roleId, skillIds, startSkillIds: [...skillIds], providerId: model.providerId, modelId: model.id,
      look: input.look, job, companyRoleId: companyRole?.id ?? null, origin: input.origin ?? null, briefedSkillIds: [...skillIds], jobPending: false, context: null,
      sessionId: randomUUID(), sessionStarted: false, sessionCostUsd: 0, hiredAt: now, deskId: desk.id,
      hired: false, firedAt: null, knownIds: [], intro: '', live: { kind: 'starting', detail: 'kommt zum Vorstellungsgespräch', since: now, runId: null }, chat: [],
    };
    company.agents.push(agent);
    this.writeAgentFile(company, agent);
    await this.startRun(company, agent, { kind: 'interview', orderId: null, prompt: interviewPrompt(agent), limitEur: RULES.interviewLimitEur, departmentId: department?.id ?? null });
    return agent;
  }

  /** Die Subagents des eingebundenen Projekts. Sie werden bei jeder Anfrage frisch gelesen, das Projekt bleibt die Quelle. */
  projectAgents(companyId: string): ProjectAgent[] {
    const company = this.require(companyId);
    if (!company.projectDir) return [];
    return listSubagents(company.projectDir).map(({ instruction: _text, ...agent }) => ({
      ...agent,
      adoptedBy: staffOf(company).find((a) => a.origin?.file === agent.file)?.name ?? null,
    }));
  }

  /** Ein Subagent wird Mitarbeiter: Seine Anweisung wird wörtlich Fähigkeit, seine Grenzen bleiben. Das echte Gespräch gehört dazu. */
  async adoptProjectAgent(companyId: string, input: { file: string; modelId?: string; look: Look; deskId?: string | null }): Promise<Agent> {
    const company = this.require(companyId);
    if (!company.projectDir) throw new GameError('Diese Firma hat kein eingebundenes Projekt.');
    const found = listSubagents(company.projectDir).find((a) => a.file === input.file);
    if (!found) throw new GameError('Diesen Subagent gibt es im Projekt nicht.', 404);
    const adopted = staffOf(company).find((a) => a.origin?.file === found.file);
    if (adopted) throw new GameError(`Diese Rolle hat schon ${adopted.name} übernommen.`);
    const modelId = input.modelId ?? found.modelId;
    if (!modelId) throw new GameError(`Die Datei legt kein Modell fest. Wähle eines für ${found.name}.`);
    const title = found.name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
    return this.hire(companyId, {
      name: title.slice(0, 20), roleId: 'frei', skillIds: [], modelId, look: input.look, deskId: input.deskId,
      job: { title, task: found.description.slice(0, RULES.jobTextMax), requirements: '' },
      customSkills: [{ title: `Anweisung ${found.name}`, instruction: found.instruction, source: 'datei' }],
      origin: { file: found.file, readOnly: found.readOnly, wantsCommands: found.wantsCommands, blockedTools: found.blockedTools },
    });
  }

  private writeAgentFile(company: Company, agent: Agent): void {
    const model = modelById(agent.modelId);
    fs.writeFileSync(
      path.join(this.workspaceOf(company.id), 'team', `${slugify(agent.name)}.md`),
      `# ${agent.name}\n\nModell: ${model?.label ?? agent.modelId}\n\n${agentProfile(company, agent)}\n`,
    );
  }

  private checkJob(input: Partial<Job> | null | undefined): Job | null {
    const title = input?.title?.trim() ?? '';
    const task = input?.task?.trim() ?? '';
    const requirements = input?.requirements?.trim() ?? '';
    if (!title && !task && !requirements) return null;
    if (title.length > 60) throw new GameError('Der Stellentitel darf höchstens 60 Zeichen lang sein.');
    if (task.length > RULES.jobTextMax || requirements.length > RULES.jobTextMax) throw new GameError(`Aufgabe und Anforderungen dürfen je höchstens ${RULES.jobTextMax} Zeichen lang sein.`);
    return { title, task, requirements };
  }

  private checkSkill(company: Company, input: { title?: string; instruction?: string; source?: CustomSkill['source'] }): Pick<CustomSkill, 'title' | 'instruction' | 'source'> {
    const title = input.title?.trim();
    const instruction = input.instruction?.trim();
    if (!title) throw new GameError('Gib der Fähigkeit einen Namen.');
    if (title.length > 60) throw new GameError('Der Name einer Fähigkeit darf höchstens 60 Zeichen lang sein.');
    if (!instruction) throw new GameError(`Beschreibe, was die Fähigkeit "${title}" können soll.`);
    if (instruction.length > RULES.skillTextMax) throw new GameError(`Die Fähigkeit "${title}" ist zu lang: höchstens ${RULES.skillTextMax.toLocaleString('de-DE')} Zeichen, denn sie wird bei jedem Lauf mitgelesen.`);
    const taken = company.customSkills.some((s) => s.title.toLowerCase() === title.toLowerCase()) || SKILLS.some((s) => s.title.toLowerCase() === title.toLowerCase());
    if (taken) throw new GameError(`Eine Fähigkeit "${title}" gibt es schon. Wähle sie aus oder nenne die neue anders.`);
    return { title, instruction, source: input.source === 'datei' ? 'datei' : 'beschrieben' };
  }

  private addCustomSkill(company: Company, skill: Pick<CustomSkill, 'title' | 'instruction' | 'source'>): CustomSkill {
    const id = `s${shortId()}`;
    const file = `team/faehigkeiten/${slugify(skill.title)}-${id.slice(1, 5)}.md`;
    const custom: CustomSkill = { id, ...skill, file, createdAt: Date.now() };
    const target = path.join(this.workspaceOf(company.id), file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${skill.instruction}\n`);
    company.customSkills.push(custom);
    return custom;
  }

  /** Eine Fähigkeit nachrüsten. Die laufende Session bekommt sie mit dem nächsten Lauf mitgeteilt. */
  addAgentSkill(companyId: string, agentId: string, input: { skillId?: string; title?: string; instruction?: string; source?: CustomSkill['source'] }): void {
    const company = this.require(companyId);
    const agent = this.hiredAgent(company, agentId);
    let id = input.skillId;
    if (id) {
      if (!skillById(id) && !company.customSkills.some((s) => s.id === id)) throw new GameError('Diese Fähigkeit gibt es nicht.', 404);
    } else {
      id = this.addCustomSkill(company, this.checkSkill(company, input)).id;
    }
    if (agent.skillIds.includes(id)) throw new GameError(`${agent.name} hat diese Fähigkeit schon.`);
    agent.skillIds.push(id);
    this.writeAgentFile(company, agent);
    this.touch(company);
  }

  /** Stelle und Aufgabe ändern. Auch das erfährt der Agent mit dem nächsten Lauf. */
  updateJob(companyId: string, agentId: string, input: Partial<Job>): void {
    const company = this.require(companyId);
    const agent = this.hiredAgent(company, agentId);
    agent.job = this.checkJob(input);
    agent.jobPending = true;
    this.writeAgentFile(company, agent);
    this.touch(company);
  }

  /**
   * Kündigen. Der Schreibtisch wird frei, die Session wird nicht mehr fortgesetzt. Verlauf, Kosten und Ergebnisse bleiben.
   * Solange noch etwas an der Person hängt, geht es nicht: Sonst stünde offene Arbeit ohne Bearbeiter da.
   */
  fireAgent(companyId: string, agentId: string): void {
    const company = this.require(companyId);
    const agent = this.hiredAgent(company, agentId);
    const open = (reason: string) => new GameError(`${agent.name} kann noch nicht gehen: ${reason}`);
    if (this.busy(company, agent.id)) throw open('Die Arbeit läuft noch. Warte oder stoppe sie.');
    const order = company.orders.find((o) => ['running', 'review'].includes(o.status) && o.stages.some((s) => s.agentId === agent.id));
    if (order) throw open(`Der Auftrag "${order.title}" ist noch offen. Nimm ihn ab oder lehne ihn ab.`);
    const project = company.mandates.find((m) => m.managerId === agent.id && m.status !== 'closed');
    if (project) throw open(`Das Projekt "${project.goal}" wird von dieser Person geleitet. Schließe es zuerst ab.`);
    const meeting = company.meetings.find((m) => !['closed', 'failed'].includes(m.status) && (m.moderatorId === agent.id || m.participantIds.includes(agent.id)));
    if (meeting) throw open(`Die Besprechung "${meeting.topic}" ist noch offen. Schließe sie zuerst ab.`);
    if (company.commands.some((c) => c.agentId === agent.id && c.status === 'pending')) throw open('Ein Befehl wartet noch auf deine Entscheidung.');
    if (company.helps.some((h) => (h.fromId === agent.id || h.toId === agent.id) && (h.status === 'queued' || h.status === 'running'))) throw open('Ein Gespräch mit einem Kollegen läuft noch.');
    for (const team of company.teams) {
      team.memberIds = team.memberIds.filter((id) => id !== agent.id);
      if (team.leadId === agent.id) team.leadId = null;
    }
    agent.firedAt = Date.now();
    agent.hired = false;
    agent.deskId = '';
    agent.companyRoleId = null;
    this.setLive(agent, 'idle', 'gekündigt', null);
    this.notify(company, 'info', `${agent.name} arbeitet nicht mehr hier. Verlauf, Kosten und Ergebnisse bleiben.`);
    this.touch(company);
  }

  /** Du selbst im Spiel. Das ist nur dein Bild: Es ändert nichts daran, was die Agenten dürfen. */
  updateCeo(companyId: string, input: { name?: string; look?: Partial<Look> }): void {
    const company = this.require(companyId);
    const ceo = company.ceo ?? DEFAULT_CEO;
    const name = input.name === undefined ? ceo.name : input.name.trim();
    if (!name) throw new GameError('Gib deiner Figur einen Namen.');
    if (name.length > 20) throw new GameError('Der Name darf höchstens 20 Zeichen lang sein.');
    const look = { ...ceo.look, ...input.look };
    const color = /^#[0-9a-f]{6}$/i;
    if (!LOOK_OPTIONS.hair.includes(look.hair) || !color.test(look.hairColor) || !color.test(look.top) || !color.test(look.skin)) throw new GameError('So kann die Figur nicht aussehen.');
    company.ceo = { name, look: { hair: look.hair, hairColor: look.hairColor, top: look.top, skin: look.skin, glasses: Boolean(look.glasses) } };
    this.touch(company);
  }

  /* ---------- Rollen ---------- */

  private companyRoleOf(company: Company, id: string): CompanyRole {
    const role = company.roles.find((r) => r.id === id);
    if (!role) throw new GameError('Diese Rolle gibt es nicht.', 404);
    return role;
  }

  /** Prüft alles, bevor etwas entsteht: Eine abgewiesene Rolle hinterlässt auch keine halben Fähigkeiten. */
  private checkRole(company: Company, input: RoleInput, own?: CompanyRole) {
    const title = input.title?.trim();
    if (!title) throw new GameError('Gib der Rolle einen Namen.');
    if (title.length > 60) throw new GameError('Der Name einer Rolle darf höchstens 60 Zeichen lang sein.');
    if (company.roles.some((r) => r !== own && r.title.toLowerCase() === title.toLowerCase())) throw new GameError(`Die Rolle "${title}" gibt es schon.`);
    const task = input.task?.trim() ?? '';
    const requirements = input.requirements?.trim() ?? '';
    if (task.length > RULES.jobTextMax || requirements.length > RULES.jobTextMax) throw new GameError(`Aufgabe und Anforderungen dürfen je höchstens ${RULES.jobTextMax} Zeichen lang sein.`);
    // Die Vorlage steht mit der ersten Person fest: Ihre Haltung steckt schon im Profil der laufenden Sessions.
    const baseRoleId = own?.baseRoleId ?? input.baseRoleId ?? 'frei';
    if (!roleById(baseRoleId)) throw new GameError('Diese Vorlage gibt es nicht.');
    const modelId = input.modelId ?? own?.modelId ?? roleById(baseRoleId)!.modelId;
    if (!modelById(modelId)) throw new GameError('Wähle ein Modell.');
    const known = [...new Set(input.skillIds ?? own?.skillIds ?? [])];
    for (const id of known) if (!skillById(id) && !company.customSkills.some((s) => s.id === id)) throw new GameError('Diese Fähigkeit gibt es nicht.', 404);
    const fresh = (input.customSkills ?? []).map((skill) => this.checkSkill(company, skill));
    if (new Set(fresh.map((s) => s.title.toLowerCase())).size < fresh.length) throw new GameError('Zwei neue Fähigkeiten heißen gleich. Nenne eine anders.');
    if (baseRoleId === 'frei' && !task && !known.length && !fresh.length) throw new GameError('Beschreibe die Aufgabe der Rolle oder hänge ihr eine Fähigkeit an. Sonst weiß niemand, was zu tun ist.');
    const color = input.color === undefined ? own?.color ?? null : input.color;
    if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) throw new GameError('Eine Farbe sieht so aus: #f7d774.');
    return { title, task, requirements, baseRoleId, modelId, color, known, fresh };
  }

  createRole(companyId: string, input: RoleInput): CompanyRole {
    const company = this.require(companyId);
    const { known, fresh, ...fields } = this.checkRole(company, input);
    const created = fresh.map((skill) => this.addCustomSkill(company, skill));
    const role: CompanyRole = { id: `r${shortId()}`, ...fields, skillIds: [...known, ...created.map((s) => s.id)], createdAt: Date.now() };
    company.roles.push(role);
    this.touch(company);
    return role;
  }

  /**
   * Eine Änderung erreicht alle, die diese Rolle haben, mit ihrem nächsten Lauf. Nur neue Fähigkeiten: Was jemand
   * schon gelernt hat, bleibt in seiner Session. Eine eigene Stelle wird nur überschrieben, wenn sich die der Rolle ändert.
   */
  updateRole(companyId: string, roleId: string, input: RoleInput): void {
    const company = this.require(companyId);
    const role = this.companyRoleOf(company, roleId);
    const { known, fresh, ...fields } = this.checkRole(company, { title: role.title, task: role.task, requirements: role.requirements, ...input }, role);
    const jobChanged = fields.title !== role.title || fields.task !== role.task || fields.requirements !== role.requirements;
    const created = fresh.map((skill) => this.addCustomSkill(company, skill));
    const added = [...known, ...created.map((s) => s.id)];
    const gained = added.filter((id) => !role.skillIds.includes(id));
    Object.assign(role, fields, { skillIds: added });
    for (const agent of company.agents.filter((a) => a.companyRoleId === role.id)) {
      if (jobChanged) {
        agent.job = { title: role.title, task: role.task, requirements: role.requirements };
        agent.jobPending = true;
      }
      for (const id of gained) if (!agent.skillIds.includes(id)) agent.skillIds.push(id);
      if (jobChanged || gained.length) this.writeAgentFile(company, agent);
    }
    this.touch(company);
  }

  /** Die Rolle verschwindet aus dem Katalog der Firma. Wer sie hat, behält Stelle und Fähigkeiten. */
  deleteRole(companyId: string, roleId: string): void {
    const company = this.require(companyId);
    const role = this.companyRoleOf(company, roleId);
    company.roles = company.roles.filter((r) => r !== role);
    for (const agent of company.agents) if (agent.companyRoleId === role.id) agent.companyRoleId = null;
    this.touch(company);
  }

  /* ---------- Teams ---------- */

  private teamOf(company: Company, id: string): Team {
    const team = company.teams.find((t) => t.id === id);
    if (!team) throw new GameError('Dieses Team gibt es nicht.', 404);
    return team;
  }

  private checkTeam(company: Company, input: { name?: string; purpose?: string; memberIds?: string[]; leadId?: string | null }, ownId?: string): Pick<Team, 'name' | 'purpose' | 'memberIds' | 'leadId'> {
    const name = input.name?.trim();
    if (!name) throw new GameError('Gib dem Team einen Namen.');
    if (name.length > 40) throw new GameError('Der Teamname darf höchstens 40 Zeichen lang sein.');
    if (company.teams.some((t) => t.id !== ownId && t.name.toLowerCase() === name.toLowerCase())) throw new GameError(`Das Team "${name}" gibt es schon.`);
    const memberIds = [...new Set(input.memberIds ?? [])];
    if (!memberIds.length) throw new GameError('Ein Team braucht mindestens eine Person.');
    for (const id of memberIds) this.hiredAgent(company, id);
    const leadId = input.leadId || null;
    if (leadId && !memberIds.includes(leadId)) throw new GameError('Die Teamleitung muss zum Team gehören.');
    return { name, purpose: input.purpose?.trim().slice(0, RULES.jobTextMax) ?? '', memberIds, leadId };
  }

  createTeam(companyId: string, input: { name: string; purpose?: string; memberIds: string[]; leadId?: string | null }): Team {
    const company = this.require(companyId);
    const team: Team = { id: `t${shortId()}`, ...this.checkTeam(company, input), createdAt: Date.now() };
    company.teams.push(team);
    this.touch(company);
    return team;
  }

  updateTeam(companyId: string, teamId: string, input: { name?: string; purpose?: string; memberIds?: string[]; leadId?: string | null }): void {
    const company = this.require(companyId);
    const team = this.teamOf(company, teamId);
    // Wer das Team verlässt, gibt auch die Leitung ab. Nur eine ausdrücklich falsche Wahl ist ein Fehler.
    const keptLead = team.leadId && (input.memberIds ?? team.memberIds).includes(team.leadId) ? team.leadId : null;
    Object.assign(team, this.checkTeam(company, { name: team.name, purpose: team.purpose, memberIds: team.memberIds, leadId: keptLead, ...input }, team.id));
    this.touch(company);
  }

  deleteTeam(companyId: string, teamId: string): void {
    const company = this.require(companyId);
    const team = this.teamOf(company, teamId);
    if (company.mandates.some((m) => m.teamId === team.id && m.status !== 'closed')) throw new GameError('Ein offenes Projekt plant mit diesem Team. Schließe es zuerst ab.');
    company.teams = company.teams.filter((t) => t.id !== team.id);
    this.touch(company);
  }

  /* ---------- Aufträge ---------- */

  async startOrder(companyId: string, input: OrderInput): Promise<Order> {
    const company = this.require(companyId);
    const note = input.noteId ? this.openNote(company, input.noteId) : null;
    const sprint = note?.status === 'sprint' ? company.sprints.find((s) => s.noteIds.includes(note.id) && s.status === 'running') ?? null : null;
    if (note?.status === 'sprint' && !sprint) throw new GameError('Dieser Sprint läuft nicht mehr.');
    if (sprint) {
      const free = sprint.budgetEur - sprintCommitted(company, sprint);
      if (roundLimit(input.limitEur) > free + 1e-9) throw new GameError(`Der Rahmen von Sprint ${sprint.number} reicht nicht: ${free.toFixed(2).replace('.', ',')} € frei.`);
    }
    const order = this.createOrder(company, input, null);
    // Erst wenn der Auftrag steht, verlässt der Zettel die Tafel.
    if (sprint) order.sprintId = sprint.id;
    if (note) {
      note.status = 'taken';
      note.orderId = order.id;
    }
    await this.pump(company);
    return order;
  }

  /** Legt den Auftrag an und reserviert sein Limit. Ohne Projekt zahlt die Abteilung des Bearbeiters oder das allgemeine Budget. */
  private createOrder(company: Company, input: OrderInput, mandate: Mandate | null): Order {
    const team = input.team ?? ({} as OrderTeam);
    const worker = this.hiredAgent(company, team.work);
    const planner = team.plan ? this.hiredAgent(company, team.plan) : null;
    const checker = team.check ? this.hiredAgent(company, team.check) : null;
    if (checker?.id === worker.id) throw new GameError(`${worker.name} kann das eigene Ergebnis nicht prüfen. Wähle für die Prüfung jemand anderen.`);
    const title = input.title?.trim();
    if (!title) throw new GameError('Beschreibe das Ziel des Auftrags.');
    const criteria: Criterion[] = (input.criteria ?? []).map((t) => t.trim()).filter(Boolean).map((text) => ({ text, checked: false }));
    if (!criteria.length) throw new GameError('Lege mindestens ein Abnahmekriterium fest. Daran prüfst du später das Ergebnis.');
    const limitEur = roundLimit(input.limitEur);
    if (!(limitEur > 0)) throw new GameError('Ein Auftrag braucht ein Limit über 0 €.');
    const departmentId = mandate ? mandate.departmentId : this.departmentOfAgent(company, worker)?.id ?? null;
    this.assertCanSpend(company, limitEur, mandate ? { mandateId: mandate.id } : { departmentId });

    const newStage = (kind: StageKind, agentId: string): Stage => ({
      id: shortId(), kind, agentId, status: 'waiting', instruction: null, isRevision: false, files: [], summary: '', verdict: null, checks: 0,
    });
    const stages = [
      ...(planner ? [newStage('plan', planner.id)] : []),
      newStage('work', worker.id),
      ...(checker ? [newStage('check', checker.id)] : []),
    ];
    const id = `a${shortId()}`;
    const order: Order = {
      id, title, notes: input.notes?.trim() ?? '', agentId: stages[0].agentId, departmentId, mandateId: mandate?.id ?? null,
      startedBy: input.startedBy ?? 'leitung', stages, stageIndex: 0, criteria, limitEur,
      maxRevisions: Math.max(0, Math.min(5, Math.round(input.maxRevisions ?? 0))), revisionsUsed: 0,
      webAccess: Boolean(input.webAccess), status: 'running', createdAt: Date.now(), decidedAt: null, runIds: [],
      resultDir: `ergebnisse/${slugify(title)}-${id.slice(1, 5)}`, files: [], summary: '', savedFromText: false, feedback: [],
    };
    if (company.repo) order.git = this.openBranch(company, id, title);
    const workspace = this.workspaceOf(company.id);
    fs.mkdirSync(path.join(workspace, order.resultDir), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'auftraege', `${path.basename(order.resultDir)}.md`), this.orderBrief(company, order));
    company.orders.push(order);
    return order;
  }

  private spendScope(order: Order) {
    return order.mandateId ? { mandateId: order.mandateId } : { departmentId: order.departmentId ?? null };
  }

  private briefingOf(company: Company, order: Order): Briefing {
    return {
      hasDecisions: fs.existsSync(path.join(this.workspaceOf(company.id), DECISIONS_FILE)),
      department: company.departments.find((d) => d.id === order.departmentId) ?? null,
      projectDir: order.git?.dir ?? (company.repo ? READ_DIR : company.projectDir ?? null),
    };
  }

  private hiredAgent(company: Company, id: string | undefined): Agent {
    if (!id) throw new GameError('Wähle aus, wer an diesem Auftrag arbeitet.');
    const agent = this.agentOf(company, id);
    if (agent.firedAt) throw new GameError(`${agent.name} arbeitet nicht mehr hier.`);
    if (!agent.hired) throw new GameError(`${agent.name} ist noch nicht eingestellt.`);
    return agent;
  }

  /** Der Auftrag als Datei im Arbeitsbereich, damit auch später nachlesbar ist, was verlangt war. */
  private orderBrief(company: Company, order: Order): string {
    const team = order.stages.map((s) => `- ${stageLabel(s.kind)}: ${this.agentOf(company, s.agentId).name}`).join('\n');
    const criteria = order.criteria.map((c) => `- ${c.text}`).join('\n');
    return `# ${order.title}\n\n${order.notes ? `${order.notes}\n\n` : ''}## Ablauf\n${team}\n\n## Abnahme\n${criteria}\n`;
  }

  private orderSpent = (company: Company, order: Order) =>
    company.runs.filter((r) => r.orderId === order.id).reduce((sum, r) => sum + r.costEur, 0);

  private meetingSpent = (company: Company, meeting: Meeting) =>
    company.runs.filter((r) => r.meetingId === meeting.id).reduce((sum, r) => sum + r.costEur, 0);

  /** Startet jede wartende Stufe, deren Agent frei ist. Wird nach jedem Lauf erneut aufgerufen. */
  private async pump(company: Company): Promise<void> {
    for (const order of company.orders) {
      if (order.status !== 'running') continue;
      const stage = order.stages[order.stageIndex];
      // Solange über einen Befehl nicht entschieden ist, geht die Stufe nicht weiter.
      if (stage.status === 'waiting' && !order.commandId && !order.helpId && !this.busy(company, stage.agentId) && !this.restingUntil(this.agentOf(company, stage.agentId))) await this.startStage(company, order, stage);
    }
    await this.pumpHelps(company);
    await this.deliverChatCommands(company);
    for (const meeting of company.meetings) {
      if (meeting.status !== 'running' || meeting.turnActive) continue;
      const speaker = speakingOrder(meeting)[meeting.speakerIndex];
      if (!this.busy(company, speaker) && !this.restingUntil(this.agentOf(company, speaker))) await this.startMeetingTurn(company, meeting, speaker);
    }
    this.touch(company);
  }

  private async startStage(company: Company, order: Order, stage: Stage): Promise<void> {
    const agent = this.agentOf(company, stage.agentId);
    const remaining = order.limitEur - this.orderSpent(company, order);
    order.agentId = agent.id;
    if (remaining <= 0) {
      stage.status = 'limit';
      order.status = 'limit';
      this.notify(company, 'info', `"${order.title}": Das Auftragslimit ist aufgebraucht. Erhöhe es, um weiterzumachen.`);
      this.setIdleOrPending(company, agent);
      return;
    }
    // Eine frühe Stufe darf nicht alles verbrauchen: Sonst bliebe für Umsetzung oder Prüfung nichts.
    const isLast = order.stageIndex === order.stages.length - 1;
    const limitEur = isLast ? remaining : remaining / 2;
    const isCheck = stage.kind === 'check';
    const prompt = stage.instruction ?? this.stagePrompt(company, order, stage);
    const kind: RunKind = stage.isRevision ? 'revision' : 'order';
    stage.status = 'running';
    stage.instruction = null;
    stage.isRevision = false;
    await this.startRun(company, agent, {
      kind, orderId: order.id, stageKind: stage.kind, prompt, limitEur, webAccess: order.webAccess,
      readOnly: isCheck, jsonSchema: isCheck ? verdictSchema(order) : null, departmentId: order.departmentId ?? null, mandateId: order.mandateId ?? null,
    });
  }

  private stagePrompt(company: Company, order: Order, stage: Stage): string {
    const agentOfStage = (kind: StageKind) => {
      const found = order.stages.find((s) => s.kind === kind);
      return found ? this.agentOf(company, found.agentId) : null;
    };
    const worker = agentOfStage('work')!;
    const briefing = this.briefingOf(company, order);
    if (stage.kind === 'plan') return planPrompt(order, worker, briefing) + NOTE_RULES + this.helpNote(company, this.agentOf(company, stage.agentId));
    if (stage.kind === 'check') {
      const files = this.orderFiles(company, order).filter((f) => !path.basename(f).startsWith('pruefung-'));
      return checkPrompt(order, worker, files);
    }
    const plan = order.stages.find((s) => s.kind === 'plan');
    return workPrompt(order, agentOfStage('plan'), plan?.files ?? [], agentOfStage('check'), briefing) + NOTE_RULES + this.helpNote(company, worker)
      + (this.knownColleagues(company, worker).length && (order.handedBy?.length ?? 0) < RULES.handoversPerOrder ? HANDOVER_RULES : '');
  }

  /** Korrekturrunde nach einer Abnahme oder Fortsetzung einer angehaltenen Stufe. */
  async revise(companyId: string, orderId: string, input: { feedback?: string; addLimitEur?: number }): Promise<void> {
    const company = this.require(companyId);
    const order = this.orderOf(company, orderId);
    const feedback = input.feedback?.trim() ?? '';
    if (order.status === 'accepted' || order.status === 'rejected' || order.status === 'running') {
      throw new GameError('Dieser Auftrag kann nicht mehr geändert werden.');
    }
    // Gestoppte Aufträge können Gekündigte enthalten. Dann muss ein neuer Auftrag her.
    for (const stage of order.stages) this.hiredAgent(company, stage.agentId);
    const isRevision = order.status === 'review';
    if (isRevision) {
      if (!feedback) throw new GameError('Schreibe, was geändert werden soll.');
      if (order.revisionsUsed >= order.maxRevisions) {
        throw new GameError(`Alle ${order.maxRevisions} Korrekturrunden sind aufgebraucht. Nimm das Ergebnis ab oder lehne es ab.`);
      }
    }
    const extra = Math.max(0, input.addLimitEur ?? 0);
    const remaining = order.limitEur + extra - this.orderSpent(company, order);
    if (remaining <= 0) throw new GameError('Das Auftragslimit ist aufgebraucht. Erhöhe es, um weiterzumachen.');
    this.assertCanSpend(company, remaining, this.spendScope(order));

    order.stopRequested = false;
    if (extra) order.limitEur = roundLimit(order.limitEur + extra);
    if (feedback) order.feedback.push({ at: Date.now(), text: feedback });
    if (isRevision) {
      const from = this.agentOf(company, order.agentId);
      this.sendBack(company, order, from, revisionPrompt(order, feedback, order.revisionsUsed + 1), 'bringt deine Korrektur zu');
    } else {
      const stage = order.stages[order.stageIndex];
      stage.status = 'waiting';
      stage.instruction = stage.kind === 'check' ? null : continuePrompt(order, feedback);
      order.status = 'running';
    }
    await this.pump(company);
  }

  /** Zurück an die Stufe, die das Ergebnis erstellt. Die Prüfung läuft danach erneut. */
  private sendBack(company: Company, order: Order, from: Agent, instruction: string, verb: string): void {
    const index = order.stages.findIndex((s) => s.kind === 'work');
    const work = order.stages[index];
    order.revisionsUsed += 1;
    order.stageIndex = index;
    order.status = 'running';
    order.agentId = work.agentId;
    work.status = 'waiting';
    work.instruction = instruction;
    work.isRevision = true;
    for (const later of order.stages.slice(index + 1)) later.status = 'waiting';
    this.handOff(company, from, work.agentId, verb);
  }

  /** Die Datei wechselt die Zuständigkeit, und die Figur bringt sie hin. */
  private handOff(company: Company, from: Agent, toId: string, verb: string): void {
    if (from.id === toId || this.busy(company, from.id)) {
      this.setIdleOrPending(company, from);
      return;
    }
    const to = this.agentOf(company, toId);
    this.setLive(from, 'handoff', `${verb} ${to.name}`, null, to.id);
    setTimeout(() => {
      if (from.live.kind !== 'handoff') return;
      this.setIdleOrPending(company, from);
      this.touch(company);
    }, HANDOFF_SHOWN_MS).unref();
  }

  /** Hält einen Auftrag an, auch wenn seine Stufe noch auf einen freien Agenten wartet. */
  stopOrder(companyId: string, orderId: string): void {
    const company = this.require(companyId);
    const order = this.orderOf(company, orderId);
    if (order.status !== 'running') throw new GameError('Dieser Auftrag läuft nicht.');
    const run = company.runs.find((r) => r.orderId === order.id && r.status === 'running');
    if (run) {
      order.stopRequested = true;
      this.handles.get(run.id)?.stop('stopped');
      return;
    }
    order.status = 'stopped';
    order.stages[order.stageIndex].status = 'stopped';
    this.cancelOrderCommand(company, order);
    const owner = company.agents.find((a) => a.id === order.agentId);
    if (owner) this.setIdleOrPending(company, owner);
    this.touch(company);
  }

  /** Die Abnahme ist Sache des Menschen. Nur sie bringt Baupunkte, Verbrauch nie. */
  decide(companyId: string, orderId: string, input: { decision: 'accept' | 'reject'; checked?: boolean[] }): void {
    const company = this.require(companyId);
    const order = this.orderOf(company, orderId);
    const agent = this.agentOf(company, order.agentId);
    if (order.status === 'running') throw new GameError('Der Lauf ist noch aktiv.');
    if (order.status === 'accepted' || order.status === 'rejected') throw new GameError('Darüber ist schon entschieden.');
    if (input.decision === 'accept') {
      if (order.status === 'failed' || !order.files.length) throw new GameError('Ohne Ergebnis gibt es nichts abzunehmen.');
      order.status = 'accepted';
      company.buildPoints += RULES.buildPointsPerAcceptedOrder;
      this.notify(company, 'info', `"${order.title}" abgenommen. +${RULES.buildPointsPerAcceptedOrder} Baupunkte.`);
    } else {
      order.status = 'rejected';
    }
    order.criteria.forEach((c, index) => (c.checked = Boolean(input.checked?.[index])));
    order.decidedAt = Date.now();
    this.settleBranch(company, order, input.decision === 'accept');
    this.setIdleOrPending(company, agent, input.decision === 'accept' ? 'done' : undefined);
    if (input.decision === 'accept') {
      setTimeout(() => {
        if (agent.live.kind !== 'done') return;
        this.setIdleOrPending(company, agent);
        this.touch(company);
      }, DONE_SHOWN_MS).unref();
    }
    this.touch(company);
  }

  /* ---------- Ansprechen und Stoppen ---------- */

  async chat(companyId: string, agentId: string, text: string, options: { expectNotes?: boolean } = {}): Promise<void> {
    const company = this.require(companyId);
    const agent = this.agentOf(company, agentId);
    const message = text?.trim();
    if (!message) throw new GameError('Was möchtest du sagen?');
    this.hiredAgent(company, agent.id);
    if (this.busy(company, agent.id)) throw new GameError(`${agent.name} arbeitet gerade und antwortet danach.`);
    const departmentId = this.departmentOfAgent(company, agent)?.id ?? null;
    this.assertCanSpend(company, RULES.chatLimitEur, { departmentId });
    agent.chat.push({ at: Date.now(), from: 'leitung', text: message, runId: null });
    await this.startRun(company, agent, { kind: 'chat', orderId: null, prompt: message + NOTE_RULES + this.helpNote(company, agent), limitEur: RULES.chatLimitEur, departmentId });
    if (options.expectNotes) {
      const run = company.runs.at(-1);
      if (run?.agentId === agent.id) run.expectNotes = true;
    }
  }

  stopRun(companyId: string, runId: string): void {
    const company = this.require(companyId);
    const run = company.runs.find((r) => r.id === runId);
    if (!run) throw new GameError('Diesen Lauf gibt es nicht.', 404);
    if (run.status !== 'running') throw new GameError('Dieser Lauf ist schon beendet.');
    this.handles.get(runId)?.stop('stopped');
  }

  /* ---------- Besprechungen ---------- */

  async startMeeting(companyId: string, input: {
    topic: string; notes?: string; participantIds: string[]; moderatorId: string; maxRounds: number; limitEur: number;
  }): Promise<Meeting> {
    const company = this.require(companyId);
    const topic = input.topic?.trim();
    if (!topic) throw new GameError('Worum soll es in der Besprechung gehen?');
    const participantIds = [...new Set(input.participantIds ?? [])];
    for (const id of participantIds) this.hiredAgent(company, id);
    if (participantIds.length < RULES.meetingMinParticipants) throw new GameError('Eine Besprechung braucht mindestens zwei Leute.');
    if (participantIds.length > RULES.meetingMaxParticipants) throw new GameError(`In den Raum passen höchstens ${RULES.meetingMaxParticipants} Leute.`);
    if (!participantIds.includes(input.moderatorId)) throw new GameError('Die Moderation muss an der Besprechung teilnehmen.');
    const limitEur = roundLimit(input.limitEur);
    if (!(limitEur > 0)) throw new GameError('Eine Besprechung braucht ein Limit über 0 €.');
    const rooms = company.placed.filter((p) => p.kind === 'meeting');
    if (!rooms.length) throw new GameError('Für eine Besprechung braucht es einen Besprechungsraum. Stelle ihn unter Bauen auf.');
    const inUse = new Set(company.meetings.filter((m) => m.status === 'running').map((m) => m.roomId));
    const room = rooms.find((r) => !inUse.has(r.id));
    if (!room) throw new GameError('Der Besprechungsraum ist gerade belegt.');
    // Sitzen alle in einer Abteilung, zahlt sie. Gemischte Runden gehen aufs allgemeine Budget.
    const departments = new Set(participantIds.map((id) => this.departmentOfAgent(company, this.agentOf(company, id))?.id ?? null));
    const departmentId = departments.size === 1 ? [...departments][0] : null;
    this.assertCanSpend(company, limitEur, { departmentId });

    const id = `b${shortId()}`;
    const dir = `besprechungen/${slugify(topic)}-${id.slice(1, 5)}`;
    const meeting: Meeting = {
      id, topic, notes: input.notes?.trim() ?? '', participantIds, moderatorId: input.moderatorId, roomId: room.id, departmentId,
      maxRounds: Math.max(1, Math.min(RULES.meetingMaxRounds, Math.round(input.maxRounds ?? 1))), round: 1, speakerIndex: 0, turnActive: false,
      limitEur, status: 'running', createdAt: Date.now(), endedAt: null, turns: [], outcome: null, decision: null, protocolFile: `${dir}/protokoll.md`,
    };
    fs.mkdirSync(path.join(this.workspaceOf(companyId), dir), { recursive: true });
    company.meetings.push(meeting);
    this.writeProtocol(company, meeting);
    this.refreshParticipants(company, meeting);
    await this.pump(company);
    return meeting;
  }

  /* ---------- Kontingent ---------- */

  /** Wer übers Abo arbeitet, hat Feierabend, solange dessen Kontingent leer ist. Wer über einen Schlüssel arbeitet, nicht. */
  private restingUntil(agent: Agent): number | null {
    if (agent.providerId !== 'anthropic' || this.providerInfo.billing === 'api') return null;
    return quotaClosedUntil(this.plan, Date.now());
  }

  private scheduleQuotaWake(): void {
    if (this.quotaTimer) clearTimeout(this.quotaTimer);
    const until = quotaClosedUntil(this.plan, Date.now());
    if (!until) return;
    this.quotaTimer = setTimeout(() => {
      // Wartende Stufen laufen von selbst weiter, und alle Spielstände erfahren, dass wieder gearbeitet wird.
      for (const company of this.companies.values()) {
        this.touch(company);
        this.pump(company).catch((err) => console.error(err));
      }
    }, Math.min(until - Date.now() + 1000, 2_000_000_000));
    this.quotaTimer.unref();
  }

  /* ---------- Repo ---------- */

  /** Mit Repo sehen Agenten den Checkout des Menschen nicht. Sie arbeiten in Arbeitsordnern unter zweige/. */
  private agentRoots(company: Company): Roots {
    const roots = this.rootsOf(company.id);
    return company.repo ? { ...roots, projectDir: null } : roots;
  }

  private syncRead(company: Company): void {
    const repo = company.repo!;
    // Solange jemand darin liest, bleibt der Ordner stehen.
    if (company.runs.some((r) => r.status === 'running' && !r.orderId)) return;
    git.syncReadWorktree(repo.dir, path.join(this.workspaceOf(company.id), READ_DIR), git.baseOf(repo.dir, repo.branch));
  }

  /** Was ein Lauf im Branch geändert hat, als Dateien des Auftrags. */
  private branchFiles(company: Company, run: Run): string[] {
    const order = company.orders.find((o) => o.id === run.orderId);
    if (!order?.git || !company.repo || run.stageKind === 'check') return [];
    try {
      const worktree = path.join(this.workspaceOf(company.id), order.git.dir);
      git.assertIntact(company.repo.dir, worktree);
      return git.changedPaths(worktree).map((file) => `${order.git!.dir}/${file}`);
    } catch (err) {
      this.notify(company, 'error', `"${order.title}": ${(err as Error).message}`);
      return [];
    }
  }

  /** Verbindet ein Repo: einen vorhandenen Ordner oder eine Adresse, die geklont wird. Der Checkout bleibt, wie er ist. */
  async connectRepo(companyId: string, input: { source?: string }): Promise<void> {
    const company = this.require(companyId);
    const source = input.source?.trim();
    if (!source) throw new GameError('Gib einen Ordner oder eine Git-Adresse an.');
    if (company.orders.some((o) => o.status === 'running')) throw new GameError('Warte, bis laufende Aufträge fertig sind.');
    let dir: string;
    if (git.isCloneUrl(source)) {
      dir = path.join(this.dataDir, 'companies', company.id, 'repo');
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      await git.clone(source, dir).catch((err) => {
        throw new GameError(`Klonen fehlgeschlagen: ${(err as Error).message}`);
      });
    } else {
      if (!path.isAbsolute(source)) throw new GameError('Gib den vollständigen Pfad an oder eine Adresse mit https:// oder git@.');
      dir = this.checkProjectDir(source)!;
      if (!git.isRepoRoot(dir)) throw new GameError('Dieser Ordner ist kein Git-Repo. Gib seinen obersten Ordner an.');
    }
    const branch = git.defaultBranch(dir);
    git.baseOf(dir, branch);
    company.projectDir = dir;
    company.repo = { dir, remote: git.remoteUrl(dir), branch, connectedAt: Date.now() };
    this.syncRead(company);
    this.touch(company);
  }

  disconnectRepo(companyId: string): void {
    const company = this.require(companyId);
    if (company.orders.some((o) => o.git && !o.git.pushedAt && !['accepted', 'rejected'].includes(o.status))) throw new GameError('Entscheide zuerst über die offenen Aufträge im Repo.');
    if (company.repo) {
      try {
        git.removeWorktree(company.repo.dir, path.join(this.workspaceOf(company.id), READ_DIR));
      } catch {
        // Der Ordner zum Lesen ist nur eine Kopie.
      }
    }
    company.repo = null;
    this.touch(company);
  }

  /** Jeder Auftrag beginnt auf einem eigenen Branch vom neuesten bekannten Stand. */
  private openBranch(company: Company, id: string, title: string): OrderGit {
    const repo = company.repo!;
    const slug = `${slugify(title)}-${id.slice(1, 5)}`;
    const dir = `${BRANCHES_DIR}/${slug}`;
    const base = git.baseOf(repo.dir, repo.branch);
    const branch = `auftrag/${slug}`;
    git.addWorktree(repo.dir, path.join(this.workspaceOf(company.id), dir), branch, base);
    // Für den nächsten Auftrag. Dieser arbeitet schon, ohne auf das Netz zu warten.
    if (repo.remote) void git.fetchQuietly(repo.dir);
    return { branch, dir, base, commit: null, pushedAt: null, prUrl: null };
  }

  /** Abgenommen heisst committet, lokal. Abgelehnt heisst weg, es ging ja nie etwas hinaus. */
  private settleBranch(company: Company, order: Order, accepted: boolean): void {
    if (!order.git || !company.repo) return;
    const worktree = path.join(this.workspaceOf(company.id), order.git.dir);
    try {
      git.assertIntact(company.repo.dir, worktree);
      if (accepted) order.git.commit = git.commitAll(worktree, `${order.title}\n\n${order.notes}`.trim(), this.agentOf(company, order.stages.find((s) => s.kind === 'work')?.agentId ?? order.agentId).name);
      if (!accepted || !order.git.commit) {
        git.removeWorktree(company.repo.dir, worktree);
        git.deleteBranch(company.repo.dir, order.git.branch);
      }
    } catch (err) {
      this.notify(company, 'error', `"${order.title}": ${(err as Error).message}`);
    }
  }

  orderDiff(companyId: string, orderId: string): string {
    const company = this.require(companyId);
    const order = this.orderOf(company, orderId);
    if (!order.git || !company.repo) throw new GameError('Dieser Auftrag hat keinen Branch.');
    const worktree = path.join(this.workspaceOf(company.id), order.git.dir);
    if (!fs.existsSync(worktree)) throw new GameError('Der Arbeitsordner dieses Auftrags ist weg.');
    git.assertIntact(company.repo.dir, worktree);
    return git.diffOf(worktree, order.git.base);
  }

  private pushable(company: Company, orderId: string): { order: Order; orderGit: OrderGit; repo: CompanyRepo } {
    const order = this.orderOf(company, orderId);
    const repo = company.repo;
    if (!order.git || !repo) throw new GameError('Dieser Auftrag hat keinen Branch.');
    if (order.status !== 'accepted') throw new GameError('Nimm den Auftrag zuerst ab.');
    if (!order.git.commit) throw new GameError('Dieser Auftrag hat nichts im Repo geändert.');
    if (!repo.remote) throw new GameError('Dieses Repo hat kein Ziel zum Hochladen (origin).');
    return { order, orderGit: order.git, repo };
  }

  /** Nach aussen geht nur, was der Mensch ausdrücklich anstösst. Nie mit force. */
  async pushOrder(companyId: string, orderId: string): Promise<void> {
    const company = this.require(companyId);
    const { order, orderGit, repo } = this.pushable(company, orderId);
    await git.pushBranch(repo.dir, orderGit.branch).catch((err) => {
      throw new GameError(`Hochladen fehlgeschlagen: ${(err as Error).message}`);
    });
    orderGit.pushedAt = Date.now();
    this.notify(company, 'info', `"${order.title}" liegt auf ${orderGit.branch}.`);
    this.touch(company);
  }

  async openOrderPr(companyId: string, orderId: string): Promise<void> {
    const company = this.require(companyId);
    const { order, orderGit, repo } = this.pushable(company, orderId);
    if (orderGit.prUrl) throw new GameError('Dafür gibt es schon einen Pull Request.');
    if (!orderGit.pushedAt) await this.pushOrder(companyId, orderId);
    const body = [order.notes, order.criteria.length ? `## Abnahme\n${order.criteria.map((c) => `- [${c.checked ? 'x' : ' '}] ${c.text}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
    orderGit.prUrl = await git.openPullRequest(repo.dir, orderGit.branch, repo.branch, order.title.slice(0, 200), body).catch((err) => {
      throw new GameError(`Pull Request fehlgeschlagen: ${(err as Error).message}`);
    });
    this.touch(company);
  }

  private meetingOf(company: Company, id: string): Meeting {
    const meeting = company.meetings.find((m) => m.id === id);
    if (!meeting) throw new GameError('Diese Besprechung gibt es nicht.', 404);
    return meeting;
  }

  private writeProtocol(company: Company, meeting: Meeting): void {
    fs.writeFileSync(path.join(this.workspaceOf(company.id), meeting.protocolFile), meetingProtocol(meeting, company.agents));
  }

  private refreshParticipants(company: Company, meeting: Meeting): void {
    for (const id of meeting.participantIds) {
      const agent = company.agents.find((a) => a.id === id);
      if (agent) this.setIdleOrPending(company, agent);
    }
  }

  private async startMeetingTurn(company: Company, meeting: Meeting, speakerId: string): Promise<void> {
    const agent = this.agentOf(company, speakerId);
    const remaining = meeting.limitEur - this.meetingSpent(company, meeting);
    if (remaining <= 0) {
      meeting.status = 'limit';
      this.notify(company, 'info', `Besprechung "${meeting.topic}": Das Limit ist aufgebraucht. Erhöhe es, um weiterzumachen.`);
      this.refreshParticipants(company, meeting);
      return;
    }
    // Das Limit verteilt sich gleichmäßig: Niemand redet das Budget leer, bevor alle dran waren.
    const speakers = speakingOrder(meeting).length;
    const turnsLeft = speakers - meeting.speakerIndex + (meeting.maxRounds - meeting.round) * speakers;
    const moderates = speakerId === meeting.moderatorId;
    meeting.turnActive = true;
    await this.startRun(company, agent, {
      kind: 'meeting', orderId: null, meetingId: meeting.id, prompt: meetingPrompt(meeting, agent, company.agents), limitEur: remaining / turnsLeft,
      readOnly: true, jsonSchema: meetingSchema(moderates), structuredLabel: moderates ? 'fasst die Runde zusammen' : 'formuliert den Beitrag',
      departmentId: meeting.departmentId ?? null,
    });
  }

  private finishMeetingTurn(company: Company, agent: Agent, run: Run, structured: unknown): void {
    const meeting = this.meetingOf(company, run.meetingId!);
    meeting.turnActive = false;
    const moderates = agent.id === meeting.moderatorId;
    const parsed = run.status === 'success' ? parseMeetingTurn(structured, moderates) : null;
    if (!parsed) {
      if (run.status === 'success') run.error = 'Der Beitrag war nicht auswertbar.';
      meeting.stopRequested = false;
      meeting.status = run.status === 'limit' ? 'limit' : run.status === 'stopped' || run.status === 'timeout' ? 'stopped' : 'failed';
      if (meeting.status === 'failed') this.notify(company, 'error', `Besprechung "${meeting.topic}": ${run.error}`);
      this.refreshParticipants(company, meeting);
      return;
    }
    meeting.turns.push({ id: shortId(), round: meeting.round, agentId: agent.id, runId: run.id, short: parsed.short, text: parsed.text, at: Date.now() });
    if (moderates) {
      const last = meeting.round >= meeting.maxRounds;
      if (parsed.agreed || last) {
        const outcome = parsed.outcome!;
        meeting.outcome = { ...outcome, proposal: outcome.proposal || parsed.text, agreed: parsed.agreed };
        meeting.status = 'decision';
        meeting.endedAt = Date.now();
      } else {
        meeting.round += 1;
        meeting.speakerIndex = 0;
      }
    } else {
      meeting.speakerIndex += 1;
    }
    // Ein Stopp gilt auch dann, wenn der Beitrag im selben Moment fertig wurde.
    if (meeting.stopRequested && meeting.status === 'running') meeting.status = 'stopped';
    meeting.stopRequested = false;
    this.writeProtocol(company, meeting);
    this.refreshParticipants(company, meeting);
  }

  stopMeeting(companyId: string, meetingId: string): void {
    const company = this.require(companyId);
    const meeting = this.meetingOf(company, meetingId);
    if (meeting.status !== 'running') throw new GameError('Diese Besprechung läuft nicht.');
    const run = company.runs.find((r) => r.meetingId === meeting.id && r.status === 'running');
    if (run) {
      meeting.stopRequested = true;
      this.handles.get(run.id)?.stop('stopped');
      return;
    }
    meeting.status = 'stopped';
    this.refreshParticipants(company, meeting);
    this.touch(company);
  }

  /** Setzt eine angehaltene Besprechung fort oder hängt nach dem Vorschlag eine weitere Runde an. */
  async resumeMeeting(companyId: string, meetingId: string, input: { addLimitEur?: number; addRound?: boolean }): Promise<void> {
    const company = this.require(companyId);
    const meeting = this.meetingOf(company, meetingId);
    if (meeting.status === 'running' || meeting.status === 'closed') throw new GameError('Diese Besprechung kann nicht fortgesetzt werden.');
    if (meeting.status === 'decision' && !input.addRound) throw new GameError('Entscheide über den Vorschlag oder hänge eine weitere Runde an.');
    const extra = Math.max(0, input.addLimitEur ?? 0);
    const remaining = meeting.limitEur + extra - this.meetingSpent(company, meeting);
    if (remaining <= 0) throw new GameError('Das Limit der Besprechung ist aufgebraucht. Erhöhe es, um weiterzumachen.');
    this.assertCanSpend(company, remaining, { departmentId: meeting.departmentId ?? null });
    const inUse = company.meetings.some((m) => m.id !== meeting.id && m.status === 'running' && m.roomId === meeting.roomId);
    if (inUse) throw new GameError('Der Besprechungsraum ist gerade belegt.');

    if (extra) meeting.limitEur = roundLimit(meeting.limitEur + extra);
    if (meeting.status === 'decision') {
      meeting.maxRounds += 1;
      meeting.round += 1;
      meeting.speakerIndex = 0;
      meeting.outcome = null;
      meeting.endedAt = null;
    }
    meeting.status = 'running';
    this.writeProtocol(company, meeting);
    this.refreshParticipants(company, meeting);
    await this.pump(company);
  }

  /** Über den Vorschlag entscheidet der Mensch. Ein Beschluss wird Teil des Firmenwissens. */
  decideMeeting(companyId: string, meetingId: string, input: { decision: 'accept' | 'reject' }): void {
    const company = this.require(companyId);
    const meeting = this.meetingOf(company, meetingId);
    if (meeting.status === 'running') throw new GameError('Die Besprechung läuft noch.');
    if (meeting.status === 'closed') throw new GameError('Darüber ist schon entschieden.');
    if (input.decision === 'accept') {
      if (meeting.status !== 'decision' || !meeting.outcome) throw new GameError('Ohne Vorschlag gibt es nichts zu beschließen.');
      const date = new Date().toISOString().slice(0, 10);
      fs.appendFileSync(path.join(this.workspaceOf(companyId), DECISIONS_FILE), decisionEntry(meeting, date));
      meeting.decision = 'accepted';
      this.notify(company, 'info', `Beschluss gefasst: "${meeting.topic}". Dein Team findet ihn jetzt im Firmenwissen.`);
    } else {
      meeting.decision = 'rejected';
    }
    meeting.status = 'closed';
    meeting.endedAt ??= Date.now();
    this.writeProtocol(company, meeting);
    this.refreshParticipants(company, meeting);
    this.touch(company);
  }

  /* ---------- Scrum ---------- */

  private sprintOf(company: Company, id: string): Sprint {
    const sprint = company.sprints.find((s) => s.id === id);
    if (!sprint) throw new GameError('Diesen Sprint gibt es nicht.', 404);
    return sprint;
  }

  /** Das Planning ist ein echter Lauf des Scrum Masters. Er schlägt nur vor. */
  async planSprint(companyId: string, input: { budgetEur?: number; hint?: string }): Promise<Sprint> {
    const company = this.require(companyId);
    const master = scrumMaster(company);
    if (!master) throw new GameError('Für Sprints braucht die Firma einen Scrum Master.');
    if (openSprint(company)) throw new GameError('Es läuft schon ein Sprint. Schliesse ihn zuerst ab.');
    if (this.busy(company, master.id)) throw new GameError(`${master.name} arbeitet gerade. Warte, bis die Arbeit fertig ist.`);
    const backlog = company.board.filter((n) => n.status === 'open');
    if (!backlog.length) throw new GameError('Das Backlog ist leer. Hänge zuerst Zettel an die Tafel.');
    const budgetEur = round2(input.budgetEur ?? 0);
    if (!(budgetEur > 0)) throw new GameError('Ein Sprint braucht einen Budgetrahmen über 0 €.');
    const limitEur = Math.min(RULES.planningLimitEur, budgetEur);
    const departmentId = this.departmentOfAgent(company, master)?.id ?? null;
    this.assertCanSpend(company, limitEur, { departmentId });
    const sprint: Sprint = {
      id: `s${shortId()}`, number: company.sprints.length + 1, goal: '', reason: '', budgetEur, scrumMasterId: master.id, status: 'planning', noteIds: [],
      hint: input.hint?.trim().slice(0, 1000) ?? '', error: null, retroMeetingId: null, createdAt: Date.now(), startedAt: null, endedAt: null,
    };
    company.sprints.push(sprint);
    const history = company.sprints.filter((s) => s.status === 'closed').slice(-3).map((s) => {
      const rows = sprintRows(company, s);
      return `Sprint ${s.number}: ${s.goal}. ${rows.filter((r) => r.order?.status === 'accepted').length} von ${rows.length} Zetteln abgenommen.`;
    });
    const prompt = planningPrompt({
      number: sprint.number, budgetEur, hint: sprint.hint, backlog, team: company.agents.filter((a) => a.hired && !a.firedAt), customSkills: company.customSkills, history,
      hasDecisions: company.meetings.some((m) => m.decision === 'accepted'),
    });
    await this.startRun(company, master, {
      kind: 'planning', sprintId: sprint.id, orderId: null, departmentId, prompt, limitEur, readOnly: true,
      jsonSchema: planningSchema(backlog.map((n) => n.id)), structuredLabel: 'plant den Sprint',
    });
    return sprint;
  }

  private finishPlanning(company: Company, master: Agent, run: Run, structured: unknown): void {
    const sprint = this.sprintOf(company, run.sprintId!);
    sprint.status = 'proposed';
    const backlog = company.board.filter((n) => n.status === 'open').map((n) => n.id);
    const plan = run.status === 'success' ? parsePlanning(structured, backlog) : null;
    if (plan) {
      Object.assign(sprint, { goal: plan.goal, reason: plan.reason, noteIds: plan.noteIds, error: null });
      this.notify(company, 'info', `${master.name} schlägt Sprint ${sprint.number} vor. Die Entscheidung liegt auf deinem Laptop.`);
    } else {
      sprint.error = run.status === 'success' ? 'Das Planning war nicht auswertbar.' : run.error ?? 'Das Planning wurde abgebrochen.';
      this.notify(company, 'error', `Sprint ${sprint.number}: ${sprint.error}`);
    }
    this.setIdleOrPending(company, master);
  }

  /** Der Mensch legt Ziel, Rahmen und Zettel fest. Erst dann läuft der Sprint. Aufträge vergibt er weiterhin selbst. */
  startSprint(companyId: string, sprintId: string, input: { goal?: string; budgetEur?: number; noteIds?: string[] }): void {
    const company = this.require(companyId);
    const sprint = this.sprintOf(company, sprintId);
    if (sprint.status !== 'proposed') throw new GameError('Dieser Sprint wartet nicht auf deine Entscheidung.');
    const goal = input.goal?.trim();
    if (!goal) throw new GameError('Ein Sprint braucht ein Ziel.');
    const budgetEur = round2(input.budgetEur ?? sprint.budgetEur);
    if (!(budgetEur > 0)) throw new GameError('Ein Sprint braucht einen Budgetrahmen über 0 €.');
    const noteIds = [...new Set(input.noteIds ?? [])];
    if (!noteIds.length) throw new GameError('Wähle mindestens einen Zettel für den Sprint.');
    if (noteIds.length > RULES.sprintNotesMax) throw new GameError(`In einen Sprint passen höchstens ${RULES.sprintNotesMax} Zettel.`);
    const notes = noteIds.map((id) => this.openNote(company, id));
    for (const note of notes) note.status = 'sprint';
    Object.assign(sprint, { goal: goal.slice(0, 300), budgetEur, noteIds, status: 'running', startedAt: Date.now(), error: null });
    this.touch(company);
  }

  discardSprint(companyId: string, sprintId: string): void {
    const company = this.require(companyId);
    const sprint = this.sprintOf(company, sprintId);
    if (sprint.status !== 'proposed') throw new GameError('Dieser Sprint wartet nicht auf deine Entscheidung.');
    // Die Nummer wird frei, der Lauf bleibt im Verbrauch.
    company.sprints = company.sprints.filter((s) => s !== sprint);
    this.touch(company);
  }

  /** Ein Zettel zurück ins Backlog, solange ihn niemand bekommen hat. */
  unsprintNote(companyId: string, sprintId: string, noteId: string): void {
    const company = this.require(companyId);
    const sprint = this.sprintOf(company, sprintId);
    const note = company.board.find((n) => n.id === noteId && n.status === 'sprint');
    if (!note || !sprint.noteIds.includes(noteId)) throw new GameError('Dieser Zettel liegt nicht offen im Sprint.');
    note.status = 'open';
    sprint.noteIds = sprint.noteIds.filter((id) => id !== noteId);
    this.touch(company);
  }

  /** Was niemand bekommen hat, geht zurück ins Backlog. */
  endSprint(companyId: string, sprintId: string): void {
    const company = this.require(companyId);
    const sprint = this.sprintOf(company, sprintId);
    if (sprint.status !== 'running') throw new GameError('Dieser Sprint läuft nicht.');
    if (company.orders.some((o) => o.sprintId === sprint.id && o.status === 'running')) throw new GameError('Im Sprint läuft noch ein Auftrag. Warte oder stoppe ihn.');
    for (const note of company.board) {
      if (note.status !== 'sprint' || !sprint.noteIds.includes(note.id)) continue;
      note.status = 'open';
      sprint.noteIds = sprint.noteIds.filter((id) => id !== note.id);
    }
    sprint.status = 'review';
    sprint.endedAt = Date.now();
    this.touch(company);
  }

  /** Die Retrospektive ist eine echte Besprechung. Ein Beschluss daraus landet im Firmenwissen und im nächsten Planning. */
  async startRetro(companyId: string, sprintId: string): Promise<Meeting> {
    const company = this.require(companyId);
    const sprint = this.sprintOf(company, sprintId);
    if (sprint.status !== 'review') throw new GameError('Eine Retrospektive gibt es, wenn der Sprint beendet ist.');
    if (sprint.retroMeetingId) throw new GameError('Die Retrospektive hat schon stattgefunden.');
    const master = scrumMaster(company);
    if (!master) throw new GameError('Für die Retrospektive braucht die Firma einen Scrum Master.');
    const rows = sprintRows(company, sprint);
    const active = (id: string) => company.agents.some((a) => a.id === id && a.hired && !a.firedAt);
    const workers = rows.flatMap((r) => r.order?.stages.map((stage) => stage.agentId) ?? []).filter(active);
    const others = company.agents.filter((a) => active(a.id)).map((a) => a.id);
    const participantIds = [...new Set([master.id, ...workers, ...others])].slice(0, RULES.meetingMaxParticipants);
    const lines = rows.map((r) => `${r.note.title}: ${r.order ? ORDER_STATE[r.order.status] : 'nicht vergeben'}`);
    const meeting = await this.startMeeting(companyId, {
      topic: `Retrospektive Sprint ${sprint.number}`, notes: retroNotes(sprint.goal, lines, sprintCommitted(company, sprint), sprint.budgetEur),
      participantIds, moderatorId: master.id, maxRounds: 1, limitEur: RULES.retroLimitEur,
    });
    sprint.retroMeetingId = meeting.id;
    this.touch(company);
    return meeting;
  }

  closeSprint(companyId: string, sprintId: string): void {
    const company = this.require(companyId);
    const sprint = this.sprintOf(company, sprintId);
    if (sprint.status !== 'review') throw new GameError('Beende den Sprint zuerst.');
    if (company.meetings.some((m) => m.id === sprint.retroMeetingId && m.status === 'running')) throw new GameError('Die Retrospektive läuft noch.');
    sprint.status = 'closed';
    this.touch(company);
  }

  /* ---------- Befehle mit Freigabe ---------- */

  private appendCommandLog(company: Company, request: CommandRequest, event: string): void {
    const { output: _output, ...facts } = request;
    fs.appendFileSync(path.join(this.companyDir(company.id), 'befehle.jsonl'), `${JSON.stringify({ event, loggedAt: Date.now(), ...facts, outputEnd: request.output.slice(-2000) })}\n`);
  }

  /** Stellt einen Antrag aus der Antwort des Agenten fest. Nur wer laut Subagent-Datei Befehle darf, kann überhaupt einen stellen. */
  /** Zettel kommen aus der echten Antwort des Agenten. Was schon offen an der Tafel hängt, kommt nicht doppelt. */
  private takeNotes(company: Company, agent: Agent, run: Run): void {
    if (run.status !== 'success' || !['chat', 'order', 'revision'].includes(run.kind) || run.stageKind === 'check') return;
    const { notes, text } = parseNotes(run.text, RULES.notesPerRun);
    run.text = text;
    const open = () => company.board.filter((n) => n.status === 'open' || n.status === 'later' || n.status === 'sprint');
    let added = 0;
    for (const note of notes) {
      if (open().length >= RULES.notesOnBoard || open().some((n) => n.title.toLowerCase() === note.title.toLowerCase())) continue;
      company.board.push({ id: `n${shortId()}`, ...note, byAgentId: agent.id, runId: run.id, status: 'open', orderId: null, mandateId: null, at: Date.now() });
      added++;
    }
    if (added) this.notify(company, 'info', `${agent.name} hat ${added === 1 ? 'einen Zettel' : `${added} Zettel`} an die Tafel gehängt.`);
    else if (run.expectNotes) this.notify(company, 'info', `${agent.name} hat keine neuen Zettel an die Tafel gehängt.`);
  }

  /** Ein Zettel der Firmenleitung. Auch er startet nichts und kostet nichts, bis er vergeben wird. */
  createNote(companyId: string, input: { title?: string; notes?: string; role?: string; criteria?: string[] }): BoardItem {
    const company = this.require(companyId);
    const title = this.checkNoteTitle(company, input.title);
    this.assertBoardRoom(company);
    const criteria = (input.criteria ?? []).map((c) => c.trim().slice(0, 200)).filter(Boolean).slice(0, 5);
    const note: BoardItem = { id: `n${shortId()}`, title, notes: input.notes?.trim().slice(0, 1000) ?? '', role: input.role?.trim().slice(0, 60) ?? '', criteria, byAgentId: null, runId: null, status: 'open', orderId: null, mandateId: null, at: Date.now() };
    company.board.push(note);
    this.touch(company);
    return note;
  }

  private checkNoteTitle(company: Company, input: string | undefined, own?: BoardItem): string {
    const title = input?.trim();
    if (!title) throw new GameError('Schreib auf den Zettel, was zu tun ist.');
    if (title.length > 140) throw new GameError('Der Titel darf höchstens 140 Zeichen lang sein.');
    if (company.board.some((n) => n !== own && (n.status === 'open' || n.status === 'later' || n.status === 'sprint') && n.title.toLowerCase() === title.toLowerCase())) throw new GameError(`Den Zettel "${title}" gibt es schon.`);
    return title;
  }

  private assertBoardRoom(company: Company): void {
    if (company.board.filter((n) => n.status === 'open').length >= RULES.notesOnBoard) throw new GameError(`An der Tafel hängen schon ${RULES.notesOnBoard} Zettel. Vergib oder lehne zuerst welche ab.`);
  }

  /** Ein Zettel lässt sich ändern, solange ihn niemand bekommen hat. */
  updateNote(companyId: string, noteId: string, input: { title?: string; notes?: string; role?: string; criteria?: string[] }): void {
    const company = this.require(companyId);
    const note = company.board.find((n) => n.id === noteId && (n.status === 'open' || n.status === 'later' || n.status === 'sprint'));
    if (!note) throw new GameError('Diesen Zettel gibt es nicht mehr.', 404);
    note.title = this.checkNoteTitle(company, input.title, note);
    note.notes = input.notes?.trim().slice(0, 1000) ?? '';
    note.role = input.role?.trim().slice(0, 60) ?? '';
    note.criteria = (input.criteria ?? []).map((c) => c.trim().slice(0, 200)).filter(Boolean).slice(0, 5);
    this.touch(company);
  }

  /** Runter von der Tafel, aber nicht weg. */
  laterNote(companyId: string, noteId: string): void {
    const company = this.require(companyId);
    const note = this.openNote(company, noteId);
    if (note.status !== 'open') throw new GameError('Dieser Zettel liegt im Sprint.');
    note.status = 'later';
    this.touch(company);
  }

  backToBoard(companyId: string, noteId: string): void {
    const company = this.require(companyId);
    const note = company.board.find((n) => n.id === noteId && n.status === 'later');
    if (!note) throw new GameError('Dieser Zettel liegt nicht bei "Für später".', 404);
    this.assertBoardRoom(company);
    note.status = 'open';
    this.touch(company);
  }

  private knownColleagues(company: Company, agent: Agent): Agent[] {
    return staffOf(company).filter((a) => a.hired && a.id !== agent.id && agent.knownIds.includes(a.id));
  }

  private helpNote(company: Company, agent: Agent): string {
    return helpRules(agent, this.knownColleagues(company, agent), company.customSkills);
  }

  /**
   * Die Kennenlernrunde. Der Neue geht zu jedem Kollegen und erfährt, was dieser kann, und umgekehrt. Das steht in Stelle
   * und Fähigkeiten, darum kostet es keinen Lauf. Danach steht es wirklich in den Anweisungen beider.
   */
  private startTour(company: Company, agent: Agent): void {
    const learn = (other: Agent) => {
      if (!agent.knownIds.includes(other.id)) agent.knownIds.push(other.id);
      if (!other.knownIds.includes(agent.id)) other.knownIds.push(agent.id);
    };
    const queue = staffOf(company).filter((a) => a.hired && a.id !== agent.id);
    if (this.tourStepMs <= 0) {
      queue.forEach(learn);
      return;
    }
    const step = () => {
      if (this.closed || agent.firedAt) return;
      const next = queue.shift();
      if (!next) {
        if (agent.live.kind === 'handoff') this.setIdleOrPending(company, agent);
        this.touch(company);
        return;
      }
      // Sobald Arbeit kommt, ist die Runde vorbei. Das Wissen hat die Person trotzdem, sonst stünde es nicht im Auftrag.
      if (this.busy(company, agent.id) || !['idle', 'handoff'].includes(agent.live.kind)) {
        [next, ...queue.splice(0)].forEach(learn);
        this.touch(company);
        return;
      }
      if (next.firedAt) {
        step();
        return;
      }
      learn(next);
      agent.chat.push({ at: Date.now(), from: 'agent', text: `Kennengelernt: ${colleagueLine(next, company.customSkills)}`, runId: null });
      this.setLive(agent, 'handoff', `fragt ${next.name} nach den Fähigkeiten`, null, next.id);
      this.touch(company);
      setTimeout(step, this.tourStepMs).unref();
    };
    step();
  }

  /** Der Agent gibt den Auftrag weiter. Der Server prüft, ob das geht; sonst bearbeitet er ihn selbst. */
  private takeHandover(company: Company, agent: Agent, run: Run): boolean {
    if (run.status !== 'success' || run.kind !== 'order' || run.stageKind !== 'work') return false;
    const parsed = parseHandover(run.text);
    if (!parsed) return false;
    run.text = parsed.text;
    const order = this.orderOf(company, run.orderId!);
    if (order.handoverDenied) return false;
    const to = this.knownColleagues(company, agent).find((a) => a.name.toLowerCase() === parsed.to.toLowerCase());
    const handed = order.handedBy ?? [];
    const check = order.stages.find((s) => s.kind === 'check');
    const denied = !to ? `${parsed.to || 'Diese Person'} kennst du hier nicht.`
      : handed.includes(to.id) ? `${to.name} hat ihn schon einmal weitergegeben.`
      : check?.agentId === to.id ? `${to.name} prüft diesen Auftrag und kann nicht selbst daran arbeiten.`
      : handed.length >= RULES.handoversPerOrder ? 'Er wurde schon zu oft weitergegeben.'
      : '';
    if (denied || !to) {
      order.handoverDenied = true;
      run.handover = { to: null, note: handoverDeniedNote(denied) };
      this.notify(company, 'info', `${agent.name} wollte "${order.title}" weitergeben, das ging nicht: ${denied}`);
      return true;
    }
    order.handedBy = [...handed, agent.id];
    run.handover = { to: to.id, note: parsed.reason };
    agent.chat.push({ at: Date.now(), from: 'agent', text: `Gibt "${order.title}" an ${to.name}${parsed.reason ? `: ${parsed.reason}` : '.'}`, runId: run.id });
    this.notify(company, 'info', `${agent.name} gibt "${order.title}" an ${to.name}${parsed.reason ? `: ${parsed.reason}` : '.'}`);
    return true;
  }

  /** Eine Frage an einen Kollegen. Der Server prüft, ob es ihn gibt und ob die Grenze erreicht ist. */
  private takeHelp(company: Company, agent: Agent, run: Run): void {
    if (run.status !== 'success' || !['chat', 'order', 'revision'].includes(run.kind) || run.stageKind === 'check') return;
    const parsed = parseHelp(run.text);
    if (!parsed) return;
    run.text = parsed.text;
    if (run.helpFollowUp || !parsed.question) return;
    const to = staffOf(company).find((a) => a.hired && a.id !== agent.id && a.name.toLowerCase() === parsed.to.toLowerCase());
    if (!to) {
      this.notify(company, 'info', `${agent.name} wollte ${parsed.to || 'jemanden'} fragen, aber diese Person gibt es hier nicht.`);
      return;
    }
    if (run.orderId && company.helps.filter((h) => h.orderId === run.orderId).length >= RULES.helpsPerOrder) {
      this.notify(company, 'info', `${agent.name} hat bei diesem Auftrag schon ${RULES.helpsPerOrder} Mal gefragt und muss allein weitermachen.`);
      return;
    }
    const help: HelpRequest = { id: `h${shortId()}`, fromId: agent.id, toId: to.id, question: parsed.question, answer: '', status: 'queued', orderId: run.orderId, roomId: null, delivered: false, at: Date.now() };
    company.helps.push(help);
    run.helpId = help.id;
    agent.chat.push({ at: Date.now(), from: 'agent', text: `Frage an ${to.name}: ${help.question}`, runId: run.id });
    this.notify(company, 'info', `${agent.name} braucht Hilfe von ${to.name}.`);
  }

  /** Startet Antworten, sobald der Kollege frei ist, und bringt fertige Antworten zu dem, der im Gespräch gefragt hat. */
  private async pumpHelps(company: Company): Promise<void> {
    for (const help of company.helps) {
      if (help.status === 'queued' && !this.busy(company, help.toId) && !this.busy(company, help.fromId) && !this.restingUntil(this.agentOf(company, help.toId))) await this.startHelp(company, help);
      if (help.status !== 'queued' && help.status !== 'running' && !help.delivered && !help.orderId && !this.busy(company, help.fromId)) await this.deliverHelp(company, help);
    }
  }

  private async startHelp(company: Company, help: HelpRequest): Promise<void> {
    const from = this.agentOf(company, help.fromId);
    const to = this.agentOf(company, help.toId);
    const order = company.orders.find((o) => o.id === help.orderId) ?? null;
    if (order && order.status !== 'running') {
      this.endHelp(company, help, '');
      return;
    }
    // Im Auftrag zahlt sein Limit, sonst das Budget des Kollegen.
    const remaining = order ? order.limitEur - this.orderSpent(company, order) : RULES.helpLimitEur;
    const limitEur = Math.min(RULES.helpLimitEur, order ? remaining / 2 : remaining);
    const departmentId = order ? order.departmentId ?? null : this.departmentOfAgent(company, to)?.id ?? null;
    try {
      if (!(limitEur > 0)) throw new GameError('Das Limit ist aufgebraucht.');
      if (!order) this.assertCanSpend(company, limitEur, { departmentId });
    } catch (err) {
      this.notify(company, 'info', `${to.name} kann ${from.name} nicht antworten: ${(err as Error).message}`);
      this.endHelp(company, help, '');
      return;
    }
    const busyRooms = new Set([
      ...company.meetings.filter((m) => m.status === 'running').map((m) => m.roomId),
      ...company.helps.filter((h) => h.status === 'running').map((h) => h.roomId),
    ]);
    help.roomId = company.placed.find((p) => p.kind === 'meeting' && !busyRooms.has(p.id))?.id ?? null;
    help.status = 'running';
    this.setLive(from, 'waiting', `fragt ${to.name}`, null);
    await this.startRun(company, to, {
      kind: 'help', orderId: order?.id ?? null, departmentId, mandateId: order?.mandateId ?? null, prompt: helpPrompt(from, help.question, order?.title ?? null), limitEur, readOnly: true,
    });
    const run = company.runs.at(-1);
    if (run?.agentId === to.id) run.helpId = help.id;
  }

  private finishHelp(company: Company, agent: Agent, run: Run): void {
    const help = company.helps.find((h) => h.id === run.helpId);
    this.setIdleOrPending(company, agent);
    if (help) this.endHelp(company, help, run.status === 'success' ? run.text.trim() : '');
  }

  private endHelp(company: Company, help: HelpRequest, answer: string): void {
    help.answer = answer;
    help.status = answer ? 'done' : 'failed';
    const from = this.agentOf(company, help.fromId);
    const to = this.agentOf(company, help.toId);
    if (answer) {
      to.chat.push({ at: Date.now(), from: 'agent', text: `Antwort an ${from.name}: ${answer}`, runId: null });
      from.chat.push({ at: Date.now(), from: 'agent', text: `Antwort von ${to.name}: ${answer}`, runId: null });
    }
    const order = company.orders.find((o) => o.id === help.orderId);
    if (order) {
      help.delivered = true;
      // Ein Stopp während der Antwort gilt: Keine neue Stufe, kein neuer Verbrauch.
      if (order.stopRequested) {
        order.stopRequested = false;
        order.status = 'stopped';
        order.stages[order.stageIndex].status = 'stopped';
        order.helpId = null;
      }
      if (order.helpId === help.id) {
        order.helpId = null;
        if (order.status === 'running') {
          const stage = order.stages[order.stageIndex];
          stage.instruction = helpFeedback(to.name, answer || null);
          stage.status = 'waiting';
        }
      }
    }
    this.setIdleOrPending(company, from);
  }

  /** Im Gespräch gibt es keine Stufe, die weiterläuft. Ein eigener Lauf arbeitet die Antwort ein. */
  private async deliverHelp(company: Company, help: HelpRequest): Promise<void> {
    help.delivered = true;
    const from = this.agentOf(company, help.fromId);
    const to = this.agentOf(company, help.toId);
    if (!from.hired) return;
    const departmentId = this.departmentOfAgent(company, from)?.id ?? null;
    try {
      this.assertCanSpend(company, RULES.chatLimitEur, { departmentId });
    } catch (err) {
      this.notify(company, 'info', `${from.name} konnte die Antwort von ${to.name} nicht einarbeiten: ${(err as Error).message}`);
      return;
    }
    await this.startRun(company, from, { kind: 'chat', orderId: null, prompt: helpFeedback(to.name, help.answer || null), limitEur: RULES.chatLimitEur, departmentId });
    const run = company.runs.at(-1);
    if (run?.agentId === from.id) run.helpFollowUp = true;
  }

  private openNote(company: Company, id: string): BoardItem {
    const note = company.board.find((n) => n.id === id);
    if (!note) throw new GameError('Diesen Zettel gibt es nicht.', 404);
    if (note.status !== 'open' && note.status !== 'sprint') throw new GameError('Dieser Zettel hängt nicht mehr an der Tafel.');
    return note;
  }

  /** Wegwerfen ist eine Entscheidung des Menschen. Der Zettel bleibt im Stand, damit er nachvollziehbar bleibt. */
  dropNote(companyId: string, noteId: string): void {
    const company = this.require(companyId);
    this.openNote(company, noteId).status = 'dropped';
    this.touch(company);
  }

  private takeCommandRequest(company: Company, agent: Agent, run: Run): CommandRequest | null {
    if (run.status !== 'success' || !agent.origin?.wantsCommands || !company.projectDir) return null;
    if (run.kind !== 'chat' && run.kind !== 'order' && run.kind !== 'revision') return null;
    if (run.stageKind === 'check') return null;
    const parsed = parseCommandRequest(run.text);
    if (!parsed) return null;
    run.text = parsed.text;
    const request: CommandRequest = {
      id: `k${shortId()}`, agentId: agent.id, agentName: agent.name, runId: run.id, orderId: run.orderId, command: parsed.command, reason: parsed.reason,
      risks: commandRisks(parsed.command), status: 'pending', at: Date.now(), decidedAt: null, durationMs: null, exitCode: null, output: '', truncated: false, declineNote: '', delivered: false,
    };
    company.commands.push(request);
    const open = (c: CommandRequest) => c.status === 'pending' || c.status === 'running';
    if (company.commands.length > RULES.commandsKept) company.commands = company.commands.filter((c, index) => open(c) || !c.delivered || index >= company.commands.length - RULES.commandsKept);
    this.appendCommandLog(company, request, 'beantragt');
    this.notify(company, 'info', `${agent.name} möchte einen Befehl ausführen. Er läuft erst nach deiner Freigabe.`);
    return request;
  }

  private commandOf(company: Company, id: string): CommandRequest {
    const request = company.commands.find((c) => c.id === id);
    if (!request) throw new GameError('Diesen Befehl gibt es nicht.', 404);
    return request;
  }

  /** Die Freigabe gilt genau für diesen Antrag. Den Wortlaut hat der Server gespeichert, niemand kann ihn nachträglich ändern. */
  async decideCommand(companyId: string, commandId: string, input: { decision: 'approve' | 'decline'; note?: string }): Promise<void> {
    const company = this.require(companyId);
    const request = this.commandOf(company, commandId);
    if (request.status !== 'pending') throw new GameError('Darüber ist schon entschieden.');
    const agent = this.agentOf(company, request.agentId);
    request.decidedAt = Date.now();
    if (input.decision !== 'approve') {
      request.status = 'declined';
      request.declineNote = input.note?.trim().slice(0, 500) ?? '';
      this.appendCommandLog(company, request, 'abgelehnt');
      this.setIdleOrPending(company, agent);
      await this.resumeAfterCommand(company, request);
      return;
    }
    // Mit Repo laufen Befehle im Branch des Auftrags, nie im Checkout des Menschen.
    const requestOrder = company.orders.find((o) => o.id === request.orderId);
    const cwd = company.repo ? path.join(this.workspaceOf(company.id), requestOrder?.git?.dir ?? READ_DIR) : company.projectDir;
    if (!cwd || !fs.existsSync(cwd)) throw new GameError('Der Projektordner ist nicht mehr da.');
    if (this.busy(company, agent.id)) throw new GameError(`${agent.name} arbeitet gerade. Warte, bis der Lauf fertig ist.`);
    request.status = 'running';
    this.appendCommandLog(company, request, 'freigegeben');
    this.setLive(agent, 'waiting', `Befehl läuft: ${request.command.split('\n')[0].slice(0, 60)}`, null);
    this.commandHandles.set(request.id, runCommand(request.command, cwd, RULES.commandTimeoutMs, (result) => this.finishCommand(company, agent, request, result)));
    this.touch(company);
  }

  stopCommand(companyId: string, commandId: string): void {
    const company = this.require(companyId);
    const request = this.commandOf(company, commandId);
    if (request.status !== 'running') throw new GameError('Dieser Befehl läuft nicht.');
    this.commandHandles.get(request.id)?.stop();
  }

  private finishCommand(company: Company, agent: Agent, request: CommandRequest, result: CommandResult): void {
    this.commandHandles.delete(request.id);
    Object.assign(request, { status: result.status, exitCode: result.exitCode, output: result.output, truncated: result.truncated, durationMs: result.durationMs });
    if (this.closed) return;
    this.appendCommandLog(company, request, result.status === 'done' ? 'fertig' : result.status === 'stopped' ? 'gestoppt' : 'fehlgeschlagen');
    this.setIdleOrPending(company, agent);
    this.resumeAfterCommand(company, request).catch((err) => this.notify(company, 'error', (err as Error).message));
    this.touch(company);
  }

  /** Der Agent erfährt das Ergebnis und arbeitet weiter. Im Auftrag übernimmt das die Stufe, im Gespräch ein eigener Lauf. */
  private async resumeAfterCommand(company: Company, request: CommandRequest): Promise<void> {
    const order = company.orders.find((o) => o.id === request.orderId);
    if (order) {
      if (order.commandId === request.id && order.status === 'running') {
        const stage = order.stages[order.stageIndex];
        stage.instruction = commandFeedback(request, RULES.commandFeedbackChars);
        stage.status = 'waiting';
        order.commandId = null;
      }
      request.delivered = true;
    }
    await this.pump(company);
  }

  /** Antworten aus einem Gespräch. Ist der Agent gerade beschäftigt, kommt das Ergebnis im nächsten freien Moment an. */
  private async deliverChatCommands(company: Company): Promise<void> {
    for (const request of company.commands) {
      const ended = request.status !== 'pending' && request.status !== 'running';
      if (!ended || request.delivered || request.orderId) continue;
      const agent = company.agents.find((a) => a.id === request.agentId);
      if (!agent) {
        request.delivered = true;
        continue;
      }
      if (this.busy(company, agent.id)) continue;
      const departmentId = this.departmentOfAgent(company, agent)?.id ?? null;
      request.delivered = true;
      try {
        this.assertCanSpend(company, RULES.chatLimitEur, { departmentId });
      } catch (err) {
        this.notify(company, 'error', `${agent.name} kann das Ergebnis des Befehls nicht mehr lesen: ${(err as Error).message}`);
        continue;
      }
      await this.startRun(company, agent, { kind: 'chat', orderId: null, prompt: commandFeedback(request, RULES.commandFeedbackChars), limitEur: RULES.chatLimitEur, departmentId });
    }
  }

  /** Ein angehaltener Auftrag braucht keine Entscheidung mehr: Sein offener Antrag verfällt. */
  private cancelOrderCommand(company: Company, order: Order): void {
    const request = company.commands.find((c) => c.id === order.commandId);
    if (request?.status === 'pending') {
      request.status = 'cancelled';
      request.delivered = true;
      this.appendCommandLog(company, request, 'verfallen');
    }
    order.commandId = null;
    // Eine Frage, die noch niemand beantwortet, verfällt mit dem Auftrag.
    const help = company.helps.find((h) => h.id === order.helpId);
    if (help?.status === 'queued') {
      help.status = 'failed';
      help.delivered = true;
    }
    if (help?.status !== 'running') order.helpId = null;
  }

  /* ---------- Projekt und Manager ---------- */

  private mandateOf(company: Company, id: string): Mandate {
    const mandate = company.mandates.find((m) => m.id === id);
    if (!mandate) throw new GameError('Dieses Projekt gibt es nicht.', 404);
    return mandate;
  }

  /** Der Mensch überträgt ein Ziel mit Budget und Freigabe-Stufe. Das Budget kommt aus der Abteilung des Managers oder dem allgemeinen. */
  async startMandate(companyId: string, input: {
    goal: string; notes?: string; managerId?: string; budgetEur: number; selfStartUpToEur?: number; webAccess?: boolean; teamId?: string | null; noteId?: string | null;
  }): Promise<Mandate> {
    const company = this.require(companyId);
    const note = input.noteId ? this.openNote(company, input.noteId) : null;
    const goal = input.goal?.trim();
    if (!goal) throw new GameError('Beschreibe das Ziel des Projekts.');
    const chosenTeam = input.teamId ? this.teamOf(company, input.teamId) : null;
    // Eine Aufgabe an ein Team nimmt seine Leitung entgegen, wenn der Mensch niemand anderen nennt.
    if (chosenTeam && !input.managerId && !chosenTeam.leadId) throw new GameError(`Das Team "${chosenTeam.name}" hat keine Teamleitung. Bestimme eine, damit jemand die Aufgabe verteilt.`);
    const manager = this.hiredAgent(company, input.managerId || chosenTeam?.leadId || undefined);
    if (this.busy(company, manager.id)) throw new GameError(`${manager.name} arbeitet gerade. Warte, bis die Arbeit fertig ist.`);
    const teamId = chosenTeam?.id ?? null;
    const department = this.departmentOfAgent(company, manager);
    const budgetEur = round2(input.budgetEur);
    if (!(budgetEur > 0)) throw new GameError('Ein Projekt braucht ein Budget über 0 €.');
    this.assertCanSpend(company, budgetEur, { departmentId: department?.id ?? null });
    const self = Math.max(0, Math.min(budgetEur, roundLimit(input.selfStartUpToEur ?? 0)));

    const id = `v${shortId()}`;
    const mandate: Mandate = {
      id, goal, notes: input.notes?.trim() ?? '', managerId: manager.id, departmentId: department?.id ?? null, teamId, budgetEur, selfStartUpToEur: self,
      webAccess: Boolean(input.webAccess), status: 'active', createdAt: Date.now(), closedAt: null, rounds: [], proposals: [], contracts: [], lastError: null,
      file: `auftraege/vorhaben-${slugify(goal)}-${id.slice(1, 5)}.md`,
    };
    company.mandates.push(mandate);
    if (note) {
      note.status = 'taken';
      note.mandateId = mandate.id;
    }
    this.writeMandateFile(company, mandate);
    await this.startManageRun(company, mandate);
    return mandate;
  }

  /** Die nächste Planungsrunde: Der Manager sieht den Stand seiner Aufträge und plant im Rest des Budgets weiter. */
  async planMandate(companyId: string, mandateId: string): Promise<void> {
    const company = this.require(companyId);
    const mandate = this.mandateOf(company, mandateId);
    if (mandate.status !== 'active') throw new GameError(mandate.status === 'planning' ? 'Der Manager plant gerade.' : 'Dieses Projekt ist abgeschlossen.');
    if (mandate.proposals.some((p) => p.status === 'pending')) throw new GameError('Entscheide zuerst über die offenen Vorschläge.');
    if (mandate.contracts.some((c) => c.status === 'pending')) throw new GameError('Unterzeichne zuerst die offenen Verträge oder lehne sie ab.');
    const manager = this.agentOf(company, mandate.managerId);
    if (!manager.hired) throw new GameError(`${manager.name} ist nicht mehr im Team.`);
    if (this.busy(company, manager.id)) throw new GameError(`${manager.name} arbeitet gerade. Warte, bis die Arbeit fertig ist.`);
    if (this.mandateFree(company, mandate) <= 0) throw new GameError('Das Budget des Projekts ist aufgebraucht. Schließe es ab oder gib ein neues.');
    await this.startManageRun(company, mandate);
  }

  private writeMandateFile(company: Company, mandate: Mandate): void {
    fs.writeFileSync(path.join(this.workspaceOf(company.id), mandate.file), mandateFile(mandate, company.agents, company.orders));
  }

  /** Wen der Manager einplanen darf: sein Abteilungsteam oder, ohne Abteilung, die ganze Firma. */
  private mandateTeam(company: Company, mandate: Mandate): Agent[] {
    // Ein Team, das der Mensch gewählt hat, geht vor: Es ist die engste Grenze.
    const team = company.teams.find((t) => t.id === mandate.teamId);
    if (team) return company.agents.filter((a) => a.hired && team.memberIds.includes(a.id));
    const department = company.departments.find((d) => d.id === mandate.departmentId) ?? null;
    return department ? this.membersOf(company, department) : company.agents.filter((a) => a.hired);
  }

  private async startManageRun(company: Company, mandate: Mandate): Promise<void> {
    const manager = this.agentOf(company, mandate.managerId);
    const team = this.mandateTeam(company, mandate);
    const free = this.mandateFree(company, mandate);
    const orderLines = company.orders.filter((o) => o.mandateId === mandate.id).map((o) => {
      const status = ORDER_STATE[o.status];
      const files = o.files.filter((f) => !/pruefung-\d+\.md$/.test(f));
      return `${o.title} (${this.agentOf(company, o.stages.find((s) => s.kind === 'work')!.agentId).name}): ${status}${files.length ? `, Dateien: ${files.join(', ')}` : ''}${o.summary ? `. ${o.summary.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`;
    });
    const prompt = managePrompt(mandate, {
      manager, team, department: company.departments.find((d) => d.id === mandate.departmentId) ?? null, freeEur: free, orderLines,
      round: mandate.rounds.length + 1, hasDecisions: fs.existsSync(path.join(this.workspaceOf(company.id), DECISIONS_FILE)), projectDir: company.projectDir ?? null,
      customSkills: company.customSkills, companyRoles: company.roles, teamNote: (() => {
        const t = company.teams.find((x) => x.id === mandate.teamId);
        return t ? `Die Firmenleitung hat dieses Projekt dem Team "${t.name}" gegeben.${t.purpose ? ` Sein Zweck: ${t.purpose}` : ''}` : '';
      })(),
    });
    mandate.status = 'planning';
    mandate.lastError = null;
    await this.startRun(company, manager, {
      kind: 'manage', orderId: null, mandateId: mandate.id, departmentId: mandate.departmentId, prompt, limitEur: Math.min(RULES.manageLimitEur, free),
      readOnly: true, jsonSchema: manageSchema(team.map((a) => a.name), company.roles.map((r) => r.title)), structuredLabel: 'schreibt die Aufträge auf',
    });
  }

  /** Die Vorschläge des Managers werden geprüft, nicht geglaubt: Team, Beträge und Freigabe-Stufe setzt der Server durch. */
  private finishManage(company: Company, manager: Agent, run: Run, structured: unknown): void {
    const mandate = this.mandateOf(company, run.mandateId!);
    mandate.status = 'active';
    const plan = run.status === 'success' ? parsePlan(structured) : null;
    if (!plan) {
      if (run.status === 'success') run.error = 'Die Planung war nicht auswertbar.';
      mandate.lastError = run.error ?? 'Die Planung wurde abgebrochen.';
      if (run.status === 'error' || run.status === 'success') this.notify(company, 'error', `Projekt "${mandate.goal}": ${mandate.lastError}`);
      this.writeMandateFile(company, mandate);
      this.setIdleOrPending(company, manager);
      return;
    }
    const round = mandate.rounds.length + 1;
    mandate.rounds.push({ round, runId: run.id, at: Date.now(), summary: plan.summary, open: plan.open, done: plan.done });
    const team = this.mandateTeam(company, mandate);
    const byName = (name: string) => team.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? null;
    let free = this.mandateFree(company, mandate);
    const started: Order[] = [];
    for (const p of plan.proposals) {
      const work = byName(p.workName);
      const planner = p.planName ? byName(p.planName) : null;
      const checker = p.checkName ? byName(p.checkName) : null;
      const limitEur = roundLimit(p.limitEur);
      const proposal: Proposal = {
        id: `p${shortId()}`, round, title: p.title, notes: p.notes, criteria: p.criteria,
        team: { plan: planner?.id ?? null, work: work?.id ?? '', check: checker?.id ?? null }, limitEur, reason: p.reason,
        status: 'pending', orderId: null, invalidReason: '', at: Date.now(),
      };
      const outside = [p.workName, p.planName, p.checkName].filter((n) => n && !byName(n));
      if (outside.length) proposal.invalidReason = `${outside.join(', ')} gehört nicht zum Team des Projekts.`;
      else if (!work || !p.title || !p.criteria.length) proposal.invalidReason = 'Ohne Ziel, Bearbeiter und Abnahmekriterien ist das kein Auftrag.';
      else if (checker?.id === work.id) proposal.invalidReason = `${work.name} kann das eigene Ergebnis nicht prüfen.`;
      else if (!(limitEur > 0)) proposal.invalidReason = 'Das Limit muss über 0 € liegen.';
      else if (limitEur > free + 1e-9) proposal.invalidReason = `Übersteigt das verbleibende Budget des Projekts (${free.toFixed(2).replace('.', ',')} €).`;
      if (proposal.invalidReason) {
        proposal.status = 'invalid';
        mandate.proposals.push(proposal);
        continue;
      }
      free -= limitEur;
      mandate.proposals.push(proposal);
      if (limitEur <= mandate.selfStartUpToEur + 1e-9) {
        const order = this.startProposal(company, mandate, proposal, 'manager');
        if (order) started.push(order);
      }
    }
    // Einstellungen werden nie selbst gestartet: Jede braucht den unterzeichneten Vertrag der Geschäftsführung.
    for (const h of plan.hires) {
      // Die Rollen der Geschäftsführung gehen vor: Sie sind das, was die Firma unter dieser Stelle versteht.
      const companyRole = company.roles.find((r) => r.title.toLowerCase() === h.roleTitle.toLowerCase()) ?? null;
      const role = companyRole ? roleById(companyRole.baseRoleId) : ROLES.find((r) => r.title.toLowerCase() === h.roleTitle.toLowerCase());
      const model = MODELS.find((m) => m.label.toLowerCase() === h.modelLabel.toLowerCase());
      const named = h.skillTitles.map((t) => SKILLS.find((s) => s.title.toLowerCase() === t.toLowerCase())?.id).filter((id): id is string => Boolean(id));
      const skillIds = [...new Set([...(companyRole?.skillIds ?? []), ...named])];
      const contract: Contract = {
        id: `c${shortId()}`, round, name: h.name, roleId: role?.id ?? '', companyRoleId: companyRole?.id ?? null, skillIds, modelId: model?.id ?? '', reason: h.reason,
        status: 'pending', agentId: null, invalidReason: '', at: Date.now(), signedAt: null,
      };
      if (!h.name) contract.invalidReason = 'Ohne Namen gibt es keinen Vertrag.';
      else if (!role) contract.invalidReason = `Die Rolle "${h.roleTitle}" gibt es nicht.`;
      else if (!model) contract.invalidReason = `Das Modell "${h.modelLabel}" gibt es nicht.`;
      else if (staffOf(company).some((a) => a.name.toLowerCase() === h.name.toLowerCase())) contract.invalidReason = `${h.name} arbeitet schon hier.`;
      else if (mandate.contracts.some((c) => c.status === 'pending' && c.name.toLowerCase() === h.name.toLowerCase())) contract.invalidReason = `Für ${h.name} liegt schon ein Vertrag vor.`;
      if (contract.invalidReason) contract.status = 'invalid';
      mandate.contracts.push(contract);
    }
    this.writeMandateFile(company, mandate);
    const pending = mandate.proposals.filter((p) => p.round === round && p.status === 'pending').length;
    const contracts = mandate.contracts.filter((c) => c.round === round && c.status === 'pending');
    if (contracts.length) this.notify(company, 'info', `${manager.name} möchte einstellen: ${contracts.map((c) => c.name).join(', ')}. Ohne deine Unterschrift unter dem Vertrag passiert nichts.`);
    if (started.length) this.notify(company, 'info', `${manager.name} hat ${started.length === 1 ? 'einen Auftrag' : `${started.length} Aufträge`} gestartet: ${started.map((o) => `"${o.title}"`).join(', ')}.`);
    if (pending) this.notify(company, 'info', `${manager.name} schlägt ${pending === 1 ? 'einen Auftrag' : `${pending} Aufträge`} vor und wartet auf deine Freigabe.`);
    if (plan.done && !pending && !started.length) this.notify(company, 'info', `${manager.name} sieht das Ziel "${mandate.goal}" als erreicht. Ob das stimmt, entscheidest du.`);
    if (started.length) this.handOff(company, manager, started[0].stages[0].agentId, 'bringt den Auftrag zu');
    else this.setIdleOrPending(company, manager);
  }

  /** Aus einem Vorschlag wird ein echter Auftrag mit dem Budget des Projekts. Scheitert das, bleibt der Vorschlag offen. */
  private startProposal(company: Company, mandate: Mandate, proposal: Proposal, by: 'leitung' | 'manager'): Order | null {
    const manager = this.agentOf(company, mandate.managerId);
    try {
      const order = this.createOrder(company, {
        team: proposal.team, title: proposal.title,
        notes: [`Geplant von ${manager.name} im Projekt "${mandate.goal}".`, proposal.notes].filter(Boolean).join('\n'),
        criteria: proposal.criteria, limitEur: proposal.limitEur, maxRevisions: RULES.defaultMaxRevisions, webAccess: mandate.webAccess, startedBy: by,
      }, mandate);
      proposal.status = 'started';
      proposal.orderId = order.id;
      return order;
    } catch (err) {
      proposal.invalidReason = (err as Error).message;
      proposal.status = 'invalid';
      return null;
    }
  }

  /** Freigeben oder ablehnen, was der Manager vorgeschlagen hat. Das ist die Stufe, die den Menschen braucht. */
  async decideProposal(companyId: string, mandateId: string, proposalId: string, input: { decision: 'approve' | 'decline' }): Promise<void> {
    const company = this.require(companyId);
    const mandate = this.mandateOf(company, mandateId);
    const proposal = mandate.proposals.find((p) => p.id === proposalId);
    if (!proposal) throw new GameError('Diesen Vorschlag gibt es nicht.', 404);
    if (proposal.status !== 'pending') throw new GameError('Darüber ist schon entschieden.');
    if (mandate.status === 'closed') throw new GameError('Dieses Projekt ist abgeschlossen.');
    if (input.decision === 'approve') {
      this.assertCanSpend(company, proposal.limitEur, { mandateId: mandate.id });
      const order = this.startProposal(company, mandate, proposal, 'leitung');
      if (!order) throw new GameError(proposal.invalidReason);
    } else {
      proposal.status = 'declined';
    }
    this.writeMandateFile(company, mandate);
    this.setIdleOrPending(company, this.agentOf(company, mandate.managerId));
    await this.pump(company);
  }

  /** Der Vertrag als lesbares Dokument, mit Listenpreisen in Euro. */
  contractOf(companyId: string, mandateId: string, contractId: string): { contract: Contract; mandate: Mandate; text: string } {
    const company = this.require(companyId);
    const mandate = this.mandateOf(company, mandateId);
    const contract = mandate.contracts.find((c) => c.id === contractId);
    if (!contract) throw new GameError('Diesen Vertrag gibt es nicht.', 404);
    const manager = company.agents.find((a) => a.id === mandate.managerId)?.name ?? 'Manager';
    const department = company.departments.find((d) => d.id === mandate.departmentId)?.name ?? null;
    return { contract, mandate, text: contractText(contract, mandate, manager, company.name, department, this.fxNow.eurPerUsd, { customSkills: company.customSkills, roleTitle: company.roles.find((r) => r.id === contract.companyRoleId)?.title }) };
  }

  /** Die Unterschrift der Geschäftsführung: Erst sie löst das echte Vorstellungsgespräch aus. Ohne sie wird niemand eingestellt. */
  async signContract(companyId: string, mandateId: string, contractId: string, input: { decision: 'sign' | 'decline'; deskId?: string | null; look?: Look; name?: string | null }): Promise<Agent | null> {
    const company = this.require(companyId);
    const mandate = this.mandateOf(company, mandateId);
    const contract = mandate.contracts.find((c) => c.id === contractId);
    if (!contract) throw new GameError('Diesen Vertrag gibt es nicht.', 404);
    if (contract.status !== 'pending') throw new GameError('Über diesen Vertrag ist schon entschieden.');
    if (input.decision === 'decline') {
      contract.status = 'declined';
      this.writeMandateFile(company, mandate);
      this.setIdleOrPending(company, this.agentOf(company, mandate.managerId));
      this.touch(company);
      return null;
    }
    // Der Platz muss im Bereich des Projekts liegen, sonst gehörte die Person nicht zum Team des Managers.
    const taken = new Set(company.agents.map((a) => a.deskId));
    const fits = (desk: PlacedItem) => (deskDepartment(company.departments, desk)?.id ?? null) === mandate.departmentId;
    const desk = input.deskId
      ? company.placed.find((p) => p.id === input.deskId && p.kind === 'desk')
      : company.placed.find((p) => p.kind === 'desk' && !taken.has(p.id) && fits(p));
    if (!desk) throw new GameError(mandate.departmentId ? 'Kein freier Arbeitsplatz in der Abteilung. Stelle unter Bauen einen Schreibtisch in den Bereich.' : 'Kein freier Arbeitsplatz. Stelle zuerst einen Schreibtisch auf.');
    if (!fits(desk)) throw new GameError('Dieser Platz liegt nicht im Bereich des Projekts.');
    const role = roleById(contract.roleId)!;
    const look: Look = input.look ?? { hair: 'kurz', hairColor: '#3a2a22', top: role.top, skin: '#e6b48b', glasses: false };
    // Den Namen legt die Geschäftsführung fest; der Vorschlag des Managers ist nur ein Vorschlag.
    const name = input.name?.trim() || contract.name;
    // Wurde die Rolle inzwischen gelöscht, gilt der Vertrag mit seiner Vorlage weiter.
    const companyRoleId = company.roles.some((r) => r.id === contract.companyRoleId) ? contract.companyRoleId : null;
    const agent = await this.hire(companyId, { name, roleId: contract.roleId, companyRoleId, skillIds: contract.skillIds, modelId: contract.modelId, look: { ...look, top: role.top }, deskId: desk.id, job: contract.reason ? { title: role.title, task: contract.reason, requirements: '' } : null });
    // Bei einer Teamaufgabe kommt die Person ins Team. Sonst könnte die Leitung sie in der nächsten Runde nicht einplanen.
    const team = company.teams.find((t) => t.id === mandate.teamId);
    if (team && !team.memberIds.includes(agent.id)) team.memberIds.push(agent.id);
    contract.name = name;
    contract.status = 'signed';
    contract.signedAt = Date.now();
    contract.agentId = agent.id;
    this.writeMandateFile(company, mandate);
    this.setIdleOrPending(company, this.agentOf(company, mandate.managerId));
    this.touch(company);
    return agent;
  }

  /** Abschließen gibt den nicht zugeteilten Rest des Budgets frei. Laufende Aufträge laufen weiter. */
  closeMandate(companyId: string, mandateId: string): void {
    const company = this.require(companyId);
    const mandate = this.mandateOf(company, mandateId);
    if (mandate.status === 'planning') throw new GameError('Der Manager plant gerade. Stoppe den Lauf oder warte.');
    if (mandate.status === 'closed') throw new GameError('Dieses Projekt ist schon abgeschlossen.');
    for (const p of mandate.proposals) if (p.status === 'pending') p.status = 'declined';
    for (const c of mandate.contracts) if (c.status === 'pending') c.status = 'declined';
    mandate.status = 'closed';
    mandate.closedAt = Date.now();
    this.writeMandateFile(company, mandate);
    this.setIdleOrPending(company, this.agentOf(company, mandate.managerId));
    this.touch(company);
  }

  /* ---------- Bauen ---------- */

  private assertBuildPoints(company: Company, cost: number): void {
    if (this.unlimitedBuild) return;
    if (company.buildPoints < cost) throw new GameError(`Dafür fehlen Baupunkte: ${cost} nötig, ${company.buildPoints} vorhanden.`);
  }

  private spendBuildPoints(company: Company, cost: number): void {
    if (!this.unlimitedBuild) company.buildPoints -= cost;
  }

  private propsOf(locationId: LocationId): PlacedItem[] {
    return locationById(locationId).props.map((prop) => ({ id: shortId(), kind: prop.kind, i: prop.i, j: prop.j, rot: 0 as Rotation }));
  }

  /** Neu gekauft oder aus dem Inventar. Was im Inventar liegt, ist schon bezahlt. */
  private checkFloor(company: Company, floor: number | undefined): number {
    const wanted = floor ?? 0;
    const site = siteAt(company, wanted);
    if (!Number.isInteger(wanted) || wanted < 0 || storeyOf(wanted) >= buildingAt(company.town, site.siteId).floors || (wanted >= SITE_STEP && !company.town.extra?.[Math.floor(wanted / SITE_STEP) - 1])) throw new GameError('Diese Etage gibt es nicht.');
    return wanted;
  }

  /** Anbauen geht nur am eigenen Haus und nur so weit, wie das Grundstück es hergibt. Bezahlt wird in Baupunkten. */
  expandBuilding(companyId: string, input: { kind: 'breiter' | 'tiefer' | 'etage'; shaft?: { kind: Shaft['kind']; i: number; j: number; rot: Rotation } }): void {
    const company = this.require(companyId);
    const limits = buildLimits(company.locationId);
    if (!limits) throw new GameError('Anbauen geht nur am eigenen Neubau.');
    const { town } = company;
    const current = buildingAt(town, town.siteId);
    const next: Building = { ...current, shafts: [...current.shafts] };
    let cost = EXTEND_COST;
    if (input.kind === 'breiter') {
      if (current.w >= limits.w) throw new GameError('Breiter gibt das Grundstück nicht her.');
      next.w++;
    } else if (input.kind === 'tiefer') {
      if (current.d >= limits.d) throw new GameError('Tiefer gibt das Grundstück nicht her.');
      next.d++;
    } else if (input.kind === 'etage') {
      if (current.floors >= limits.floors) throw new GameError('Höher gibt das Grundstück nicht her.');
      cost = floorCost(current.floors);
      next.floors++;
      if (!current.shafts.length) {
        if (!input.shaft) throw new GameError('Für ein Stockwerk brauchst du zuerst einen Platz für Treppe oder Fahrstuhl.');
        cost += SHAFT_COST[input.shaft.kind] ?? 0;
        next.shafts.push(this.checkedShaft(company, input.shaft));
      }
    } else {
      throw new GameError('So lässt sich nicht anbauen.');
    }
    this.assertBuildPoints(company, cost);
    town.buildings = { ...town.buildings, [town.siteId]: next };
    this.placeShafts(company, next);
    this.spendBuildPoints(company, cost);
    this.touch(company);
  }

  /** Noch ein Aufgang im Haus, damit die Wege kürzer werden. */
  addShaft(companyId: string, input: { kind: Shaft['kind']; i: number; j: number; rot: Rotation }): void {
    const company = this.require(companyId);
    const { town } = company;
    const current = buildingAt(town, town.siteId);
    if (current.floors < 2) throw new GameError('Ein Aufgang braucht ein zweites Stockwerk.');
    const shaft = this.checkedShaft(company, input);
    const cost = SHAFT_COST[shaft.kind];
    this.assertBuildPoints(company, cost);
    const next = { ...current, shafts: [...current.shafts, shaft] };
    town.buildings = { ...town.buildings, [town.siteId]: next };
    this.placeShafts(company, next);
    this.spendBuildPoints(company, cost);
    this.touch(company);
  }

  private checkedShaft(company: Company, input: { kind: Shaft['kind']; i: number; j: number; rot: Rotation }): Shaft {
    if (!isShaft(input.kind)) throw new GameError('Das ist kein Aufgang.');
    assertRotation(input.rot);
    const check = checkShaft(company, input);
    if (!check.ok) throw new GameError(check.reason);
    return { kind: input.kind, i: input.i, j: input.j, landing: shaftLanding(input.kind, input.i, input.j, input.rot) };
  }

  /** Jeder Aufgang steht auf jeder Etage. Was noch fehlt, kommt dazu. */
  private placeShafts(company: Company, building: Building): void {
    company.placed.push(...this.shaftItems(building).filter((n) => !company.placed.some((p) => p.kind === n.kind && p.i === n.i && p.j === n.j && floorOf(p) === floorOf(n))));
  }

  private shaftItems(building: Building): PlacedItem[] {
    return building.shafts.flatMap((s) => Array.from({ length: building.floors > 1 ? building.floors : 0 }, (_, floor): PlacedItem => ({ id: shortId(), kind: s.kind, i: s.i, j: s.j, rot: 0, ...(floor ? { floor } : {}) })));
  }

  placeItem(companyId: string, input: { kind?: FurnitureKind; inventoryId?: string; floor?: number; i: number; j: number; rot: Rotation }): PlacedItem {
    const company = this.require(companyId);
    const stored = input.inventoryId ? company.inventory.find((s) => s.id === input.inventoryId) : null;
    if (input.inventoryId && !stored) throw new GameError('Das liegt nicht im Inventar.', 404);
    const info = stored ? null : FURNITURE.find((f) => f.kind === input.kind);
    if (!stored && !info) throw new GameError('Dieses Möbelstück gibt es nicht.');
    const kind = (stored?.kind ?? input.kind)!;
    // Den Chefplatz gibt es einmal. Liegt er im Inventar, kommt er von dort.
    if (!stored && kind === 'ceoDesk' && [...company.placed, ...company.inventory].some((p) => p.kind === 'ceoDesk')) throw new GameError('Du hast schon einen Chefschreibtisch.');
    assertRotation(input.rot);
    const rot = isProp(kind) ? 0 : input.rot;
    if (info) this.assertBuildPoints(company, info.cost);
    const floor = this.checkFloor(company, input.floor);
    const check = checkPlacement(roomOf(company, floor), itemsOnFloor(company.placed, floor), { kind, i: input.i, j: input.j, rot });
    if (!check.ok) throw new GameError(check.reason);
    const item: PlacedItem = { id: stored?.id ?? shortId(), kind, i: input.i, j: input.j, rot, ...(floor ? { floor } : {}) };
    company.placed.push(item);
    if (stored) company.inventory = company.inventory.filter((s) => s !== stored);
    if (info) this.spendBuildPoints(company, info.cost);
    this.touch(company);
    return item;
  }

  /** Was gerade gebraucht wird, darf nicht aus dem Raum verschwinden. */
  private removablePlaced(company: Company, itemId: string): PlacedItem {
    const item = company.placed.find((p) => p.id === itemId);
    if (!item) throw new GameError('Dieses Möbelstück gibt es nicht.', 404);
    if (isShaft(item.kind)) throw new GameError(`${furnitureByKind(item.kind).title} bleibt, wo sie ist. Entfernen geht, solange ein zweiter Aufgang steht.`);
    const sitter = company.agents.find((a) => a.deskId === item.id);
    if (sitter) throw new GameError(`Hier sitzt ${sitter.name}. Rücke den Schreibtisch stattdessen an einen anderen Platz.`);
    if (company.meetings.some((m) => m.roomId === item.id && m.status !== 'closed')) throw new GameError('Dieser Raum gehört zu einer offenen Besprechung. Schließe sie zuerst ab.');
    return item;
  }

  /** Aus dem Raum ins Inventar. Das Neuplatzieren kostet nichts. */
  storeItem(companyId: string, itemId: string): void {
    const company = this.require(companyId);
    const item = this.removablePlaced(company, itemId);
    company.placed = company.placed.filter((p) => p !== item);
    company.inventory.push({ id: item.id, kind: item.kind, at: Date.now() });
    this.touch(company);
  }

  /** Endgültig weg, und ohne Erstattung: Baupunkte gibt es nur für abgenommene Arbeit. */
  deleteItem(companyId: string, itemId: string): void {
    const company = this.require(companyId);
    const stored = company.inventory.find((s) => s.id === itemId);
    const shaftItem = company.placed.find((p) => p.id === itemId && isShaft(p.kind));
    if (stored) company.inventory = company.inventory.filter((s) => s !== stored);
    else if (shaftItem) {
      const { town } = company;
      const building = buildingAt(town, town.siteId);
      if (building.shafts.length < 2) throw new GameError('Das ist der einzige Weg nach oben. Er kann erst weg, wenn ein zweiter Aufgang steht.');
      town.buildings = { ...town.buildings, [town.siteId]: { ...building, shafts: building.shafts.filter((s) => !(s.i === shaftItem.i && s.j === shaftItem.j && s.kind === shaftItem.kind)) } };
      company.placed = company.placed.filter((p) => !(p.kind === shaftItem.kind && p.i === shaftItem.i && p.j === shaftItem.j));
    } else {
      const item = this.removablePlaced(company, itemId);
      company.placed = company.placed.filter((p) => p !== item);
    }
    this.touch(company);
  }

  moveItem(companyId: string, itemId: string, input: { floor?: number; i: number; j: number; rot: Rotation }): void {
    const company = this.require(companyId);
    const item = company.placed.find((p) => p.id === itemId);
    if (!item) throw new GameError('Dieses Möbelstück gibt es nicht.', 404);
    assertRotation(input.rot);
    if (company.meetings.some((m) => m.status === 'running' && m.roomId === itemId)) throw new GameError('In diesem Raum läuft gerade eine Besprechung.');
    if (isShaft(item.kind)) throw new GameError(`${furnitureByKind(item.kind).title} bleibt, wo sie ist.`);
    const floor = this.checkFloor(company, input.floor ?? floorOf(item));
    const check = checkPlacement(roomOf(company, floor), itemsOnFloor(company.placed, floor), { ...item, i: input.i, j: input.j, rot: input.rot });
    if (!check.ok) throw new GameError(check.reason);
    Object.assign(item, { i: input.i, j: input.j, rot: isProp(item.kind) ? 0 : input.rot });
    if (floor) item.floor = floor;
    else delete item.floor;
    this.touch(company);
  }

  /** Eine Stadt zum ersten Mal betreten: Ihr Aussehen wird zufällig gezogen und danach festgehalten. */
  visitCity(companyId: string, cityId: string): void {
    const company = this.require(companyId);
    const known = CITIES.some((c) => c.id === cityId) || Boolean(placeById(cityId));
    if (!known) throw new GameError('Diese Stadt gibt es nicht.', 404);
    const { town } = company;
    town.citySalts ??= {};
    if (town.citySalts[cityId] !== undefined) return;
    town.citySalts[cityId] = randomInt(1, 2_000_000_000);
    this.touch(company);
  }

  /** Direkt umziehen: Ein noch nicht gemieteter Laden wird dabei gemietet. Die Stadtkarte nutzt townAction. */
  moveCompany(companyId: string, locationId: LocationId): void {
    const company = this.require(companyId);
    const target = LOCATIONS.find((l) => l.id === locationId);
    const parcel = target ? parcelOfLocation(locationId) : undefined;
    if (!target || !parcel || parcel.kind === 'lot') throw new GameError('Dorthin kannst du nicht umziehen.');
    const open = parcel.kind === 'home' || company.town.rented.includes(parcel.id);
    this.relocate(company, locationId, parcel.id, open ? 0 : parcel.price ?? 0);
    if (!open) company.town.rented.push(parcel.id);
    this.touch(company);
  }

  /** Was die Figur vor Ort tun kann. Bezahlt wird in Baupunkten, das KI-Budget bleibt echtem Verbrauch vorbehalten. */
  townAction(companyId: string, parcelId: string, input: { action: 'buy' | 'rent' | 'build' | 'move'; locationId?: LocationId }): void {
    const company = this.require(companyId);
    const parcel = parcelById(parcelId);
    if (!parcel) throw new GameError('Dieses Grundstück gibt es nicht.', 404);
    const { town } = company;
    switch (input.action) {
      case 'buy':
        if (parcel.kind !== 'lot') throw new GameError('Das steht nicht zum Verkauf.');
        if (town.owned.includes(parcel.id)) throw new GameError('Dieses Grundstück gehört dir schon.');
        this.assertBuildPoints(company, parcel.price!);
        this.spendBuildPoints(company, parcel.price!);
        town.owned.push(parcel.id);
        this.notify(company, 'info', `${parcel.name} gehört jetzt dir. Hier kannst du bauen.`);
        break;
      case 'rent':
        if (parcel.kind !== 'vacant') throw new GameError('Das ist nicht zu vermieten.');
        if (town.rented.includes(parcel.id)) throw new GameError('Das hast du schon gemietet.');
        this.assertBuildPoints(company, parcel.price!);
        this.spendBuildPoints(company, parcel.price!);
        town.rented.push(parcel.id);
        this.notify(company, 'info', `${parcel.name} ist gemietet. Die Tür führt hinein.`);
        break;
      case 'build':
        if (parcel.kind !== 'lot') throw new GameError('Hier kannst du nicht bauen.');
        if (!town.owned.includes(parcel.id)) throw new GameError('Kaufe das Grundstück zuerst.');
        if (town.built.includes(parcel.id)) throw new GameError('Hier steht schon dein Neubau.');
        this.assertBuildPoints(company, parcel.buildCost!);
        this.spendBuildPoints(company, parcel.buildCost!);
        town.built.push(parcel.id);
        this.notify(company, 'info', `Dein Neubau auf ${parcel.name} steht. Die Tür führt hinein.`);
        break;
      case 'move': {
        const open = parcel.kind === 'home' || town.rented.includes(parcel.id) || town.built.includes(parcel.id);
        if (!open) throw new GameError(parcel.kind === 'lot' ? 'Hier steht noch nichts, in das du einziehen könntest.' : parcel.kind === 'vacant' ? 'Miete das zuerst.' : 'Hier kannst du nicht einziehen.');
        const locationId = parcel.kind === 'home' ? input.locationId : parcel.locationId;
        if (!locationId || (parcel.kind === 'home' && !HOME_ROOMS.includes(locationId))) throw new GameError('Wähle das Kinderzimmer oder die Garage.');
        this.relocate(company, locationId, parcel.id, 0);
        break;
      }
      default:
        throw new GameError('Das geht hier nicht.');
    }
    this.touch(company);
  }

  /** Hineingehen ohne Umzug: Ein Haus, das der Firma gehört oder das sie gemietet hat, wird ein weiterer Standort. */
  enterSite(companyId: string, parcelId: string): number {
    const company = this.require(companyId);
    const known = baseFloorOf(company, parcelId);
    if (known !== null) return known;
    const parcel = parcelById(parcelId);
    if (!parcel) throw new GameError('Dieses Grundstück gibt es nicht.', 404);
    const { town } = company;
    const open = parcel.kind === 'home' || town.rented.includes(parcel.id) || town.built.includes(parcel.id);
    if (!open) throw new GameError('Dieses Haus gehört dir nicht.');
    const locationId = parcel.kind === 'home' ? 'garage' : parcel.locationId;
    if (!locationId) throw new GameError('Hier gibt es keinen Raum.');
    town.extra ??= [];
    town.extra.push({ siteId: parcel.id, locationId });
    const base = town.extra.length * SITE_STEP;
    const building = buildingAt(town, parcel.id);
    const fresh = town.furnished.includes(locationId) ? [] : this.propsOf(locationId);
    if (!town.furnished.includes(locationId)) town.furnished.push(locationId);
    company.placed.push(...fresh.map((item) => ({ ...item, floor: base })), ...this.shaftItems(building).map((item) => ({ ...item, floor: base + floorOf(item) })));
    this.touch(company);
    return base;
  }

  private relocate(company: Company, locationId: LocationId, siteId: string, cost: number): void {
    if (baseFloorOf(company, siteId) !== null && siteId !== company.town.siteId) throw new GameError('Hier arbeitet deine Firma schon als weiterer Standort.');
    const targetBuilding = buildingAt(company.town, siteId);
    const target = roomAt(locationId, targetBuilding);
    if (company.locationId === locationId && company.town.siteId === siteId) throw new GameError('Deine Firma sitzt schon dort.');
    if (company.runs.some((r) => r.status === 'running') || company.orders.some((o) => o.status === 'running') || company.meetings.some((m) => m.status === 'running') || company.commands.some((c) => c.status === 'running')) {
      throw new GameError('Warte, bis alle Aufträge und Besprechungen angehalten oder fertig sind. Mitten in der Arbeit zieht niemand um.');
    }
    this.assertBuildPoints(company, cost);

    // Die Einrichtung des neuen Raums wird beim ersten Einzug ausgepackt, die des alten kommt ins Inventar.
    const placed: PlacedItem[] = company.town.furnished.includes(locationId) ? [] : this.propsOf(locationId);
    placed.push(...this.shaftItems(targetBuilding));
    const stored: PlacedItem[] = [];
    const tryPlace = (item: PlacedItem, i: number, j: number, rot: Rotation) => {
      const floor = Math.min(floorOf(item), targetBuilding.floors - 1);
      const candidate: PlacedItem = { ...item, i, j, rot };
      if (floor) candidate.floor = floor;
      else delete candidate.floor;
      if (!checkPlacement(roomAt(locationId, targetBuilding, floor), itemsOnFloor(placed, floor), candidate).ok) return false;
      placed.push(candidate);
      return true;
    };
    const elsewhere = company.placed.filter((item) => floorOf(item) >= SITE_STEP);
    for (const item of company.placed) {
      if (floorOf(item) >= SITE_STEP) continue;
      if (isShaft(item.kind)) continue;
      if (isProp(item.kind)) {
        stored.push(item);
        continue;
      }
      let done = tryPlace(item, item.i, item.j, item.rot);
      for (let j = 0; j < target.d && !done; j++) {
        for (let i = 0; i < target.w && !done; i++) done = tryPlace(item, i, j, item.rot);
      }
      if (done) continue;
      const sitter = company.agents.find((a) => a.deskId === item.id);
      if (sitter) throw new GameError(`Der Schreibtisch von ${sitter.name} passt nicht in den neuen Raum.`);
      stored.push(item);
    }
    // Abteilungen sind Bereiche des alten Grundrisses. Was in den neuen passt, bleibt; der Rest gibt sein Budget zurück.
    const kept: Department[] = [];
    for (const department of company.departments) {
      if (floorOf(department) >= SITE_STEP) {
        kept.push(department);
        continue;
      }
      const onFloor = floorOf(department) < targetBuilding.floors;
      if (onFloor && checkDepartment(roomAt(locationId, targetBuilding, floorOf(department)), kept.filter((d) => floorOf(d) === floorOf(department)), department).ok) kept.push(department);
      else this.notify(company, 'info', `Die Abteilung "${department.name}" passt nicht in den neuen Grundriss. Stecke sie neu ab; ihr Wissen bleibt erhalten.`);
    }
    company.departments = kept;
    company.placed = [...placed, ...elsewhere];
    company.inventory.push(...stored.map((item) => ({ id: item.id, kind: item.kind, at: Date.now() })));
    if (!company.town.furnished.includes(locationId)) company.town.furnished.push(locationId);
    if (stored.length) this.notify(company, 'info', `Im Inventar liegt jetzt: ${stored.map((item) => furnitureByKind(item.kind).title).join(', ')}. Von dort stellst du es wieder auf.`);
    company.locationId = locationId;
    company.town.siteId = siteId;
    this.spendBuildPoints(company, cost);
    this.notify(company, 'info', `Umgezogen: ${target.title}.`);
  }

  /* ---------- Läufe ---------- */

  private setLive(agent: Agent, kind: LiveKind, detail: string, runId: string | null, targetId: string | null = null): void {
    agent.live = { kind, detail, since: agent.live.kind === kind ? agent.live.since : Date.now(), runId, targetId } satisfies AgentLive;
  }

  private setIdleOrPending(company: Company, agent: Agent, override?: LiveKind): void {
    // Arbeitet der Agent gerade an etwas anderem, bestimmt allein dieser Lauf seinen Zustand.
    if (this.busy(company, agent.id)) return;
    const inMeeting = company.meetings.find((m) => m.status === 'running' && m.participantIds.includes(agent.id));
    if (inMeeting) {
      // Die Figur zeigt ihre eigene letzte Aussage, solange die anderen reden.
      const said = inMeeting.turns.filter((t) => t.agentId === agent.id).at(-1);
      this.setLive(agent, 'meeting', said?.short ?? 'hört zu', null);
      return;
    }
    const pending = company.orders.find((o) => o.agentId === agent.id && (o.status === 'review' || o.status === 'limit' || o.status === 'failed'));
    const proposal = company.meetings.find((m) => m.status === 'decision' && m.moderatorId === agent.id);
    const command = company.commands.find((c) => c.agentId === agent.id && c.status === 'pending');
    if (command && !override) {
      this.setLive(agent, 'review', 'wartet auf Freigabe eines Befehls', null);
      return;
    }
    const approvals = company.mandates.some((m) => m.status === 'active' && m.managerId === agent.id && (m.proposals.some((p) => p.status === 'pending') || m.contracts.some((c) => c.status === 'pending')));
    if (override) this.setLive(agent, override, 'Ergebnis abgenommen', null);
    else if (proposal) this.setLive(agent, 'review', 'wartet auf deine Entscheidung', null);
    else if (approvals) this.setLive(agent, 'review', 'wartet auf deine Freigabe', null);
    else if (pending?.status === 'review') this.setLive(agent, 'review', 'Ergebnis liegt in deiner Post', null);
    else if (pending?.status === 'limit') this.setLive(agent, 'limit', 'Limit erreicht, wartet auf dich', null);
    else if (pending?.status === 'failed') this.setLive(agent, 'error', 'Lauf fehlgeschlagen', null);
    else this.setLive(agent, 'idle', 'frei', null);
  }

  private async startRun(company: Company, agent: Agent, spec: {
    kind: RunKind; sprintId?: string; orderId: string | null; stageKind?: StageKind; meetingId?: string; departmentId?: string | null; mandateId?: string | null;
    prompt: string; limitEur: number; webAccess?: boolean; readOnly?: boolean; jsonSchema?: object | null; structuredLabel?: string;
  }): Promise<void> {
    if (company.projectDir && !fs.existsSync(company.projectDir)) {
      throw new GameError(`Der Projektordner ${company.projectDir} ist nicht mehr da. Ohne ihn startet kein Lauf.`);
    }
    const resting = this.restingUntil(agent);
    if (resting) throw new GameError(`${agent.name} hat Feierabend: Das Kontingent ist bis ${new Date(resting).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} leer.`);
    if (company.repo && !spec.orderId) this.syncRead(company);
    this.starting.add(agent.id);
    let fx: Fx;
    try {
      fx = await this.fxSource.get();
    } finally {
      this.starting.delete(agent.id);
    }
    this.fxNow = fx;
    const limitUsd = spec.limitEur / fx.eurPerUsd;
    // Eine neue Session liest das aktuelle Profil. Eine laufende kennt nur das vom ersten Lauf.
    const newSkills = agent.sessionStarted ? agent.skillIds.filter((id) => !agent.briefedSkillIds.includes(id)) : [];
    const newJob = agent.sessionStarted && agent.jobPending;
    if (!agent.sessionStarted) {
      agent.briefedSkillIds = [...agent.skillIds];
      agent.jobPending = false;
    }
    if (newSkills.length || newJob) spec = { ...spec, prompt: `${jobUpdate(agent, company, newSkills, newJob)}${spec.prompt}` };
    const run: Run & { pid?: number } = {
      id: `r${shortId()}`, agentId: agent.id, agentName: agent.name, orderId: spec.orderId, kind: spec.kind, sprintId: spec.sprintId ?? null, stageKind: spec.stageKind ?? null, meetingId: spec.meetingId ?? null,
      departmentId: spec.departmentId ?? null, mandateId: spec.mandateId ?? null, status: 'running',
      startedAt: Date.now(), endedAt: null, model: agent.modelId, modelUsed: null, sessionId: agent.sessionId, resumed: agent.sessionStarted,
      limitEur: spec.limitEur, limitUsd, usage: emptyUsage(), costUsd: 0, costSource: 'berechnet', fx, costEur: 0, durationMs: null, turns: 0,
      billing: this.providerInfo.billing ?? 'abo', denied: 0, files: [], prompt: spec.prompt, text: '', error: null, webAccess: Boolean(spec.webAccess), activity: [],
      briefedSkills: newSkills, briefedJob: newJob,
    };
    company.runs.push(run);
    if (spec.orderId) this.orderOf(company, spec.orderId).runIds.push(run.id);
    this.setLive(agent, 'starting', spec.kind === 'interview' ? 'kommt zum Vorstellungsgespräch' : 'nimmt die Arbeit auf', run.id);

    const roots = this.agentRoots(company);
    const before = snapshotFiles(roots);
    const handle = this.provider.start(
      {
        cwd: roots.workspace, prompt: spec.prompt, systemPrompt: `${agentProfile(company, agent)}\n\n${languageRule(this.settings?.language ?? 'en')}`, model: agent.modelId,
        sessionId: agent.sessionId, resume: agent.sessionStarted, limitUsd, sessionCostBefore: agent.sessionCostUsd, webAccess: Boolean(spec.webAccess),
        readOnly: Boolean(spec.readOnly) || Boolean(agent.origin?.readOnly), extraDirs: roots.projectDir ? [roots.projectDir] : [],
        jsonSchema: spec.jsonSchema ?? null, structuredLabel: spec.structuredLabel, rawLogPath: this.rawLogOf(company.id, run.id), timeoutMs: RULES.runTimeoutMs,
      },
      (event) => this.onEvent(company, agent, run, before, event),
    );
    run.pid = handle.pid ?? undefined;
    this.handles.set(run.id, handle);
    this.touch(company);
  }

  private onEvent(company: Company, agent: Agent, run: Run, before: FileSnapshot, event: ProviderEvent): void {
    switch (event.type) {
      case 'init':
        agent.sessionStarted = true;
        run.billing = this.providerInfo.testDouble ? 'test' : event.billing;
        run.activity.push({ at: Date.now(), kind: 'status', label: `Lauf gestartet mit ${event.model}. Werkzeuge: ${event.tools.join(', ')}` });
        if (event.connectors.length) {
          // Sollte nie passieren (--strict-mcp-config). Wenn doch, darf es nicht unsichtbar bleiben.
          run.activity.push({ at: Date.now(), kind: 'error', label: `Unerwartete Konnektoren: ${event.connectors.join(', ')}` });
        }
        break;
      case 'state':
        this.setLive(agent, event.kind, event.detail, run.id);
        break;
      case 'activity':
        run.activity.push({ at: Date.now(), ...event.entry });
        if (run.activity.length > MAX_ACTIVITY) run.activity.splice(0, run.activity.length - MAX_ACTIVITY);
        if (event.entry.kind === 'denied') run.denied += 1;
        break;
      case 'usage':
        if (event.contextTokens) agent.context = { tokens: event.contextTokens, at: Date.now() };
        run.usage = event.usage;
        run.costUsd = event.costUsd;
        run.costEur = event.costUsd * run.fx.eurPerUsd;
        // Die CLI prüft ihr Limit nur zwischen zwei Schritten. Ein einziger langer Schritt
        // liefe sonst weit darüber hinaus, deshalb stoppt der Wächter hier mitten im Schritt.
        if (run.status === 'running' && event.costUsd >= run.limitUsd) this.handles.get(run.id)?.stop('limit');
        break;
      case 'text':
        run.text = event.text.slice(-MAX_TEXT);
        if (agent.live.kind === 'answering') {
          const tail = event.text.replace(/\s+/g, ' ').slice(-90).trim();
          this.setLive(agent, 'answering', tail, run.id);
        }
        break;
      case 'plan':
        this.plan = event.plan;
        this.scheduleQuotaWake();
        try {
          fs.writeFileSync(path.join(this.dataDir, 'plan.json'), JSON.stringify(event.plan));
        } catch {
          // Der Stand kommt beim nächsten Lauf erneut
        }
        break;
      case 'end':
        this.finish(company, agent, run, before, event);
        break;
    }
    this.touch(company);
  }

  private orderFiles(company: Company, order: Order): string[] {
    const own = listFiles(this.workspaceOf(company.id), order.resultDir).map((f) => f.path);
    if (!order.git || !company.repo) return own;
    const worktree = path.join(this.workspaceOf(company.id), order.git.dir);
    if (!fs.existsSync(worktree)) return own;
    try {
      // Auch hier erst prüfen: Eine veränderte .git könnte Git auf ein anderes Repo lenken.
      git.assertIntact(company.repo.dir, worktree);
      return [...own, ...git.changedPaths(worktree).map((file) => `${order.git!.dir}/${file}`)];
    } catch {
      return own;
    }
  }

  private finish(company: Company, agent: Agent, run: Run, before: FileSnapshot, end: Extract<ProviderEvent, { type: 'end' }>): void {
    this.handles.delete(run.id);
    Object.assign(run, {
      status: end.status, endedAt: Date.now(), usage: end.usage, costUsd: end.costUsd, costSource: end.costSource,
      costEur: end.costUsd * run.fx.eurPerUsd, modelUsed: end.modelUsed ?? run.model, durationMs: end.durationMs,
      turns: end.turns, denied: Math.max(run.denied, end.denied), error: end.error, text: end.text.slice(-MAX_TEXT),
      files: [...changedFiles(this.agentRoots(company), before), ...this.branchFiles(company, run)],
    });
    this.appendLedger(company, run);
    if (end.sessionCostUsd !== null) agent.sessionCostUsd = end.sessionCostUsd;
    // Nur was wirklich in der Session angekommen ist, gilt als mitgeteilt. Sonst steht es im nächsten Lauf noch einmal da.
    if (run.status === 'success') {
      agent.briefedSkillIds = [...new Set([...agent.briefedSkillIds, ...(run.briefedSkills ?? [])])];
      if (run.briefedJob) agent.jobPending = false;
    }

    if (end.error && /No conversation found/i.test(end.error)) {
      // Die Session entstand nie (Stopp in den ersten Millisekunden). Der nächste Lauf beginnt neu.
      agent.sessionId = randomUUID();
      agent.sessionStarted = false;
      agent.sessionCostUsd = 0;
      agent.context = null;
    }

    this.takeNotes(company, agent, run);
    const commandRequest = this.takeCommandRequest(company, agent, run);
    if (commandRequest) run.commandId = commandRequest.id;
    // Ein Befehl geht vor: Beides zugleich liesse sich nicht sauber fortsetzen.
    if (!commandRequest && !this.takeHandover(company, agent, run)) this.takeHelp(company, agent, run);
    if (run.kind === 'interview') this.finishInterview(company, agent, run);
    else if (run.kind === 'chat') this.finishChat(company, agent, run);
    else if (run.kind === 'meeting') this.finishMeetingTurn(company, agent, run, end.structured);
    else if (run.kind === 'manage') this.finishManage(company, agent, run, end.structured);
    else if (run.kind === 'help') this.finishHelp(company, agent, run);
    else if (run.kind === 'planning') this.finishPlanning(company, agent, run, end.structured);
    else this.finishStage(company, agent, run, end.structured);
    this.persistNow(company);
    // Jemand ist frei geworden: Vielleicht wartet eine Stufe auf genau diesen Agenten.
    this.pump(company).catch((err) => {
      console.error(err);
      this.notify(company, 'error', `Die nächste Stufe konnte nicht starten: ${(err as Error).message}`);
    });
  }

  private finishInterview(company: Company, agent: Agent, run: Run): void {
    if (run.status === 'success') {
      agent.hired = true;
      agent.intro = run.text.trim();
      agent.chat.push({ at: Date.now(), from: 'agent', text: agent.intro, runId: run.id });
      this.setLive(agent, 'idle', 'frei', null);
      this.startTour(company, agent);
      return;
    }
    // Ohne erfolgreichen echten Lauf gibt es keinen Mitarbeiter. Der Verbrauch bleibt im Buch.
    company.agents = company.agents.filter((a) => a.id !== agent.id);
    fs.rmSync(path.join(this.workspaceOf(company.id), 'team', `${slugify(agent.name)}.md`), { force: true });
    this.notify(company, 'error', `${agent.name} konnte nicht eingestellt werden: ${run.error ?? 'Der Lauf wurde abgebrochen.'}`);
  }

  private finishChat(company: Company, agent: Agent, run: Run): void {
    const reply = run.status === 'success' ? run.text.trim() || (run.commandId ? 'Ich beantrage einen Befehl.' : '') : `(${run.error ?? 'Lauf abgebrochen.'})`;
    agent.chat.push({ at: Date.now(), from: 'agent', text: reply, runId: run.id });
    this.setIdleOrPending(company, agent);
  }

  private finishStage(company: Company, agent: Agent, run: Run, structured: unknown): void {
    const order = this.orderOf(company, run.orderId!);
    this.applyStageResult(company, order, agent, run, structured);
    if (!order.stopRequested) return;
    // Ein Stopp gilt auch dann, wenn der Lauf im selben Moment fertig wurde: Keine neue Stufe, kein neuer Verbrauch.
    order.stopRequested = false;
    if (order.status === 'running') {
      order.status = 'stopped';
      order.stages[order.stageIndex].status = 'stopped';
      this.cancelOrderCommand(company, order);
      this.setIdleOrPending(company, agent);
    }
  }

  private applyStageResult(company: Company, order: Order, agent: Agent, run: Run, structured: unknown): void {
    const stage = order.stages[order.stageIndex];
    const inResult = run.files.filter((f) => f.startsWith(`${order.resultDir}/`) || (order.git && f.startsWith(`${order.git.dir}/`)));
    stage.files = [...new Set([...stage.files, ...inResult])];
    order.files = this.orderFiles(company, order);

    if (run.status !== 'success') {
      if (run.text.trim() && stage.kind !== 'check') order.summary = run.text.trim();
      stage.status = run.status === 'limit' ? 'limit' : run.status === 'error' ? 'failed' : 'stopped';
      order.status = run.status === 'limit' ? 'limit' : run.status === 'error' ? 'failed' : 'stopped';
      if (run.status === 'error') this.notify(company, 'error', `${agent.name}: ${run.error}`);
      this.setIdleOrPending(company, agent);
      return;
    }
    if (stage.kind === 'check') {
      this.finishCheck(company, order, stage, agent, run, structured);
      return;
    }
    if (run.handover) {
      // Die Stufe ist nicht fertig: Sie läuft bei der neuen Person neu an oder bei dieser, wenn das nicht ging.
      stage.status = 'waiting';
      const { to, note } = run.handover;
      if (to) {
        stage.agentId = to;
        order.agentId = to;
        stage.instruction = `${this.stagePrompt(company, order, stage)}${handoverNote(agent.name, note)}`;
        this.handOff(company, agent, to, 'gibt den Zettel an');
      } else {
        stage.instruction = note;
        this.setIdleOrPending(company, agent);
      }
      return;
    }
    if (run.helpId) {
      // Die Stufe ist nicht fertig: Sie wartet auf die Antwort des Kollegen und läuft danach weiter.
      order.helpId = run.helpId;
      order.summary = run.text.trim() || order.summary;
      stage.status = 'waiting';
      this.setIdleOrPending(company, agent);
      return;
    }
    if (run.commandId) {
      // Die Stufe ist nicht fertig: Sie wartet auf die Entscheidung über den Befehl und läuft danach weiter.
      order.commandId = run.commandId;
      order.summary = run.text.trim() || order.summary;
      stage.status = 'waiting';
      this.setIdleOrPending(company, agent);
      return;
    }
    stage.summary = run.text.trim();
    order.summary = stage.summary;
    if (!stage.files.length && stage.summary) this.saveAnswer(company, order, stage);
    stage.status = 'done';

    const next = order.stages[order.stageIndex + 1];
    if (!next) {
      this.toReview(company, order, agent);
      return;
    }
    order.stageIndex += 1;
    order.agentId = next.agentId;
    next.status = 'waiting';
    this.handOff(company, agent, next.agentId, stage.kind === 'plan' ? 'bringt den Plan zu' : 'bringt das Ergebnis zu');
  }

  /** Ein Agent ohne Datei hat trotzdem etwas geliefert. Die nächste Stufe und der Mensch sollen es nutzen können. */
  private saveAnswer(company: Company, order: Order, stage: Stage): void {
    const rel = `${order.resultDir}/${stage.kind === 'plan' ? 'plan' : 'antwort'}.md`;
    fs.writeFileSync(path.join(this.workspaceOf(company.id), rel), `${stage.summary}\n`);
    stage.files = [rel];
    order.files = this.orderFiles(company, order);
    if (stage.kind === 'work') order.savedFromText = true;
  }

  private toReview(company: Company, order: Order, agent: Agent): void {
    order.status = 'review';
    order.agentId = agent.id;
    this.setIdleOrPending(company, agent);
  }

  private finishCheck(company: Company, order: Order, stage: Stage, agent: Agent, run: Run, structured: unknown): void {
    stage.checks += 1;
    const verdict: Verdict | null = parseVerdict(order, structured, stage.checks, `${order.resultDir}/pruefung-${stage.checks}.md`);
    if (!verdict) {
      run.error = 'Die Prüfung hat kein auswertbares Urteil geliefert.';
      stage.status = 'failed';
      order.status = 'failed';
      this.notify(company, 'error', `${agent.name}: ${run.error}`);
      this.setIdleOrPending(company, agent);
      return;
    }
    // Die Prüfung kann selbst nichts schreiben, deshalb legt der Server ihren Bericht ab.
    fs.writeFileSync(path.join(this.workspaceOf(company.id), verdict.file), verdictReport(order, verdict, agent.name));
    stage.verdict = verdict;
    stage.summary = verdict.summary;
    stage.files = [...new Set([...stage.files, verdict.file])];
    stage.status = 'done';
    order.files = this.orderFiles(company, order);

    if (verdict.passed) {
      this.toReview(company, order, agent);
    } else if (order.revisionsUsed < order.maxRevisions) {
      this.sendBack(company, order, agent, reworkPrompt(order, agent, verdict, order.revisionsUsed + 1), 'bringt die Mängel zu');
    } else {
      this.notify(company, 'info', `"${order.title}": Die Prüfung von ${agent.name} ist nicht bestanden, und die Korrekturrunden sind aufgebraucht. Die Entscheidung liegt bei dir.`);
      this.toReview(company, order, agent);
    }
  }
}

function assertRotation(rot: unknown): void {
  if (rot !== 0 && rot !== 1 && rot !== 2 && rot !== 3) throw new GameError('Ein Möbelstück lässt sich nur in vier Richtungen drehen.');
}

export interface OrderTeam {
  plan?: string | null;
  work: string;
  check?: string | null;
}

export interface OrderInput {
  team: OrderTeam;
  title: string;
  notes?: string;
  criteria: string[];
  limitEur: number;
  maxRevisions: number;
  webAccess?: boolean;
  startedBy?: 'leitung' | 'manager';
  /** Der Zettel von der Tafel, aus dem dieser Auftrag wird. */
  noteId?: string | null;
}

/** Aufträge aus Meilenstein 1 hatten genau einen Bearbeiter. Sie werden zu Aufträgen mit einer Stufe. */
function migrateOrders(company: Company): boolean {
  let changed = false;
  for (const order of company.orders) {
    if (order.departmentId === undefined) {
      changed = true;
      order.departmentId = null;
      order.mandateId = null;
      order.startedBy = 'leitung';
    }
    if (order.stages) continue;
    changed = true;
    const status = order.status;
    order.stages = [{
      id: shortId(), kind: 'work', agentId: order.agentId, instruction: null, isRevision: false,
      status: status === 'running' ? 'stopped' : status === 'failed' ? 'failed' : status === 'stopped' ? 'stopped' : status === 'limit' ? 'limit' : 'done',
      files: order.files, summary: order.summary, verdict: null, checks: 0,
    }];
    order.stageIndex = 0;
  }
  return changed;
}
