// The board's read model (AD-1, AD-7, AD-16, AD-23): one run's commands and facts → one lane. Pure: no
// I/O and no clock. Deadlines are absolute; only the browser compares them with `now`. The live-only
// SIGNAL LOST overlay (`live`) is added by the server at serve time and never cached.
import { budgetOf, openCutAsk, timeboxView } from './budget.ts';
import { HEARTBEAT_INTERVAL_MS, SIGNAL_LOST_MISSED } from './config.ts';
import type { AnyEvent, Card, Stage } from './events.ts';
import { isDecisionKind, TOOL_FACT_KINDS } from './events.ts';
import { boardStage, fold, isTerminal, openSteps, type RunState, type SliceState, type Step } from './reducer.ts';
import { claimOverlay, isParked, isVoided } from './verify.ts';

export type Column = 'backlog' | 'in_progress' | 'in_review' | 'needs_you' | 'done';
export type TrackStatus = 'pending' | 'active' | 'waiting' | 'done';

// Ids, kinds and paths only: never fact text.
export interface EvidenceRow { id: string; kind: string; ts: string | null; path?: string; check?: string; exit_code?: number }

export interface Claim {
  step_id: string;
  role: string;
  kind: string;
  state: 'claimed' | 'verified';
  reported_at: string;
  overdue_at: string;
  verdict?: string;
  superseded: boolean;
  evidence: EvidenceRow[];
}

export interface BoardCard {
  id: string;
  kind: 'stage' | 'slice';
  label: string;
  column: Column;
  state: string;
  rounds?: number;
  claims: Claim[];
  seals: string[]; // decision ids
  superseded: boolean;
  at_risk?: true; // a Backlog slice while the cut card is open: a cut candidate (3-1)
  tags?: string[]; // 3-3: the slice's tags and reviewer roster, as gate_2_passed recorded them
  roster?: string[];
  // 3-4: a live slice's Time box meter (not while an escalation pauses it): when its net time reaches
  // the limit, and the limit in minutes. The browser draws `elapsed / limit min` from them.
  timebox_ends_at?: string;
  timebox_min?: number;
}

export interface NeedsYou { ask_id: string; raised_at: string | null; slice?: string; card: Card }

export interface Decision {
  id: string;
  kind: string;
  at: string;
  decided_by: string;
  prompt_text: string | null;
  reason?: string;
  stage: Stage;
  evidence: string[];
  superseded: boolean;
}

// timebox_ends_at (3-4): the earliest time box end of the live slices.
export interface Deadlines { signal_lost_at: string | null; overdue_at: string | null; cut_at: string | null; ends_at: string | null; timebox_ends_at: string | null }

// The Budget clock (3-1): absolute times only; the browser counts down against its own clock. A
// terminal run's clock stops at its last command (stopped_at). Without a time limit (6-2) only
// clock_start is set, and the board counts elapsed time up from it.
export interface BudgetView { clock_start: string; limit_min: number | null; cut_at: string | null; ends_at: string | null; stopped_at: string | null }

export interface Lane {
  run_id: string;
  repo_hash: string;
  task: string | null;
  origin: 'brownfield' | 'greenfield';
  phase: RunState['phase'];
  stage: Stage;
  holder: string | null;
  started_at: string | null;
  last_event_at: string | null;
  terminal: boolean;
  parked: boolean;
  skipped: number;
  deadlines: Deadlines;
  budget: BudgetView | null; // null until a confirmed intake (with a clock start)
  stage_track: { stage: Stage; status: TrackStatus }[];
  gates: { n: 1 | 2; status: 'hollow' | 'waiting' | 'passed' }[];
  cards: BoardCard[];
  needs_you: NeedsYou[];
  decisions: Decision[];
  // 6-1: the Stop hook let the conductor's turn end through a recorded exit (stop_yielded: the human
  // rejected a tool call; stop_forced: the block cap), and nothing has happened in the run since.
  // Absent otherwise, so runs without stop facts project as before.
  paused?: Paused;
  live?: { signal_lost: boolean };
}

export interface Paused { reason: 'human_rejected' | 'block_cap'; at: string; blocks?: number }

export interface Board { runs: Lane[] }

// What loadRun returns, structurally (core does not import store).
export interface RunInput { state: RunState; commands: readonly AnyEvent[]; facts: readonly AnyEvent[]; skipped: readonly unknown[] }

const SLICE_COLUMN: Record<SliceState, Column> = {
  BACKLOG: 'backlog', BUILDING: 'in_progress', IN_REVIEW: 'in_review', FINDINGS_QUEUED: 'in_review', ESCALATED: 'needs_you', CLOSED: 'done', CUT: 'done',
};

// Board order. DESIGN runs beside SPEC (boardStage never returns it), so they share a rank.
const RANK: Record<Stage, number> = { INTAKE: 0, RECON: 1, FRAME: 1, SCAFFOLD: 2, SPEC: 3, DESIGN: 3, SLICE_PLAN: 4, BUILD: 5, WRAP: 6 };

const stageCard = (st: Stage): string => `stage:${st}`;
const sliceCard = (id: string): string => `slice:${id}`;

// Running stepwise over the commands: what the final state no longer holds.
interface Trace {
  started_at: string | null;
  issued: Map<string, string>; // step id → issued (or reissued) ts
  reported: Map<string, string>; // step id → newest step_reported ts
  verified: Map<string, string[]>; // step id → its step_verified evidence ids
  raised: Map<string, string>; // ask id → ask_raised ts
  decisions: { e: AnyEvent; before: RunState }[];
}

// One fold for the whole run (apply() per command clones the state each time: quadratic); the
// events it rejected are skipped, and a decision's `before` is the fold of the commands before it.
function trace(commands: readonly AnyEvent[]): Trace {
  const t: Trace = { started_at: null, issued: new Map(), reported: new Map(), verified: new Map(), raised: new Map(), decisions: [] };
  const rejected = new Set(fold(commands).rejected.map((r) => r.id));
  for (let i = 0; i < commands.length; i++) {
    const e = commands[i];
    if (rejected.has(e.id)) continue;
    switch (e.kind) {
      case 'run_started': t.started_at = e.ts; break;
      case 'step_issued': t.issued.set(e.id, e.ts); break;
      case 'step_reissued': t.issued.set(e.data.new, e.ts); break;
      case 'step_reported': t.reported.set(e.data.step_id, e.ts); break;
      case 'step_verified': t.verified.set(e.data.step_id, e.data.evidence.filter((x): x is string => typeof x === 'string')); break;
      case 'ask_raised': t.raised.set(e.id, e.ts); break;
      default: if (isDecisionKind(e.kind)) t.decisions.push({ e, before: fold(commands.slice(0, i)) });
    }
  }
  return t;
}

function evidenceRows(ids: readonly string[], byId: Map<string, AnyEvent>): EvidenceRow[] {
  return ids.map((id) => {
    const e = byId.get(id);
    if (!e) return { id, kind: 'ref', ts: null };
    const row: EvidenceRow = { id, kind: e.kind, ts: e.ts };
    if (e.kind === 'check_ran') { row.check = e.data.check; row.exit_code = e.data.exit_code; }
    if (e.kind === 'output_written') row.path = e.data.path;
    return row;
  });
}

const promptText = (data: unknown): string | null => {
  const p = (data as { prompt_text?: { data?: { prompt?: unknown } } } | null)?.prompt_text?.data?.prompt;
  return typeof p === 'string' ? p : null;
};

// The cards a decision seals. `multi` targets (DESIGN beside SPEC) only attach when that card exists.
function sealTargets(e: AnyEvent, before: RunState, orient: Stage): { cards: string[]; optional: string[] } {
  const one = (id: string): { cards: string[]; optional: string[] } => ({ cards: [id], optional: [] });
  const none = { cards: [], optional: [] };
  switch (e.kind) {
    case 'intake_confirmed': return one(stageCard('INTAKE'));
    case 'gate_1_passed': return { cards: [stageCard('SPEC')], optional: [stageCard('DESIGN')] };
    case 'gate_2_passed': return one(stageCard('SLICE_PLAN'));
    case 'merge_approved': return one(stageCard('WRAP'));
    case 'design_choice_made': return one(stageCard('DESIGN'));
    case 'rework_requested': {
      const t = e.data.target;
      if (t === 'gate1') return { cards: [stageCard('SPEC')], optional: [stageCard('DESIGN')] };
      if (t === 'gate2') return one(stageCard('SLICE_PLAN'));
      return one(sliceCard(t));
    }
    case 'escalation_ruled': {
      const ask = Object.values(before.asks).find((a) => a.open && a.escalation === e.data.escalation);
      if (!ask) return none;
      if (ask.slice) return one(sliceCard(ask.slice));
      const st = ask.step_id ? before.steps[ask.step_id] : undefined;
      const stage = st?.stage ?? boardStage(before);
      return stage === 'BUILD' ? none : one(stageCard(stage));
    }
    case 'cut_decided': {
      // A keep (nothing cut) seals the slices it kept in Backlog.
      const ids = e.data.cut.length ? e.data.cut : before.slice_order.filter((id) => before.slices[id]?.state === 'BACKLOG');
      return { cards: ids.map(sliceCard), optional: [] };
    }
    case 'stage_rerun_requested': return one(stageCard(e.data.stage === 'RECON' || e.data.stage === 'FRAME' ? orient : e.data.stage));
    case 'run_abandoned': {
      const stage = boardStage(before);
      if (stage !== 'BUILD') return one(stageCard(stage));
      // Every live slice (3-4: several may be in flight), else the next one not CLOSED or CUT.
      const open = before.slice_order.filter((id) => before.slices[id].state !== 'CLOSED' && before.slices[id].state !== 'CUT');
      const live = open.filter((id) => before.slices[id].state !== 'BACKLOG');
      return { cards: (live.length ? live : open.slice(0, 1)).map(sliceCard), optional: [] };
    }
    default: return none;
  }
}

export function projectRun(loaded: RunInput, opts: { repo_hash: string; run_id: string }): Lane {
  const s = loaded.state;
  const t = trace(loaded.commands);
  const byId = new Map<string, AnyEvent>();
  for (const e of loaded.facts) byId.set(e.id, e);
  for (const e of loaded.commands) byId.set(e.id, e);

  const orient: Stage = s.greenfield ? 'FRAME' : 'RECON';
  const hasDesign = s.step_order.some((id) => s.steps[id].stage === 'DESIGN') || t.decisions.some((d) => d.e.kind === 'design_choice_made');
  const track: Stage[] = ['INTAKE', orient, 'SCAFFOLD', 'SPEC', ...(hasDesign ? ['DESIGN' as const] : []), 'SLICE_PLAN', 'BUILD', 'WRAP'];
  const current = boardStage(s);
  const completed = s.phase === 'COMPLETED';
  const parked = isParked(s);

  // Needs You (AD-34): open escalations from state.asks, plus the open gate and merge cards (ask_human
  // steps; an escalation's own ask_human step repeats its ask, and intake is answered in the chat).
  const needs: (NeedsYou & { stage?: Stage })[] = [];
  for (const a of Object.values(s.asks)) {
    if (!a.open) continue;
    const st = a.step_id ? s.steps[a.step_id] : undefined;
    needs.push({ ask_id: a.id, raised_at: t.raised.get(a.id) ?? null, ...(a.slice ? { slice: a.slice } : { stage: st?.stage ?? current }), card: a.card });
  }
  for (const st of openSteps(s)) {
    // The cut card's ask_human step repeats its ask, like an escalation's.
    if (st.kind !== 'ask_human' || !st.card || st.card.escalation || st.card.type === 'intake' || st.card.type === 'cut') continue;
    needs.push({ ask_id: st.id, raised_at: t.issued.get(st.id) ?? null, stage: st.stage, card: st.card });
  }
  needs.sort((a, b) => (a.raised_at ?? '').localeCompare(b.raised_at ?? '') || a.ask_id.localeCompare(b.ask_id));
  const askedStages = new Set(needs.filter((n) => !n.slice && n.stage).map((n) => (n.stage === 'DESIGN' ? 'SPEC' : n.stage!)));

  const status = (stage: Stage): TrackStatus => {
    if (completed || RANK[stage] < RANK[current]) return 'done';
    if (RANK[stage] > RANK[current]) return 'pending';
    const key = stage === 'DESIGN' ? 'SPEC' : stage;
    return askedStages.has(key) || (parked && stage === current) ? 'waiting' : 'active';
  };

  // Claims: every reported step, on its slice's card or its stage's card.
  const claimsOf = new Map<string, Claim[]>();
  for (const id of s.step_order) {
    const st: Step = s.steps[id];
    const ov = claimOverlay(s, st, t.reported.get(id), t.verified.get(id));
    if (!ov.state) continue;
    const card = st.slice ? sliceCard(st.slice) : st.stage === 'BUILD' ? null : stageCard(st.stage);
    if (!card) continue;
    const claim: Claim = {
      step_id: id, role: st.role ?? st.check ?? st.kind, kind: st.kind, state: ov.state, reported_at: t.reported.get(id)!, overdue_at: ov.overdue_at!,
      ...(st.verdict ? { verdict: st.verdict } : {}), superseded: isVoided(s, id) || st.state === 'reissued' || st.state === 'cancelled', evidence: evidenceRows(ov.evidence, byId),
    };
    claimsOf.set(card, [...(claimsOf.get(card) ?? []), claim]);
  }

  // Decisions and their seals.
  const sealsOf = new Map<string, string[]>();
  const optionalSeals: [string, string][] = [];
  const decisions: Decision[] = [];
  for (const { e, before } of t.decisions) {
    const askCard = e.kind === 'escalation_ruled' ? Object.values(before.asks).find((a) => a.open && a.escalation === e.data.escalation)?.card : undefined;
    const data = e.data as { evidence?: unknown };
    decisions.push({
      id: e.id, kind: e.kind, at: e.ts, decided_by: e.actor, prompt_text: promptText(e.data),
      ...(askCard ? { reason: askCard.reason_label ? `${askCard.reason_label}: ${askCard.reason ?? ''}` : (askCard.reason ?? askCard.title) } : {}),
      stage: boardStage(before), evidence: Array.isArray(data.evidence) ? data.evidence.filter((x): x is string => typeof x === 'string') : [],
      superseded: isVoided(s, e.id),
    });
    const tg = sealTargets(e, before, orient);
    for (const c of tg.cards) sealsOf.set(c, [...(sealsOf.get(c) ?? []), e.id]);
    for (const c of tg.optional) optionalSeals.push([c, e.id]);
  }

  // Stage cards: every stage reached, and any stage holding claims or seals. BUILD has none: its slices are the cards.
  const cards: BoardCard[] = [];
  for (const stage of track) {
    if (stage === 'BUILD') continue;
    const id = stageCard(stage);
    const st = status(stage);
    if (st === 'pending' && !claimsOf.has(id) && !sealsOf.has(id)) continue;
    const column: Column = st === 'done' ? 'done' : st === 'pending' ? 'backlog' : askedStages.has(stage === 'DESIGN' ? 'SPEC' : stage) ? 'needs_you' : 'in_progress';
    cards.push({ id, kind: 'stage', label: stage.replace('_', ' '), column, state: s.phase === 'ABANDONED' && stage === current ? 'abandoned' : st, claims: claimsOf.get(id) ?? [], seals: sealsOf.get(id) ?? [], superseded: false });
  }
  const cutOpen = Boolean(openCutAsk(s));
  const timeboxEnds: string[] = [];
  for (const sid of s.slice_order) {
    const sl = s.slices[sid];
    const id = sliceCard(sid);
    const live = !isTerminal(s) && (sl.state === 'BUILDING' || sl.state === 'IN_REVIEW' || sl.state === 'FINDINGS_QUEUED');
    const tb = live ? timeboxView(s, loaded.commands, sid) : null;
    if (tb?.ends_at) timeboxEnds.push(tb.ends_at);
    cards.push({
      id, kind: 'slice', label: `${sid}${sl.title ? ` ${sl.title}` : ''}`, column: SLICE_COLUMN[sl.state], state: sl.state, rounds: sl.rounds, claims: claimsOf.get(id) ?? [], seals: sealsOf.get(id) ?? [], superseded: false,
      ...(cutOpen && sl.state === 'BACKLOG' ? { at_risk: true as const } : {}),
      ...(sl.tags ? { tags: [...sl.tags] } : {}), ...(sl.roster ? { roster: [...sl.roster] } : {}),
      ...(tb?.ends_at ? { timebox_ends_at: tb.ends_at, timebox_min: tb.limit_min } : {}),
    });
  }
  for (const [c, d] of optionalSeals) cards.find((x) => x.id === c)?.seals.push(d);
  for (const c of cards) c.seals.sort((a, b) => decisions.findIndex((d) => d.id === a) - decisions.findIndex((d) => d.id === b));

  let last: string | null = null;
  for (const e of loaded.commands) if (!last || e.ts > last) last = e.ts;
  for (const e of loaded.facts) if (!last || e.ts > last) last = e.ts;
  const terminal = isTerminal(s);
  const working = !terminal && !parked;
  const openClaims = cards.flatMap((c) => c.claims).filter((c) => c.state === 'claimed' && !c.superseded).map((c) => c.overdue_at).sort();
  const phaseAt = (p: RunState['phase']): number => ['INTAKE', 'ORIENT', 'SCAFFOLD', 'SPEC_DESIGN', 'SLICE_PLAN', 'BUILD', 'WRAP', 'MERGED', 'COMPLETED'].indexOf(p);
  const reached = phaseAt(s.phase === 'ABANDONED' ? (s.abandoned_from ?? 'INTAKE') : s.phase);
  const b = budgetOf(s);
  const paused = pausedOf(loaded, terminal);
  const gate = (n: 1 | 2, passedAt: number, type: string): Lane['gates'][number] => ({
    n, status: reached >= passedAt ? 'passed' : openSteps(s).some((st) => st.kind === 'ask_human' && st.card?.type === type) ? 'waiting' : 'hollow',
  });

  return {
    run_id: opts.run_id, repo_hash: opts.repo_hash, task: s.task, origin: s.greenfield ? 'greenfield' : 'brownfield',
    phase: s.phase, stage: current, holder: s.holder, started_at: t.started_at, last_event_at: last, terminal, parked, skipped: loaded.skipped.length,
    deadlines: {
      signal_lost_at: working ? isoPlus(last, HEARTBEAT_INTERVAL_MS * SIGNAL_LOST_MISSED) : null,
      overdue_at: openClaims[0] ?? null, cut_at: b && !terminal ? b.cut_at : null, ends_at: b && !terminal ? b.ends_at : null,
      timebox_ends_at: timeboxEnds.sort()[0] ?? null,
    },
    budget: b ? { clock_start: b.clock_start, limit_min: b.limit_min, cut_at: b.cut_at, ends_at: b.ends_at, stopped_at: terminal ? s.last_ts : null }
      : s.intake && s.clock_start ? { clock_start: s.clock_start, limit_min: null, cut_at: null, ends_at: null, stopped_at: terminal ? s.last_ts : null } : null,
    stage_track: track.map((stage) => ({ stage, status: status(stage) })),
    gates: [gate(1, phaseAt('SLICE_PLAN'), 'gate_1'), gate(2, phaseAt('BUILD'), 'gate_2')],
    cards,
    needs_you: needs.map(({ stage: _stage, ...n }) => n),
    decisions,
    ...(paused ? { paused } : {}),
  };
}

// The PAUSED notice (6-1): the newest stop fact, while it is newer than every command and every
// main-agent tool fact of its session, on a run that has not ended.
function pausedOf(loaded: RunInput, terminal: boolean): Paused | null {
  if (terminal) return null;
  let newest: AnyEvent | null = null;
  for (const f of loaded.facts) if ((f.kind === 'stop_yielded' || f.kind === 'stop_forced') && (!newest || f.ts >= newest.ts)) newest = f;
  if (!newest) return null;
  const stop = newest;
  const at = stop.ts;
  if (loaded.commands.some((e) => e.ts >= at)) return null;
  const mainTool = (f: AnyEvent): boolean => (TOOL_FACT_KINDS as readonly string[]).includes(f.kind) && f.session === stop.session && (f.data as { agent_id?: unknown }).agent_id === undefined;
  if (loaded.facts.some((f) => mainTool(f) && f.ts >= at)) return null;
  return stop.kind === 'stop_forced' ? { reason: 'block_cap', at, blocks: stop.data.blocks } : { reason: 'human_rejected', at };
}

// `ts` + `ms`, or null when `ts` is missing or not a real date (TS_RE admits month 13).
function isoPlus(ts: string | null, ms: number): string | null {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? new Date(t + ms).toISOString() : null;
}

// Started runs only, newest run_started first.
export function projectBoard(lanes: readonly Lane[]): Board {
  const runs = lanes.filter((l) => l.started_at !== null)
    .sort((a, b) => b.started_at!.localeCompare(a.started_at!) || a.repo_hash.localeCompare(b.repo_hash) || a.run_id.localeCompare(b.run_id));
  return { runs: [...runs] };
}
