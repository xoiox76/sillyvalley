// Die Verbindungen zu Anbietern. Sie gelten für alle Firmen und liegen lokal in einer Datei, die nur der Benutzer lesen darf.
// Ein API-Schlüssel verlässt den Server nur in Richtung seines Anbieters: nicht zur Oberfläche, nicht in Logs, nicht zu den Agenten.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setExtraModels, type ModelInfo } from '../shared/catalog.ts';
import { OPENAI_MODELS, connectionKind, type ConnectionKind } from '../shared/providers.ts';
import type { ConnectionView } from '../shared/types.ts';

export class SettingsError extends Error {}

export const SUBSCRIPTION_ID = 'abo';

interface StoredModel {
  remote: string;
  label: string;
  input: number;
  cached: number;
  output: number;
  contextWindow: number;
}

interface Connection {
  id: string;
  kind: ConnectionKind;
  label: string;
  baseUrl: string;
  apiKey: string;
  available: string[];
  models: StoredModel[];
  checkedAt: number;
}

export interface ResolvedModel {
  baseUrl: string;
  apiKey: string;
  kind: ConnectionKind;
  remote: string;
  model: ModelInfo;
}

const isLocal = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

export type Language = 'en' | 'de';

export class Settings {
  private readonly file: string;
  private readonly languageFile: string;
  private currentLanguage: Language = 'en';
  private connections: Connection[] = [];
  private anthropicKey: string | null = null;
  private subscription: ModelInfo[] = [];
  private subscriptionInfo: { label: string; account: string | null; version: string | null } | null = null;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'verbindungen.json');
    this.languageFile = path.join(dataDir, 'sprache.json');
    try {
      if (JSON.parse(fs.readFileSync(this.languageFile, 'utf8')).language === 'de') this.currentLanguage = 'de';
    } catch {
      // Ohne Wahl gilt Englisch.
    }
    try {
      const stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.connections = stored.connections ?? [];
      this.anthropicKey = stored.anthropicKey ?? null;
    } catch {
      this.connections = [];
    }
    this.apply();
  }

  get language(): Language {
    return this.currentLanguage;
  }

  setLanguage(language: unknown): void {
    if (language !== 'en' && language !== 'de') throw new SettingsError('Diese Sprache gibt es nicht.');
    this.currentLanguage = language;
    fs.mkdirSync(path.dirname(this.languageFile), { recursive: true });
    fs.writeFileSync(this.languageFile, JSON.stringify({ language }));
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ connections: this.connections, anthropicKey: this.anthropicKey }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  private toInfo(connection: Connection, m: StoredModel): ModelInfo {
    return {
      id: `${connection.id}:${m.remote}`, label: m.label, providerId: connection.id, blurb: connection.label,
      price: { input: m.input, write5m: m.input, write1h: m.input, read: m.cached, output: m.output },
      contextWindow: m.contextWindow, maxOutput: 16_000,
    };
  }

  private apply(): void {
    setExtraModels(this.models(), [...(this.subscription.length ? [{ id: SUBSCRIPTION_ID, label: 'OpenAI' }] : []), ...this.connections.map((c) => ({ id: c.id, label: c.label }))]);
  }

  /** Wer lokal bei OpenAI angemeldet ist, arbeitet mit dem eigenen Abo. Das kostet keinen Schlüssel. */
  useSubscription(info: { account: string | null; version: string | null }): void {
    this.subscriptionInfo = { label: 'OpenAI', ...info };
    this.subscription = OPENAI_MODELS.map((m) => ({
      id: `${SUBSCRIPTION_ID}:${m.remote}`, label: m.label, providerId: SUBSCRIPTION_ID, blurb: 'OpenAI, dein Abo',
      price: { input: m.input, write5m: m.input, write1h: m.input, read: m.cached, output: m.output }, contextWindow: m.contextWindow, maxOutput: 16_000,
    }));
    this.apply();
  }

  subscriptions() {
    return this.subscriptionInfo ? [this.subscriptionInfo] : [];
  }

  /** Für alle, die lieber über einen Schlüssel als über ihr Abo abrechnen. */
  setAnthropicKey(apiKey: string | null): void {
    this.anthropicKey = apiKey?.trim() || null;
    this.persist();
  }

  getAnthropicKey = () => this.anthropicKey;
  anthropicKeyEnd = () => this.anthropicKey?.slice(-4) ?? null;

  views(): ConnectionView[] {
    return this.connections.map((c) => ({
      id: c.id, kind: c.kind, label: c.label, baseUrl: c.baseUrl, keyEnd: c.apiKey ? c.apiKey.slice(-4) : null, available: c.available,
      models: c.models.map((m) => ({ id: `${c.id}:${m.remote}`, ...m })), checkedAt: c.checkedAt,
    }));
  }

  models(): ModelInfo[] {
    return [...this.subscription, ...this.connections.flatMap((c) => c.models.map((m) => this.toInfo(c, m)))];
  }

  resolve(modelId: string): ResolvedModel | null {
    const connection = this.connections.find((c) => modelId.startsWith(`${c.id}:`));
    const stored = connection?.models.find((m) => `${connection.id}:${m.remote}` === modelId);
    if (!connection || !stored) return null;
    return { baseUrl: connection.baseUrl, apiKey: connection.apiKey, kind: connection.kind, remote: stored.remote, model: this.toInfo(connection, stored) };
  }

  /** Fragt den Anbieter nach seinen Modellen. So zeigt sich, ob Adresse und Schlüssel stimmen. */
  private async fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new SettingsError(`${baseUrl} ist nicht erreichbar.`);
    }
    if (res.status === 401 || res.status === 403) throw new SettingsError('Der Anbieter hat den Schlüssel abgelehnt.');
    if (!res.ok) throw new SettingsError(`Der Anbieter antwortet mit Status ${res.status}.`);
    const body = (await res.json().catch(() => null)) as { data?: { id?: unknown }[]; models?: { name?: unknown }[] } | null;
    const ids = (body?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
    return [...new Set(ids)].sort();
  }

  async addConnection(input: { kind?: string; apiKey?: string; baseUrl?: string; label?: string }): Promise<ConnectionView> {
    const kind = connectionKind(input.kind ?? '');
    if (!kind) throw new SettingsError('Diesen Anbieter gibt es nicht.');
    const baseUrl = (kind.id === 'custom' ? input.baseUrl?.trim() ?? '' : kind.baseUrl).replace(/\/+$/, '');
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new SettingsError('Gib die Adresse des Endpunkts an, zum Beispiel https://example.com/v1.');
    }
    // Ein Schlüssel geht nie unverschlüsselt durchs Netz.
    if (url.protocol !== 'https:' && !isLocal(url)) throw new SettingsError('Ausserhalb dieses Rechners sind nur https-Adressen erlaubt.');
    const apiKey = input.apiKey?.trim() ?? '';
    if (kind.needsKey && !apiKey) throw new SettingsError(`Für ${kind.label} brauchst du einen API-Schlüssel.`);
    const available = await this.fetchModels(baseUrl, apiKey);
    const label = kind.id === 'custom' ? input.label?.trim() || url.hostname : kind.label;
    const existing = this.connections.find((c) => c.baseUrl === baseUrl);
    const connection: Connection = existing ?? { id: `c${randomUUID().slice(0, 8)}`, kind: kind.id, label, baseUrl, apiKey, available, models: [], checkedAt: Date.now() };
    Object.assign(connection, { apiKey, available, checkedAt: Date.now() });
    if (!existing) this.connections.push(connection);
    // Für OpenAI gibt es offizielle Preise. Eingetragen wird nur, was dieses Konto wirklich anbietet.
    if (kind.id === 'openai') {
      for (const known of OPENAI_MODELS) {
        if (available.includes(known.remote) && !connection.models.some((m) => m.remote === known.remote)) connection.models.push({ ...known });
      }
    }
    this.persist();
    this.apply();
    return this.views().find((v) => v.id === connection.id)!;
  }

  removeConnection(id: string): void {
    this.connections = this.connections.filter((c) => c.id !== id);
    this.persist();
    this.apply();
  }

  addModel(connectionId: string, input: { remote?: string; label?: string; input?: number; cached?: number; output?: number; contextWindow?: number }): void {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection) throw new SettingsError('Diese Verbindung gibt es nicht.');
    const remote = input.remote?.trim();
    if (!remote) throw new SettingsError('Wähle ein Modell.');
    const price = (value: unknown) => Number(value);
    const [cost, cached, output] = [price(input.input), price(input.cached ?? input.input), price(input.output)];
    if (![cost, cached, output].every((n) => Number.isFinite(n) && n >= 0)) throw new SettingsError('Trage die Preise je Million Tokens ein. Lokale Modelle kosten 0.');
    if (!connectionKind(connection.kind)?.local && cost === 0 && output === 0) throw new SettingsError('Ohne Preise wäre der Verbrauch falsch. Trage die Listenpreise des Anbieters ein.');
    const contextWindow = Math.round(Number(input.contextWindow) || 128_000);
    const model: StoredModel = { remote, label: input.label?.trim() || remote, input: cost, cached, output, contextWindow };
    connection.models = [...connection.models.filter((m) => m.remote !== remote), model];
    this.persist();
    this.apply();
  }

  removeModel(connectionId: string, remote: string): void {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection) throw new SettingsError('Diese Verbindung gibt es nicht.');
    connection.models = connection.models.filter((m) => m.remote !== remote);
    this.persist();
    this.apply();
  }
}
