// Pure, DOM-free view logic for the board (2-2). Everything here derives from the 2-1 Lane shape;
// the only clock is the `now` passed in, compared against the projection's absolute deadlines. The
// browser holds no thresholds.
import type { ArtifactView, BoardCard, BudgetView, Card, CardOption, Claim, Column, Decision, Frame, Lane, NeedsYou, Stage, TrackStatus } from './types.ts';

export const COLUMNS: readonly Column[] = ['backlog', 'in_progress', 'in_review', 'needs_you', 'done'];
export const COLUMN_TITLE: Record<Column, string> = { backlog: 'Backlog', in_progress: 'In Progress', in_review: 'In Review', needs_you: 'Needs You', done: 'Done' };

// Beyond this many Done cards the oldest collapse into the deck; the newest DONE_SHOWN stay.
export const DONE_MAX = 5;
export const DONE_SHOWN = 4;

export const laneKey = (lane: Pick<Lane, 'repo_hash' | 'run_id'>): string => `${lane.repo_hash}/${lane.run_id}`;

// Cards grouped by column, each in pipeline order (stages, then slices).
export function cells(lane: Lane): Record<Column, BoardCard[]> {
  const out: Record<Column, BoardCard[]> = { backlog: [], in_progress: [], in_review: [], needs_you: [], done: [] };
  for (const c of lane.cards) (out[c.column] ?? out.backlog).push(c);
  return out;
}

// Board-wide column counts. Needs You counts what waits on d2t (the lane's needs_you entries).
export function counts(lanes: readonly Lane[]): Record<Column, number> {
  const n: Record<Column, number> = { backlog: 0, in_progress: 0, in_review: 0, needs_you: 0, done: 0 };
  for (const lane of lanes) {
    for (const c of lane.cards) if (c.column !== 'needs_you' && n[c.column] !== undefined) n[c.column]++;
    n.needs_you += lane.needs_you.length;
  }
  return n;
}

// The Done stack (EXPERIENCE Component Patterns): newest first. The projection has no completion
// time per card, so pipeline order is the proxy and the newest card is the last one. The projection
// lists every stage card before the slices, but WRAP runs after BUILD, so the true order is the
// stages up to SLICE PLAN, then the slices, then WRAP. Beyond DONE_MAX cards, the DONE_SHOWN newest
// stay and the rest (in pipeline order) collapse into the deck.
export function doneDeck(cards: readonly BoardCard[]): { shown: BoardCard[]; rest: BoardCard[] } {
  const wrap = (c: BoardCard): boolean => c.kind === 'stage' && c.label === 'WRAP';
  const ordered = [...cards.filter((c) => c.kind === 'stage' && !wrap(c)), ...cards.filter((c) => c.kind === 'slice'), ...cards.filter(wrap)];
  const newestFirst = [...ordered].reverse();
  if (ordered.length <= DONE_MAX) return { shown: newestFirst, rest: [] };
  return { shown: newestFirst.slice(0, DONE_SHOWN), rest: ordered.slice(0, ordered.length - DONE_SHOWN) };
}

export type ChipState = 'claimed' | 'verified' | 'unverified' | 'superseded';

// A voided claim is superseded whatever it said; a verified one stays verified; a claimed one past
// its overdue_at is UNVERIFIED with no server event. A claim waiting on Master d2t or on checks has
// no overdue_at (6-3) and stays CLAIMED.
export function chipState(claim: Claim, now: number): ChipState {
  if (claim.superseded) return 'superseded';
  if (claim.state === 'verified') return 'verified';
  const due = claim.overdue_at ? Date.parse(claim.overdue_at) : NaN;
  return Number.isFinite(due) && now >= due ? 'unverified' : 'claimed';
}

export const CHIP_WORD: Record<ChipState, string> = { claimed: 'CLAIMED', verified: 'VERIFIED', unverified: 'UNVERIFIED', superseded: 'SUPERSEDED' };

// The chip's gloss (6-3): `· no hook fact` on UNVERIFIED; on CLAIMED what the claim waits on,
// `· awaiting Master d2t` or `· checks running`. A gloss on CLAIMED, never a fourth state.
export function chipGloss(claim: Pick<Claim, 'waiting_on'>, state: ChipState): string {
  if (state === 'unverified') return '· no hook fact';
  if (state !== 'claimed') return '';
  return claim.waiting_on === 'human' ? '· awaiting Master d2t' : claim.waiting_on === 'checks' ? '· checks running' : '';
}

// The Claim drawer's proof row while there is no proof: `waiting on Master d2t — <card title>`,
// `waiting on <checks>`, `no hook fact` (UNVERIFIED) or `none yet`.
export function proofRow(claim: Pick<Claim, 'waiting_on' | 'waiting_for'>, state: ChipState): string {
  if (state === 'unverified') return 'no hook fact';
  if (state === 'claimed' && claim.waiting_on === 'human') return `waiting on Master d2t${claim.waiting_for ? ` — ${claim.waiting_for}` : ''}`;
  if (state === 'claimed' && claim.waiting_on === 'checks') return `waiting on ${claim.waiting_for ?? 'checks'}`;
  return 'none yet';
}

// Claim counts for the Truth legend; superseded claims are left out.
export function truthCounts(lanes: readonly Lane[], now: number): { claimed: number; verified: number; unverified: number } {
  const n = { claimed: 0, verified: 0, unverified: 0 };
  for (const lane of lanes) for (const c of lane.cards) for (const cl of c.claims) {
    const s = chipState(cl, now);
    if (s !== 'superseded') n[s]++;
  }
  return n;
}

// A card's seals as decisions, in the card's order; unknown ids are skipped.
export function sealsOf(card: Pick<BoardCard, 'seals'>, lane: Pick<Lane, 'decisions'>): Decision[] {
  const byId = new Map(lane.decisions.map((d) => [d.id, d]));
  return card.seals.map((id) => byId.get(id)).filter((d): d is Decision => d !== undefined);
}

const TYPE_TAGS: Record<string, string> = {
  gate_1: 'GATE', gate_2: 'GATE', merge: 'MERGE', escalation: 'ESCALATION', scaffold_failure: 'ESCALATION', design_choice: 'ESCALATION', cut: 'CUT', signal_lost: 'SIGNAL LOST',
};

export function typeTag(card: Pick<Card, 'type'>): string {
  return TYPE_TAGS[card.type] ?? card.type.replace(/_/g, ' ').toUpperCase();
}

// Verdict words (EXPERIENCE Verdict words): APPROVE and ESCALATE as they are, anything else is the
// first line cut to 14 characters (the full line is the accessible name).
export function verdictText(v: string): string {
  const first = v.split('\n')[0].trim();
  if (first === 'APPROVE' || first === 'ESCALATE') return first;
  return first.length > 14 ? first.slice(0, 14) : first;
}

export function verdictTone(v: string): 'plain' | 'other' {
  const w = verdictText(v);
  return w === 'APPROVE' || w === 'ESCALATE' ? 'plain' : 'other';
}

// `4m ago`, `2d ago`: how long since `ts`, in the largest whole unit.
export function ago(ts: string | null, now: number): string {
  const t = ts ? Date.parse(ts) : NaN;
  if (!Number.isFinite(t)) return 'never';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const pad = (n: number): string => String(n).padStart(2, '0');
// Local wall-clock time of an ISO timestamp: `14:36`, or `14:02:09` with seconds.
export function clockTime(ts: string | null, seconds = false): string {
  const t = ts ? new Date(ts) : null;
  if (!t || !Number.isFinite(t.getTime())) return '—';
  return `${pad(t.getHours())}:${pad(t.getMinutes())}${seconds ? `:${pad(t.getSeconds())}` : ''}`;
}

// The lane header's PAUSED notice (6-1), or null: `PAUSED · you rejected a tool call 15:24` or
// `PAUSED · the conductor stopped after 3 blocks 15:24`, in local time.
export function pausedNotice(lane: Pick<Lane, 'paused'>): string | null {
  const p = lane.paused;
  if (!p) return null;
  const why = p.reason === 'human_rejected' ? 'you rejected a tool call' : `the conductor stopped after ${p.blocks ?? '?'} blocks`;
  return `PAUSED · ${why} ${clockTime(p.at)}`;
}

const gatePassed = (lane: Lane, n: 1 | 2): boolean => lane.gates.some((g) => g.n === n && g.status === 'passed');

// Why an empty cell is empty. Only Backlog has a pending reason: before any slice exists it waits
// on the gate that deals them. Idle cells (and runs that ended) stay blank.
export function emptyCellCopy(lane: Lane, column: Column): { title: string; body: string } | null {
  if (column !== 'backlog' || lane.terminal) return null;
  if (lane.cards.some((c) => c.kind === 'slice' || c.column === 'backlog')) return null;
  const body = 'Slices are dealt here once the slice plan clears Gate 2.';
  if (!gatePassed(lane, 1)) return { title: 'AWAITING GATE 1', body };
  if (!gatePassed(lane, 2)) return { title: 'AWAITING GATE 2', body };
  return null;
}

const byStart = (a: Lane, b: Lane): number =>
  (b.started_at ?? '').localeCompare(a.started_at ?? '') || a.repo_hash.localeCompare(b.repo_hash) || a.run_id.localeCompare(b.run_id);

// One SSE `event: run`: that lane replaced in place (key repo_hash/run_id), or inserted by
// started_at, newest on top. An unstarted lane is not on the board.
export function upsertLane(lanes: readonly Lane[], lane: Lane): Lane[] {
  const k = laneKey(lane);
  const i = lanes.findIndex((l) => laneKey(l) === k);
  if (lane.started_at === null) return i < 0 ? [...lanes] : lanes.filter((_, j) => j !== i);
  if (i >= 0) return lanes.map((l, j) => (j === i ? lane : l));
  const out = [...lanes];
  const at = out.findIndex((l) => byStart(lane, l) < 0);
  out.splice(at < 0 ? out.length : at, 0, lane);
  return out;
}

// --- cards ---------------------------------------------------------------------------------------

// A slice card's label is `<id> <title>`.
export function sliceParts(card: Pick<BoardCard, 'label'>): { sid: string; title: string } {
  const i = card.label.indexOf(' ');
  return i < 0 ? { sid: card.label, title: '' } : { sid: card.label.slice(0, i), title: card.label.slice(i + 1) };
}

export const shortLabel = (card: Pick<BoardCard, 'kind' | 'label'>): string => (card.kind === 'slice' ? sliceParts(card).sid : card.label);

// The card an agent works now: the lane's SIGNAL LOST variant goes here.
export function activeCardId(lane: Lane): string | null {
  const c = cells(lane);
  const pick = c.in_progress[0] ?? c.in_review[0] ?? c.needs_you[0] ?? lane.cards.find((x) => x.kind === 'stage' && x.label === lane.stage.replace('_', ' ') && x.column !== 'done');
  return pick?.id ?? null;
}

// The Needs You cell: each needs_you entry with the cards it stands for (an escalated slice; the
// stage cards waiting at a gate or merge), then any needs_you-column card no entry claimed.
export interface NeedsGroup { needs: NeedsYou; cards: BoardCard[] }
export function needsCell(lane: Lane): { groups: NeedsGroup[]; loose: BoardCard[] } {
  const waiting = cells(lane).needs_you;
  const used = new Set<string>();
  const groups = lane.needs_you.map((needs): NeedsGroup => ({ needs, cards: [] }));
  for (const g of groups) {
    if (!g.needs.slice) continue;
    const c = waiting.find((x) => x.id === `slice:${g.needs.slice}`);
    if (c) { g.cards.push(c); used.add(c.id); }
  }
  const host = groups.find((g) => !g.needs.slice && g.needs.ask_id !== 'signal_lost');
  if (host) for (const c of waiting) if (c.kind === 'stage' && !used.has(c.id)) { host.cards.push(c); used.add(c.id); }
  return { groups, loose: waiting.filter((c) => !used.has(c.id)) };
}

// --- people --------------------------------------------------------------------------------------

// DESIGN Character roster and Check droids: display (short) names by role, and by run_check id (7-2).
// Characters carry their role color; the check droids carry a role label and an outlined dot
// instead (no role color). An unknown role shows as itself, drawn as the conductor (sprites.ts).
export const ROSTER: Record<string, { name: string; color?: string; label?: string; outline?: true }> = {
  builder: { name: 'Brix', color: 'var(--role-builder)' },
  designer: { name: 'Sela Venn', color: 'var(--role-designer)' },
  'reviewer-code': { name: 'Tarvus', color: 'var(--role-reviewer-code)' },
  'reviewer-security': { name: 'Kael Nox', color: 'var(--role-reviewer-security)' },
  'reviewer-ux': { name: 'Mira Sol', color: 'var(--role-reviewer-ux)' },
  'reviewer-a11y': { name: 'Pell', color: 'var(--role-reviewer-a11y)' },
  'reviewer-ui': { name: 'Quill', color: 'var(--role-reviewer-ui)' },
  recon: { name: 'Nyra', color: 'var(--role-recon)' },
  framer: { name: 'Halden', color: 'var(--role-framer)' },
  scaffolder: { name: 'Tamsin', color: 'var(--role-scaffolder)' },
  'spec-writer': { name: 'Ione', color: 'var(--role-spec-writer)' },
  slicer: { name: 'Sorel', color: 'var(--role-slicer)' },
  'contract.install': { name: 'Crate', label: 'install check', outline: true },
  'contract.health': { name: 'Pulse', label: 'health check', outline: true },
  'contract.test': { name: 'Gauge', label: 'test check', outline: true },
  'spec.lint': { name: 'Margin', label: 'spec lint', outline: true },
  'plan.lint': { name: 'Tally', label: 'plan lint', outline: true },
};

export const displayName = (role: string): string => ROSTER[role]?.name ?? role;
export const roleColor = (role: string): string => ROSTER[role]?.color ?? 'var(--line-strong)';
// The plain role label beside a name: the role itself, or a check droid's label (`health check`).
export const roleLabel = (role: string): string => ROSTER[role]?.label ?? role;
// A check droid (7-2): an outlined dot, never a role color.
export const isDroid = (role: string): boolean => ROSTER[role]?.outline === true;
// A role's 6px dot: a check droid's is outlined (class `droid`, no inline fill); anyone else's is
// filled with their role color.
export const roleDot = (role: string): { droid: boolean; style: string } =>
  (isDroid(role) ? { droid: true, style: '' } : { droid: false, style: `background:${roleColor(role)}` });
export const isReviewer = (role: string): boolean => role.startsWith('reviewer');
export const decider = (by: string): string => (by === 'human' ? 'Master d2t' : by);

// The Verdict list's pending rows (3-3): each rostered reviewer of a slice that is being built or
// reviewed and has no live claim yet. Backlog, Done and cut slices show none.
export function pendingReviewers(card: Pick<BoardCard, 'kind' | 'state' | 'roster' | 'claims'>): string[] {
  if (card.kind !== 'slice' || !card.roster || ['BACKLOG', 'CLOSED', 'CUT'].includes(card.state)) return [];
  const claimed = new Set(card.claims.filter((c) => isReviewer(c.role) && !c.superseded).map((c) => c.role));
  return card.roster.filter((r) => !claimed.has(r));
}

// The Verdict list's generic "reviewers reviewing…" row: a slice in review with no verdict since the
// newest builder report. Pending roster rows already say who is at it, so with any of those, none.
export function reviewersAtWork(card: Pick<BoardCard, 'kind' | 'state' | 'roster' | 'claims'>): boolean {
  if (card.state !== 'IN_REVIEW' || pendingReviewers(card).length) return false;
  const built = card.claims.filter((c) => !isReviewer(c.role)).map((c) => c.reported_at).sort().at(-1) ?? '';
  return !card.claims.some((c) => isReviewer(c.role) && !c.superseded && c.reported_at > built);
}

// Who stands at a card (7-2): at an In Progress card its stage's agent (the builder at a slice;
// INTAKE and WRAP are the conductor's own and show none), at a slice In Review the reviewers that
// reported, then the check droids of its running checks, deduped. Other columns show no crew.
export const STAGE_AGENT: Record<string, string> = { RECON: 'recon', FRAME: 'framer', SCAFFOLD: 'scaffolder', SPEC: 'spec-writer', DESIGN: 'designer', 'SLICE PLAN': 'slicer' };
export function agentsAt(card: Pick<BoardCard, 'kind' | 'label' | 'column' | 'claims' | 'checks_running'>): string[] {
  let who: string[];
  if (card.column === 'in_progress') who = card.kind === 'slice' ? ['builder'] : STAGE_AGENT[card.label] ? [STAGE_AGENT[card.label]] : [];
  else if (card.column === 'in_review') who = card.claims.filter((x) => isReviewer(x.role) && !x.superseded).map((x) => x.role);
  else return [];
  return [...new Set([...who, ...(card.checks_running ?? [])])];
}

// The Time box meter of a live slice (3-4): `12 / 30 min`, the share used (0..1), and over (amber)
// once the net elapsed time reaches the limit. Null without a running box (paused while escalated).
export function timeboxMeter(card: Pick<BoardCard, 'timebox_ends_at' | 'timebox_min'>, now: number): { text: string; fill: number; over: boolean } | null {
  const ends = card.timebox_ends_at ? Date.parse(card.timebox_ends_at) : NaN;
  const limit = card.timebox_min ?? 0;
  if (!Number.isFinite(ends) || limit <= 0) return null;
  const elapsed = Math.max(0, Math.floor(limit - (ends - now) / 60_000));
  return { text: `${elapsed} / ${limit} min`, fill: Math.min(1, elapsed / limit), over: now >= ends };
}

// --- decisions -----------------------------------------------------------------------------------

const EVENT_NAME: Record<string, string> = {
  intake_confirmed: 'Intake', gate_1_passed: 'Gate 1', gate_2_passed: 'Gate 2', merge_approved: 'Merge', escalation_ruled: 'Escalation',
  rework_requested: 'Rework', cut_decided: 'Cut', design_choice_made: 'Design choice', stage_rerun_requested: 'Rerun', run_abandoned: 'Abandon',
};
export const eventName = (d: Pick<Decision, 'kind'>): string => EVENT_NAME[d.kind] ?? d.kind.replace(/_/g, ' ');

// The seal line: what was decided, and by whom.
export function sealLine(d: Pick<Decision, 'kind' | 'decided_by'>): string {
  const who = decider(d.decided_by);
  switch (d.kind) {
    case 'intake_confirmed': return `intake confirmed · ${who}`;
    case 'gate_1_passed': return `Gate 1 · approved by ${who}`;
    case 'gate_2_passed': return `Gate 2 · approved by ${who}`;
    case 'merge_approved': return `merge OK · ${who}`;
    case 'escalation_ruled': return `escalation ruled · ${who}`;
    case 'rework_requested': return `rework · ${who}`;
    case 'cut_decided': return `cut · ${who}`;
    case 'design_choice_made': return `design choice · ${who}`;
    case 'stage_rerun_requested': return `rerun · ${who}`;
    case 'run_abandoned': return `abandoned · ${who}`;
    default: return `${d.kind.replace(/_/g, ' ')} · ${who}`;
  }
}

// --- swimlane header -----------------------------------------------------------------------------

export type StepLook = 'done' | 'now' | 'future';
export type GateLook = 'passed' | 'waiting' | 'hollow';
export type TrackItem = { kind: 'step'; label: string; look: StepLook } | { kind: 'gate'; label: string; look: GateLook };

// The Stage track: INTAKE · RECON/FRAME · SCAFFOLD · SPEC∥DESIGN · ◆GATE 1 · SLICE PLAN · ◆GATE 2 ·
// BUILD · WRAP · ◆MERGE. A stage waiting on d2t at a gate (or the merge) reads done; the gate waits.
export function stageTrack(lane: Lane): TrackItem[] {
  const st = new Map(lane.stage_track.map((s) => [s.stage, s.status]));
  const gate = (n: 1 | 2): GateLook => lane.gates.find((g) => g.n === n)?.status ?? 'hollow';
  const merged = lane.phase === 'MERGED' || lane.phase === 'COMPLETED';
  const mergeLook: GateLook = merged ? 'passed' : st.get('WRAP') === 'waiting' ? 'waiting' : 'hollow';
  const look = (s: TrackStatus | undefined, gated: boolean): StepLook =>
    s === 'done' ? 'done' : s === 'active' ? 'now' : s === 'waiting' ? (gated ? 'done' : 'now') : 'future';
  const orient: Stage = st.has('FRAME') ? 'FRAME' : 'RECON';
  const g1 = gate(1);
  const g2 = gate(2);
  return [
    { kind: 'step', label: 'INTAKE', look: look(st.get('INTAKE'), false) },
    { kind: 'step', label: orient, look: look(st.get(orient), false) },
    { kind: 'step', label: 'SCAFFOLD', look: look(st.get('SCAFFOLD'), false) },
    { kind: 'step', label: st.has('DESIGN') ? 'SPEC∥DESIGN' : 'SPEC', look: look(st.get('SPEC'), g1 === 'waiting') },
    { kind: 'gate', label: 'GATE 1', look: g1 },
    { kind: 'step', label: 'SLICE PLAN', look: look(st.get('SLICE_PLAN'), g2 === 'waiting') },
    { kind: 'gate', label: 'GATE 2', look: g2 },
    { kind: 'step', label: 'BUILD', look: look(st.get('BUILD'), false) },
    { kind: 'step', label: 'WRAP', look: look(st.get('WRAP'), mergeLook === 'waiting') },
    { kind: 'gate', label: 'MERGE', look: mergeLook },
  ];
}

// The header's `STAGE …` word: the waiting gate (or MERGE) in gold while parked on d2t.
export function stageWord(lane: Lane): { text: string; gold: boolean } {
  if (lane.phase === 'COMPLETED') return { text: 'COMPLETE', gold: false };
  if (lane.phase === 'ABANDONED') return { text: 'ABANDONED', gold: false };
  const waiting = stageTrack(lane).find((t) => t.kind === 'gate' && t.look === 'waiting');
  if (waiting) return { text: waiting.label, gold: true };
  return { text: lane.stage.replace('_', ' '), gold: lane.parked };
}

// --- Budget clock --------------------------------------------------------------------------------

// `h:mm` of whole minutes.
const hmm = (min: number): string => `${Math.floor(min / 60)}:${pad(min % 60)}`;

export interface ClockView {
  value: string; // `1:12` left, or `+m:ss` past 0:00
  limit: string; // `2:00`
  over: boolean;
  fill: number; // the share of the budget left, 0..1 (empty when over)
  cut: number; // the cut marker's position from the left, 0..1
  cutLeft: string; // `0:40`: the time left at the cut point
}

// DESIGN Budget clock: counts down from the limit and never pauses; a terminal run's clock stops at
// its last command, and a browser clock behind clock_start shows the full limit. The cut marker sits where the time left equals the cut lead (ends_at − cut_at).
export function budgetClock(b: BudgetView | null, now: number): ClockView | null {
  if (!b || b.limit_min === null || b.ends_at === null || b.cut_at === null) return null;
  const start = Date.parse(b.clock_start);
  const ends = Date.parse(b.ends_at);
  const cutAt = Date.parse(b.cut_at);
  if (![start, ends, cutAt].every(Number.isFinite)) return null;
  const stop = b.stopped_at ? Date.parse(b.stopped_at) : NaN;
  const at = Math.max(start, Number.isFinite(stop) ? Math.min(now, stop) : now);
  const total = Math.max(1, ends - start);
  const left = ends - at;
  const lead = Math.max(0, ends - cutAt);
  const clamp = (x: number): number => Math.min(1, Math.max(0, x));
  const over = left < 0;
  const s = Math.floor(-left / 1000);
  return {
    value: over ? `+${Math.floor(s / 60)}:${pad(s % 60)}` : hmm(Math.ceil(left / 60_000)),
    limit: hmm(b.limit_min),
    over,
    fill: over ? 0 : clamp(left / total),
    cut: clamp(lead / total),
    cutLeft: hmm(Math.round(lead / 60_000)),
  };
}

// The no-limit variant (6-2): `ELAPSED 0:47 · no limit`, whole minutes as `h:mm`, counting up from
// clock_start and stopping at stopped_at. Null with a time limit (the Budget clock shows instead).
export function elapsedClock(b: BudgetView | null, now: number): { value: string } | null {
  if (!b || b.limit_min !== null) return null;
  const start = Date.parse(b.clock_start);
  if (!Number.isFinite(start)) return null;
  const stop = b.stopped_at ? Date.parse(b.stopped_at) : NaN;
  const at = Number.isFinite(stop) ? Math.min(now, stop) : now;
  return { value: hmm(Math.floor(Math.max(0, at - start) / 60_000)) };
}

// --- Action slot (6-2) ---------------------------------------------------------------------------

// 8-2: a mirror of src/core/cards.ts CLEAR_SAFE_LINE (the web never imports core); test/web-model
// checks the two are equal.
export const CLEAR_SAFE_LINE = 'Safe to `/clear` here: the run is saved. After clearing, type one of the commands above.';

// The Action slot's rows: each option (command and its then line) and the card's reply. A card
// recorded before 6-2 has only commands: those rows have no then, and there is no reply. 8-2: a card
// with clear_safe closes with the clear line, after the reply, in either shape.
export function actionRows(card: Pick<Card, 'commands' | 'options' | 'reply' | 'clear_safe'>): { rows: CardOption[]; reply?: string; clear?: string } {
  const clear = card.clear_safe ? { clear: CLEAR_SAFE_LINE } : {};
  if (!card.options) return { rows: card.commands.map((command) => ({ command, then: '' })), ...clear };
  return { rows: card.options, ...(card.reply ? { reply: card.reply } : {}), ...clear };
}

// --- Artifacts (6-3) -----------------------------------------------------------------------------

// A replay frame with its artifact bodies joined back from the recording's artifact_bodies.
export function withBodies(frame: Frame, bodies: Record<string, string> | undefined): Lane {
  if (!frame.artifacts) return frame as Lane;
  return { ...frame, artifacts: frame.artifacts.map((a) => ({ ...a, body: bodies?.[a.id] ?? '' })) };
}

// The artifact with this id, else the newest one of the step with this id (a Decision drawer's
// evidence ids are step ids), or null.
export function artifactFor(lane: Pick<Lane, 'artifacts'>, id: string): ArtifactView | null {
  const all = lane.artifacts ?? [];
  return all.find((a) => a.id === id) ?? all.filter((a) => a.step_id === id).at(-1) ?? null;
}

// The artifact an intake seal opens: the intake it pinned.
export function sealArtifact(lane: Pick<Lane, 'artifacts'>, d: Pick<Decision, 'id' | 'kind' | 'evidence'>): ArtifactView | null {
  if (d.kind !== 'intake_confirmed') return null;
  return (lane.artifacts ?? []).find((a) => a.pinned_by === d.id && a.stage === 'INTAKE') ?? d.evidence.map((id) => artifactFor(lane, id)).find((a) => a !== null) ?? null;
}

// The Gate card's file rows: its files, as artifacts.
export function gateFiles(lane: Pick<Lane, 'artifacts'>, needs: Pick<NeedsYou, 'files'>): ArtifactView[] {
  return (needs.files ?? []).map((id) => artifactFor(lane, id)).filter((a): a is ArtifactView => a !== null);
}

// The Artifact drawer's `pinned` row: `pinned by <seal line>` (gold) or `not yet approved`.
export function pinnedLine(lane: Pick<Lane, 'decisions'>, a: Pick<ArtifactView, 'pinned_by'>): { text: string; decision: Decision | null } {
  const d = a.pinned_by ? lane.decisions.find((x) => x.id === a.pinned_by) ?? null : null;
  return d ? { text: `pinned by ${sealLine(d)}`, decision: d } : { text: 'not yet approved', decision: null };
}

// The card an artifact belongs to: its stage card (evidence-selected while the drawer shows it).
export const artifactCard = (a: Pick<ArtifactView, 'stage'>): string => `stage:${a.stage}`;
export const shortSha = (sha: string): string => sha.slice(0, 12);
