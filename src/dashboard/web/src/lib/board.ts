// The board's wiring (2-2, 4-1), kept out of App.svelte so node:test can check it: which stores feed
// the board (the live stream, or the replay playhead), the clock every deadline is compared with,
// the Needs You announcer, and the drawer following the board.
import { derived, readable, type Readable } from 'svelte/store';
import { announce } from './announce.ts';
import { closeDrawer, selection, type Selection } from './drawer.ts';
import { laneKey, typeTag } from './model.ts';
import * as playback from './playback.ts';
import { needsSummary, selectionPresent } from './replay.ts';
import * as stream from './stream.ts';
import type { Lane } from './types.ts';

export interface BoardSources { lanes: Readable<Lane[]>; loaded: Readable<boolean>; mode: Readable<stream.Mode>; now: Readable<number> }

// Live (/) or replay (/replay/<name>): which stores feed the board is fixed for the page. In replay
// the clock is the playhead, never wall time, and there is no offline mode.
export function boardSources(replay: boolean): BoardSources {
  if (!replay) return { lanes: stream.lanes, loaded: stream.loaded, mode: stream.mode, now: stream.now };
  return { lanes: playback.lanes, loaded: derived(playback.status, (s) => s === 'ready'), mode: readable<stream.Mode>('live'), now: playback.t };
}

// The clock chips and `ago` compare with. Offline, the live board is frozen at its last tick (`held`).
export const boardClock = (replay: boolean, mode: stream.Mode, now: number, held: number): number => (replay || mode === 'live' ? now : held);

// New Needs You cards are announced (`<TYPE>: <title>, run <id>`); what is already waiting at first
// load is not. At 16× replay they are muted while playing; when it stops, one summary instead.
// `lanes` returns whether anything was announced (Master d2t looks up).
export function needsAnnouncer(say: (text: string) => void = announce) {
  let seen: Set<string> | null = null;
  let wasFast = false;
  return {
    fast(fast: boolean, lanes: readonly Lane[]): void {
      if (wasFast && !fast) say(needsSummary(lanes));
      wasFast = fast;
    },
    lanes(lanes: readonly Lane[], loaded: boolean, muted: boolean): boolean {
      if (!loaded) return false;
      const fresh: string[] = [];
      const keys = new Set<string>();
      for (const lane of lanes) for (const n of lane.needs_you) {
        const k = `${laneKey(lane)}/${n.ask_id}`;
        keys.add(k);
        if (seen && !seen.has(k)) fresh.push(`${typeTag(n.card)}: ${n.card.title}, run ${lane.run_id}`);
      }
      seen = keys;
      if (muted) return false;
      for (const m of fresh) say(m);
      return fresh.length > 0;
    },
  };
}

export const focusTimeline = (): void => { document.querySelector<HTMLElement>('[data-replay-timeline]')?.focus(); };

// A drawer whose lane is gone closes. In replay the drawer follows the playhead: when its claim,
// decision or card is not on the board at the new playhead, it closes and focus moves to the
// timeline (its source control is gone too).
export function followBoard(sel: Selection | null, lanes: readonly Lane[], loaded: boolean, replay: boolean, toTimeline: () => void = focusTimeline): void {
  if (!sel || !loaded) return;
  if (replay) {
    if (!selectionPresent(sel, lanes)) {
      selection.set(null);
      toTimeline();
    }
  } else if (!lanes.some((l) => laneKey(l) === sel.lane)) closeDrawer();
}
