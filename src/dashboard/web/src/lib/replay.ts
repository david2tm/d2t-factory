// Replay's pure view logic (4-1): the board at a playhead, the decision pips, and the replay
// keyboard rule. The playhead is an absolute time (ms) on the recording's own clock; every deadline
// on the board is compared with it, never with wall time.
import type { Selection } from './drawer.ts';
import { eventName, laneKey } from './model.ts';
import type { Lane, Recording } from './types.ts';

const times = new WeakMap<Recording, number[]>();
// Each event's `at` in ms, in event order (non-decreasing).
export function eventTimes(rec: Recording): number[] {
  let t = times.get(rec);
  if (!t) {
    t = rec.events.map((e) => Date.parse(e.at));
    times.set(rec, t);
  }
  return t;
}

export const startMs = (rec: Recording): number => Date.parse(rec.start);
export const endMs = (rec: Recording): number => Date.parse(rec.end);

// How many events have happened at `ms` (every event with at ≤ ms).
export function appliedCount(rec: Recording, ms: number): number {
  const t = eventTimes(rec);
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= ms) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Each run's latest applied event index (-1 before its first), given `n` applied events.
function latestPerRun(rec: Recording, n: number): number[] {
  const last = rec.runs.map(() => -1);
  for (let i = 0; i < n; i++) last[rec.events[i].run] = i;
  return last;
}

const iso = (ms: number): string => new Date(ms).toISOString();

// One run's lane at `ms`, from its latest applied event: the frame with last_event_at and
// signal_lost_at restored from the playhead, plus the SIGNAL LOST overlay the live server adds
// (from event gaps alone: no event for signal_lost_ms on a working lane).
function laneFrom(rec: Recording, i: number, ms: number): Lane {
  const ev = rec.events[i];
  const frame = rec.frames[ev.frame];
  const working = !frame.terminal && !frame.parked;
  const at = Date.parse(ev.at);
  const slAt = working && Number.isFinite(at) ? iso(at + rec.signal_lost_ms) : null;
  const lost = slAt !== null && ms >= Date.parse(slAt);
  const needs_you = lost ? [...frame.needs_you, { ask_id: 'signal_lost', raised_at: slAt, card: rec.runs[ev.run].signal_lost_card }] : frame.needs_you;
  return { ...frame, last_event_at: ev.at, deadlines: { ...frame.deadlines, signal_lost_at: slAt }, needs_you, live: { signal_lost: lost } };
}

// The board at `ms`: started runs only, newest run_started first (projectBoard's order).
export function boardAt(rec: Recording, ms: number): Lane[] {
  const lanes: Lane[] = [];
  for (const i of latestPerRun(rec, appliedCount(rec, ms))) if (i >= 0) lanes.push(laneFrom(rec, i, ms));
  return lanes.filter((l) => l.started_at !== null)
    .sort((a, b) => b.started_at!.localeCompare(a.started_at!) || a.repo_hash.localeCompare(b.repo_hash) || a.run_id.localeCompare(b.run_id));
}

// What boardAt depends on at `ms`: the applied events and each lane's SIGNAL LOST flag. The board
// is recomputed only when this changes, not on every clock tick.
export function boardKey(rec: Recording, ms: number): string {
  const n = appliedCount(rec, ms);
  const lost = latestPerRun(rec, n).map((i) => {
    if (i < 0) return '-';
    const f = rec.frames[rec.events[i].frame];
    return !f.terminal && !f.parked && ms >= eventTimes(rec)[i] + rec.signal_lost_ms ? 'L' : '';
  });
  return `${n}|${lost.join(',')}`;
}

export interface Pip { index: number; at: number; id: string; kind: string; run: number; label: string }

// One gold pip per applied human decision, labelled `<event> · <run-id>` (never assuming one run).
export function pips(rec: Recording): Pip[] {
  const t = eventTimes(rec);
  const out: Pip[] = [];
  rec.events.forEach((e, index) => {
    if (e.decision) out.push({ index, at: t[index], id: e.id, kind: e.kind, run: e.run, label: `${eventName(e)} · ${rec.runs[e.run]?.run_id ?? '?'}` });
  });
  return out;
}

// The adjacent pip strictly before or after the playhead, or null.
export const prevPip = (ps: readonly Pip[], ms: number): Pip | null => [...ps].reverse().find((p) => p.at < ms) ?? null;
export const nextPip = (ps: readonly Pip[], ms: number): Pip | null => ps.find((p) => p.at > ms) ?? null;

// `hh:mm:ss` of a duration.
export function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

// The recording's day, `YYYY-MM-DD` (local).
export function recordedDay(ts: string): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// /replay/<name> → the recording name; `bad` for a malformed replay URL; null when not replay.
export function replayRoute(pathname: string): { name: string } | { bad: string } | null {
  const m = /^\/replay(?:\/(.*))?$/.exec(pathname);
  if (!m) return null;
  const raw = (m[1] ?? '').replace(/\/$/, '');
  let name: string;
  try { name = decodeURIComponent(raw); } catch { return { bad: raw }; }
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.includes('..') ? { name } : { bad: name };
}

// Does the drawer's source still exist on this board? A claim or decision whose card, or the item
// itself, is absent at the playhead closes the drawer.
export function selectionPresent(sel: Selection, lanes: readonly Lane[]): boolean {
  const lane = lanes.find((l) => laneKey(l) === sel.lane);
  const card = lane?.cards.find((c) => c.id === sel.card);
  if (!lane || !card) return false;
  if (sel.kind === 'claim') return card.claims.some((c) => c.step_id === sel.step);
  return card.seals.includes(sel.decision) && lane.decisions.some((d) => d.id === sel.decision);
}

// Replay shortcuts: Space plays or pauses, ←/→ go to the previous or next decision. Never while
// focus is on a native control (its own activation and arrow keys win), and never with a modifier.
export type Shortcut = 'toggle' | 'prev' | 'next';
interface KeyLike { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; target?: unknown }
const NATIVE = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY', 'OPTION', 'LABEL']);

export function isNativeControl(target: unknown): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  return !!el && typeof el.tagName === 'string' && (NATIVE.has(el.tagName.toUpperCase()) || el.isContentEditable === true);
}

export function replayShortcut(e: KeyLike): Shortcut | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isNativeControl(e.target)) return null;
  if (e.key === ' ' || e.key === 'Spacebar') return 'toggle';
  if (e.key === 'ArrowLeft') return 'prev';
  if (e.key === 'ArrowRight') return 'next';
  return null;
}

// `Needs You: N cards`, the one summary announced when 16× playback stops.
export function needsSummary(lanes: readonly Lane[]): string {
  const n = lanes.reduce((k, l) => k + l.needs_you.length, 0);
  return `Needs You: ${n} card${n === 1 ? '' : 's'}`;
}

// Pip label placement on a timeline `width` px wide: labels alternate above and below, anchored left
// of their pip (right past 70%), and a label that would overlap the previous one in its row is left
// out (the pip stays). Mono 11px ≈ 6.8 px a character.
export interface PipPlace { x: number; row: 'up' | 'dn' | null; anchor: 'l' | 'r' }
export function pipLayout(ps: readonly Pip[], start: number, end: number, width: number): PipPlace[] {
  const span = Math.max(1, end - start);
  const ends = { up: -Infinity, dn: -Infinity };
  let prefer: 'up' | 'dn' = 'up';
  return ps.map((p) => {
    const x = Math.min(100, Math.max(0, ((p.at - start) / span) * 100));
    const anchor = x > 70 ? 'r' : 'l';
    const w = p.label.length * 6.8 + 12;
    const px = (x / 100) * width;
    const [from, to] = anchor === 'l' ? [px - 4, px - 4 + w] : [px + 4 - w, px + 4];
    for (const row of [prefer, prefer === 'up' ? 'dn' : 'up'] as const) {
      if (from >= ends[row]) {
        ends[row] = to;
        prefer = row === 'up' ? 'dn' : 'up';
        return { x, row, anchor };
      }
    }
    return { x, row: null, anchor };
  });
}
