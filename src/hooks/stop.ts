// The synchronous Stop hook (AD-12): blocks the holder's turn end unless mayStop allows it, with two
// recorded exits (6-1): a tool use the human rejected this turn (stop_yielded), and the factory's
// own block cap (stop_forced). stop_hook_active is deliberately ignored.
import { STOP_BLOCK_MAX } from '../core/config.ts';
import { TOOL_FACT_KINDS } from '../core/events.ts';
import { boardStage, isTerminal } from '../core/reducer.ts';
import { humanRejection, lastHumanTurn, mayStop } from '../core/stop.ts';
import { readLines } from '../store/jsonl.ts';
import { loadCommands } from '../store/load-run.ts';
import { factsFile } from '../store/paths.ts';
import { locateTranscript, readStopFile, readTranscript, writeStopFile, type StopCounter } from '../store/sessions.ts';
import { appendFact, boundRun, holds, logError, safeId, type Bound, type Payload } from './io.ts';

// The id of the newest main-thread tool fact of the session, or null.
function newestToolFact(b: Bound): string | null {
  const items = readLines<{ id?: unknown; kind?: unknown }>(factsFile(b.hash, b.runId, b.session, null)).items;
  for (let i = items.length - 1; i >= 0; i--) {
    const f = items[i];
    if (f && (TOOL_FACT_KINDS as readonly unknown[]).includes(f.kind) && typeof f.id === 'string') return f.id;
  }
  return null;
}

export function stop(p: Payload): unknown {
  const b = boundRun(safeId(p.session_id));
  if (!b) return;
  const state = loadCommands(b.hash, b.runId);
  // Unbound, non-holder and terminal runs always pass, and leave no counter.
  if (!state.run_id || isTerminal(state) || !holds(b.binding, state)) return;
  const prev = readStopFile(b.session);
  const v = mayStop(state, p.background_tasks);
  if (v.may) {
    if (prev && prev.blocks > 0) writeStopFile(b.session, { ...prev, blocks: 0 });
    return;
  }

  // The transcript only ever comes from the AD-6 locate; a missing one holds no rejection.
  const file = locateTranscript(b.session);
  const lines = file ? readTranscript(file) : [];
  const human_turn = lastHumanTurn(lines);
  const tool_fact = newestToolFact(b);
  const yielded = prev?.yielded ?? [];

  const rejected = humanRejection(lines, b.session);
  if (rejected) {
    // The fact before the counter: a failed counter write can only repeat a fact, never lose one.
    const first = !yielded.includes(rejected);
    if (first) appendFact(b, 'stop_yielded', { reason: 'human_rejected', tool_use_id: rejected });
    writeStopFile(b.session, { blocks: 0, tool_fact, human_turn, yielded: first ? [...yielded, rejected] : yielded });
    return;
  }

  // A new main tool fact or a new human prompt since the last count starts it again.
  const blocks = prev && prev.tool_fact === tool_fact && prev.human_turn === human_turn ? prev.blocks : 0;
  if (blocks >= STOP_BLOCK_MAX) {
    appendFact(b, 'stop_forced', { blocks, reason: v.reason });
    writeStopFile(b.session, { blocks: 0, tool_fact, human_turn, yielded });
    return;
  }
  const next: StopCounter = { blocks: blocks + 1, tool_fact, human_turn, yielded };
  // The block holds even if the counter can't be written: an uncounted block beats an unblocked stop.
  try { writeStopFile(b.session, next); } catch (e) { logError('Stop', e); }
  return {
    decision: 'block',
    reason: `Factory run ${b.runId} is in ${boardStage(state)} and is not waiting on the human or on background work: ${v.reason}. Do not stop. Run \`factory next --session ${b.session}\` and follow its output.`,
  };
}
