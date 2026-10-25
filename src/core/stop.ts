// When the conductor may end a turn (AD-12). Pure: no I/O.
import { isTerminal, openSteps, type RunState, type Step } from './reducer.ts';

export interface StopVerdict { may: boolean; reason: string }

interface BackgroundTask { type?: unknown; status?: unknown; agent_type?: unknown }

const running = (t: unknown): t is BackgroundTask =>
  Boolean(t) && typeof t === 'object' && (t as BackgroundTask).status === 'running';

// The running background entry that carries a claimed step: a subagent whose agent_type is the
// step's agent, or a shell for a run_check. enter_worktree and exit_worktree are never carried:
// the conductor does them in the foreground, so they always block the turn's end.
function carrier(st: Step, t: BackgroundTask): boolean {
  if (st.kind === 'run_check') return t.type === 'shell';
  if (st.kind === 'spawn' || st.kind === 'resume') return t.type === 'subagent' && typeof st.agent === 'string' && t.agent_type === st.agent;
  return false;
}

// True iff the run is terminal, or every open step is ask_human or claimed and carried by its own
// running background task. With no open steps the rule holds vacuously. Holder checks are the caller's.
export function mayStop(state: RunState, background_tasks: unknown): StopVerdict {
  if (isTerminal(state)) return { may: true, reason: `run is ${state.phase}` };
  const free = (Array.isArray(background_tasks) ? background_tasks : []).filter(running);
  for (const st of openSteps(state)) {
    if (st.kind === 'ask_human') continue;
    // The subject of an open escalation is parked until the human rules (its card is an ask_human step).
    if (Object.values(state.asks).some((a) => a.open && a.step_id === st.id)) continue;
    if (st.state === 'claimed') {
      const i = free.findIndex((t) => carrier(st, t));
      if (i >= 0) { free.splice(i, 1); continue; }
    }
    return { may: false, reason: `step ${st.id} (${st.kind}${st.agent ? ` ${st.agent}` : ''}) is ${st.state} and not running in the background` };
  }
  return { may: true, reason: 'every open step awaits the human or runs in the background' };
}
