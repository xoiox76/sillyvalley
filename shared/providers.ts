// Die Anbieter, die über eine OpenAI-kompatible Schnittstelle angebunden werden.
// Listenpreise nur, wo sie aus der offiziellen Preisliste stammen. Alle anderen trägt der Mensch selbst ein.

export type ConnectionKind = 'openai' | 'gemini' | 'mistral' | 'openrouter' | 'ollama' | 'lmstudio' | 'custom';

export interface KnownModel {
  remote: string;
  label: string;
  /** USD je Million Tokens. */
  input: number;
  cached: number;
  output: number;
  contextWindow: number;
}

export interface ConnectionKindInfo {
  id: ConnectionKind;
  label: string;
  baseUrl: string;
  needsKey: boolean;
  /** Lokale Modelle kosten keine Tokenpreise. */
  local: boolean;
}

export const CONNECTION_KINDS: ConnectionKindInfo[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true, local: false },
  { id: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, local: false },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', needsKey: true, local: false },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, local: false },
  { id: 'ollama', label: 'Ollama (lokal)', baseUrl: 'http://127.0.0.1:11434/v1', needsKey: false, local: true },
  { id: 'lmstudio', label: 'LM Studio (lokal)', baseUrl: 'http://127.0.0.1:1234/v1', needsKey: false, local: true },
  { id: 'custom', label: 'Eigener Endpunkt', baseUrl: '', needsKey: false, local: false },
];

export const connectionKind = (id: string) => CONNECTION_KINDS.find((k) => k.id === id);

// Quelle: https://developers.openai.com/api/docs/pricing (Standard, bis 272.000 Eingabe-Tokens, Stand 2026-11-05).
export const OPENAI_PRICES_AS_OF = '2026-11-05';
export const OPENAI_MODELS: KnownModel[] = [
  { remote: 'gpt-6-luna', label: 'GPT-6 Luna', input: 0.1, cached: 0.01, output: 0.5, contextWindow: 272_000 },
  { remote: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', input: 1, cached: 0.05, output: 5, contextWindow: 272_000 },
  { remote: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', input: 2, cached: 0.1, output: 10, contextWindow: 272_000 },
  { remote: 'gpt-6-astra', label: 'GPT-6 Astra', input: 10, cached: 1, output: 50, contextWindow: 272_000 },
];
