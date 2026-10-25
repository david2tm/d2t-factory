// The run's machine resources (AD-15, AD-20): the port claim, the worktree with its exclude line,
// and the gitignored files the run contract names, whose values feed redact.json (AD-14).
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, normalize, sep } from 'node:path';
import { PORT_RANGE } from '../core/config.ts';
import { FactoryError } from '../core/errors.ts';
import { readRedactValues } from '../store/load-run.ts';
import { claimDir } from '../store/locks.ts';
import { gitExcludeFile, inCheckout, isUnder, portDir, portOwnerFile, realish, redactFile, WORKTREES_EXCLUDE, worktreePath } from '../store/paths.ts';
import { commonDir, isWorktreeTop, worktreeAdd } from './git.ts';

function owner(n: number): string | null {
  try { return readFileSync(portOwnerFile(n), 'utf8').trim(); } catch { return null; }
}

// `mkdir ports/<n>` from PORT_RANGE; a claim this run already holds is reused. None free → LOCKED.
export function claimPort(runId: string): number {
  for (let n = PORT_RANGE.min; n <= PORT_RANGE.max; n++) if (owner(n) === runId) return n;
  for (let n = PORT_RANGE.min; n <= PORT_RANGE.max; n++) {
    if (!claimDir(portDir(n))) continue;
    writeFileSync(portOwnerFile(n), runId + '\n');
    return n;
  }
  throw new FactoryError('LOCKED', `every port in ${PORT_RANGE.min}-${PORT_RANGE.max} is claimed`);
}

// Released only by a terminal run, and only if this run holds it.
export function releasePort(runId: string, port: number | undefined): void {
  if (port !== undefined && owner(port) === runId) rmSync(portDir(port), { recursive: true, force: true });
}

// `.claude/worktrees/` in the untracked `.git/info/exclude`, once.
export function ensureExclude(cwd: string): void {
  const file = gitExcludeFile(commonDir(cwd));
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { /* none yet */ }
  if (text.split('\n').some((l) => l.trim() === WORKTREES_EXCLUDE)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text + (text && !text.endsWith('\n') ? '\n' : '') + WORKTREES_EXCLUDE + '\n');
}

// The worktree at <root>/.claude/worktrees/factory-<run-id> on factory/<run-id> from base_sha.
// Idempotent: an existing worktree there is reused.
export function prepareWorktree(root: string, runId: string, baseSha: string, branch: string): string {
  const path = worktreePath(root, runId);
  ensureExclude(root);
  if (!(existsSync(path) && isWorktreeTop(path))) worktreeAdd(root, path, branch, baseSha);
  return path;
}

export const inWorktree = (cwd: string, worktree: string | undefined): boolean => Boolean(worktree) && isUnder(realish(cwd), realish(worktree!));

// A dotenv-ish file's secret values: the value of each `KEY=value` line, else the whole line.
// Values shorter than 4 characters, numbers and booleans would redact ordinary text, so they are skipped.
export function secretValues(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*[=:]\s*(.*)$/.exec(line);
    const v = (m ? m[1] : line).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (v.length >= 4 && !/^(?:-?[\d.]+|true|false)$/i.test(v)) out.push(v);
  }
  return out;
}

export type CopyResult = { ok: true; copied: string[]; values: string[] } | { ok: false; error: string };

// Each path must be relative, inside the checkout, present and `git check-ignore`d.
export function copyGitignored(root: string, worktree: string, files: readonly string[], ignored: (root: string, rel: string) => boolean): CopyResult {
  const values: string[] = [];
  for (const rel of files) {
    const n = normalize(rel);
    if (isAbsolute(rel) || n === '..' || n.startsWith('..' + sep)) return { ok: false, error: `copy_gitignored ${rel} is not a path inside the repo` };
    const from = inCheckout(root, n);
    if (!existsSync(from) || !statSync(from).isFile()) return { ok: false, error: `copy_gitignored ${rel} is not a file in the main checkout` };
    if (!ignored(root, n)) return { ok: false, error: `copy_gitignored ${rel} is not ignored by git` };
    values.push(...secretValues(readFileSync(from, 'utf8')));
  }
  for (const rel of files) {
    const to = inCheckout(worktree, normalize(rel));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(inCheckout(root, normalize(rel)), to);
  }
  return { ok: true, copied: [...files], values };
}

// Merges values into the run's redact.json (mode 0600, never recorded).
export function addRedactValues(hash: string, runId: string, values: readonly string[]): void {
  if (!values.length) return;
  const file = redactFile(hash, runId);
  const merged = [...new Set([...readRedactValues(hash, runId), ...values])];
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ values: merged }) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}
