// `factory prune` (read only): the kept run worktrees under <repo>/.claude/worktrees whose runs are
// over (MERGED, COMPLETED or ABANDONED), plus what `git worktree list` marks prunable, and the exact
// commands that remove them. It never runs them: the sandbox blocks removing a worktree a session
// entered, so the human runs them in their own terminal.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FactoryError } from '../core/errors.ts';
import type { Phase } from '../core/reducer.ts';
import { loadCommands } from '../store/load-run.ts';
import { commandsFile, worktreesDir } from '../store/paths.ts';
import type { Args } from './args.ts';
import { repoHash, repoRoot } from './git.ts';

const OVER: readonly Phase[] = ['MERGED', 'COMPLETED', 'ABANDONED'];
const RUN_DIR_RE = /^factory-(.+)$/;
// A path or ref as one shell word.
const q = (s: string): string => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export interface PrunableWorktree { path: string; reason: string }

// `git worktree list --porcelain`: the entries git marks `prunable` (their directory is gone).
export function prunableWorktrees(root: string): PrunableWorktree[] {
  const r = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout.split('\n\n').flatMap((block) => {
    const lines = block.split('\n');
    const path = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
    const prunable = lines.find((l) => l === 'prunable' || l.startsWith('prunable '));
    return path && prunable ? [{ path, reason: prunable.slice('prunable'.length).trim() }] : [];
  });
}

export async function prune(args: Args): Promise<unknown> {
  if (args.positionals.length) throw new FactoryError('BAD_ARGS', 'usage: factory prune (from the target repo; prints commands, runs none)');
  const cwd = process.cwd();
  const root = repoRoot(cwd);
  const hash = repoHash(cwd);
  const dir = worktreesDir(root);
  const runs: { run_id: string; phase: Phase; path: string; branch: string | null }[] = [];
  const skipped: { path: string; why: string }[] = [];
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    const id = RUN_DIR_RE.exec(name)?.[1];
    const path = join(dir, name);
    if (!id) continue;
    if (!existsSync(commandsFile(hash, id))) { skipped.push({ path, why: 'no factory run with this id for this repo' }); continue; }
    let state: ReturnType<typeof loadCommands>;
    try { state = loadCommands(hash, id); } catch (e) { skipped.push({ path, why: `run ${id} could not be read: ${(e as Error).message}` }); continue; }
    if (!OVER.includes(state.phase)) { skipped.push({ path, why: `run ${id} is ${state.phase}` }); continue; }
    runs.push({ run_id: id, phase: state.phase, path, branch: state.branch });
  }
  const prunable = prunableWorktrees(root);
  const commands = [
    ...runs.map((r) => `git -C ${q(root)} worktree remove --force ${q(r.path)}`),
    ...(prunable.length ? [`git -C ${q(root)} worktree prune`] : []),
    ...runs.filter((r) => r.branch).map((r) => `git -C ${q(root)} branch -D ${q(r.branch!)}`),
  ];
  return {
    repo: root,
    worktrees: runs,
    prunable,
    kept: skipped,
    commands,
    note: commands.length
      ? 'Run these in your own terminal (the sandbox blocks removing worktrees); factory prune runs nothing.'
      : 'Nothing to prune.',
  };
}
