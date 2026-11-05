// Die Dateiwerkzeuge der Agenten. Jeder Pfad wird hier geprüft, nicht per Prompt erbeten.

import fs from 'node:fs';
import path from 'node:path';

const MAX_READ = 200_000;
const MAX_WRITE = 2_000_000;
const MAX_LIST = 500;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

export class Denied extends Error {}

/** Führt ein Werkzeug aus. Jeder Pfad muss nach dem Auflösen von Links in einem erlaubten Ordner liegen. */
export class Workspace {
  private readonly roots: string[];
  private readonly cwd: string;
  private readonly readOnly: boolean;

  constructor(cwd: string, extraDirs: string[], readOnly: boolean) {
    this.cwd = fs.realpathSync(cwd);
    this.roots = [this.cwd, ...extraDirs.filter((d) => fs.existsSync(d)).map((d) => fs.realpathSync(d))];
    this.readOnly = readOnly;
  }

  /** Auch eine neue Datei prüft den nächsten vorhandenen Elternordner. So führt kein Link hinaus. */
  private inside(rel: string): string {
    if (typeof rel !== 'string') throw new Denied('Pfad fehlt.');
    const target = path.resolve(this.cwd, rel);
    if (target.split(path.sep).includes('.git')) throw new Denied('Git bedient nur die Firmenleitung.');
    let existing = target;
    while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
    const real = path.join(fs.realpathSync(existing), path.relative(existing, target));
    if (!this.roots.some((root) => real === root || real.startsWith(`${root}${path.sep}`))) throw new Denied(`${rel} liegt ausserhalb des Arbeitsbereichs.`);
    return real;
  }

  private walk(start: string, out: string[]): void {
    for (const entry of fs.readdirSync(start, { withFileTypes: true })) {
      if (out.length >= MAX_LIST) return;
      if (SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(start, entry.name);
      if (entry.isDirectory()) this.walk(full, out);
      else if (entry.isFile()) out.push(full);
    }
  }

  private show = (full: string) => path.relative(this.cwd, full);

  run(name: string, args: Record<string, unknown>): string {
    if (name === 'read_file') {
      const file = this.inside(String(args.path));
      const text = fs.readFileSync(file, 'utf8');
      return text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n[gekürzt]` : text;
    }
    if (name === 'list_files') {
      const out: string[] = [];
      this.walk(this.inside(String(args.path ?? '.')), out);
      return out.map(this.show).join('\n') || '(leer)';
    }
    if (name === 'search_files') {
      const query = String(args.query ?? '');
      if (!query) throw new Denied('Suchtext fehlt.');
      const files: string[] = [];
      this.walk(this.inside(String(args.path ?? '.')), files);
      const hits: string[] = [];
      for (const file of files) {
        if (fs.statSync(file).size > MAX_READ) continue;
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
          if (hits.length < 200 && line.includes(query)) hits.push(`${this.show(file)}:${index + 1}: ${line.slice(0, 200)}`);
        });
      }
      return hits.join('\n') || '(nichts gefunden)';
    }
    if (name === 'write_file' || name === 'edit_file') {
      if (this.readOnly) throw new Denied('In diesem Lauf darfst du nur lesen.');
      const file = this.inside(String(args.path));
      if (name === 'write_file') {
        const content = String(args.content ?? '');
        if (content.length > MAX_WRITE) throw new Denied('Die Datei ist zu gross.');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        return 'Geschrieben.';
      }
      const before = fs.readFileSync(file, 'utf8');
      const old = String(args.old ?? '');
      if (!old || before.split(old).length !== 2) throw new Error('Der Text muss genau einmal vorkommen.');
      fs.writeFileSync(file, before.replace(old, () => String(args.new ?? '')));
      return 'Geändert.';
    }
    throw new Denied(`Das Werkzeug ${name} gibt es nicht.`);
  }
}
