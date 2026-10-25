// Replay's timeline (AD-18, 4-1): a recording folded into one ordered list of events, each with the
// post-event lane of its run, all from the AD-1 reducer and projection. Pure: no I/O and no clock.
//
// Order. Per run, commands keep file order; facts, in (ts, id) order, go before the first command
// whose ts is at or after theirs (on a tie the fact comes first, so a command that cites a fact
// sees it). An event's `at` is the running max of ts within its run, so each run is monotone. Runs
// merge by `at`, manifest order breaking ties.
//
// Frames. A frame is a run's lane after an event, with `last_event_at` and
// `deadlines.signal_lost_at` blanked: the browser restores both from the playhead. A fact that no
// command cites (as a `data.evidence` id) changes nothing else in the lane, so it reuses the
// previous frame without re-projecting. Identical frames are stored once.
import { signalLostCard } from './cards.ts';
import { HEARTBEAT_INTERVAL_MS, SIGNAL_LOST_MISSED } from './config.ts';
import type { AnyEvent, Card } from './events.ts';
import { isDecisionKind } from './events.ts';
import { projectRun, type Lane, type RunInput } from './projection.ts';
import { fold } from './reducer.ts';

export interface TimelineEvent {
  id: string;
  kind: string;
  at: string;
  run: number; // index into runs
  decision: boolean; // an applied human decision: one gold pip
  frame: number; // index into frames: the run's lane after this event
}

export interface TimelineRun { repo_hash: string; run_id: string; signal_lost_card: Card }

export interface Timeline {
  name: string;
  recorded_at: string;
  start: string;
  end: string;
  signal_lost_ms: number;
  runs: TimelineRun[];
  events: TimelineEvent[];
  frames: Lane[];
}

export interface TimelineManifest { name: string; recorded_at: string }
export interface TimelineRunInput { repo_hash: string; run_id: string; loaded: RunInput }

export const SIGNAL_LOST_MS = HEARTBEAT_INTERVAL_MS * SIGNAL_LOST_MISSED;

// One run's commands and facts in replay order, each with its `at`.
export function runOrder(commands: readonly AnyEvent[], facts: readonly AnyEvent[]): { e: AnyEvent; fact: boolean; at: string }[] {
  const out: { e: AnyEvent; fact: boolean; at: string }[] = [];
  let at = '';
  const push = (e: AnyEvent, fact: boolean): void => {
    if (e.ts > at) at = e.ts;
    out.push({ e, fact, at });
  };
  let f = 0;
  for (const c of commands) {
    while (f < facts.length && facts[f].ts <= c.ts) push(facts[f++], true);
    push(c, false);
  }
  while (f < facts.length) push(facts[f++], true);
  return out;
}

// Every id a command cites as evidence: the facts whose arrival can change a lane beyond its clock.
function citedIds(commands: readonly AnyEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const c of commands) {
    const ev = (c.data as { evidence?: unknown } | null)?.evidence;
    if (Array.isArray(ev)) for (const x of ev) if (typeof x === 'string') ids.add(x);
  }
  return ids;
}

const blank = (lane: Lane): Lane => ({ ...lane, last_event_at: null, deadlines: { ...lane.deadlines, signal_lost_at: null } });

export function buildTimeline(manifest: TimelineManifest, runs: readonly TimelineRunInput[]): Timeline {
  const frames: Lane[] = [];
  const frameIds = new Map<string, number>();
  const frameOf = (lane: Lane): number => {
    const json = JSON.stringify(blank(lane));
    let i = frameIds.get(json);
    if (i === undefined) {
      i = frames.length;
      frames.push(JSON.parse(json) as Lane);
      frameIds.set(json, i);
    }
    return i;
  };

  const merged: (TimelineEvent & { seq: number })[] = [];
  runs.forEach((r, run) => {
    const cited = citedIds(r.loaded.commands);
    const commands: AnyEvent[] = [];
    const facts: AnyEvent[] = [];
    let frame = -1;
    runOrder(r.loaded.commands, r.loaded.facts).forEach(({ e, fact, at }, seq) => {
      if (fact) facts.push(e); else commands.push(e);
      let lane: Lane | null = null;
      if (!fact || cited.has(e.id) || frame < 0) {
        lane = projectRun({ state: fold(commands), commands, facts, skipped: r.loaded.skipped }, { repo_hash: r.repo_hash, run_id: r.run_id });
        frame = frameOf(lane);
      }
      const decision = !fact && isDecisionKind(e.kind) && Boolean(lane?.decisions.some((d) => d.id === e.id));
      merged.push({ id: e.id, kind: e.kind, at, run, decision, frame, seq });
    });
  });
  merged.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.run - b.run || a.seq - b.seq));
  const events: TimelineEvent[] = merged.map(({ seq: _seq, ...e }) => e);

  return {
    name: manifest.name,
    recorded_at: manifest.recorded_at,
    start: events[0]?.at ?? manifest.recorded_at,
    end: events.at(-1)?.at ?? manifest.recorded_at,
    signal_lost_ms: SIGNAL_LOST_MS,
    runs: runs.map((r) => ({ repo_hash: r.repo_hash, run_id: r.run_id, signal_lost_card: signalLostCard(r.run_id) })),
    events,
    frames,
  };
}
