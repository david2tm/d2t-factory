// `factory start [task]` (AD-9, AD-25, AD-26): consumes the human's task prompt and starts a run,
// in an empty or non-git directory as a greenfield run (5-2).
// While a live run holds the repo's exclusive claim (AD-15) it refuses with REFUSED_EXCLUSIVE before
// anything is claimed: no run dir, no lane, and the prompt stays unconsumed. A failed sandbox
// preflight (AD-35) refuses the same way, with SANDBOX_DENIED.
import { readdirSync, rmSync } from 'node:fs';
import { FactoryError } from '../core/errors.ts';
import { runId as newRunId } from '../store/ids.ts';
import { loadRun } from '../store/load-run.ts';
import { claimDir, withLock } from '../store/locks.ts';
import { lockDir, runDir } from '../store/paths.ts';
import { writeSessionFile } from '../store/sessions.ts';
import type { Args } from './args.ts';
import { exclusiveHolder, refusedExclusive } from './claims.ts';
import { appendAll, gateOrThrow, makeEvent, requireSetup } from './commit.ts';
import { ensureDashboard } from './dashboard.ts';
import { headSha, headTreeEmpty, initGreenfield, insideRepo, repoHash, repoRoot, statusDigest } from './git.ts';
import { consumeWith, describe, embed, newestPrompt, supersede } from './prompt.ts';
import { refuseOtherBinding, requireSession } from './resolve.ts';
import { sandboxPreflight } from './worktree.ts';

export async function start(args: Args): Promise<unknown> {
  const session = requireSession(args);
  requireSetup();
  const cwd = process.cwd();
  const p = newestPrompt(session);
  const given = args.positionals.join(' ').trim();
  let task: string;
  if ('intent' in p.parsed && p.parsed.intent === 'start') {
    if (given && given !== p.parsed.task) throw new FactoryError('BAD_ARGS', `task ${JSON.stringify(given)} differs from the typed prompt ${JSON.stringify(p.parsed.task)}`);
    task = p.parsed.task;
  } else if ('intent' in p.parsed && p.parsed.intent === 'bare') {
    if (!given) throw new FactoryError('BAD_ARGS', 'the prompt is a bare /factory: pass the task as factory start <task>');
    task = given;
  } else {
    throw new FactoryError('BAD_ARGS', `the newest prompt is ${describe(p.parsed)}, not a task`);
  }

  // AD-9 (5-2): an empty non-git cwd is initialised, and a repo with no commit gets `factory: init`,
  // before anything is claimed. A run is greenfield iff HEAD's tree is empty then. A non-git cwd that
  // holds anything is refused: greenfield starts only in an empty directory.
  if (!insideRepo(cwd) && readdirSync(cwd).length) {
    throw new FactoryError('BAD_ARGS', `${cwd} is not a git repository and is not empty: start a greenfield run in an empty directory, or run git init there first`);
  }
  initGreenfield(cwd);
  const hash = repoHash(cwd);
  const base = headSha(cwd);
  const greenfield = headTreeEmpty(cwd);

  refuseOtherBinding(session, hash);
  const holder = exclusiveHolder(hash);
  if (holder) throw new FactoryError('REFUSED_EXCLUSIVE', refusedExclusive(holder));
  // AD-35 (8-1): the sandbox preflight, before any run state is written (SANDBOX_DENIED).
  await sandboxPreflight(repoRoot(cwd), hash);
  // AD-8: the main checkout's status is the brownfield baseline, probed before the lock.
  const t0 = Date.now();
  const status = statusDigest(repoRoot(cwd));
  const probeMs = Date.now() - t0;

  let id = '';
  for (let i = 0; i < 8 && !id; i++) {
    const candidate = newRunId(task);
    if (claimDir(runDir(hash, candidate))) id = candidate; // AD-9: atomic mkdir
  }
  if (!id) throw new FactoryError('LOCKED', 'could not claim a run id');

  try {
    await withLock(lockDir(hash, id), () => {
      const { state } = loadRun(hash, id);
      const started = makeEvent(id, 'run_started', { task, repo_hash: hash, base_sha: base, branch: `factory/${id}`, ...(greenfield ? { greenfield } : {}), ...embed(p) }, { session, corr: p.human.id });
      const bound = makeEvent(id, 'session_bound', { session }, { session, corr: started.id });
      const baseline = makeEvent(id, 'check_ran', {
        check: 'git.baseline', exit_code: 0, duration_ms: probeMs, basis_seq: 2, sha: base, digest: status.digest, command: status.command,
      }, { corr: started.id });
      gateOrThrow(state, [started, bound, baseline]);
      consumeWith(p, 'started', () => appendAll(hash, id, [started, bound, baseline]));
    });
  } catch (e) {
    rmSync(runDir(hash, id), { recursive: true, force: true });
    throw e;
  }
  supersede(p.older);
  writeSessionFile({ session, repo_hash: hash, run_id: id });
  return { run_id: id, ...(await ensureDashboard()) };
}
