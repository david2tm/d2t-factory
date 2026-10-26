// All git runs in the CLI (AD-8), unlocked: identity (AD-9), the base commit, the brownfield
// probes, the worktree (AD-15), the per-step commits (AD-30) and the merge.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { FactoryError } from '../core/errors.ts';

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function gitOrThrow(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new FactoryError('BAD_ARGS', `git ${args.join(' ')} failed in ${cwd}: ${(r.stderr || r.error?.message || '').trim()}`);
  return r.stdout;
}

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

// realpath of the git common dir. In a linked worktree git already returns it absolute.
export function commonDir(cwd: string): string {
  const dir = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!dir) throw new FactoryError('BAD_ARGS', `${cwd} is not inside a git repository`);
  return realpathSync(dir);
}

// First 12 hex of sha256(realpath(git common dir)). The path comes back absolute, never joined onto cwd.
export function repoHash(cwd: string): string {
  return sha256(commonDir(cwd)).slice(0, 12);
}

// The main checkout's root: the common dir's parent, from the main checkout or any worktree.
export const repoRoot = (cwd: string): string => dirname(commonDir(cwd));

export function headSha(cwd: string): string {
  const sha = git(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!sha) throw new FactoryError('BAD_ARGS', `${cwd} has no commit yet`);
  return sha;
}
export const head = headSha;

// `git status --porcelain=v2` of a checkout and its digest (the brownfield baseline, AD-8).
export function statusDigest(root: string): { digest: string; command: string } {
  return { digest: sha256(gitOrThrow(root, ['status', '--porcelain=v2'])), command: 'git status --porcelain=v2' };
}

// No tracked file changed (untracked and ignored files don't count).
export function trackedClean(root: string): boolean {
  return gitOrThrow(root, ['status', '--porcelain=v2', '--untracked-files=no']).trim() === '';
}

export function checkIgnored(root: string, rel: string): boolean {
  return spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: root, stdio: 'ignore' }).status === 0;
}

// Is `path` the top of a git worktree?
export function isWorktreeTop(path: string): boolean {
  const top = git(path, ['rev-parse', '--show-toplevel']);
  if (!top) return false;
  try { return realpathSync(top) === realpathSync(path); } catch { return false; }
}

// `git worktree add <path> -b <branch> <base>`, or onto an existing branch on a retry.
export function worktreeAdd(root: string, path: string, branch: string, base: string): void {
  const exists = git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null;
  gitOrThrow(root, exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', path, '-b', branch, base]);
}

// --- greenfield (AD-9, 5-2) ------------------------------------------------------------------

// The empty tree's id in this repo's hash format.
export const emptyTree = (cwd: string): string => gitOrThrow(cwd, ['hash-object', '-t', 'tree', '/dev/null']).trim();

export const insideRepo = (cwd: string): boolean => git(cwd, ['rev-parse', '--git-dir']) !== null;

// AD-9: a non-git cwd gets `git init`; a repo with no commit gets the empty commit `factory: init`,
// built from the empty tree (never the index, so anything staged stays staged and uncommitted) and
// set as HEAD's branch. A repo with a commit is left alone.
export function initGreenfield(cwd: string): void {
  if (!insideRepo(cwd)) gitOrThrow(cwd, ['init', '-q']);
  if (git(cwd, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'])) return;
  const tree = gitOrThrow(cwd, ['hash-object', '-w', '-t', 'tree', '/dev/null']).trim();
  const sha = gitOrThrow(cwd, [...identity(cwd), 'commit-tree', tree, '-m', 'factory: init']).trim();
  gitOrThrow(cwd, ['update-ref', '-m', 'factory: init', 'HEAD', sha]);
}

// HEAD's tree is the empty tree: a greenfield run (5-2).
export const headTreeEmpty = (cwd: string): boolean => git(cwd, ['rev-parse', '--verify', '-q', 'HEAD^{tree}']) === emptyTree(cwd);

// Any change in a checkout, untracked files included (ignored files don't count).
export const dirty = (cwd: string): boolean => gitOrThrow(cwd, ['status', '--porcelain', '--untracked-files=all']).trim() !== '';

// --- the build loop, WRAP and merge (AD-8, AD-30) --------------------------------------------

// A commit needs an identity; a repo without one gets the factory's, never the user's config changed.
function identity(cwd: string): string[] {
  const has = (k: string): boolean => Boolean(git(cwd, ['config', '--get', k]));
  return has('user.name') && has('user.email') ? [] : ['-c', 'user.name=d2t-factory', '-c', 'user.email=factory@localhost'];
}

// `git add -A` + commit in a checkout; an empty diff still commits. The commit is the factory's
// mechanical step record on its own branch, so the target repo's commit hooks don't run. Returns HEAD.
export function commitAll(cwd: string, message: string): string {
  gitOrThrow(cwd, ['add', '-A']);
  gitOrThrow(cwd, [...identity(cwd), 'commit', '-q', '--allow-empty', '--no-verify', '-m', message]);
  return headSha(cwd);
}

// The current branch's name, or null on a detached HEAD.
export const currentBranch = (cwd: string): string | null => git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']) || null;

export const isAncestor = (cwd: string, a: string, b: string): boolean =>
  spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd, stdio: 'ignore' }).status === 0;

// `git diff --shortstat from..to`, e.g. "2 files changed, 5 insertions(+)".
// With '...', from the merge base of the two.
export const diffStat = (cwd: string, from: string, to: string, range: '..' | '...' = '..'): string => git(cwd, ['diff', '--shortstat', `${from}${range}${to}`]) ?? '';

export const diffNames = (cwd: string, from: string, to: string): string[] =>
  (git(cwd, ['diff', '--name-only', `${from}..${to}`]) ?? '').split('\n').filter(Boolean);

export const mergeInProgress = (cwd: string): boolean => git(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null;

export type MergeResult = { ok: true; sha: string } | { ok: false; conflicts: string[]; error: string };

// The human-approved merge's message (AD-8): git's own default subject, which commitlint's default
// ignores accept, with the task as the body. The target's hooks still run on it.
export const mergeMessage = (branch: string, task?: string | null): string => `Merge branch '${branch}'${task ? `\n\n${task}` : ''}`;

// `git merge` of `rev` into the checkout's current branch, committed by the CLI. A failed merge is
// aborted, so the checkout is left as it was; its conflicting files are returned. `noVerify` skips
// the repo's merge hooks (the factory's own integration commit on the run branch).
export function mergeInto(cwd: string, rev: string, message: string, o: { noFf?: boolean; noVerify?: boolean } = {}): MergeResult {
  const flags = [...(o.noFf ? ['--no-ff'] : []), ...(o.noVerify ? ['--no-verify'] : [])];
  const r = spawnSync('git', [...identity(cwd), 'merge', '-q', ...flags, '--no-edit', '-m', message, rev], { cwd, encoding: 'utf8' });
  if (r.status === 0) return { ok: true, sha: headSha(cwd) };
  const conflicts = (git(cwd, ['diff', '--name-only', '--diff-filter=U']) ?? '').split('\n').filter(Boolean);
  if (mergeInProgress(cwd)) spawnSync('git', ['merge', '--abort'], { cwd, stdio: 'ignore' });
  return { ok: false, conflicts, error: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() || `git merge exited ${r.status}` };
}
