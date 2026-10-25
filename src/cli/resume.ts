// `factory resume [run-id]` (AD-25): rebinds a run to this session on the human's resume prompt.
import { FactoryError } from '../core/errors.ts';
import { boardStage } from '../core/reducer.ts';
import { loadRun } from '../store/load-run.ts';
import { withLock } from '../store/locks.ts';
import { lockDir } from '../store/paths.ts';
import { deleteSessionFile, readSessionFile, sessionLive, writeSessionFile } from '../store/sessions.ts';
import type { Args } from './args.ts';
import { appendAll, gateOrThrow, makeEvent } from './commit.ts';
import { ensureDashboard } from './dashboard.ts';
import { repoHash } from './git.ts';
import { consumeWith, describe, embed, newestPrompt, supersede } from './prompt.ts';
import { isRun, refuseOtherBinding, requireSession, resolveRun } from './resolve.ts';

export async function resume(args: Args): Promise<unknown> {
  const session = requireSession(args);
  if (args.positionals.length > 1) throw new FactoryError('BAD_ARGS', 'usage: factory resume [run-id] --session <id>');
  const given = args.positionals[0];
  const cwd = process.cwd();
  const hash = repoHash(cwd);
  const p = newestPrompt(session);

  // A typed `/factory resume` is a human takeover and always rebinds; a bare `/factory` defers to a live holder.
  let takeover: boolean;
  let typedId: string | undefined;
  if ('intent' in p.parsed && p.parsed.intent === 'resume') {
    takeover = true;
    typedId = p.parsed.run_id;
  } else if ('intent' in p.parsed && p.parsed.intent === 'bare') {
    takeover = false;
  } else {
    throw new FactoryError('BAD_ARGS', `the newest prompt is ${describe(p.parsed)}, not a resume`);
  }
  if (given && given !== typedId) throw new FactoryError('BAD_ARGS', `run ${given} is not the one typed in the prompt (${typedId ?? 'none'})`);

  const r = resolveRun(cwd, hash, { runId: typedId });
  if (!isRun(r)) return r; // a list or nothing: the prompt stays unconsumed for `start` or a typed resume
  const id = r.run_id;
  refuseOtherBinding(session, hash, id);

  // Liveness runs a subprocess, so it is read before the lock and the holder re-checked inside.
  const before = loadRun(hash, id).state;
  const old = before.holder && before.holder !== session ? before.holder : undefined;
  if (!takeover && old && sessionLive(old)) throw new FactoryError('CLAIM_TAKEN', `Run ${id} is already claimed by another session. Type /factory resume ${id} to take it over.`);

  const after = await withLock(lockDir(hash, id), () => {
    const { state } = loadRun(hash, id);
    if (state.holder !== before.holder) throw new FactoryError('CLAIM_TAKEN', `run ${id} was rebound to ${state.holder} meanwhile`);
    const e = makeEvent(id, 'session_bound', { session, ...(old ? { supersedes: old } : {}), ...embed(p) }, { session, corr: p.human.id });
    const next = gateOrThrow(state, [e]);
    consumeWith(p, 'resumed', () => appendAll(hash, id, [e]));
    return next;
  });
  supersede(p.older);
  writeSessionFile({ session, repo_hash: hash, run_id: id });
  if (old && readSessionFile(old)?.run_id === id) deleteSessionFile(old);
  return { run_id: id, stage: boardStage(after), ...(old ? { supersedes: old } : {}), ...(await ensureDashboard()) };
}
