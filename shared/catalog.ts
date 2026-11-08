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

/** Bereiche, nach denen der Baukasten Fähigkeiten und Aufgaben ordnet. */
export type SkillArea = 'scrum' | 'management' | 'finanzen' | 'entwicklung' | 'inhalte';

export const SKILL_AREAS: { id: SkillArea; title: string }[] = [
  { id: 'scrum', title: 'Scrum' },
  { id: 'management', title: 'Management' },
  { id: 'finanzen', title: 'Finanzen' },
  { id: 'entwicklung', title: 'Entwicklung' },
  { id: 'inhalte', title: 'Inhalte' },
];

export interface SkillInfo {
  id: string;
  title: string;
  blurb: string;
  instruction: string;
  area: SkillArea;
}

// Eine Fähigkeit ist eine echte Arbeitsanweisung: Sie landet wörtlich im Profil des Agenten.
export const SKILLS: SkillInfo[] = [
  {
    id: 'konzept',
    title: 'Konzepte',
    blurb: 'Macht aus einer Idee einen klaren Plan.',
    area: 'management',
    instruction:
      'Konzepte: Beginne mit dem Problem und der Zielgruppe. Trenne Fakten von Annahmen. Ende mit den nächsten drei konkreten Schritten.',
  },
  {
    id: 'prototyp',
    title: 'Klickbare Prototypen',
    blurb: 'Baut eigenständige HTML-Prototypen.',
    area: 'entwicklung',
    instruction:
      'Prototypen: Liefere eine einzige index.html mit eingebettetem CSS und JavaScript, ohne externe Abhängigkeiten. Sie muss per Doppelklick laufen und auf dem Handy bedienbar sein.',
  },
  {
    id: 'recherche',
    title: 'Recherche',
    blurb: 'Belegt Aussagen mit Quellen.',
    area: 'inhalte',
    instruction:
      'Recherche: Nenne zu jeder Tatsachenbehauptung die Quelle. Hast du keinen Webzugriff, kennzeichne Aussagen als ungeprüftes Vorwissen.',
  },
  {
    id: 'text',
    title: 'Texte',
    blurb: 'Schreibt klar und ohne Floskeln.',
    area: 'inhalte',
    instruction:
      'Texte: Schreibe kurze Sätze in aktiver Sprache. Sprich die Lesenden direkt an. Streiche jedes Wort, das nichts beiträgt.',
  },
  {
    id: 'backlog',
    title: 'Backlog',
    blurb: 'Ordnet Aufgaben nach Wert und Dringlichkeit.',
    area: 'scrum',
    instruction: 'Backlog: Ordne die Zettel so, dass oben steht, was dem Produkt jetzt am meisten bringt. Dringlich ist, was andere blockiert oder einen Fehler behebt, den Nutzer spüren. Begründe jede Einordnung in einem Satz.',
  },
  {
    id: 'scrum',
    title: 'Scrum',
    blurb: 'Plant Sprints und moderiert Retrospektiven.',
    area: 'scrum',
    instruction: 'Scrum: Wähle für einen Sprint wenige Zettel, die zu einem gemeinsamen Ziel führen. Plane nur, was im Budget liegt. In der Retrospektive benennst du, was gut lief, was nicht, und eine konkrete Änderung für den nächsten Sprint.',
  },
  {
    id: 'pruefung',
    title: 'Prüfung',
    blurb: 'Prüft Ergebnisse gegen die Abnahme.',
    area: 'entwicklung',
    instruction:
      'Prüfung: Gehe jedes Abnahmekriterium einzeln durch und vermerke Bestanden oder Nicht bestanden mit Begründung. Beschönige nichts.',
  },
  {
    id: 'fuehrung',
    title: 'Führung',
    blurb: 'Zerlegt Ziele in prüfbare Aufträge.',
    area: 'management',
    instruction:
      'Führung: Zerlege ein Ziel in wenige, klar abgegrenzte Aufträge mit Abnahmekriterien, die ein Mensch prüfen kann. Vergib jeden an die passende Rolle, halte das zugewiesene Budget ein und nenne offen, was du nicht entscheiden kannst.',
  },
  // Aus gängigen Berufsbildern: Scrum Guide und Scrum.org, Produkt- und Engineering-Management, Startup-Finanzen, Entwicklung.
  {
    id: 'refinement',
    title: 'Refinement',
    blurb: 'Schneidet Zettel klein und macht sie schätzbar.',
    area: 'scrum',
    instruction: 'Refinement: Schneide große Aufgaben in kleine, die einzeln Wert liefern. Jede bekommt prüfbare Abnahmekriterien und eine grobe Größe. Was unklar ist, benennst du als offene Frage, statt es zu raten.',
  },
  {
    id: 'moderation',
    title: 'Moderation',
    blurb: 'Leitet Planning, Review und Retrospektive.',
    area: 'scrum',
    instruction: 'Moderation: Halte Treffen kurz und beim Thema. Alle kommen zu Wort, am Ende steht ein klares Ergebnis mit Verantwortlichen. Hindernisse sammelst du und gibst sie an die Firmenleitung, wenn das Team sie nicht selbst lösen kann.',
  },
  {
    id: 'stakeholder',
    title: 'Stakeholder',
    blurb: 'Kennt Bedürfnisse und Einfluss der Beteiligten.',
    area: 'management',
    instruction: 'Stakeholder-Management: Benenne, wer betroffen ist, was diese Leute brauchen und wie viel Einfluss sie haben. Stimme Erwartungen früh ab und schreibe Zusagen auf, damit sie nachprüfbar sind.',
  },
  {
    id: 'roadmap',
    title: 'Roadmap',
    blurb: 'Ordnet Arbeit nach Themen und Zielen.',
    area: 'management',
    instruction: 'Roadmap: Ordne Arbeit nach Themen mit Ziel, nicht als Liste von Funktionen. Jedes Thema sagt, welches Problem es löst und woran man den Erfolg erkennt.',
  },
  {
    id: 'kennzahlen',
    title: 'Ziele und Kennzahlen',
    blurb: 'Macht Erfolg messbar.',
    area: 'management',
    instruction: 'Ziele und Kennzahlen: Formuliere Ziele so, dass man sie messen kann, mit Ausgangswert und Zielwert. Nenne nur Kennzahlen, die du aus echten Daten ableiten kannst, und kennzeichne Schätzungen.',
  },
  {
    id: 'budgetplanung',
    title: 'Budget und Forecast',
    blurb: 'Plant Ausgaben und vergleicht mit dem Ist.',
    area: 'finanzen',
    instruction: 'Budget und Forecast: Plane Einnahmen und Ausgaben für die nächsten Monate und vergleiche sie regelmäßig mit dem Ist. Abweichungen erklärst du mit Ursache. Annahmen stehen getrennt von Zahlen.',
  },
  {
    id: 'liquiditaet',
    title: 'Liquidität und Runway',
    blurb: 'Hat Zahlungsflüsse und Reichweite im Blick.',
    area: 'finanzen',
    instruction: 'Liquidität: Stelle Zu- und Abflüsse nach Monaten dar und berechne, wie lange das Geld reicht. Eine Firma kann auf dem Papier Gewinn machen und trotzdem zahlungsunfähig werden; darauf achtest du zuerst.',
  },
  {
    id: 'unitecon',
    title: 'Unit Economics',
    blurb: 'Rechnet Kosten und Ertrag je Kunde.',
    area: 'finanzen',
    instruction: 'Unit Economics: Rechne für einen Kunden oder ein Produkt Kundengewinnungskosten, Kundenwert und Amortisationszeit. Nenne jede Annahme mit Quelle oder als Schätzung.',
  },
  {
    id: 'buchhaltung',
    title: 'Buchhaltung und Reporting',
    blurb: 'Führt saubere Aufstellungen und Berichte.',
    area: 'finanzen',
    instruction: 'Buchhaltung und Reporting: Halte Aufstellungen vollständig und nachvollziehbar, jede Zahl mit Beleg oder Herkunft. Berichte sind kurz: Stand, Veränderung, Auffälligkeiten. Steuer- und Rechtsfragen kennzeichnest du als offen für Fachleute.',
  },
  {
    id: 'frontend',
    title: 'Frontend',
    blurb: 'Baut Oberflächen für Handy und Desktop.',
    area: 'entwicklung',
    instruction: 'Frontend: Baue Oberflächen, die auf Handy und Desktop bedienbar sind, mit Tastatur erreichbar und schnell geladen. Halte Komponenten klein und wiederverwendbar.',
  },
  {
    id: 'backend',
    title: 'Backend und APIs',
    blurb: 'Entwirft Schnittstellen und Abläufe.',
    area: 'entwicklung',
    instruction: 'Backend: Entwirf Schnittstellen mit klaren Eingaben, Ausgaben und Fehlern. Prüfe jede Eingabe, bevor du sie verwendest, und dokumentiere die Endpunkte kurz.',
  },
  {
    id: 'datenbank',
    title: 'Datenbanken',
    blurb: 'Modelliert und schützt Daten.',
    area: 'entwicklung',
    instruction: 'Datenbanken: Modelliere Daten so einfach wie möglich, mit eindeutigen Schlüsseln und klaren Beziehungen. Änderungen am Schema schreibst du als nachvollziehbare Migration.',
  },
  {
    id: 'tests',
    title: 'Automatisierte Tests',
    blurb: 'Sichert Verhalten mit Tests ab.',
    area: 'entwicklung',
    instruction: 'Tests: Schreibe zu jeder Änderung Tests, die das gewünschte Verhalten prüfen, auch Grenzfälle und Fehler. Ein Fehler bekommt zuerst einen Test, der ihn zeigt.',
  },
  {
    id: 'devops',
    title: 'CI/CD und Betrieb',
    blurb: 'Automatisiert Bauen, Testen und Ausliefern.',
    area: 'entwicklung',
    instruction: 'CI/CD: Beschreibe Bauen, Testen und Ausliefern als wiederholbare Schritte in Dateien. Geheimnisse gehören nie in den Code.',
  },
  {
    id: 'sicherheit',
    title: 'Sichere Entwicklung',
    blurb: 'Denkt Angriffe an jeder Schicht mit.',
    area: 'entwicklung',
    instruction: 'Sicherheit: Prüfe an jeder Schicht, wie man sie missbrauchen könnte: Eingaben, Rechte, gespeicherte Daten. Nenne gefundene Lücken mit Schweregrad und Vorschlag.',
  },
  {
    id: 'codereview',
    title: 'Code-Review',
    blurb: 'Prüft Code anderer auf Fehler und Lesbarkeit.',
    area: 'entwicklung',
    instruction: 'Code-Review: Prüfe fremden Code auf Fehler, Sicherheitslücken und Verständlichkeit. Jeder Hinweis nennt die Stelle, das Problem und einen konkreten Vorschlag.',
  },

];

/** Bausteine für die Aufgabe einer Stelle. Ein Baustein bringt die Fähigkeiten mit, die er braucht. */
export const TASK_BLOCKS: { id: string; area: SkillArea; text: string; skillIds: string[] }[] = [
  { id: 'backlog-pflegen', area: 'scrum', text: 'Hält das Backlog geordnet und bereitet Zettel für das Planning vor.', skillIds: ['backlog', 'refinement'] },
  { id: 'events-leiten', area: 'scrum', text: 'Moderiert Planning, Review und Retrospektive und räumt Hindernisse aus dem Weg.', skillIds: ['scrum', 'moderation'] },
  { id: 'ziel-verantworten', area: 'management', text: 'Verantwortet ein Produktziel und verteilt die Arbeit im Team.', skillIds: ['fuehrung'] },
  { id: 'roadmap-abstimmen', area: 'management', text: 'Stimmt Roadmap und Prioritäten mit den Stakeholdern ab.', skillIds: ['roadmap', 'stakeholder'] },
  { id: 'kennzahlen-fuehren', area: 'management', text: 'Legt messbare Ziele fest und berichtet, wie weit das Team ist.', skillIds: ['kennzahlen'] },
  { id: 'budget-planen', area: 'finanzen', text: 'Plant Budgets und Forecasts und meldet Abweichungen.', skillIds: ['budgetplanung'] },
  { id: 'liquiditaet-ueberwachen', area: 'finanzen', text: 'Überwacht Liquidität und Runway und warnt früh.', skillIds: ['liquiditaet'] },
  { id: 'unitecon-rechnen', area: 'finanzen', text: 'Rechnet Unit Economics für Produkte und Kanäle.', skillIds: ['unitecon'] },
  { id: 'buecher-fuehren', area: 'finanzen', text: 'Führt Aufstellungen und schreibt den Monatsbericht.', skillIds: ['buchhaltung'] },
  { id: 'oberflaechen-bauen', area: 'entwicklung', text: 'Baut Oberflächen, die auf Handy und Desktop funktionieren.', skillIds: ['frontend', 'prototyp'] },
  { id: 'apis-bauen', area: 'entwicklung', text: 'Baut APIs und Datenmodelle.', skillIds: ['backend', 'datenbank'] },
  { id: 'tests-schreiben', area: 'entwicklung', text: 'Schreibt automatisierte Tests und hält sie grün.', skillIds: ['tests'] },
  { id: 'code-pruefen', area: 'entwicklung', text: 'Prüft Code anderer auf Fehler und Sicherheitslücken.', skillIds: ['codereview', 'sicherheit'] },
  { id: 'auslieferung', area: 'entwicklung', text: 'Automatisiert Bauen, Testen und Ausliefern.', skillIds: ['devops'] },
  { id: 'texte-schreiben', area: 'inhalte', text: 'Schreibt Texte für Website und Produkt.', skillIds: ['text'] },
  { id: 'markt-recherchieren', area: 'inhalte', text: 'Recherchiert Markt und Wettbewerb mit Quellen.', skillIds: ['recherche'] },
  { id: 'konzepte-schreiben', area: 'inhalte', text: 'Macht aus Ideen Konzepte mit nächsten Schritten.', skillIds: ['konzept'] },
];

/** Erfahrung: wie selbstständig die Stelle arbeitet. Wird zur Anforderung. */
export const SENIORITY: { id: string; title: string; text: string }[] = [
  { id: 'junior', title: 'Junior', text: 'Arbeitet nach klaren Vorgaben und fragt bei Unklarheiten nach.' },
  { id: 'erfahren', title: 'Erfahren', text: 'Arbeitet selbstständig und schlägt Verbesserungen vor.' },
  { id: 'senior', title: 'Senior', text: 'Trifft Methoden- und Architekturentscheidungen selbst und leitet andere an.' },
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
    id: 'po',
    title: 'Product Owner',
    blurb: 'Ordnet das Backlog nach Dringlichkeit und hält das Planning mit dem Team.',
    instruction: 'Du bist Product Owner. Du hältst das Backlog geordnet, damit das Team immer am Wichtigsten arbeitet, und planst mit dem Team, was als Nächstes umgesetzt wird. Was gebaut wird, entscheiden die Stakeholder und die Firmenleitung.',
    skillIds: ['backlog'],
    modelId: 'claude-haiku-5-5',
    top: '#4f9fd8',
    criteria: ['Jeder Zettel hat eine Dringlichkeit', 'Jede Einordnung ist begründet', 'Oben steht, was andere blockiert'],
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
    title: 'Manager',
    blurb: 'Stakeholder mit eigenem Budget. Entscheidet selbst, was umgesetzt wird.',
    instruction: 'Du bist Manager und Stakeholder. Du entscheidest selbst, was in deinem Budget umgesetzt wird, machst daraus kleine, prüfbare Aufträge und gibst sie an die, die sie am besten können. Die Firmenleitung fragst du nur nach mehr Budget, und Strategievorschläge stimmst du mit ihr ab.',
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
  { kind: 'meeting', title: 'Besprechungsraum', blurb: 'Glasraum für bis zu vier Leute. Ohne ihn keine Besprechung.', cost: 80, size: '4 × 4 Felder' },
  { kind: 'plant', title: 'Pflanze', blurb: 'Macht das Büro wohnlicher.', cost: 10, size: '1 × 1 Feld' },
  { kind: 'door', title: 'Tür', blurb: 'Eine Tür in einer Kante. Räume brauchen eine, damit man hineinkommt. Klick auf eine Tür entfernt sie.', cost: 0, size: '1 Kante' },
  { kind: 'table', title: 'Besprechungstisch', blurb: 'Steht er in einem Raum, den du als Besprechungsraum benennst, finden dort Besprechungen statt.', cost: 40, size: '2 × 2 Felder' },
  { kind: 'window', title: 'Fensterwand', blurb: 'Wand mit breitem Fenster. Wie die Wand: Klick setzt den Anfang, ein zweiter zieht sie.', cost: 0, size: '1 Kante' },
  { kind: 'glass', title: 'Glaswand', blurb: 'Bodentief verglast. Trennt Räume, ohne sie zu verstecken.', cost: 0, size: '1 Kante' },
  { kind: 'sofa', title: 'Sofa', blurb: 'Für den Sozialbereich. Freie Agenten setzen sich gern hierhin.', cost: 0, size: '1 × 2 Felder' },
  { kind: 'beanbag', title: 'Sitzsack', blurb: 'Für Sozialbereich und Gaming-Raum.', cost: 0, size: '1 × 1 Feld' },
  { kind: 'arcade', title: 'Spielautomat', blurb: 'Im Gaming-Raum zocken freie Agenten hier.', cost: 0, size: '1 × 1 Feld' },
  { kind: 'board', title: 'Tafel', blurb: 'Zeigt die Zettel. In einer Abteilung nur die ihrer Leute, sonst alle.', cost: 0, size: '1 × 1 Feld' },
  { kind: 'wall', title: 'Wand', blurb: 'Mit gedrückter Maus ziehen. Klick auf eine Wand reißt sie ab.', cost: 0, size: '1 Kante' },
  { kind: 'half', title: 'Halbwand', blurb: 'Hüfthoch. Versperrt den Weg, trennt aber keine Räume.', cost: 0, size: '1 Kante' },
  { kind: 'fence', title: 'Geländer', blurb: 'Für Podeste und Galerien. Versperrt den Weg, trennt aber keine Räume.', cost: 0, size: '1 Kante' },
  { kind: 'steps', title: 'Stufen', blurb: 'Führen eine Höhenstufe hinauf. R dreht sie zur höheren Seite.', cost: 0, size: '1 × 1 Feld' },
  { kind: 'column', title: 'Säule', blurb: 'Trägt nichts, steht aber im Weg.', cost: 0, size: '1 × 1 Feld' },
  { kind: 'picture', title: 'Bild', blurb: 'Hängt an einer Wandseite.', cost: 0, size: 'An der Wand' },
  { kind: 'wallLamp', title: 'Wandlampe', blurb: 'Hängt an einer Wandseite.', cost: 0, size: 'An der Wand' },
  { kind: 'wallShelf', title: 'Wandregal', blurb: 'Hängt an einer Wandseite.', cost: 0, size: 'An der Wand' },
  { kind: 'clock', title: 'Wanduhr', blurb: 'Hängt an einer Wandseite.', cost: 0, size: 'An der Wand' },
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

/** Farben zum Anstreichen von Wänden. Die erste ist der Grundton. */
export const WALL_COLORS: { id: string; title: string; hex: string }[] = [
  { id: 'weiss', title: 'Weiß', hex: '#d9dee6' },
  { id: 'sand', title: 'Sand', hex: '#d8c8a8' },
  { id: 'salbei', title: 'Salbei', hex: '#a9c3a6' },
  { id: 'himmel', title: 'Himmel', hex: '#a8c4dc' },
  { id: 'koralle', title: 'Koralle', hex: '#e0a090' },
  { id: 'anthrazit', title: 'Anthrazit', hex: '#5a6270' },
];
export const wallColor = (id: string | undefined): string => WALL_COLORS.find((c) => c.id === id)?.hex ?? WALL_COLORS[0].hex;

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
  /** null: Startort. Sonst ein Ort, der sich ab einer bestimmten Teamgröße lohnt. */
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
    id: 'coworking',
    title: 'Shared Office',
    blurb: '10 × 8 Felder im Hinterhof. Für ein kleines Team, das aus dem Laden herauswächst.',
    w: 10,
    d: 8,
    door: { i: 5, j: 7 },
    props: [{ kind: 'sofa', i: 0, j: 5, w: 1, d: 2 }],
    startItems: [],
    moveCost: 0,
  },
  {
    id: 'fabrik',
    title: 'Alte Fabrikhalle',
    blurb: '16 × 12 Felder unter einem Sheddach. Viel Platz, die Räume ziehst du selbst.',
    w: 16,
    d: 12,
    door: { i: 8, j: 11 },
    props: [{ kind: 'lockers', i: 0, j: 0, w: 2, d: 1 }, { kind: 'workbench', i: 12, j: 0, w: 3, d: 1 }],
    startItems: [],
    moveCost: 0,
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
