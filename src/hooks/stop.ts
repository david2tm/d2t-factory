// The synchronous Stop hook (AD-12): blocks the holder's turn end unless mayStop allows it.
import { boardStage, isTerminal } from '../core/reducer.ts';
import { mayStop } from '../core/stop.ts';
import { loadCommands } from '../store/load-run.ts';
import { boundRun, holds, safeId, type Payload } from './io.ts';

export function stop(p: Payload): unknown {
  const b = boundRun(safeId(p.session_id));
  if (!b) return;
  const state = loadCommands(b.hash, b.runId);
  // Unbound, non-holder and terminal runs always pass. stop_hook_active is deliberately ignored.
  if (!state.run_id || isTerminal(state) || !holds(b.binding, state)) return;
  const v = mayStop(state, p.background_tasks);
  if (v.may) return;
  return {
    decision: 'block',
    reason: `Factory run ${b.runId} is in ${boardStage(state)} and is not waiting on the human or on background work: ${v.reason}. Do not stop. Run \`factory next --session ${b.session}\` and follow its output.`,
  };
}
