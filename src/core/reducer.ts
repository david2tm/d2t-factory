// The one reducer (AD-1): folds commands.jsonl into run state. Pure: no I/O.
// The fold is total and never throws. An event that is illegal in the current state is recorded in
// `rejected` and otherwise ignored; the CLI calls `apply` before appending to refuse it up front.
import type { AnyEvent, Card, Check, Envelope, Intake, ReconEmbed, Stage, StepKind } from './events.ts';
import { isFactKind } from './events.ts';

// Reducer state names (Structural Seed run diagram). ORIENT is RECON or FRAME; SPEC_DESIGN is SPEC plus DESIGN.
export type Phase = 'INTAKE' | 'ORIENT' | 'SCAFFOLD' | 'SPEC_DESIGN' | 'SLICE_PLAN' | 'BUILD' | 'WRAP' | 'MERGED' | 'COMPLETED' | 'ABANDONED';
// 3-4: `cancelled` closes an open step without a result (step_cancelled).
export type StepState = 'issued' | 'claimed' | 'reported' | 'verified' | 'reissued' | 'cancelled';
export type SliceState = 'BACKLOG' | 'BUILDING' | 'IN_REVIEW' | 'FINDINGS_QUEUED' | 'ESCALATED' | 'CLOSED' | 'CUT';

export interface Step {
  id: string;
  kind: StepKind;
  stage: Stage;
  attempt: number;
  state: StepState;
  role?: string;
  agent?: string;
  agent_id?: string;
  slice?: string;
  output_path?: string;
  brief_path?: string;
  card?: Card;
  check?: Check;
  output?: Record<string, unknown>; // step_reported.output: the parsed projection (AD-23)
  claimed_by?: string;
  sha?: string;
  verdict?: string;
  issued_seq: number;
}

export interface Slice {
  id: string;
  title?: string;
  acs?: string[];
  notes?: string[];
  deps: string[];
  state: SliceState;
  rounds: number;
  escalated_from?: SliceState;
  // 3-3, stored only when gate_2_passed carries them (earlier runs' snapshots stay byte-identical).
  tags?: string[];
  roster?: string[];
}

export interface Ask {
  id: string;
  card: Card;
  step_id?: string;
  slice?: string;
  escalation?: string;
  open: boolean;
}

export interface RunState {
  run_id: string | null;
  task: string | null;
  repo_hash: string | null;
  base_sha: string | null;
  branch: string | null;
  greenfield: boolean;
  phase: Phase;
  abandoned_from: Phase | null;
  holder: string | null;
  steps: Record<string, Step>;
  step_order: string[];
  slices: Record<string, Slice>;
  slice_order: string[];
  checks: { id: string; check: string; exit_code: number; sha?: string; basis_seq: number; seq: number; digest?: string; error?: string }[];
  asks: Record<string, Ask>;
  voided: string[];
  cut_decided: boolean;
  merge_approved: boolean;
  merged_sha: string | null;
  seq: number;
  last_ts: string | null;
  rejected: { id: string; kind: string; reason: string }[];
  // Set only once the run reaches them (absent in earlier runs' snapshots).
  port?: number;
  worktree?: string;
  recon?: ReconEmbed;
  intake?: Intake; // 3-1: from intake_confirmed.data.intake
  clock_start?: string; // 3-1: where the budget clock starts (intake_confirmed.data.clock_start)
}

export function initialState(): RunState {
  return {
    run_id: null, task: null, repo_hash: null, base_sha: null, branch: null, greenfield: false,
    phase: 'INTAKE', abandoned_from: null, holder: null,
    steps: {}, step_order: [], slices: {}, slice_order: [], checks: [], asks: {}, voided: [],
    cut_decided: false, merge_approved: false, merged_sha: null, seq: 0, last_ts: null, rejected: [],
  };
}

export const isTerminal = (s: RunState): boolean => s.phase === 'COMPLETED' || s.phase === 'ABANDONED';

const OPEN_STEP: readonly StepState[] = ['issued', 'claimed', 'reported'];
export const openSteps = (s: RunState): Step[] => s.step_order.map((id) => s.steps[id]).filter((st) => OPEN_STEP.includes(st.state));

// The board's stage (AD-5 enum) for a reducer phase.
export function boardStage(s: RunState): Stage {
  const p = s.phase === 'ABANDONED' ? (s.abandoned_from ?? 'INTAKE') : s.phase;
  switch (p) {
    case 'INTAKE': return 'INTAKE';
    case 'ORIENT': return s.greenfield ? 'FRAME' : 'RECON';
    case 'SCAFFOLD': return 'SCAFFOLD';
    case 'SPEC_DESIGN': return 'SPEC';
    case 'SLICE_PLAN': return 'SLICE_PLAN';
    case 'BUILD': return 'BUILD';
    default: return 'WRAP';
  }
}

const RERUN_PHASE: Partial<Record<Stage, Phase>> = { RECON: 'ORIENT', FRAME: 'ORIENT', SPEC: 'SPEC_DESIGN', DESIGN: 'SPEC_DESIGN', SLICE_PLAN: 'SLICE_PLAN' };
const PHASE_ORDER: Phase[] = ['INTAKE', 'ORIENT', 'SCAFFOLD', 'SPEC_DESIGN', 'SLICE_PLAN', 'BUILD', 'WRAP', 'MERGED', 'COMPLETED'];

type Reason = string | null; // null = applied

function slice(s: RunState, id: string | undefined): Slice | undefined {
  return id ? s.slices[id] : undefined;
}

function moveSlice(s: RunState, id: string | undefined, from: readonly SliceState[], to: SliceState): Reason {
  const sl = slice(s, id);
  if (!sl) return `unknown slice ${id}`;
  if (!from.includes(sl.state)) return `slice ${id} is ${sl.state}, not ${from.join('|')}`;
  if (to === 'ESCALATED') sl.escalated_from = sl.state;
  sl.state = to;
  return null;
}

// Mutates `s`. Returns null when applied, or the reason the event is illegal.
function step(s: RunState, e: AnyEvent): Reason {
  if (isFactKind(e.kind)) return 'facts do not change state';
  if (e.kind === 'run_started') {
    if (s.run_id) return 'run already started';
    const d = e.data;
    Object.assign(s, { run_id: e.run, task: d.task, repo_hash: d.repo_hash, base_sha: d.base_sha, branch: d.branch, greenfield: Boolean(d.greenfield), phase: 'INTAKE' });
    return null;
  }
  if (!s.run_id) return 'run not started';
  if (e.run !== s.run_id) return `event for run ${e.run}, state is ${s.run_id}`;
  if (isTerminal(s)) return `run is ${s.phase}`;

  switch (e.kind) {
    case 'session_bound':
      s.holder = e.data.session;
      return null;

    case 'stage_started':
      if (e.data.port !== undefined) s.port = e.data.port;
      if (e.data.worktree !== undefined) s.worktree = e.data.worktree;
      return null;

    case 'stage_completed': {
      const next: Partial<Record<Phase, Phase>> = { ORIENT: 'SCAFFOLD', SCAFFOLD: 'SPEC_DESIGN', BUILD: 'WRAP' };
      const to = next[s.phase];
      if (!to) return `stage_completed is not a transition from ${s.phase}`;
      if (s.phase === 'BUILD') {
        const open = s.slice_order.map((id) => s.slices[id]).find((sl) => sl.state !== 'CLOSED' && sl.state !== 'CUT');
        if (open) return `slice ${open.id} is ${open.state}`;
      }
      s.phase = to;
      if (e.data.recon) s.recon = e.data.recon;
      return null;
    }

    case 'step_issued': {
      const d = e.data;
      if (s.steps[e.id]) return `step ${e.id} exists`;
      if (d.kind === 'resume' && !d.agent_id) return 'resume requires agent_id';
      if (d.slice && !s.slices[d.slice]) return `unknown slice ${d.slice}`;
      // AD-24: at most one open step per role. Role-less steps are exempt.
      if (d.role) {
        const busy = openSteps(s).find((st) => st.role === d.role);
        if (busy) return `role ${d.role} already has open step ${busy.id} (${busy.state})`;
      }
      // A builder round: after FINDINGS, or after a failing slice test (IN_REVIEW). It is a resume of
      // the same agent when it can be, else a spawn; either way it counts (MAX_RETRIGGER_ROUNDS).
      if ((d.kind === 'resume' || d.kind === 'spawn') && d.role === 'builder' && d.slice) {
        const sl = s.slices[d.slice];
        if (sl.state === 'FINDINGS_QUEUED' || sl.state === 'IN_REVIEW') { sl.state = 'BUILDING'; sl.rounds += 1; }
      }
      s.steps[e.id] = {
        id: e.id, kind: d.kind, stage: d.stage, attempt: d.attempt, state: 'issued', role: d.role, agent: d.agent,
        agent_id: d.agent_id, slice: d.slice, output_path: d.output_path, brief_path: d.brief_path, card: d.card, check: d.check, issued_seq: s.seq,
      };
      s.step_order.push(e.id);
      return null;
    }

    case 'step_claimed': {
      const st = s.steps[e.data.step_id];
      if (!st) return `unknown step ${e.data.step_id}`;
      if (st.state !== 'issued') return `step ${st.id} is ${st.state}`;
      st.state = 'claimed';
      st.claimed_by = e.session;
      if (e.data.agent_id) st.agent_id = e.data.agent_id;
      return null;
    }

    case 'step_reported': {
      const st = s.steps[e.data.step_id];
      if (!st) return `unknown step ${e.data.step_id}`;
      if (st.state !== 'claimed') return `step ${st.id} is ${st.state}`;
      st.state = 'reported';
      if (e.data.sha) st.sha = e.data.sha;
      if (e.data.output) st.output = e.data.output;
      return null;
    }

    case 'step_verified': {
      const st = s.steps[e.data.step_id];
      if (!st) return `unknown step ${e.data.step_id}`;
      if (st.state !== 'claimed' && st.state !== 'reported') return `step ${st.id} is ${st.state}`;
      st.state = 'verified';
      st.verdict = e.data.verdict;
      if (st.role === 'scaffolder' && s.phase === 'SCAFFOLD') s.phase = 'SPEC_DESIGN';
      if (st.slice) {
        const sl = s.slices[st.slice];
        if (st.role === 'builder' && sl.state === 'BUILDING') sl.state = 'IN_REVIEW';
        else if (st.role?.startsWith('reviewer-') && e.data.verdict === 'FINDINGS' && sl.state === 'IN_REVIEW') sl.state = 'FINDINGS_QUEUED';
      }
      return null;
    }

    case 'step_reissued': {
      const old = s.steps[e.data.old];
      if (!old) return `unknown step ${e.data.old}`;
      if (!OPEN_STEP.includes(old.state)) return `step ${old.id} is ${old.state}`;
      if (s.steps[e.data.new]) return `step ${e.data.new} exists`;
      if (e.data.kind === 'resume' && !e.data.agent_id) return 'resume requires agent_id';
      old.state = 'reissued';
      s.steps[e.data.new] = {
        ...old, id: e.data.new, state: 'issued', attempt: old.attempt + 1, claimed_by: undefined, sha: undefined, output: undefined,
        output_path: e.data.output_path ?? old.output_path, brief_path: e.data.brief_path ?? old.brief_path, issued_seq: s.seq,
      };
      // 3-4: a reissued resume is a spawn, with no agent to continue.
      if (e.data.kind === 'spawn') { s.steps[e.data.new].kind = 'spawn'; delete s.steps[e.data.new].agent_id; }
      // 6-4: a SCAFFOLD repair round resumes the reported scaffolder's agent.
      else if (e.data.kind === 'resume') { s.steps[e.data.new].kind = 'resume'; s.steps[e.data.new].agent_id = e.data.agent_id; }
      s.step_order.push(e.data.new);
      return null;
    }

    case 'step_cancelled': {
      const st = s.steps[e.data.step_id];
      if (!st) return `unknown step ${e.data.step_id}`;
      if (!OPEN_STEP.includes(st.state)) return `step ${st.id} is ${st.state}`;
      st.state = 'cancelled';
      // An ask about the cancelled step can no longer be ruled: it closes with it.
      for (const a of Object.values(s.asks)) if (a.open && a.step_id === st.id) a.open = false;
      return null;
    }

    case 'check_ran':
      // `error` only when present (dry run 2), so older folds are unchanged.
      s.checks.push({
        id: e.id, check: e.data.check, exit_code: e.data.exit_code, sha: e.data.sha, basis_seq: e.data.basis_seq, seq: s.seq, digest: e.data.digest,
        ...(typeof e.data.error === 'string' ? { error: e.data.error } : {}),
      });
      return null;

    case 'ask_raised': {
      const d = e.data;
      if (d.slice) {
        const r = moveSlice(s, d.slice, ['BUILDING', 'IN_REVIEW', 'FINDINGS_QUEUED'], 'ESCALATED');
        if (r) return r;
      }
      s.asks[e.id] = { id: e.id, card: d.card, step_id: d.step_id, slice: d.slice, escalation: d.escalation, open: true };
      return null;
    }

    case 'slice_started':
      return moveSlice(s, e.data.slice, ['BACKLOG'], 'BUILDING');

    case 'slice_closed':
      return moveSlice(s, e.data.slice, ['IN_REVIEW'], 'CLOSED');

    case 'merged':
      if (s.phase !== 'WRAP') return `merged in ${s.phase}`;
      if (!s.merge_approved) return 'merged before merge_approved';
      s.phase = 'MERGED';
      s.merged_sha = e.data.sha;
      return null;

    case 'run_completed':
      if (s.phase !== 'MERGED') return `run_completed in ${s.phase}`;
      s.phase = 'COMPLETED';
      return null;

    // --- decisions ---
    case 'intake_confirmed':
      if (s.phase !== 'INTAKE') return `intake_confirmed in ${s.phase}`;
      s.phase = 'ORIENT';
      // Additive (3-1): only an intake that carries its data sets the new fields.
      if (e.data.intake) {
        s.intake = e.data.intake;
        if (typeof e.data.clock_start === 'string') s.clock_start = e.data.clock_start;
      }
      return null;

    case 'gate_1_passed':
      if (s.phase !== 'SPEC_DESIGN') return `gate_1_passed in ${s.phase}`;
      s.phase = 'SLICE_PLAN';
      return null;

    case 'gate_2_passed': {
      if (s.phase !== 'SLICE_PLAN') return `gate_2_passed in ${s.phase}`;
      const ids = e.data.slices.map((x) => x.id);
      if (!ids.length) return 'gate_2_passed with no slices';
      if (new Set(ids).size !== ids.length) return 'duplicate slice ids';
      s.slices = {};
      s.slice_order = [];
      for (const x of e.data.slices) {
        s.slices[x.id] = {
          id: x.id, title: x.title, acs: x.acs, notes: x.notes, deps: x.deps ?? [], state: 'BACKLOG', rounds: 0,
          ...(x.tags ? { tags: x.tags } : {}), ...(x.roster ? { roster: x.roster } : {}),
        };
        s.slice_order.push(x.id);
      }
      s.phase = 'BUILD';
      return null;
    }

    case 'rework_requested': {
      const t = e.data.target;
      if (t === 'gate1') { if (s.phase !== 'SPEC_DESIGN') return `rework gate1 in ${s.phase}`; }
      else if (t === 'gate2') { if (s.phase !== 'SLICE_PLAN') return `rework gate2 in ${s.phase}`; }
      else if (/^S\d+$/.test(t)) {
        // From the merge card (WRAP, before merged) the run goes back to BUILD. AD-33: not a round.
        if (s.phase !== 'BUILD' && s.phase !== 'WRAP') return `rework ${t} in ${s.phase}`;
        const r = moveSlice(s, t, ['CLOSED'], 'BUILDING');
        if (r) return r;
        if (s.phase === 'WRAP') { s.phase = 'BUILD'; s.merge_approved = false; }
      } else return `unknown rework target ${t}`;
      s.voided.push(...e.data.voids);
      return null;
    }

    case 'escalation_ruled': {
      const ask = Object.values(s.asks).find((a) => a.open && a.escalation === e.data.escalation);
      if (!ask) return `no open escalation ${e.data.escalation}`;
      // slice_to: where the ruling sends the slice (3-4: the state its evidence implies, or CUT).
      if (ask.slice) {
        const r = moveSlice(s, ask.slice, ['ESCALATED'], e.data.slice_to ?? s.slices[ask.slice].escalated_from ?? 'BUILDING');
        if (r) return r;
      }
      ask.open = false;
      return null;
    }

    case 'design_choice_made':
      // 3-2, additive: a non-default choice sends the design back (its voids), like a gate-1 rework.
      if (Array.isArray(e.data.voids)) s.voided.push(...e.data.voids);
      return null;

    case 'cut_decided': {
      if (s.phase !== 'BUILD') return `cut_decided in ${s.phase}`;
      for (const id of e.data.cut) {
        const sl = s.slices[id];
        if (!sl) return `unknown slice ${id}`;
        if (sl.state !== 'BACKLOG' && sl.state !== 'ESCALATED') return `slice ${id} is ${sl.state}`;
      }
      for (const id of e.data.cut) s.slices[id].state = 'CUT';
      s.cut_decided = true;
      // The decision answers the live cut card (3-1).
      for (const a of Object.values(s.asks)) if (a.open && a.card?.type === 'cut') a.open = false;
      return null;
    }

    case 'stage_rerun_requested': {
      const to = RERUN_PHASE[e.data.stage];
      if (!to) return `${e.data.stage} cannot be rerun`;
      if (PHASE_ORDER.indexOf(to) > PHASE_ORDER.indexOf(s.phase) || s.phase === 'MERGED') return `cannot rerun ${e.data.stage} from ${s.phase}`;
      if (PHASE_ORDER.indexOf(to) < PHASE_ORDER.indexOf('BUILD')) { s.slices = {}; s.slice_order = []; }
      s.phase = to;
      s.merge_approved = false;
      s.voided.push(...e.data.voids);
      // 3-4: the rerun answers every open ask (their cards are cancelled with it).
      for (const a of Object.values(s.asks)) a.open = false;
      return null;
    }

    case 'merge_approved':
      if (s.phase !== 'WRAP') return `merge_approved in ${s.phase}`;
      s.merge_approved = true;
      return null;

    case 'run_abandoned':
      s.abandoned_from = s.phase;
      s.phase = 'ABANDONED';
      return null;
  }
  return `unhandled kind ${(e as Envelope).kind}`;
}

export interface ApplyResult { state: RunState; ok: boolean; reason?: string }

// Pure: returns a new state. The CLI uses this to refuse an illegal command before appending it.
export function apply(state: RunState, e: AnyEvent): ApplyResult {
  const s = structuredClone(state);
  let reason: Reason;
  try {
    reason = step(s, e);
  } catch (err) {
    reason = `malformed: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (reason) return { state, ok: false, reason };
  s.seq += 1;
  s.last_ts = e.ts;
  return { state: s, ok: true };
}

// Folds commands in file order. Never throws; illegal events land in `rejected`.
// A malformed event (e.g. no `data`) can make step() throw partway through its mutations. The fold then
// marks it bad and replays from `from` without it, so the common path pays nothing for the guard.
export function fold(events: readonly AnyEvent[], from: RunState = initialState()): RunState {
  const bad = new Map<number, string>();
  for (;;) {
    const s = structuredClone(from);
    let threw = false;
    for (let i = 0; i < events.length && !threw; i++) {
      const e = events[i];
      const malformed = bad.get(i);
      if (malformed !== undefined) {
        const x = e as { id?: unknown; kind?: unknown } | null | undefined;
        s.rejected.push({ id: String(x?.id), kind: String(x?.kind), reason: `malformed: ${malformed}` });
        continue;
      }
      let reason: Reason;
      try {
        reason = step(s, e);
      } catch (err) {
        bad.set(i, err instanceof Error ? err.message : String(err));
        threw = true;
        continue;
      }
      if (reason) s.rejected.push({ id: e.id, kind: e.kind, reason });
      else { s.seq += 1; s.last_ts = e.ts; }
    }
    if (!threw) return s;
  }
}
