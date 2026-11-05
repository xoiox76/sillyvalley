// Wechselkurs für die Euro-Anzeige. Agenten-Kosten werden in USD gemeldet.
// Jeder Lauf speichert den verwendeten Kurs, damit jede Buchung nachvollziehbar bleibt.

import fs from 'node:fs';
import path from 'node:path';
import type { Fx } from '../shared/types.ts';

const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function parseEcb(xml: string): { eurPerUsd: number; date: string } | null {
  const rate = xml.match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/)?.[1];
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  if (!rate || !date || Number(rate) <= 0) return null;
  return { eurPerUsd: 1 / Number(rate), date };
}

export type FxFetcher = () => Promise<string>;

const fetchEcb: FxFetcher = async () => {
  const res = await fetch(ECB_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`EZB antwortet ${res.status}`);
  return res.text();
};

export class FxSource {
  private readonly file: string;
  private readonly fetcher: FxFetcher;
  private current: Fx | null = null;
  private fetchedAt = 0;

  constructor(dataDir: string, fetcher: FxFetcher = fetchEcb) {
    this.file = path.join(dataDir, 'fx.json');
    this.fetcher = fetcher;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.current = { eurPerUsd: saved.eurPerUsd, date: saved.date, source: 'ezb-gespeichert' };
      this.fetchedAt = saved.fetchedAt ?? 0;
    } catch {
      // Noch kein gespeicherter Kurs
    }
  }

  async get(): Promise<Fx> {
    if (this.current && Date.now() - this.fetchedAt < MAX_AGE_MS) return this.current;
    try {
      const parsed = parseEcb(await this.fetcher());
      if (parsed) {
        this.current = { ...parsed, source: 'ezb' };
        this.fetchedAt = Date.now();
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify({ ...parsed, fetchedAt: this.fetchedAt }));
        return this.current;
      }
    } catch {
      // Unten greift der gespeicherte oder der Ersatzwert
    }
    if (this.current) return { ...this.current, source: 'ezb-gespeichert' };
    // Ohne jeden Kurs lieber zu hoch anzeigen als zu niedrig. Die Oberfläche weist darauf hin.
    return { eurPerUsd: 1, date: new Date().toISOString().slice(0, 10), source: 'ersatzwert' };
  }
}
