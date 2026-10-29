// `factory status [run-id]`: view of the resolved run. Its only write is adopting a pending /clear rebind.
import { boardStage, openSteps } from '../core/reducer.ts';
import { loadRun } from '../store/load-run.ts';
import { withLock } from '../store/locks.ts';
import { lockDir } from '../store/paths.ts';
import { readSessionFile } from '../store/sessions.ts';
import type { Args } from './args.ts';
import { stepView } from './commit.ts';
import { repoHash } from './git.ts';
import { adoptRebind, isRun, requireSession, resolveRun } from './resolve.ts';

export async function status(args: Args): Promise<unknown> {
  const session = requireSession(args);
  const cwd = process.cwd();
  const hash = repoHash(cwd);
  const r = resolveRun(cwd, hash, { runId: args.positionals[0], boundSession: session });
  if (!isRun(r)) return r;
  let { state } = loadRun(hash, r.run_id);
  // The lock is taken only when the session file carries a rebind for this run.
  const b = readSessionFile(session);
  if (state.holder !== session && b?.run_id === r.run_id && b.supersedes) {
    state = await withLock(lockDir(hash, r.run_id), () => {
      const run = loadRun(hash, r.run_id);
      return adoptRebind(hash, r.run_id, run, session) ?? run.state;
    });
  }
  return {
    run_id: r.run_id, task: state.task, phase: state.phase, stage: boardStage(state), holder: state.holder,
    is_holder: state.holder === session, last_ts: state.last_ts,
    open_steps: openSteps(state).map((st) => ({ ...stepView(st, state), state: st.state })),
  };
}
