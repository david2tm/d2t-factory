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
    // A reissued exit_worktree: a done came from inside the worktree, so ExitWorktree did not move this
    // session. Only the human can go on (a session started in the main checkout), so the turn may end.
    if (st.kind === 'exit_worktree' && st.attempt > 1) continue;
    if (st.state === 'claimed') {
      const i = free.findIndex((t) => carrier(st, t));
      if (i >= 0) { free.splice(i, 1); continue; }
    }
    return { may: false, reason: `step ${st.id} (${st.kind}${st.agent ? ` ${st.agent}` : ''}) is ${st.state} and not running in the background` };
  }
  return { may: true, reason: 'every open step awaits the human or runs in the background' };
}

// --- transcript readers (6-1) ----------------------------------------------------------------
// Over the parsed lines of the session's own transcript, located the AD-6 way by the caller. They
// match Claude Code's structured records only, never message text.

type Entry = Record<string, unknown>;
const entry = (x: unknown): x is Entry => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

// A turn the human started: a user entry with turnOrigin human. Stop-hook feedback is isMeta.
const isHumanTurn = (x: unknown): x is Entry => entry(x) && x.type === 'user' && x.turnOrigin === 'human' && x.isMeta !== true;

function lastHumanIndex(lines: readonly unknown[]): number {
  for (let i = lines.length - 1; i >= 0; i--) if (isHumanTurn(lines[i])) return i;
  return -1;
}

// The uuid of the turn's last human prompt, or null.
export function lastHumanTurn(lines: readonly unknown[]): string | null {
  const i = lastHumanIndex(lines);
  const uuid = i >= 0 ? (lines[i] as Entry).uuid : undefined;
  return typeof uuid === 'string' ? uuid : null;
}

// A main-thread assistant entry of this session that calls a tool.
const isToolUse = (x: unknown, session: string): boolean =>
  entry(x) && x.type === 'assistant' && x.isSidechain !== true && x.sessionId === session && entry(x.message) && Array.isArray(x.message.content)
  && x.message.content.some((b) => entry(b) && b.type === 'tool_use');

// The tool_use_id of the newest tool use the human rejected after the last human prompt, in this
// session's main thread, with no main-thread tool use after it, or null. Once the conductor calls a
// tool again the rejection is spent. Hook (guard) and deny-rule denials are `permission-rule`
// records and never match.
export function humanRejection(lines: readonly unknown[], session: string): string | null {
  const from = lastHumanIndex(lines);
  for (let i = lines.length - 1; i > from; i--) {
    const x = lines[i];
    if (isToolUse(x, session)) return null;
    if (!entry(x) || x.type !== 'user' || x.isSidechain === true || x.sessionId !== session) continue;
    if (x.toolDenialKind !== 'user-rejected') continue;
    const d = x.permissionDecision;
    if (!entry(d) || d.decision !== 'reject' || d.source !== 'user_reject') continue;
    const content = entry(x.message) ? x.message.content : undefined;
    if (!Array.isArray(content)) continue;
    const block = content.find((b): b is Entry => entry(b) && b.type === 'tool_result' && b.is_error === true && typeof b.tool_use_id === 'string');
    if (block) return block.tool_use_id as string;
  }
  return null;
}
