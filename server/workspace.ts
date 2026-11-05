// Der reale Arbeitsbereich einer Firma: ein Ordner mit Team, Wissen, Dateien, Aufträgen, Ergebnissen.
// Ein eingebundenes Projekt ist ein zweiter Ordner, der für Agenten und Oberfläche als "projekt/" erscheint.

import fs from 'node:fs';
import path from 'node:path';

export const WORKSPACE_DIRS = ['team', 'wissen', 'dateien', 'auftraege', 'ergebnisse', 'besprechungen'];
export const PROJECT_PREFIX = 'projekt';
export const BRANCHES_DIR = 'zweige';
export const READ_DIR = `${BRANCHES_DIR}/lesen`;

/** Ordner, die kein Agent und keine Liste braucht. Sie würden die Dateiliste sprengen. */
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', 'coverage']);
const MAX_FILES = 2000;

export function ensureWorkspace(root: string): void {
  for (const dir of WORKSPACE_DIRS) fs.mkdirSync(path.join(root, dir), { recursive: true });
}

export interface FileEntry {
  path: string;
  size: number;
  mtime: number;
}

export function listFiles(root: string, sub = '', out: FileEntry[] = []): FileEntry[] {
  const dir = path.join(root, sub);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    // Die Arbeitsordner der Branches zeigt die Post als Änderungen. In der Dateiliste wären sie ein zweites Repo.
    if (!sub && entry.name === BRANCHES_DIR) continue;
    const rel = sub ? `${sub}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) listFiles(root, rel, out);
    } else if (entry.isFile()) {
      const stat = fs.statSync(path.join(root, rel));
      out.push({ path: rel, size: stat.size, mtime: stat.mtimeMs });
    }
  }
  return out;
}

/** Arbeitsbereich und, falls vorhanden, Projekt: Die Pfade des Projekts tragen den Vorsatz "projekt/". */
export interface Roots {
  workspace: string;
  projectDir: string | null;
}

export function listAll(roots: Roots): FileEntry[] {
  const own = listFiles(roots.workspace);
  if (!roots.projectDir) return own;
  return [...own, ...listFiles(roots.projectDir).map((f) => ({ ...f, path: `${PROJECT_PREFIX}/${f.path}` }))];
}

export type FileSnapshot = Map<string, string>;

export const snapshotFiles = (roots: Roots): FileSnapshot =>
  new Map(listAll(roots).map((f) => [f.path, `${f.size}:${f.mtime}`]));

export const changedFiles = (roots: Roots, before: FileSnapshot): string[] =>
  listAll(roots)
    .filter((f) => before.get(f.path) !== `${f.size}:${f.mtime}`)
    .map((f) => f.path);

/** Löst einen relativen Pfad auf und weist alles ab, was aus dem Arbeitsbereich herausführt. */
export function safeResolve(root: string, rel: string): string | null {
  if (!rel || rel.includes('\0') || path.isAbsolute(rel)) return null;
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, rel);
  if (target !== realRoot && !target.startsWith(`${realRoot}${path.sep}`)) return null;
  try {
    const real = fs.realpathSync(target);
    if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) return null;
    return real;
  } catch {
    return null;
  }
}

/** Wie safeResolve, aber "projekt/..." führt in den Projektordner. "projekt" allein ist der Ordner selbst. */
export function resolveIn(roots: Roots, rel: string): string | null {
  if (rel === PROJECT_PREFIX || rel.startsWith(`${PROJECT_PREFIX}/`)) {
    if (!roots.projectDir) return null;
    const rest = rel.slice(PROJECT_PREFIX.length + 1);
    if (!rest) {
      try {
        return fs.realpathSync(roots.projectDir);
      } catch {
        return null;
      }
    }
    return safeResolve(roots.projectDir, rest);
  }
  return safeResolve(roots.workspace, rel);
}

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'x';
