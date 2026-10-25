// The budget clock (CAP-11, AD-17). Pure: the caller passes `now`. Time only sets flags here; the
// cut itself is an ask_raised the CLI appends when `cutCandidates` says it is due.
import { CUT_LEAD_MS, WAIT_MAX_MS } from './config.ts';
import type { AnyEvent, Envelope } from './events.ts';
import type { Ask, RunState } from './reducer.ts';

export interface Budget {
  clock_start: string;
  limit_min: number;
  cut_at: string; // limit − CUT_LEAD_MS after the clock start (before it, when the limit is shorter)
  ends_at: string;
  cut_ms: number;
  ends_ms: number;
}

// The clock runs from the run start, or from the exercise's own start when that was earlier.
export function clockStart(runStartedTs: string, started?: string): string {
  const s = started ? Date.parse(started) : NaN;
  return Number.isFinite(s) && s < Date.parse(runStartedTs) ? new Date(s).toISOString() : runStartedTs;
}

// Null until a confirmed intake recorded a limit and a clock start.
export function budgetOf(s: RunState): Budget | null {
  const start = s.clock_start ? Date.parse(s.clock_start) : NaN;
  const limit = s.intake?.limit_min;
  if (!Number.isFinite(start) || typeof limit !== 'number' || !Number.isFinite(limit)) return null;
  const ends_ms = start + limit * 60_000;
  const cut_ms = ends_ms - CUT_LEAD_MS;
  return { clock_start: s.clock_start!, limit_min: limit, cut_at: new Date(cut_ms).toISOString(), ends_at: new Date(ends_ms).toISOString(), cut_ms, ends_ms };
}

export const openCutAsk = (s: RunState): Ask | undefined => Object.values(s.asks).find((a) => a.open && a.card?.type === 'cut');

const backlog = (s: RunState): string[] => s.slice_order.filter((id) => s.slices[id]?.state === 'BACKLOG');

// The cut gate (AD-30): in BUILD, once `now` reaches cut_at with slices still in Backlog, and no cut
// was decided (cut or keep) or is open. Returns every Backlog slice, in plan order; else [].
export function cutCandidates(s: RunState, nowMs: number): string[] {
  const b = budgetOf(s);
  if (!b || s.phase !== 'BUILD' || s.cut_decided || openCutAsk(s) || nowMs < b.cut_ms) return [];
  return backlog(s);
}

// The ms to each deadline ahead: the cut point while a cut can still be raised, each claim
// overdue_at, and (3-4) each live slice's time box end. Deadlines already past are not waited for.
export function deadlinesAhead(s: RunState, nowMs: number, overdue: readonly string[] = [], timeboxes: readonly string[] = []): number[] {
  const ahead: number[] = [];
  const b = budgetOf(s);
  if (b && s.phase === 'BUILD' && !s.cut_decided && !openCutAsk(s) && backlog(s).length && b.cut_ms > nowMs) ahead.push(b.cut_ms - nowMs);
  for (const o of [...overdue, ...timeboxes]) {
    const t = Date.parse(o);
    if (Number.isFinite(t) && t > nowMs) ahead.push(t - nowMs);
  }
  return ahead;
}

// How long `next` may let the conductor sleep (wait.retry_after_ms): until the next deadline ahead,
// and never longer than WAIT_MAX_MS.
export function nextDeadlineMs(s: RunState, nowMs: number, overdue: readonly string[] = [], timeboxes: readonly string[] = []): number {
  return Math.ceil(Math.min(WAIT_MAX_MS, ...deadlinesAhead(s, nowMs, overdue, timeboxes)));
}

// --- the slice time box (3-4, AD-17) -----------------------------------------------------------

// What a slice's time box is measured from, read from the commands of the current plan (after the
// last gate_2_passed): the start (slice_started, or a later rework of the slice: a slice sent back
// from the merge card gets a fresh box), the limit ((k+1) × slice_timebox_min, k = Over time box
// rulings already made on the slice since the start), the escalated time already over, and when an
// escalation on the slice is open, since when. Null without a confirmed intake or a start.
interface TimeboxBasis { start_ms: number; limit_ms: number; paused_ms: number; open_since: number | null }

function timeboxBasis(s: RunState, commands: readonly AnyEvent[], slice: string): TimeboxBasis | null {
  const box = s.intake?.slice_timebox_min;
  if (typeof box !== 'number' || !Number.isFinite(box)) return null;
  const from = commands.findLastIndex((e) => e.kind === 'gate_2_passed');
  const plan = commands.slice(from + 1);
  let start = NaN;
  for (const e of plan) {
    if ((e.kind === 'slice_started' && (e as Envelope<'slice_started'>).data.slice === slice) || (e.kind === 'rework_requested' && (e as Envelope<'rework_requested'>).data.target === slice)) start = Date.parse(e.ts);
  }
  if (!Number.isFinite(start)) return null;
  const raised = new Map<string, { at: number; label?: string }>();
  let paused_ms = 0;
  let open_since: number | null = null;
  let k = 0;
  for (const e of plan) {
    if (e.kind === 'ask_raised') {
      const d = (e as Envelope<'ask_raised'>).data;
      if (d.slice === slice && d.escalation) raised.set(d.escalation, { at: Date.parse(e.ts), label: d.card?.reason_label });
    } else if (e.kind === 'escalation_ruled') {
      const r = raised.get((e as Envelope<'escalation_ruled'>).data.escalation);
      if (!r) continue;
      raised.delete((e as Envelope<'escalation_ruled'>).data.escalation);
      const at = Date.parse(e.ts);
      paused_ms += Math.max(0, at - Math.max(r.at, start));
      if (r.label === 'Over time box' && at >= start) k += 1;
    }
  }
  for (const r of raised.values()) open_since = Math.max(r.at, start, open_since ?? -Infinity);
  return { start_ms: start, limit_ms: (k + 1) * box * 60_000, paused_ms, open_since };
}

export interface Timebox {
  limit_min: number; // (k+1) × slice_timebox_min
  ends_at: string | null; // when the net elapsed time reaches the limit; null while an escalation pauses it
  elapsed_ms: number; // wall time since the start, minus the escalated time
  over: boolean;
}

// The time box of a slice at `nowMs`, or null when it has none (no intake, not started).
export function sliceTimebox(s: RunState, commands: readonly AnyEvent[], slice: string, nowMs: number): Timebox | null {
  const b = timeboxBasis(s, commands, slice);
  if (!b) return null;
  const paused = b.paused_ms + (b.open_since === null ? 0 : Math.max(0, nowMs - b.open_since));
  const elapsed_ms = nowMs - b.start_ms - paused;
  return {
    limit_min: b.limit_ms / 60_000, ends_at: b.open_since === null ? new Date(b.start_ms + b.paused_ms + b.limit_ms).toISOString() : null,
    elapsed_ms, over: elapsed_ms >= b.limit_ms,
  };
}

// The board's view (no clock): the limit and the absolute end, or null.
export function timeboxView(s: RunState, commands: readonly AnyEvent[], slice: string): { limit_min: number; ends_at: string | null } | null {
  const b = timeboxBasis(s, commands, slice);
  return b ? { limit_min: b.limit_ms / 60_000, ends_at: b.open_since === null ? new Date(b.start_ms + b.paused_ms + b.limit_ms).toISOString() : null } : null;
}
