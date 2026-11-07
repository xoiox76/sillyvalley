import type { ModelInfo } from './catalog.ts';
// Datenmodell einer Firma. Der Server ist die einzige Quelle der Wahrheit;
// der Client zeichnet nur, was hier steht.

export type LocationId = 'kinderzimmer' | 'garage' | 'eckladen' | 'coworking' | 'buero' | 'fabrik' | 'kino' | 'neubau-klein' | 'neubau-mittel' | 'neubau-gross';
/** Was schon im Raum steht, wenn man einzieht. Es lässt sich verschieben, aber nicht kaufen. */
export type PropKind = 'stairs' | 'lift' | 'bed' | 'toybox' | 'desk-kid' | 'workbench' | 'boxes' | 'tires' | 'lockers' | 'sofa';
export type FurnitureKind = 'ceoDesk' | 'desk' | 'shelf' | 'coffee' | 'plant' | 'meeting' | 'wall' | 'door' | 'window' | 'glass' | 'table' | 'board' | 'arcade' | 'beanbag' | PropKind;

/** Ein Agent fragt einen Kollegen um Hilfe. Das sind zwei echte Läufe mit echtem Verbrauch, kein Bild. */
export interface HelpRequest {
  id: string;
  fromId: string;
  toId: string;
  question: string;
  answer: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  /** Der Auftrag, der auf die Antwort wartet. null: Es war ein Gespräch. */
  orderId: string | null;
  /** Wo sich die beiden treffen. null: Es gibt keinen freien Besprechungsraum. */
  roomId: string | null;
  /** Der Fragende hat die Antwort bekommen. */
  delivered: boolean;
  at: number;
}

export type NoteStatus = 'open' | 'later' | 'sprint' | 'taken' | 'dropped';

/** Ein Zettel auf der Tafel: eine Aufgabe, die ein Agent vorschlägt. Verteilt wird sie erst durch den Menschen. */
export interface BoardItem {
  id: string;
  title: string;
  /** Platz im Backlog, vom Product Owner geordnet. 0 ist ganz oben. Fehlt er, ist der Zettel noch nicht eingeordnet. */
  rank?: number;
  urgency?: Urgency;
  /** Warum der Product Owner ihn so eingeordnet hat. */
  urgencyReason?: string;
  notes: string;
  criteria: string[];
  /** Für wen der Agent die Aufgabe hält, in seinen Worten. */
  role: string;
  /** null: Die Firmenleitung hat den Zettel selbst geschrieben. */
  byAgentId: string | null;
  runId: string | null;
  status: NoteStatus;
  /** Was daraus wurde. */
  orderId: string | null;
  mandateId: string | null;
  at: number;
}

/** Ein Gegenstand, der gerade nicht im Raum steht. Von hier aus lässt er sich kostenlos neu platzieren. */
export interface StoredItem {
  id: string;
  kind: FurnitureKind;
  at: number;
}
export type Rotation = 0 | 1 | 2 | 3;

export interface PlacedItem {
  id: string;
  kind: FurnitureKind;
  i: number;
  j: number;
  rot: Rotation;
  /** Die Etage. Fehlt sie, steht der Gegenstand im Erdgeschoss. */
  floor?: number;
  /** Anstrich einer Wand oder Fensterwand. Fehlt er, ist sie weiß. */
  color?: string;
}

/** Was ein Agent gerade tatsächlich tut. Wird ausschließlich aus Ereignissen des Agenten-Prozesses abgeleitet. */
export type LiveKind =
  | 'idle'
  | 'starting'
  | 'thinking'
  | 'answering'
  | 'reading'
  | 'writing'
  | 'searching'
  | 'waiting'
  | 'handoff'
  | 'meeting'
  | 'review'
  | 'done'
  | 'limit'
  | 'error'
  | 'stopped';

export interface AgentLive {
  kind: LiveKind;
  detail: string;
  since: number;
  runId: string | null;
  /** Nur bei einer Übergabe: Zu wem die Figur gerade geht. */
  targetId?: string | null;
}

export interface Look {
  hair: 'kurz' | 'lang' | 'zopf' | 'locken';
  hairColor: string;
  top: string;
  skin: string;
  glasses: boolean;
}

export interface ChatLine {
  at: number;
  from: 'leitung' | 'agent';
  text: string;
  runId: string | null;
}

/** Die Stelle, wie der Mensch sie ausgeschrieben hat. Sie gibt dem Agenten eine konkrete Aufgabe. */
export interface Job {
  title: string;
  task: string;
  requirements: string;
}

/** Eine Fähigkeit, die der Mensch beschrieben oder als Markdown-Datei mitgebracht hat. Sie gehört der Firma. */
export interface CustomSkill {
  id: string;
  title: string;
  instruction: string;
  source: 'beschrieben' | 'datei';
  /** Die Fähigkeit als Datei im Arbeitsbereich. */
  file: string;
  createdAt: number;
}

/** Ein Subagent aus dem eingebundenen Projekt, wie er in .claude/agents/ steht. */
export interface ProjectAgent {
  name: string;
  file: string;
  description: string;
  /** Das Modell aus der Datei. null: Die Datei legt keines fest, der Mensch wählt. */
  modelId: string | null;
  /** Die Datei gibt keine Schreibwerkzeuge. Das bleibt auch im Spiel so. */
  readOnly: boolean;
  /** Die Datei erlaubt Befehle (Tests, Builds). Im Spiel sind sie gesperrt. */
  wantsCommands: boolean;
  blockedTools: string[];
  chars: number;
  /** Wer schon aus dieser Datei eingestellt wurde. */
  adoptedBy: string | null;
}

/** Woher ein Mitarbeiter stammt, wenn er aus einem Subagent des Projekts übernommen wurde. */
export interface AgentOrigin {
  file: string;
  readOnly: boolean;
  wantsCommands: boolean;
  blockedTools: string[];
}

export type CommandStatus = 'pending' | 'running' | 'done' | 'failed' | 'stopped' | 'declined' | 'cancelled';

/** Ein Befehl, den ein Agent beantragt. Er läuft erst, wenn der Mensch genau diesen Wortlaut freigibt. */
export interface CommandRequest {
  id: string;
  agentId: string;
  agentName: string;
  runId: string;
  orderId: string | null;
  command: string;
  reason: string;
  /** Warnhinweise zum Wortlaut. Sie helfen beim Hinsehen, ersetzen es aber nicht. */
  risks: string[];
  status: CommandStatus;
  at: number;
  decidedAt: number | null;
  durationMs: number | null;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  declineNote: string;
  /** Der Agent hat das Ergebnis schon erfahren. */
  delivered: boolean;
}

/** Eine benannte Gruppe von Mitarbeitern. Bei einem Vorhaben begrenzt sie, wen der Manager einplanen darf. */
export interface Team {
  id: string;
  name: string;
  purpose: string;
  memberIds: string[];
  /** Wer Aufgaben an das Team entgegennimmt und im Team verteilt. null: Der Mensch wählt es bei jeder Aufgabe. */
  leadId: string | null;
  createdAt: number;
}

/** Eine Rolle, wie die Geschäftsführung sie definiert: Stelle und Fähigkeiten, noch ohne Person. */
export interface CompanyRole {
  id: string;
  title: string;
  task: string;
  requirements: string;
  /** Die Vorlage aus dem Katalog. Sie gibt Grundhaltung, Kleidung und Vorschläge für die Abnahme. */
  baseRoleId: string;
  skillIds: string[];
  /** Das Modell, das beim Einstellen vorgeschlagen wird. */
  modelId: string;
  /** Die Farbe ihrer Zettel. Ohne Angabe gilt eine Voreinstellung. */
  color?: string | null;
  createdAt: number;
}

/** Wie voll das Gedächtnis eines Agenten ist: gemessen an der letzten Modellantwort seiner Session. */
export interface AgentContext {
  tokens: number;
  at: number;
}

export interface Agent {
  id: string;
  name: string;
  roleId: string;
  skillIds: string[];
  /** Was die Person bei der Einstellung mitgebracht hat. Der Rest ist dazugelernt. */
  startSkillIds: string[];
  providerId: string;
  modelId: string;
  look: Look;
  job: Job | null;
  /** Die definierte Rolle, aus der die Person stammt. Änderungen an der Rolle erreichen sie mit dem nächsten Lauf. */
  companyRoleId: string | null;
  origin: AgentOrigin | null;
  /** Fähigkeiten, die der Agent in seiner Session schon kennt. Sein Profil wird nur beim ersten Lauf gesetzt. */
  briefedSkillIds: string[];
  /** Die Stelle wurde nach dem ersten Lauf geändert und muss noch mitgeteilt werden. */
  jobPending: boolean;
  context: AgentContext | null;
  /** Persistente Provider-Session: Der Mitarbeiter behält sein Gedächtnis über Aufträge und Neustarts. */
  sessionId: string;
  sessionStarted: boolean;
  /** Letzte vom Anbieter gemeldete Summe dieser Session. Basis für Einzelpreis und Limit des nächsten Laufs. */
  sessionCostUsd: number;
  hiredAt: number;
  deskId: string;
  hired: boolean;
  /** Gekündigt: Die Person arbeitet nicht mehr hier. Der Eintrag bleibt, damit Verlauf und Kosten lesbar bleiben. */
  firedAt: number | null;
  /** Kollegen, deren Fähigkeiten die Person kennt. Nur sie stehen in ihren Anweisungen. */
  knownIds: string[];
  intro: string;
  live: AgentLive;
  chat: ChatLine[];
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface Fx {
  eurPerUsd: number;
  date: string;
  source: 'ezb' | 'ezb-gespeichert' | 'ersatzwert';
}

export type RunKind = 'interview' | 'order' | 'revision' | 'chat' | 'meeting' | 'manage' | 'help' | 'planning' | 'backlog';

/** Wie dringend ein Zettel ist. Der Product Owner legt das fest. */
export type Urgency = 'hoch' | 'mittel' | 'niedrig';
export type RunStatus = 'running' | 'success' | 'limit' | 'error' | 'stopped' | 'timeout' | 'interrupted';
export type Billing = 'abo' | 'api' | 'test';

export interface ActivityEntry {
  at: number;
  kind: 'tool' | 'denied' | 'status' | 'error';
  label: string;
}

export interface Run {
  id: string;
  agentId: string;
  agentName: string;
  orderId: string | null;
  kind: RunKind;
  /** Das Planning, zu dem dieser Lauf gehört. */
  sprintId?: string | null;
  stageKind?: StageKind | null;
  meetingId?: string | null;
  /** Der Befehl, den dieser Lauf beantragt hat. */
  commandId?: string | null;
  /** Die Anfrage, die dieser Lauf gestellt oder beantwortet hat. */
  helpId?: string | null;
  /** Der Agent gibt den Auftrag weiter. to fehlt, wenn das nicht ging. */
  handover?: { to: string | null; note: string };
  /** Die Firmenleitung hat um Zettel gebeten. Kommen keine, erfährt sie das. */
  expectNotes?: boolean;
  /** Der Lauf verarbeitet eine Antwort und darf nicht gleich wieder fragen. */
  helpFollowUp?: boolean;
  /** Was mit diesem Lauf nachgereicht wurde. Geht erst bei Erfolg in die Session ein. */
  briefedSkills?: string[];
  briefedJob?: boolean;
  /** Aus welchem Budget dieser Lauf bezahlt wird. null: das allgemeine Budget der Firma. */
  departmentId?: string | null;
  mandateId?: string | null;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  model: string;
  modelUsed: string | null;
  sessionId: string;
  resumed: boolean;
  limitEur: number;
  limitUsd: number;
  usage: Usage;
  costUsd: number;
  /** gemeldet = vom Anbieter am Laufende genannt. berechnet = Lauf ohne Abschluss, aus mitgezählten Tokens und Listenpreisen. */
  costSource: 'gemeldet' | 'berechnet';
  fx: Fx;
  costEur: number;
  durationMs: number | null;
  turns: number;
  billing: Billing;
  denied: number;
  files: string[];
  prompt: string;
  text: string;
  error: string | null;
  webAccess: boolean;
  activity: ActivityEntry[];
}

export type OrderStatus = 'running' | 'review' | 'accepted' | 'rejected' | 'failed' | 'stopped' | 'limit';

export type StageKind = 'plan' | 'work' | 'check';
export type StageStatus = 'waiting' | 'running' | 'done' | 'failed' | 'stopped' | 'limit';

export interface CriterionVerdict {
  met: boolean;
  reason: string;
}

/** Urteil einer Prüfstufe. Es entscheidet über den Rückweg, die Abnahme bleibt beim Menschen. */
export interface Verdict {
  passed: boolean;
  /** Gleiche Reihenfolge wie die Kriterien des Auftrags. */
  criteria: CriterionVerdict[];
  defects: string[];
  summary: string;
  at: number;
  file: string;
  round: number;
}

/** Eine Stufe des Ablaufs. Stufen geben nur Dateien weiter, jeder Agent bleibt in seiner eigenen Session. */
export interface Stage {
  id: string;
  kind: StageKind;
  agentId: string;
  status: StageStatus;
  /** Was der nächste Lauf dieser Stufe tun soll. Leer: der reguläre Auftrag der Stufe. */
  instruction: string | null;
  isRevision: boolean;
  files: string[];
  summary: string;
  verdict: Verdict | null;
  checks: number;
}

export interface Criterion {
  text: string;
  checked: boolean;
}

/** Der Branch eines Auftrags. Der Arbeitsordner liegt im Arbeitsbereich unter zweige/. */
export interface OrderGit {
  branch: string;
  dir: string;
  base: string;
  /** Gesetzt, sobald der Mensch abgenommen hat und committet wurde. */
  commit: string | null;
  pushedAt: number | null;
  prUrl: string | null;
}

/** Das Repo, an dem die Firma arbeitet. */
export interface CompanyRepo {
  dir: string;
  remote: string | null;
  branch: string;
  connectedAt: number;
}

export interface Order {
  git?: OrderGit | null;
  /** Gesetzt, wenn der Auftrag aus einem Sprint stammt. */
  sprintId?: string | null;
  /** Wer den Auftrag schon weitergegeben hat. Niemand bekommt ihn zurück, und er wandert nur begrenzt oft. */
  handedBy?: string[];
  /** Das Weitergeben wurde abgelehnt. Wer ihn jetzt hat, bearbeitet ihn. */
  handoverDenied?: boolean;
  /** Die Stufe wartet auf die Antwort eines Kollegen. */
  helpId?: string | null;
  id: string;
  title: string;
  notes: string;
  /** Wer gerade zuständig ist. Wechselt mit jeder Stufe. */
  agentId: string;
  /** Budget, aus dem der Auftrag bezahlt wird: eine Abteilung oder null für das allgemeine. Steht beim Start fest. */
  departmentId?: string | null;
  /** Gesetzt, wenn ein Manager den Auftrag im Rahmen eines Vorhabens geplant hat. */
  mandateId?: string | null;
  startedBy?: 'leitung' | 'manager';
  stages: Stage[];
  stageIndex: number;
  /** Der Mensch hat gestoppt. Gilt auch, wenn der laufende Schritt im selben Moment fertig wird. */
  stopRequested?: boolean;
  /** Die Stufe wartet auf die Entscheidung über diesen Befehl. */
  commandId?: string | null;
  criteria: Criterion[];
  limitEur: number;
  maxRevisions: number;
  revisionsUsed: number;
  webAccess: boolean;
  status: OrderStatus;
  createdAt: number;
  decidedAt: number | null;
  runIds: string[];
  resultDir: string;
  files: string[];
  summary: string;
  /** true, wenn der Agent keine Datei angelegt hat und der Server seine Antwort als Datei gesichert hat. */
  savedFromText: boolean;
  feedback: { at: number; text: string }[];
}

export type MeetingStatus = 'running' | 'decision' | 'closed' | 'stopped' | 'limit' | 'failed';

export interface MeetingTurn {
  id: string;
  round: number;
  agentId: string;
  runId: string;
  /** Die Kernaussage für die Sprechblase. Sie stammt aus der Antwort des Agenten, nie aus dem Spiel. */
  short: string;
  text: string;
  at: number;
}

export interface MeetingStep {
  task: string;
  role: string;
}

export interface MeetingOutcome {
  agreed: boolean;
  proposal: string;
  steps: MeetingStep[];
  openPoints: string[];
}

/** Mehrere Agenten, ein Thema, begrenzte Runden. Am Ende entscheidet der Mensch über den Vorschlag. */
export interface Meeting {
  id: string;
  topic: string;
  notes: string;
  participantIds: string[];
  moderatorId: string;
  roomId: string;
  /** Sitzen alle Teilnehmenden in einer Abteilung, zahlt sie. Sonst das allgemeine Budget. */
  departmentId?: string | null;
  maxRounds: number;
  round: number;
  speakerIndex: number;
  /** Läuft gerade ein Beitrag? Sonst wartet die Besprechung auf den nächsten Sprecher. */
  turnActive: boolean;
  stopRequested?: boolean;
  limitEur: number;
  status: MeetingStatus;
  createdAt: number;
  endedAt: number | null;
  turns: MeetingTurn[];
  outcome: MeetingOutcome | null;
  decision: 'accepted' | 'rejected' | null;
  protocolFile: string;
}

export interface Notice {
  id: string;
  at: number;
  level: 'info' | 'error';
  text: string;
}

/** Ein Bereich auf dem Boden. Wessen Schreibtischplatz darin liegt, gehört zur Abteilung: Umorganisieren heißt Möbel rücken. */
/** Was in einem Raum geschieht. Ein Raum entsteht aus Wänden und Türen, die Zone gibt ihm Zweck und Namen. */
export type ZoneKind = 'meeting' | 'break' | 'gaming' | 'lobby' | 'ceo' | 'other';

export type FloorStyle = 'holz' | 'teppich' | 'fliesen' | 'beton';

export interface Zone {
  id: string;
  kind: ZoneKind;
  name: string;
  /** Eigener Bodenbelag des Raums. Fehlt er, bleibt der Boden des Hauses. */
  floorStyle?: FloorStyle;
  /** Die Etage. Fehlt sie, liegt die Zone im Erdgeschoss. */
  floor?: number;
  /** Ein Feld im Raum. Der Raum selbst ergibt sich aus den Wänden drumherum. */
  i: number;
  j: number;
}

export interface Department {
  id: string;
  name: string;
  /** Die Etage. Fehlt sie, liegt die Abteilung im Erdgeschoss. */
  floor?: number;
  i: number;
  j: number;
  w: number;
  d: number;
  color: string;
  /** Teil des KI-Budgets, der nur dieser Abteilung gehört. Das allgemeine Budget ist der Rest. */
  budgetEur: number;
  /** Eigene Wissensablage unter wissen/. */
  knowledgeDir: string;
  createdAt: number;
}

export type ProposalStatus = 'pending' | 'started' | 'declined' | 'invalid';

/** Ein Auftrag, wie ihn der Manager vorschlägt. Erst eine Freigabe oder die Freigabe-Stufe macht daraus einen echten Auftrag. */
export interface Proposal {
  id: string;
  round: number;
  title: string;
  notes: string;
  criteria: string[];
  team: { plan: string | null; work: string; check: string | null };
  limitEur: number;
  reason: string;
  status: ProposalStatus;
  orderId: string | null;
  /** Warum der Server den Vorschlag nicht zugelassen hat. */
  invalidReason: string;
  at: number;
}

export type ContractStatus = 'pending' | 'signed' | 'declined' | 'invalid';

/** Eine Einstellung, die ein Manager vorschlägt. Sie wird erst wirksam, wenn der Mensch den Vertrag unterzeichnet. */
export interface Contract {
  id: string;
  round: number;
  name: string;
  roleId: string;
  /** Der Manager schlägt eine Rolle vor, die die Geschäftsführung definiert hat. */
  companyRoleId: string | null;
  skillIds: string[];
  modelId: string;
  reason: string;
  status: ContractStatus;
  /** Nach der Unterschrift: die eingestellte Person. */
  agentId: string | null;
  invalidReason: string;
  at: number;
  signedAt: number | null;
}

export interface MandateRound {
  round: number;
  runId: string;
  at: number;
  /** Was der Manager der Firmenleitung berichtet. Wörtlich aus seiner Antwort. */
  summary: string;
  open: string;
  /** Der Manager sieht das Ziel als erreicht. Ob das stimmt, entscheidet der Mensch. */
  done: boolean;
}

export type MandateStatus = 'planning' | 'active' | 'closed';

/** Der Manager entscheidet im Budget selbst. Mehr Geld erbittet er bei der Firmenleitung. */
export interface BudgetRequest {
  id: string;
  round: number;
  eur: number;
  reason: string;
  status: 'pending' | 'approved' | 'declined';
  at: number;
}

/** Ein Strategievorschlag des Managers, den er mit der Firmenleitung klärt. Ihre Antwort sieht er in der nächsten Runde. */
export interface StrategyProposal {
  id: string;
  round: number;
  title: string;
  text: string;
  status: 'pending' | 'accepted' | 'declined';
  answer: string;
  at: number;
}

/** Ein Ziel mit Budget, das der Mensch einem Manager überträgt. Der Manager plant, die Grenzen setzt der Server durch. */
export interface Mandate {
  id: string;
  goal: string;
  notes: string;
  managerId: string;
  departmentId: string | null;
  /** Gesetzt: Der Manager plant nur mit diesem Team. */
  teamId: string | null;
  budgetEur: number;
  /** Freigabe-Stufe: Aufträge bis zu diesem Limit startet der Manager selbst, alles darüber braucht den Menschen. 0: alles. */
  selfStartUpToEur: number;
  webAccess: boolean;
  status: MandateStatus;
  createdAt: number;
  closedAt: number | null;
  rounds: MandateRound[];
  proposals: Proposal[];
  contracts: Contract[];
  /** Die offene oder letzte Bitte um mehr Budget. */
  budgetRequest?: BudgetRequest | null;
  strategies?: StrategyProposal[];
  lastError: string | null;
  file: string;
}

/** planning: Der Scrum Master plant. proposed: Der Mensch entscheidet. review: beendet, die Retro steht noch aus. */
export type SprintStatus = 'planning' | 'proposed' | 'running' | 'review' | 'closed';

/** Ein Sprint ist ein Budgetrahmen für ausgewählte Zettel, keine Kalenderzeit: Agenten arbeiten nicht in Wochen. */
export interface Sprint {
  id: string;
  number: number;
  goal: string;
  /** Warum der Scrum Master das so vorschlägt. */
  reason: string;
  /** Obergrenze für die Limits der Aufträge im Sprint. */
  budgetEur: number;
  scrumMasterId: string;
  status: SprintStatus;
  noteIds: string[];
  /** Was die Firmenleitung dem Planning mitgegeben hat. */
  hint: string;
  error: string | null;
  retroMeetingId: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

/** Was der Firma in der Stadt gehört, und wo sie gerade sitzt. Grundstücke stehen in shared/town.ts. */
/** Was an einem eigenen Haus angebaut wurde. */
export interface Building {
  w: number;
  d: number;
  floors: number;
  /** Treppen und Fahrstühle. Sie stehen auf jeder Etage an derselben Stelle. */
  shafts: Shaft[];
}

export interface Shaft {
  kind: 'stairs' | 'lift';
  i: number;
  j: number;
  /** Das Feld davor. Es bleibt frei, und dort kommen die Figuren an. */
  landing: { i: number; j: number };
}

export interface TownState {
  buildings?: Record<string, Building>;
  /** Der Firmensitz. */
  siteId: string;
  /** Weitere Standorte, an denen die Firma ebenfalls arbeitet. Ihre Etagen beginnen bei 100, 200 und so weiter. */
  extra?: { siteId: string; locationId: LocationId }[];
  owned: string[];
  rented: string[];
  built: string[];
  /** Standorte, deren Einrichtung schon ausgepackt wurde. Sie kommt nur beim ersten Einzug in den Raum. */
  furnished: string[];
  /** Besuchte Städte und ihre Zufallszahl. Sie wird beim ersten Besuch gezogen und danach nicht mehr geändert. */
  citySalts?: Record<string, number>;
}

export interface Company {
  repo?: CompanyRepo | null;
  sprints: Sprint[];
  id: string;
  name: string;
  idea: string;
  locationId: LocationId;
  createdAt: number;
  /** Ein bestehender Ordner auf der Platte, an dem die Firma arbeitet. Für Agenten als "projekt/" sichtbar. null: nur der eigene Arbeitsbereich. */
  projectDir: string | null;
  budgetEur: number;
  buildPoints: number;
  town: TownState;
  placed: PlacedItem[];
  inventory: StoredItem[];
  board: BoardItem[];
  helps: HelpRequest[];
  departments: Department[];
  /** Benannte Räume. Ältere Spielstände haben noch keine. */
  zones?: Zone[];
  customSkills: CustomSkill[];
  roles: CompanyRole[];
  /** Du selbst als Figur. Fehlt es, gilt die Vorgabe. */
  ceo?: { name: string; look: Look };
  teams: Team[];
  commands: CommandRequest[];
  agents: Agent[];
  orders: Order[];
  meetings: Meeting[];
  mandates: Mandate[];
  runs: Run[];
  notices: Notice[];
}

export interface PlanWindow {
  utilization: number;
  resetsAt: number;
}

/** Stand des Abo-Kontingents, wie ihn der Agenten-Prozess selbst meldet. */
export interface PlanStatus {
  status: string;
  fiveHour: PlanWindow | null;
  sevenDay: PlanWindow | null;
  at: number;
}

export interface ProviderInfo {
  id: string;
  label: string;
  available: boolean;
  version: string | null;
  billing: Billing | null;
  account: string | null;
  error: string | null;
  testDouble: boolean;
}

/** Eine Verbindung, wie die Oberfläche sie sieht. Der Schlüssel selbst verlässt den Server nicht. */
export interface ConnectionView {
  id: string;
  kind: string;
  label: string;
  baseUrl: string;
  /** Die letzten vier Zeichen, damit man Schlüssel unterscheiden kann. */
  keyEnd: string | null;
  available: string[];
  models: { id: string; remote: string; label: string; input: number; cached: number; output: number; contextWindow: number }[];
  checkedAt: number;
}

export interface SystemInfo {
  /** Weitere Abos, mit denen dieser Rechner angemeldet ist. */
  subscriptions?: { label: string; account: string | null; version: string | null }[];
  /** Die letzten vier Zeichen eines hinterlegten Anthropic-Schlüssels. Null: Es zählt das Abo. */
  anthropicKeyEnd?: string | null;
  connections?: ConnectionView[];
  /** Die Modelle der Verbindungen, im Format des Katalogs. */
  extraModels?: ModelInfo[];
  provider: ProviderInfo;
  fx: Fx;
  plan: PlanStatus | null;
  /** Eigener Port für Agenten-Ergebnisse, damit sie nicht auf dem Ursprung des Spiels laufen. */
  artifactPort: number;
  /** Schalter zum Ausprobieren: Räume und Anbauten ohne Mindestgröße des Teams. */
  unlimitedBuild: boolean;
}

export interface Money {
  spentEur: number;
  reservedEur: number;
  remainingEur: number;
}

/** Ein Teilbudget: das allgemeine (id null) oder das einer Abteilung. */
export interface Pool extends Money {
  id: string | null;
  name: string;
  budgetEur: number;
}

export interface Snapshot {
  company: Company;
  money: Money;
  pools: Pool[];
  seats: { used: number; total: number };
  system: SystemInfo;
}

export interface CompanySummary {
  id: string;
  name: string;
  idea: string;
  locationId: LocationId;
  /** Das Grundstück in der Stadt, auf dem die Firma sitzt. */
  siteId: string;
  createdAt: number;
  projectDir: string | null;
  team: number;
  /** Wie viele Agenten gerade wirklich arbeiten. Die Mac-App fragt das vor dem Beenden. */
  runningAgents: number;
  spentEur: number;
  budgetEur: number;
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
