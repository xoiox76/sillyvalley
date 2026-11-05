import type { FurnitureKind, LocationId, Look, PlacedItem, PropKind, Usage } from './types.ts';

// Listenpreise in USD pro Million Tokens.
// Quelle: https://platform.claude.com/docs/en/about-claude/pricing (Stand 2026-11-01)
export const PRICES_AS_OF = '2026-11-01';
export const PRICES_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';

export interface ModelPrice {
  input: number;
  write5m: number;
  write1h: number;
  read: number;
  output: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  providerId: string;
  blurb: string;
  price: ModelPrice;
  /** Laut CLI (modelUsage.contextWindow, maxOutputTokens), gemessen 2026-11-03. test:live prüft das erneut. */
  contextWindow: number;
  maxOutput: number;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'claude-haiku-5-5',
    label: 'Haiku 5.5',
    providerId: 'anthropic',
    blurb: 'Schnell und günstig. Gut für klar umrissene Aufgaben.',
    price: { input: 0.1, write5m: 0.125, write1h: 0.2, read: 0.01, output: 0.5 },
    contextWindow: 1_000_000,
    maxOutput: 128_000,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Sonnet 5.5',
    providerId: 'anthropic',
    blurb: 'Für Konzepte, Texte und Prototypen.',
    price: { input: 2, write5m: 2.5, write1h: 4, read: 0.1, output: 10 },
    contextWindow: 1_000_000,
    maxOutput: 128_000,
  },
  {
    id: 'claude-opus-5-5',
    label: 'Opus 5.5',
    providerId: 'anthropic',
    blurb: 'Für schwierige Aufgaben mit vielen Abwägungen.',
    price: { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
    contextWindow: 1_000_000,
    maxOutput: 128_000,
  },
  {
    id: 'claude-fable-5-1',
    label: 'Fable 5.1',
    providerId: 'anthropic',
    blurb: 'Das leistungsstärkste und teuerste Modell.',
    price: { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 },
    contextWindow: 1_000_000,
    maxOutput: 64_000,
  },
];

const BUILT_IN_MODELS = MODELS.length;

export const modelById = (id: string) => MODELS.find((m) => m.id === id);

/** Verbundene Anbieter ergänzen die Listen. Server und Oberfläche rufen das mit dem Stand der Einstellungen auf. */
export function setExtraModels(models: ModelInfo[], providers: { id: string; label: string }[]): void {
  MODELS.length = BUILT_IN_MODELS;
  MODELS.push(...models);
  PROVIDERS.length = 1;
  PROVIDERS.push(...providers);
}

/** Grobe Faustregel für Text, den noch kein Modell gezählt hat. Das Verbrauchsbuch nutzt immer die gemeldeten Tokens. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
export const estimateTokensOfChars = (chars: number) => Math.ceil(chars / 4);

/** Was der erste Lauf eines neuen Agenten ohne Aufgabe liest: CLI-Vorgaben und Profil, gemessen in echten Läufen (rund 4.500). */
export const BASE_CONTEXT_TOKENS = 4500;

/**
 * Schätzung für einen Arbeitsschritt: Der vorhandene Kontext wird aus dem Cache gelesen, neuer Text zum Schreibpreis
 * in den Cache geschrieben. Dazu kommt die Ausgabe, deren Länge vorher niemand kennt. Darum ist das eine Untergrenze.
 */
export function estimateStepUsd(modelId: string, contextTokens: number, newTokens: number): number {
  const price = modelById(modelId)?.price;
  if (!price) return 0;
  return (contextTokens * price.read + newTokens * price.write1h) / 1_000_000;
}

export const costFromUsage = (price: ModelPrice, u: Usage): number =>
  (u.input * price.input +
    u.output * price.output +
    u.cacheRead * price.read +
    u.cacheWrite5m * price.write5m +
    u.cacheWrite1h * price.write1h) /
  1_000_000;

export interface SkillInfo {
  id: string;
  title: string;
  blurb: string;
  instruction: string;
}

// Eine Fähigkeit ist eine echte Arbeitsanweisung: Sie landet wörtlich im Profil des Agenten.
export const SKILLS: SkillInfo[] = [
  {
    id: 'konzept',
    title: 'Konzepte',
    blurb: 'Macht aus einer Idee einen klaren Plan.',
    instruction:
      'Konzepte: Beginne mit dem Problem und der Zielgruppe. Trenne Fakten von Annahmen. Ende mit den nächsten drei konkreten Schritten.',
  },
  {
    id: 'prototyp',
    title: 'Klickbare Prototypen',
    blurb: 'Baut eigenständige HTML-Prototypen.',
    instruction:
      'Prototypen: Liefere eine einzige index.html mit eingebettetem CSS und JavaScript, ohne externe Abhängigkeiten. Sie muss per Doppelklick laufen und auf dem Handy bedienbar sein.',
  },
  {
    id: 'recherche',
    title: 'Recherche',
    blurb: 'Belegt Aussagen mit Quellen.',
    instruction:
      'Recherche: Nenne zu jeder Tatsachenbehauptung die Quelle. Hast du keinen Webzugriff, kennzeichne Aussagen als ungeprüftes Vorwissen.',
  },
  {
    id: 'text',
    title: 'Texte',
    blurb: 'Schreibt klar und ohne Floskeln.',
    instruction:
      'Texte: Schreibe kurze Sätze in aktiver Sprache. Sprich die Lesenden direkt an. Streiche jedes Wort, das nichts beiträgt.',
  },
  {
    id: 'scrum',
    title: 'Scrum',
    blurb: 'Plant Sprints und moderiert Retrospektiven.',
    instruction: 'Scrum: Wähle für einen Sprint wenige Zettel, die zu einem gemeinsamen Ziel führen. Plane nur, was im Budget liegt. In der Retrospektive benennst du, was gut lief, was nicht, und eine konkrete Änderung für den nächsten Sprint.',
  },
  {
    id: 'pruefung',
    title: 'Prüfung',
    blurb: 'Prüft Ergebnisse gegen die Abnahme.',
    instruction:
      'Prüfung: Gehe jedes Abnahmekriterium einzeln durch und vermerke Bestanden oder Nicht bestanden mit Begründung. Beschönige nichts.',
  },
  {
    id: 'fuehrung',
    title: 'Führung',
    blurb: 'Zerlegt Ziele in prüfbare Aufträge.',
    instruction:
      'Führung: Zerlege ein Ziel in wenige, klar abgegrenzte Aufträge mit Abnahmekriterien, die ein Mensch prüfen kann. Vergib jeden an die passende Rolle, halte das zugewiesene Budget ein und nenne offen, was du nicht entscheiden kannst.',
  },
];

export interface RoleInfo {
  id: string;
  title: string;
  blurb: string;
  instruction: string;
  skillIds: string[];
  modelId: string;
  top: string;
  /** Vorschlag für die Abnahme, wenn jemand mit dieser Rolle den Auftrag bearbeitet. Der Spieler passt ihn an. */
  criteria: string[];
}

export const ROLES: RoleInfo[] = [
  {
    id: 'planung',
    title: 'Planung',
    blurb: 'Zerlegt Ideen in Konzepte und nächste Schritte.',
    instruction: 'Du planst. Du machst aus vagen Ideen Dokumente, nach denen andere arbeiten können.',
    skillIds: ['konzept'],
    modelId: 'claude-sonnet-5-5',
    top: '#2fa58f',
    criteria: ['Das Konzept nennt Problem und Zielgruppe', 'Annahmen sind als Annahmen gekennzeichnet', 'Am Ende stehen die nächsten drei Schritte'],
  },
  {
    id: 'entwicklung',
    title: 'Entwicklung',
    blurb: 'Baut funktionierende Prototypen.',
    instruction: 'Du entwickelst. Du lieferst etwas, das man öffnen und ausprobieren kann.',
    skillIds: ['prototyp'],
    modelId: 'claude-sonnet-5-5',
    top: '#e4792b',
    criteria: ['Eine einzige index.html, die per Doppelklick läuft', 'Auf dem Handy bedienbar', 'Die wichtigste Funktion ist klickbar'],
  },
  {
    id: 'recherche',
    title: 'Recherche',
    blurb: 'Recherchiert und belegt mit Quellen.',
    instruction: 'Du recherchierst. Du trennst sauber zwischen Belegtem und Vermutetem.',
    skillIds: ['recherche'],
    modelId: 'claude-haiku-5-5',
    top: '#3f7fd0',
    criteria: ['Jede Tatsachenbehauptung nennt ihre Quelle', 'Belegtes und Vermutetes sind getrennt', 'Ein kurzes Fazit mit Empfehlung'],
  },
  {
    id: 'text',
    title: 'Text und Marke',
    blurb: 'Schreibt Namen, Botschaften und Texte.',
    instruction: 'Du schreibst. Du gibst der Firma eine Stimme, die Menschen verstehen.',
    skillIds: ['text'],
    modelId: 'claude-haiku-5-5',
    top: '#b05cc6',
    criteria: ['Kurze Sätze in aktiver Sprache', 'Spricht die Zielgruppe direkt an', 'Keine Floskeln und keine erfundenen Fakten'],
  },
  {
    id: 'pruefung',
    title: 'Prüfung',
    blurb: 'Prüft Ergebnisse gegen die Abnahme.',
    instruction: 'Du prüfst. Du bist freundlich im Ton und unbestechlich in der Sache.',
    skillIds: ['pruefung'],
    modelId: 'claude-haiku-5-5',
    top: '#3c6db5',
    criteria: ['Jedes Kriterium ist einzeln bewertet', 'Jede Bewertung hat eine Begründung', 'Mängel sind konkret und umsetzbar'],
  },
  {
    id: 'scrum',
    title: 'Scrum Master',
    blurb: 'Plant Sprints aus dem Backlog und moderiert die Retrospektive.',
    instruction: 'Du bist Scrum Master. Du machst aus dem Backlog einen Sprint, den das Team schaffen kann, und hilfst dem Team, aus jedem Sprint zu lernen. Du entscheidest nichts anstelle der Firmenleitung.',
    skillIds: ['scrum'],
    modelId: 'claude-haiku-5-5',
    top: '#d0569a',
    criteria: ['Der Sprint hat ein Ziel in einem Satz', 'Jeder Zettel im Sprint trägt zu diesem Ziel bei', 'Was nicht in den Sprint passt, bleibt im Backlog'],
  },
  {
    id: 'frei',
    title: 'Eigene Stelle',
    blurb: 'Nur das, was du in die Ausschreibung schreibst.',
    instruction: '',
    skillIds: [],
    modelId: 'claude-haiku-5-5',
    top: '#7f93a8',
    criteria: ['Das Ergebnis liegt als Datei vor', 'Es erfüllt die Aufgabe der Stelle'],
  },
  {
    id: 'fuehrung',
    title: 'Führung',
    blurb: 'Macht aus Zielen Aufträge und verteilt sie im Team.',
    instruction: 'Du führst ein Team. Du machst aus Zielen kleine, prüfbare Aufträge und gibst sie an die, die sie am besten können.',
    skillIds: ['fuehrung'],
    modelId: 'claude-sonnet-5-5',
    top: '#c9a227',
    criteria: ['Das Ziel ist in klar abgegrenzte Schritte zerlegt', 'Jeder Schritt hat eine zuständige Rolle', 'Offene Entscheidungen sind benannt'],
  },
];

export const roleById = (id: string) => ROLES.find((r) => r.id === id);
export const skillById = (id: string) => SKILLS.find((s) => s.id === id);

/** Warnhinweise für die Freigabe. Eine grobe Hilfe: Was hier nicht auftaucht, ist deshalb nicht harmlos. */
const COMMAND_RISKS: [RegExp, string][] = [
  [/\brm\s|\bfind\b.*-delete|\bdd\s|\bmkfs|\btruncate\b|\bgit\s+(clean|reset\s+--hard)/, 'Kann Dateien unwiderruflich löschen.'],
  [/\bsudo\b|\bchmod\b|\bchown\b/, 'Ändert Rechte oder läuft als Administrator.'],
  [/\bgit\s+(push|commit|merge|rebase|tag)\b/, 'Verändert das Git-Repository oder wirkt nach außen.'],
  [/\b(deploy|publish|release|upload|wrangler|fastlane|testflight|altool|vercel|netlify|kubectl|terraform|gh\s+(pr|release))\b/i, 'Kann etwas veröffentlichen oder ausliefern.'],
  [/\b(curl|wget|ssh|scp|rsync|nc|sftp)\b/, 'Spricht mit anderen Rechnern. Daten könnten abfließen.'],
  [/\|\s*(sh|bash|zsh)\b|\beval\b/, 'Führt weiteren, hier nicht sichtbaren Code aus.'],
  [/\b(npm|pnpm|yarn|pip3?|brew|gem|cargo|flutter\s+pub)\s+(i|add|install|get)\b/, 'Lädt und installiert fremden Code.'],
  [/\.env\b|\.ssh\b|credentials|secret|token|keychain|password/i, 'Berührt vermutlich Zugangsdaten.'],
  [/(^|[\s;&|])(cd\s+)?(\/|~)/, 'Nennt Pfade außerhalb des Projekts.'],
];

export const commandRisks = (command: string) => COMMAND_RISKS.filter(([pattern]) => pattern.test(command)).map(([, note]) => note);

/** Was jemand ist: der ausgeschriebene Stellentitel, sonst die Rolle. */
/** Wer gerade zur Firma gehört. Ehemalige stehen nur noch im Verlauf. */
export const staffOf = <T extends { firedAt?: number | null }>(company: { agents: T[] }): T[] => company.agents.filter((a) => !a.firedAt);

export const agentTitle = (agent: { roleId: string; job?: { title: string } | null }) =>
  agent.job?.title || roleById(agent.roleId)?.title || agent.roleId;

/** Titel einer Fähigkeit, egal ob aus dem Katalog oder von der Firma. */
export const skillTitle = (custom: { id: string; title: string }[], id: string) =>
  skillById(id)?.title ?? custom.find((s) => s.id === id)?.title ?? id;

/** Die Figur der Geschäftsführung, bis du sie änderst. */
export const DEFAULT_CEO = { name: 'Du', look: { hair: 'kurz', hairColor: '#5a3a26', top: '#f8b62d', skin: '#e6b48b', glasses: false } as Look };

export const NAME_IDEAS = ['Mila', 'Alex', 'Robin', 'Sam', 'Noa', 'Juno', 'Kim', 'Toni', 'Lou', 'Ari'];

export const LOOK_OPTIONS = {
  hair: ['kurz', 'lang', 'zopf', 'locken'] as Look['hair'][],
  hairColor: ['#3a2a22', '#5a3a26', '#1f1d24', '#d9a441', '#8d4a2b'],
  skin: ['#f3cfa9', '#e6b48b', '#c98d62', '#8d5a3c'],
};

export interface FurnitureInfo {
  kind: FurnitureKind;
  title: string;
  blurb: string;
  cost: number;
  size: string;
}

export const FURNITURE: FurnitureInfo[] = [
  { kind: 'desk', title: 'Schreibtisch', blurb: 'Ein Arbeitsplatz. Ohne freien Platz keine Einstellung.', cost: 40, size: '2 × 2 Felder' },
  { kind: 'ceoDesk', title: 'Chefschreibtisch', blurb: 'Dein Platz mit Pineapple-Laptop. Kostenlos, nur einmal, kein Platz für Mitarbeiter.', cost: 0, size: '2 × 2 Felder' },
  { kind: 'shelf', title: 'Regal', blurb: 'Hier liest dein Team im Firmenwissen.', cost: 25, size: '1 × 1 Feld' },
  { kind: 'coffee', title: 'Kaffeemaschine', blurb: 'Hier treffen sich freie Mitarbeiter.', cost: 20, size: '1 × 1 Feld' },
  { kind: 'meeting', title: 'Besprechungsraum', blurb: 'Glasraum für bis zu vier Leute. Ohne ihn keine Besprechung.', cost: 80, size: '3 × 3 Felder' },
  { kind: 'plant', title: 'Pflanze', blurb: 'Macht das Büro wohnlicher.', cost: 10, size: '1 × 1 Feld' },
];

/** Was schon im Raum steht. Es kostet nichts, lässt sich aber auch nicht nachkaufen. */
export const PROPS: (FurnitureInfo & { kind: PropKind; w: number; d: number })[] = [
  { kind: 'stairs', title: 'Treppe', blurb: '', cost: 0, size: '1 × 2 Felder', w: 1, d: 2 },
  { kind: 'lift', title: 'Fahrstuhl', blurb: '', cost: 0, size: '1 × 1 Feld', w: 1, d: 1 },
  { kind: 'bed', title: 'Bett', blurb: '', cost: 0, size: '2 × 3 Felder', w: 2, d: 3 },
  { kind: 'toybox', title: 'Spielzeugkiste', blurb: '', cost: 0, size: '1 × 1 Feld', w: 1, d: 1 },
  { kind: 'desk-kid', title: 'Kinderschreibtisch', blurb: '', cost: 0, size: '2 × 1 Felder', w: 2, d: 1 },
  { kind: 'workbench', title: 'Werkbank', blurb: '', cost: 0, size: '3 × 1 Felder', w: 3, d: 1 },
  { kind: 'boxes', title: 'Kisten', blurb: '', cost: 0, size: '1 × 1 Feld', w: 1, d: 1 },
  { kind: 'tires', title: 'Reifen', blurb: '', cost: 0, size: '1 × 1 Feld', w: 1, d: 1 },
  { kind: 'lockers', title: 'Spinde', blurb: '', cost: 0, size: '2 × 1 Felder', w: 2, d: 1 },
  { kind: 'sofa', title: 'Sofa', blurb: '', cost: 0, size: '1 × 2 Felder', w: 1, d: 2 },
];

export const isProp = (kind: FurnitureKind): kind is PropKind => PROPS.some((p) => p.kind === kind);

export const furnitureByKind = (kind: FurnitureKind): FurnitureInfo => FURNITURE.find((f) => f.kind === kind) ?? PROPS.find((p) => p.kind === kind)!;

export interface FixedProp {
  kind: PropKind;
  i: number;
  j: number;
  w: number;
  d: number;
}

export interface LocationInfo {
  id: LocationId;
  title: string;
  blurb: string;
  w: number;
  d: number;
  /** Feld, durch das neue Mitarbeiter hereinkommen. */
  /** Das Feld innen an der Haustür. Sie liegt in der vorderen Wand, zur Strasse. */
  door: { i: number; j: number };
  /** Felder, die frei und erreichbar bleiben müssen, etwa vor der Treppe. */
  keep?: { i: number; j: number }[];
  props: FixedProp[];
  startItems: Omit<PlacedItem, 'id'>[];
  /** null: Startort. Sonst Baupunkte für den Umzug. */
  moveCost: number | null;
}

export const LOCATIONS: LocationInfo[] = [
  {
    id: 'kinderzimmer',
    title: 'Kinderzimmer',
    blurb: 'Startort, 7 × 6 Felder.',
    w: 7,
    d: 6,
    door: { i: 5, j: 5 },
    props: [
      { kind: 'bed', i: 0, j: 0, w: 2, d: 3 },
      { kind: 'toybox', i: 0, j: 5, w: 1, d: 1 },
    ],
    startItems: [{ kind: 'desk', i: 3, j: 1, rot: 0 }],
    moveCost: null,
  },
  {
    id: 'garage',
    title: 'Garage',
    blurb: 'Startort, 8 × 6 Felder.',
    w: 8,
    d: 6,
    door: { i: 0, j: 5 },
    props: [
      { kind: 'workbench', i: 5, j: 0, w: 3, d: 1 },
      { kind: 'boxes', i: 0, j: 0, w: 1, d: 1 },
      { kind: 'tires', i: 7, j: 5, w: 1, d: 1 },
    ],
    startItems: [{ kind: 'desk', i: 2, j: 1, rot: 0 }],
    moveCost: null,
  },
  {
    id: 'eckladen',
    title: 'Eckladen',
    blurb: '9 × 7 Felder, Main Street.',
    w: 9,
    d: 7,
    door: { i: 4, j: 6 },
    props: [],
    startItems: [],
    moveCost: 60,
  },
  {
    id: 'kino',
    title: 'Altes Kino',
    blurb: '13 × 10 Felder.',
    w: 13,
    d: 10,
    door: { i: 6, j: 9 },
    props: [{ kind: 'sofa', i: 0, j: 8, w: 1, d: 2 }],
    startItems: [],
    moveCost: 260,
  },
  {
    id: 'neubau-klein',
    title: 'Eigener Neubau, klein',
    blurb: '10 × 8 Felder.',
    w: 10,
    d: 8,
    door: { i: 4, j: 7 },
    props: [],
    startItems: [],
    moveCost: 100,
  },
  {
    id: 'neubau-mittel',
    title: 'Eigener Neubau, mittel',
    blurb: '13 × 9 Felder.',
    w: 13,
    d: 9,
    door: { i: 6, j: 8 },
    props: [],
    startItems: [],
    moveCost: 180,
  },
  {
    id: 'neubau-gross',
    title: 'Eigener Neubau, groß',
    blurb: '15 × 11 Felder.',
    w: 15,
    d: 11,
    door: { i: 7, j: 10 },
    props: [],
    startItems: [],
    moveCost: 300,
  },
  {
    id: 'buero',
    title: 'Altes Postamt',
    blurb: '11 × 9 Felder.',
    w: 11,
    d: 9,
    door: { i: 5, j: 8 },
    props: [
      { kind: 'lockers', i: 5, j: 0, w: 2, d: 1 },
      { kind: 'sofa', i: 0, j: 7, w: 1, d: 2 },
    ],
    startItems: [],
    moveCost: 150,
  },
];

export const locationById = (id: LocationId) => LOCATIONS.find((l) => l.id === id)!;

export const RULES = {
  startBuildPoints: 60,
  /** Baupunkte gibt es nur für abgenommene Ergebnisse, nie für Verbrauch. */
  buildPointsPerAcceptedOrder: 30,
  /** Obergrenze für den kurzen, echten Lauf beim Einstellen. */
  interviewLimitEur: 0.5,
  chatLimitEur: 0.25,
  /** Eine Antwort darf höchstens so viele Zettel schreiben, an der Tafel hängen höchstens so viele. */
  /** Eine Antwort eines Kollegen kostet höchstens so viel, und ein Auftrag fragt höchstens so oft. */
  helpLimitEur: 0.15,
  /** Ein Planning kostet höchstens so viel, eine Retrospektive so viel, und in einen Sprint passen so viele Zettel. */
  planningLimitEur: 0.15,
  retroLimitEur: 0.25,
  sprintNotesMax: 8,
  helpsPerOrder: 3,
  /** So oft darf ein Auftrag weitergegeben werden. */
  handoversPerOrder: 2,
  notesPerRun: 10,
  notesOnBoard: 60,
  meetingMinParticipants: 2,
  meetingMaxParticipants: 4,
  meetingMaxRounds: 3,
  defaultOrderLimitEur: 1,
  defaultMaxRevisions: 2,
  runTimeoutMs: 10 * 60 * 1000,
  /** Eine Abteilung abzustecken kostet Baupunkte. Sie ist mindestens 2 × 2 Felder groß. */
  departmentCost: 30,
  departmentMinSize: 2,
  /** Eine Planungsrunde des Managers darf höchstens so viel vom Budget des Vorhabens nutzen. */
  manageLimitEur: 0.3,
  maxProposals: 4,
  /** Einstellungen, die ein Manager je Runde vorschlagen darf. Jede braucht einen unterzeichneten Vertrag. */
  maxContracts: 2,
  jobTextMax: 2000,
  commandTimeoutMs: 10 * 60 * 1000,
  /** So viel Ausgabe eines Befehls liest der Agent. Mehr kostet nur Kontext. */
  commandFeedbackChars: 6000,
  /** Für die Anzeige. Das vollständige Protokoll steht in befehle.jsonl. */
  commandsKept: 40,
  /** Eine Fähigkeit wird bei jedem Lauf mitgelesen. Die Grenze schützt das Budget vor einer versehentlich riesigen Datei. */
  skillTextMax: 20000,
};

/** Farben für Abteilungen, in dieser Reihenfolge vergeben. */
export const DEPARTMENT_COLORS = ['#2fa58f', '#e4792b', '#3f7fd0', '#b05cc6', '#c9a227', '#d13c35'];

export const PROVIDERS = [{ id: 'anthropic', label: 'Anthropic' }];
