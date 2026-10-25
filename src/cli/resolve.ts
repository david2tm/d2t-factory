// Session checks (AD-25) and run resolution: the worktree's run, else the single live run, else a list.
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { FactoryError } from '../core/errors.ts';
import type { Stage } from '../core/events.ts';
import { boardStage, isTerminal, type RunState } from '../core/reducer.ts';
import { liveSlices } from '../core/verify.ts';
import { loadRun, type LoadedRun } from '../store/load-run.ts';
import { commandsFile, runsDir } from '../store/paths.ts';
import { isSafeId, readSessionFile, writeSessionFile } from '../store/sessions.ts';
import { flagString, type Args } from './args.ts';
import { appendAll, gateOrThrow, makeEvent } from './commit.ts';
import { repoHash } from './git.ts';

export function requireSession(args: Args): string {
  const session = flagString(args, 'session');
  if (!session) throw new FactoryError('BAD_ARGS', '--session is required');
  if (!isSafeId(session)) throw new FactoryError('BAD_ARGS', `bad session id ${JSON.stringify(session)}`);
  const env = process.env.CLAUDE_CODE_SESSION_ID;
  if (env && env !== session) throw new FactoryError('BAD_ARGS', `--session ${session} differs from CLAUDE_CODE_SESSION_ID ${env}`);
  return session;
}

// A /clear rebind the hook wrote (AD-25) and the CLI has not adopted yet: the caller's session file
// names this run, the session it supersedes is the run's holder, and the hook's
// session_started{source:'clear', supersedes} fact is in the run's facts.
function pendingRebind(hash: string, runId: string, run: LoadedRun, session: string): { supersedes: string; fact: string } | null {
  const { state } = run;
  if (!state.holder || state.holder === session || isTerminal(state)) return null;
  const b = readSessionFile(session);
  if (!b || b.repo_hash !== hash || b.run_id !== runId || b.supersedes !== state.holder || !b.rebind_fact_id) return null;
  const f = run.facts.find((x) => x.id === b.rebind_fact_id);
  if (!f || f.kind !== 'session_started' || f.session !== session || f.data.source !== 'clear' || f.data.supersedes !== state.holder) return null;
  return { supersedes: state.holder, fact: f.id };
}

// Under the run lock. Adopts a pending /clear rebind as session_bound{supersedes, rebind_fact_id}
// and returns the new state, or null when there is none.
export function adoptRebind(hash: string, runId: string, run: LoadedRun, session: string): RunState | null {
  const p = pendingRebind(hash, runId, run, session);
  if (!p) return null;
  const e = makeEvent(runId, 'session_bound', { session, supersedes: p.supersedes, rebind_fact_id: p.fact }, { session, corr: p.fact });
  const next = gateOrThrow(run.state, [e]);
  appendAll(hash, runId, [e]);
  writeSessionFile({ session, repo_hash: hash, run_id: runId }); // adopted: drop the pending fields
  return next;
}

// Under the run lock, for the holder verbs. Returns the state to act on (after any adoption).
export function requireHolder(hash: string, runId: string, run: LoadedRun, session: string): RunState {
  if (run.state.holder === session) return run.state;
  const adopted = adoptRebind(hash, runId, run, session);
  if (adopted) return adopted;
  throw new FactoryError('NOT_HOLDER', `session ${session} is not the holder of run ${run.state.run_id} (holder ${run.state.holder ?? 'none'})`);
}

// One resume-list row, in the Swimlane header's vocabulary: `run id · title · stage · slice · last
// activity`. The title is the run's task; the slice is its first live slice, or `—`.
export interface RunSummary { run_id: string; title: string; stage: Stage; slice: string; last_ts: string | null }

export const runExists = (hash: string, runId: string): boolean => isSafeId(runId) && existsSync(commandsFile(hash, runId));

function summary(state: RunState, runId: string): RunSummary {
  return { run_id: runId, title: state.task ?? '', stage: boardStage(state), slice: liveSlices(state)[0]?.id ?? '—', last_ts: state.last_ts };
}

function liveRuns(hash: string): RunSummary[] {
  let names: string[] = [];
  try { names = readdirSync(runsDir(hash)); } catch { /* no runs yet */ }
  const out: RunSummary[] = [];
  for (const id of names.sort()) {
    if (!runExists(hash, id)) continue;
    const { state } = loadRun(hash, id);
    if (state.run_id && !isTerminal(state)) out.push(summary(state, id));
  }
  return out;
}

// `factory-<run-id>` under `.claude/worktrees/` in cwd or its realpath (AD-9, AD-15).
export function worktreeRunId(cwd: string): string | null {
  const paths = [cwd];
  try { paths.push(realpathSync(cwd)); } catch { /* cwd vanished */ }
  for (const p of paths) {
    const parts = p.split(sep);
    for (let i = 0; i + 2 < parts.length; i++) {
      if (parts[i] === '.claude' && parts[i + 1] === 'worktrees' && parts[i + 2].startsWith('factory-')) return parts[i + 2].slice('factory-'.length);
    }
  }
  return null;
}

export type Resolution = RunSummary | { list: RunSummary[] } | { none: true };

export interface ResolveOpts {
  runId?: string; // an explicit id wins
  boundSession?: string; // for holder verbs: the session's own binding comes after the worktree
}

export function resolveRun(cwd: string, hash: string, opts: ResolveOpts = {}): Resolution {
  const pick = (id: string): RunSummary => {
    if (!runExists(hash, id)) throw new FactoryError('NOT_FOUND', `no run ${id} in this repo`);
    return summary(loadRun(hash, id).state, id);
  };
  if (opts.runId) return pick(opts.runId);
  const wt = worktreeRunId(cwd);
  if (wt) return pick(wt);
  if (opts.boundSession) {
    const b = readSessionFile(opts.boundSession);
    if (b && b.repo_hash === hash && runExists(hash, b.run_id)) return pick(b.run_id);
  }
  const live = liveRuns(hash);
  if (live.length === 1) return live[0];
  return live.length ? { list: live } : { none: true };
}

export const isRun = (r: Resolution): r is RunSummary => 'run_id' in r;

// The run a holder verb acts on. A list or no run at all is NOT_FOUND.
export function requireRun(cwd: string, session: string): { hash: string; runId: string } {
  const hash = repoHash(cwd);
  const r = resolveRun(cwd, hash, { boundSession: session });
  if (isRun(r)) return { hash, runId: r.run_id };
  if ('list' in r) throw new FactoryError('NOT_FOUND', `several live runs: ${r.list.map((x) => x.run_id).join(', ')}`);
  throw new FactoryError('NOT_FOUND', 'no live run in this repo');
}

// A session holds at most one live run: binding it elsewhere would orphan the one it holds.
export function refuseOtherBinding(session: string, hash: string, allowRunId?: string): void {
  const b = readSessionFile(session);
  if (!b || b.repo_hash !== hash || b.run_id === allowRunId || !runExists(hash, b.run_id)) return;
  const { state } = loadRun(hash, b.run_id);
  if (!isTerminal(state) && state.holder === session) {
    throw new FactoryError('BAD_ARGS', `session ${session} already holds live run ${b.run_id}: /factory abandon it or finish it first`);
  }
}
