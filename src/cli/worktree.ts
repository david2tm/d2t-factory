// The run's worktree (AD-15) with its exclude line, the start preflight (AD-35), and the gitignored
// files the run contract names, whose values feed redact.json (AD-14). The port claim lives in claims.ts.
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { isDenied, sandboxDenied } from '../core/errors.ts';
import { readRedactValues } from '../store/load-run.ts';
import { gitExcludeFile, inCheckout, isUnder, realish, redactFile, repoDir, WORKTREES_EXCLUDE, worktreePath, worktreesDir } from '../store/paths.ts';
import { checkOut, commonDir, isWorktreeTop, worktreeAdd } from './git.ts';

// `.claude/worktrees/` in the untracked `.git/info/exclude`. Appended, never rewritten: two runs
// starting at once may both append it, and a duplicate line is harmless.
export function ensureExclude(cwd: string): void {
  const file = gitExcludeFile(commonDir(cwd));
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { /* none yet */ }
  if (text.split('\n').some((l) => l.trim() === WORKTREES_EXCLUDE)) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, (text && !text.endsWith('\n') ? '\n' : '') + WORKTREES_EXCLUDE + '\n');
}

// The worktree at <root>/.claude/worktrees/factory-<run-id> on factory/<run-id> from base_sha, and
// its read-only paths: the tracked files the sandbox refused to check out (AD-15, 8-1). Idempotent:
// an existing worktree there is reused. Reuse happens only before SCAFFOLD's stage_started is
// recorded (no work exists yet), so the checkout steps run again: an add killed before its reset or
// skip-worktree is completed, and the read-only paths are computed afresh.
export function prepareWorktree(root: string, runId: string, baseSha: string, branch: string): { path: string; readonly: string[] } {
  const path = worktreePath(root, runId);
  ensureExclude(root);
  if (existsSync(path) && isWorktreeTop(path)) return { path, readonly: checkOut(path) };
  return { path, readonly: worktreeAdd(root, path, branch, baseSha) };
}

// --- the start preflight (AD-35, 8-1) --------------------------------------------------------

// Test-only: set, the bind probe fails as a sandbox without sandbox.network.allowLocalBinding does.
const BIND_DENIED_ENV = 'FACTORY_TEST_BIND_DENIED';

function bindProbe(): Promise<void> {
  if (process.env[BIND_DENIED_ENV]) {
    return Promise.reject(Object.assign(new Error('listen EPERM: operation not permitted 127.0.0.1'), { code: 'EPERM', syscall: 'listen', address: '127.0.0.1', port: 0 }));
  }
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => srv.close(() => resolve()));
  });
}

// A refused probe becomes SANDBOX_DENIED naming `what`; any other failure is rethrown as is.
function probe<T>(what: string, f: () => T): T {
  try { return f(); } catch (e) { if (isDenied(e)) throw sandboxDenied(`${what} (${e.code})`); throw e; }
}

// Creates `file` (and any missing parent dirs), then removes what it created.
function writeAndRemove(file: string): void {
  const made = mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, '');
    rmSync(file, { force: true });
  } finally {
    // Only the dirs this probe created, deepest first; a dir something else wrote into stays.
    for (let d = dirname(file); made && isUnder(d, made); d = dirname(d)) {
      try { rmdirSync(d); } catch { break; }
    }
  }
}

// `factory start` probes, from the CLI process (inside the session's sandbox), what a run needs
// before any run state is written: a file under <repo>/.claude/worktrees/, `.git/info/exclude` opened
// for append (nothing written), a file under ~/.factory/<repo-hash>/, and a listener on 127.0.0.1:0
// (always run; unsandboxed it succeeds). A refused probe is SANDBOX_DENIED naming its path, or
// sandbox.network.allowLocalBinding for the listener.
export async function sandboxPreflight(root: string, hash: string): Promise<void> {
  const tag = `.factory-preflight-${process.pid}`;
  const wt = join(worktreesDir(root), tag);
  probe(`create ${wt}`, () => writeAndRemove(wt));
  const exclude = gitExcludeFile(commonDir(root));
  probe(`open ${exclude} for append`, () => {
    mkdirSync(dirname(exclude), { recursive: true });
    closeSync(openSync(exclude, 'a'));
  });
  const home = join(repoDir(hash), tag);
  probe(`write ${home}`, () => writeAndRemove(home));
  try {
    await bindProbe();
  } catch (e) {
    if (isDenied(e)) throw sandboxDenied(`listen on 127.0.0.1:0 (${e.code}; sandbox.network.allowLocalBinding)`);
    throw e;
  }
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
