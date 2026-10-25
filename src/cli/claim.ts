// `factory claim <step_id> [--agent-id id]` (AD-24).
import { FactoryError } from '../core/errors.ts';
import { loadRun } from '../store/load-run.ts';
import { withLock } from '../store/locks.ts';
import { lockDir } from '../store/paths.ts';
import { flagString, type Args } from './args.ts';
import { appendAll, gateOrThrow, makeEvent } from './commit.ts';
import { requireHolder, requireRun, requireSession } from './resolve.ts';

export async function claim(args: Args): Promise<unknown> {
  const session = requireSession(args);
  const [stepId, ...extra] = args.positionals;
  if (!stepId || extra.length) throw new FactoryError('BAD_ARGS', 'usage: factory claim <step_id> [--agent-id id] --session <id>');
  const agentId = flagString(args, 'agent-id');
  const { hash, runId } = requireRun(process.cwd(), session);
  return withLock(lockDir(hash, runId), () => {
    const state = requireHolder(hash, runId, loadRun(hash, runId), session);
    const st = Object.hasOwn(state.steps, stepId) ? state.steps[stepId] : undefined;
    if (!st) throw new FactoryError('NOT_FOUND', `no step ${stepId} in run ${runId}`);
    if (st.state !== 'issued') throw new FactoryError('CLAIM_TAKEN', `step ${stepId} is ${st.state}${st.claimed_by ? ` by ${st.claimed_by}` : ''}`);
    const e = makeEvent(runId, 'step_claimed', { step_id: stepId, ...(agentId ? { agent_id: agentId } : {}) }, { session, corr: stepId });
    gateOrThrow(state, [e]);
    appendAll(hash, runId, [e]);
    return { step_id: stepId, state: 'claimed' };
  });
}
