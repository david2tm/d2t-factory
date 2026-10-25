// The replay store (4-1): fetches GET /api/recordings/<name> and plays it on its own clock. The
// playhead `t` is an absolute time on the recording's clock (start … end); play, pause, seek, speed
// (1×, 4×, 16× of real time, no gap compression), and prev/next decision. Playback pauses at the
// last event; play from there restarts at the start. `fast` (16× while playing) tells the card
// glide and the agent walk to skip travel. Read only: there is no SSE and no write.
import { derived, get, writable, type Readable } from 'svelte/store';
import { appliedCount, boardAt, boardKey, endMs, nextPip, pips, prevPip, startMs, type Pip } from './replay.ts';
import type { Lane, Recording } from './types.ts';

export type ReplayStatus = 'loading' | 'ready' | 'missing';
export type Speed = 1 | 4 | 16;
export const SPEEDS: readonly Speed[] = [1, 4, 16];

export const status = writable<ReplayStatus>('loading');
export const recording = writable<Recording | null>(null);
export const t = writable(0); // the playhead, ms
export const playing = writable(false);
export const speed = writable<Speed>(1);
export const lanes = writable<Lane[]>([]);
export const decisionPips = writable<Pip[]>([]);
export const fast: Readable<boolean> = derived([playing, speed], ([p, s]) => p && s === 16);

let isFastNow = false;
fast.subscribe((f) => { isFastNow = f; });
export const isFast = (): boolean => isFastNow;

let rec: Recording | null = null;
let key = '';
let raf: number | null = null;
let lastFrame: number | null = null;

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const frame = (fn: (ts: number) => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(() => fn(nowMs()), 16) as unknown as number);
const cancel = (id: number): void => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id); };

// The board follows the playhead, but only changes when an event or a SIGNAL LOST flag does.
function show(ms: number): void {
  t.set(ms);
  if (!rec) return;
  const k = boardKey(rec, ms);
  if (k !== key) {
    key = k;
    lanes.set(boardAt(rec, ms));
  }
}

function stopClock(): void {
  if (raf !== null) cancel(raf);
  raf = null;
  lastFrame = null;
}

// Moves the playhead by `dt` ms of real time at the current speed; pauses at the end.
export function advance(dt: number): void {
  if (!rec || !get(playing)) return;
  const end = endMs(rec);
  const next = get(t) + dt * get(speed);
  if (next >= end) {
    show(end);
    pause();
    return;
  }
  show(next);
}

function tick(ts: number): void {
  raf = null;
  if (!get(playing)) return;
  if (lastFrame !== null) advance(Math.max(0, ts - lastFrame));
  lastFrame = ts;
  if (get(playing)) raf = frame(tick);
}

export function play(): void {
  if (!rec || get(playing)) return;
  if (get(t) >= endMs(rec)) show(startMs(rec)); // ended: play restarts from 00:00:00
  playing.set(true);
  lastFrame = null;
  raf = frame(tick);
}

export function pause(): void {
  playing.set(false);
  stopClock();
}

export const toggle = (): void => (get(playing) ? pause() : play());

// Seeks within start … end; playing continues from there.
export function seek(ms: number): void {
  if (!rec) return;
  show(Math.min(endMs(rec), Math.max(startMs(rec), ms)));
}

export function setSpeed(s: Speed): void {
  if (SPEEDS.includes(s)) speed.set(s);
}

// Jumps to the adjacent gold pip and pauses there.
function jump(p: Pip | null): void {
  if (!rec || !p) return;
  pause();
  show(p.at);
}
export const nextDecision = (): void => jump(rec ? nextPip(get(decisionPips), get(t)) : null);
export const prevDecision = (): void => jump(rec ? prevPip(get(decisionPips), get(t)) : null);

// A recording, ready: paused at its start, showing every event at or before it.
export function open(r: Recording): void {
  pause();
  rec = r;
  key = '';
  recording.set(r);
  decisionPips.set(pips(r));
  show(startMs(r));
  status.set('ready');
}

export function close(): void {
  pause();
  rec = null;
  key = '';
  recording.set(null);
  decisionPips.set([]);
  lanes.set([]);
  t.set(0);
}

const valid = (r: unknown): r is Recording => {
  const x = r as Partial<Recording> | null;
  return !!x && Array.isArray(x.events) && x.events.length > 0 && Array.isArray(x.frames) && Array.isArray(x.runs)
    && Number.isFinite(Date.parse(x.start ?? '')) && Number.isFinite(Date.parse(x.end ?? '')) && typeof x.signal_lost_ms === 'number';
};

// GET /api/recordings/<name>: a 404 (or anything unusable) is the not-found state.
export async function load(name: string): Promise<void> {
  close();
  status.set('loading');
  try {
    const r = await fetch(`/api/recordings/${encodeURIComponent(name)}`, { cache: 'no-store' });
    const body: unknown = r.ok ? await r.json() : null;
    if (valid(body)) open(body); else status.set('missing');
  } catch {
    status.set('missing');
  }
}

// How many events the board shows (for tests and the readout).
export const applied = (): number => (rec ? appliedCount(rec, get(t)) : 0);
