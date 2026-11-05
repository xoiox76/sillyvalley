// Schnittstelle zu einem Agenten-Anbieter. Ein weiterer Anbieter ist eine weitere Datei
// neben anthropic.ts; das Spiel selbst kennt nur diese Ereignisse.

import type { ActivityEntry, Billing, LiveKind, PlanStatus, ProviderInfo, RunStatus, Usage } from '../../shared/types.ts';

export interface RunSpec {
  cwd: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  sessionId: string;
  resume: boolean;
  limitUsd: number;
  /** Bisherige Session-Summe des Anbieters. Sein Limit und seine Kostenangabe zählen über die ganze Session. */
  sessionCostBefore: number;
  webAccess: boolean;
  /** Nur lesen: Eine Prüfung kann das, was sie prüft, nicht verändern. */
  readOnly: boolean;
  /** Weitere erlaubte Ordner neben dem Arbeitsbereich, etwa das eingebundene Projekt. Alles andere bleibt gesperrt. */
  extraDirs?: string[];
  /** Erzwingt eine strukturierte Abschlussantwort nach diesem Schema. */
  jsonSchema: object | null;
  /** Was die Figur zeigt, während das Modell die strukturierte Antwort schreibt. */
  structuredLabel?: string;
  rawLogPath: string;
  timeoutMs: number;
}

export type ProviderEvent =
  | { type: 'init'; sessionId: string; model: string; tools: string[]; connectors: string[]; billing: Billing }
  | { type: 'state'; kind: LiveKind; detail: string }
  | { type: 'activity'; entry: Omit<ActivityEntry, 'at'> }
  | { type: 'usage'; usage: Usage; costUsd: number; contextTokens?: number }
  | { type: 'text'; text: string }
  | { type: 'plan'; plan: PlanStatus }
  | {
      type: 'end';
      status: Exclude<RunStatus, 'running' | 'interrupted'>;
      text: string;
      structured: unknown;
      usage: Usage;
      costUsd: number;
      costSource: 'gemeldet' | 'berechnet';
      /** Neue Session-Summe laut Anbieter. Fehlt bei Läufen ohne Abschluss: Die zählt der Anbieter nicht mit. */
      sessionCostUsd: number | null;
      modelUsed: string | null;
      durationMs: number;
      turns: number;
      denied: number;
      error: string | null;
    };

export type StopReason = 'stopped' | 'timeout' | 'limit';

export interface RunHandle {
  pid: number | null;
  stop(reason: StopReason): void;
}

export interface Provider {
  id: string;
  detect(): Promise<ProviderInfo>;
  start(spec: RunSpec, on: (event: ProviderEvent) => void): RunHandle;
}
