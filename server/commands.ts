// Befehle, die ein Mensch freigegeben hat. Die Agenten selbst laufen weiter ohne Bash:
// Sie stellen nur einen Antrag im Text ihrer Antwort, ausgeführt wird er hier und erst nach der Freigabe.

import { spawn } from 'node:child_process';

const BLOCK = /<<<BEFEHL\s*\n([\s\S]*?)\n\s*BEFEHL>>>/;
const MAX_COMMAND = 2000;
const MAX_REASON = 500;
const OUTPUT_TAIL = 12000;

/** Nur diese Variablen sieht ein Befehl. API-Schlüssel und Ähnliches aus der Umgebung des Spiels wandern nicht mit. */
const ENV_KEYS = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TERM'];

export interface ParsedCommand {
  command: string;
  reason: string;
  /** Die Antwort ohne den Antrag. */
  text: string;
}

export function parseCommandRequest(text: string): ParsedCommand | null {
  const match = text.match(BLOCK);
  if (!match) return null;
  const lines = match[1].split('\n');
  const reasonAt = lines.findIndex((line) => /^\s*GRUND:/.test(line));
  const reason = reasonAt >= 0 ? lines[reasonAt].replace(/^\s*GRUND:\s*/, '').trim() : '';
  const command = lines.filter((_, index) => index !== reasonAt).join('\n').trim();
  if (!command || command.length > MAX_COMMAND) return null;
  return { command, reason: reason.slice(0, MAX_REASON), text: text.replace(BLOCK, '').trim() };
}

export interface ParsedNote {
  title: string;
  notes: string;
  criteria: string[];
  role: string;
}

const NOTE_BLOCK = /<<<ZETTEL\s*\n([\s\S]*?)\n?\s*ZETTEL>>>/g;

/** Zettel für die Tafel aus einer Antwort. Sie sind Vorschläge: Gestartet wird dadurch nichts. */
export function parseNotes(text: string, limit: number): { notes: ParsedNote[]; text: string } {
  const notes: ParsedNote[] = [];
  for (const match of text.matchAll(NOTE_BLOCK)) {
    const field = (name: string) => match[1].split('\n').filter((line) => line.trim().startsWith(`${name}:`)).map((line) => line.trim().slice(name.length + 1).trim()).filter(Boolean);
    const title = field('TITEL')[0]?.slice(0, 140);
    if (!title || notes.length >= limit) continue;
    notes.push({ title, role: field('ROLLE')[0]?.slice(0, 60) ?? '', notes: field('HINWEIS').join('\n').slice(0, 1000), criteria: field('KRITERIUM').slice(0, 5).map((c) => c.slice(0, 200)) });
  }
  return { notes, text: text.replace(NOTE_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim() };
}

const HELP_BLOCK = /<<<HILFE\s*\n([\s\S]*?)\n?\s*HILFE>>>/;

/** Eine Frage an einen Kollegen. Wen es gibt, prüft der Server. */
export function parseHelp(text: string): { to: string; question: string; text: string } | null {
  const match = text.match(HELP_BLOCK);
  if (!match) return null;
  const field = (name: string) => match[1].split('\n').find((line) => line.trim().startsWith(`${name}:`))?.trim().slice(name.length + 1).trim() ?? '';
  return { to: field('AN'), question: field('FRAGE').slice(0, 1500), text: text.replace(HELP_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim() };
}

const HANDOVER_BLOCK = /<<<WEITERGEBEN\s*\n([\s\S]*?)\n?\s*WEITERGEBEN>>>/;

/** Der Agent hält jemand anderen für besser geeignet. Ob das geht, entscheidet der Server. */
export function parseHandover(text: string): { to: string; reason: string; text: string } | null {
  const match = text.match(HANDOVER_BLOCK);
  if (!match) return null;
  const field = (name: string) => match[1].split('\n').find((line) => line.trim().startsWith(`${name}:`))?.trim().slice(name.length + 1).trim() ?? '';
  return { to: field('AN'), reason: field('GRUND').slice(0, 500), text: text.replace(HANDOVER_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim() };
}

export interface CommandResult {
  exitCode: number | null;
  output: string;
  truncated: boolean;
  durationMs: number;
  status: 'done' | 'failed' | 'stopped';
}

export interface CommandHandle {
  stop(): void;
}

export function runCommand(command: string, cwd: string, timeoutMs: number, done: (result: CommandResult) => void): CommandHandle {
  const started = Date.now();
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_KEYS) if (process.env[key]) env[key] = process.env[key];
  // Eine eigene Prozessgruppe, damit ein Stopp auch alles trifft, was der Befehl gestartet hat.
  const child = spawn('/bin/sh', ['-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  let truncated = false;
  let stopped = false;
  let finished = false;
  const collect = (chunk: Buffer) => {
    output += chunk.toString('utf8');
    if (output.length > OUTPUT_TAIL) {
      output = output.slice(-OUTPUT_TAIL);
      truncated = true;
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const kill = () => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Schon beendet
    }
  };
  const stop = () => {
    stopped = true;
    kill();
  };
  const timer = setTimeout(stop, timeoutMs);
  timer.unref();
  const finish = (exitCode: number | null, error?: string) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (error) output += `${output ? '\n' : ''}${error}`;
    done({ exitCode, output, truncated, durationMs: Date.now() - started, status: stopped ? 'stopped' : exitCode === 0 ? 'done' : 'failed' });
  };
  child.on('error', (err) => finish(null, err.message));
  child.on('close', (code) => finish(code));
  return { stop };
}
