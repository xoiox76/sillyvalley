// Git für die Firma. Nur der Server ruft das auf, Agenten haben weder Git noch einen Zugang zum Anbieter.
// Hooks und fsmonitor sind abgeschaltet: Agenten dürfen Dateien im Branch ändern, und daraus darf nichts ausgeführt werden.

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class GitError extends Error {}

const SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never'];
const env = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' });

/** Fehlermeldungen von Git, ohne Adressen, in denen ein Zugang stehen könnte. */
const clean = (text: string) => text.replace(/\/\/[^/@\s]+@/g, '//').trim().split('\n').slice(-3).join(' ').slice(0, 400);

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', [...SAFE, ...args], { cwd, env: env(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 50_000_000 });
  } catch (err) {
    throw new GitError(clean(String((err as { stderr?: string }).stderr ?? (err as Error).message)));
  }
}

function run(file: string, cwd: string, args: string[], timeout = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, env: env(), timeout, maxBuffer: 5_000_000 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return reject(new GitError(`${file} ist auf diesem Rechner nicht installiert.`));
      reject(new GitError(clean(stderr || err.message)));
    });
  });
}

export function isRepoRoot(dir: string): boolean {
  try {
    return fs.realpathSync(git(dir, ['rev-parse', '--show-toplevel']).trim()) === fs.realpathSync(dir);
  } catch {
    return false;
  }
}

export function remoteUrl(dir: string): string | null {
  try {
    return git(dir, ['remote', 'get-url', 'origin']).trim().replace(/\/\/[^/@]+@/, '//') || null;
  } catch {
    return null;
  }
}

export function defaultBranch(dir: string): string {
  try {
    return git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim().replace(/^origin\//, '');
  } catch {
    const current = git(dir, ['symbolic-ref', '--short', 'HEAD']).trim();
    if (!current) throw new GitError('Das Repo hat keinen Hauptbranch.');
    return current;
  }
}

/** Nur übliche Adressen. Git kennt auch Adressen, die Programme starten. */
export const isCloneUrl = (url: string) => /^(https:\/\/|ssh:\/\/|git@)[^\s]+$/.test(url);

export const clone = (url: string, target: string) => run('git', path.dirname(target), [...SAFE, 'clone', '--', url, target], 600_000);

/** Holt den Stand vom Anbieter, ändert aber keinen Arbeitsordner. Scheitert das, bleibt der letzte Stand. */
export const fetchQuietly = (dir: string) => run('git', dir, [...SAFE, 'fetch', '--quiet', 'origin']).then(() => true, () => false);

/** Der neueste bekannte Stand des Hauptbranchs, ohne den Checkout des Menschen anzufassen. */
export function baseOf(dir: string, branch: string): string {
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    try {
      return git(dir, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
    } catch {
      // Der nächste
    }
  }
  throw new GitError(`Den Branch ${branch} gibt es nicht. Hat das Repo schon einen Commit?`);
}

export function addWorktree(repo: string, worktree: string, branch: string, base: string): void {
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  git(repo, ['worktree', 'add', '--quiet', '-b', branch, worktree, base]);
}

/** Ein Ordner zum Lesen, ohne Branch. Was dort jemand ändert, verschwindet beim nächsten Abgleich. */
export function syncReadWorktree(repo: string, worktree: string, base: string): void {
  if (!fs.existsSync(path.join(worktree, '.git'))) {
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    git(repo, ['worktree', 'prune']);
    git(repo, ['worktree', 'add', '--quiet', '--detach', worktree, base]);
    return;
  }
  assertIntact(repo, worktree);
  git(worktree, ['reset', '--quiet', '--hard', base]);
  git(worktree, ['clean', '--quiet', '-fd']);
}

/** Ein Agent kann Dateien im Arbeitsordner ändern, auch die Datei .git. Sie darf nur auf dieses Repo zeigen. */
export function assertIntact(repo: string, worktree: string): void {
  const common = fs.realpathSync(git(repo, ['rev-parse', '--git-common-dir']).trim().replace(/^(?!\/)/, `${repo}/`));
  let pointer = '';
  try {
    pointer = fs.readFileSync(path.join(worktree, '.git'), 'utf8').trim();
  } catch {
    throw new GitError('Der Arbeitsordner des Auftrags ist beschädigt. Git bleibt dort gesperrt.');
  }
  const target = pointer.replace(/^gitdir:\s*/, '');
  if (!pointer.startsWith('gitdir:') || !target.startsWith(`${path.join(common, 'worktrees')}${path.sep}`)) {
    throw new GitError('Die Datei .git im Arbeitsordner wurde verändert. Git bleibt dort gesperrt.');
  }
}

export function removeWorktree(repo: string, worktree: string): void {
  if (fs.existsSync(worktree)) git(repo, ['worktree', 'remove', '--force', worktree]);
  git(repo, ['worktree', 'prune']);
}

export function deleteBranch(repo: string, branch: string): void {
  git(repo, ['branch', '--quiet', '-D', branch]);
}

/** Geänderte und neue Dateien, ohne gelöschte. Was die .gitignore ausschliesst, zählt nicht. */
export function changedPaths(worktree: string): string[] {
  const entries = git(worktree, ['status', '--porcelain', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const code = entries[i].slice(0, 2);
    if (code.startsWith('R')) i += 1;
    if (!code.includes('D')) out.push(entries[i].slice(3));
  }
  return out;
}

const MAX_DIFF = 400_000;

/** Was der Branch gegenüber seinem Ausgangspunkt ändert, auch neue Dateien. Der Index wird dafür nur vorgemerkt. */
export function diffOf(worktree: string, base: string): string {
  git(worktree, ['add', '--intent-to-add', '--all']);
  const text = git(worktree, ['diff', '--no-ext-diff', '--no-textconv', base]);
  return text.length > MAX_DIFF ? `${text.slice(0, MAX_DIFF)}\n[gekürzt]` : text;
}

/** Commit unter dem Namen des Agenten. So landet keine persönliche Adresse im Repo. */
export function commitAll(worktree: string, message: string, authorName: string): string | null {
  git(worktree, ['add', '--all']);
  if (!git(worktree, ['diff', '--cached', '--name-only']).trim()) return null;
  git(worktree, ['-c', `user.name=${authorName}`, '-c', 'user.email=agent@sillyvalley.invalid', 'commit', '--quiet', '--no-gpg-sign', '-m', message]);
  return git(worktree, ['rev-parse', 'HEAD']).trim();
}

/** Nie mit force. Ein Branch gehört genau einem Auftrag. */
export const pushBranch = (repo: string, branch: string) => run('git', repo, [...SAFE, 'push', '--quiet', 'origin', `refs/heads/${branch}:refs/heads/${branch}`]);

export async function openPullRequest(repo: string, branch: string, base: string, title: string, body: string): Promise<string> {
  const out = await run('gh', repo, ['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body', body]);
  return out.trim().split('\n').pop() ?? '';
}
