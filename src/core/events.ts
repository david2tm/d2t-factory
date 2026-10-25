// Event envelope and typed kinds (AD-5). Pure: no I/O.
import type { SliceState } from './reducer.ts';

export const STAGES = ['INTAKE', 'RECON', 'FRAME', 'SCAFFOLD', 'SPEC', 'DESIGN', 'SLICE_PLAN', 'BUILD', 'WRAP'] as const;
export type Stage = (typeof STAGES)[number];

export const COMMAND_KINDS = [
  'run_started', 'session_bound', 'stage_started', 'stage_completed', 'step_issued', 'step_claimed',
  'step_reported', 'step_verified', 'step_reissued', 'check_ran', 'ask_raised', 'slice_started',
  'slice_closed', 'merged', 'run_completed', 'step_cancelled',
] as const;
export const DECISION_KINDS = [
  'intake_confirmed', 'gate_1_passed', 'gate_2_passed', 'rework_requested', 'escalation_ruled',
  'design_choice_made', 'cut_decided', 'stage_rerun_requested', 'merge_approved', 'run_abandoned',
] as const;
export const FACT_KINDS = [
  'human_prompt', 'prompt_text', 'session_started', 'session_ended', 'subagent_started',
  'subagent_stopped', 'tool_succeeded', 'tool_failed', 'output_written', 'stop_yielded', 'stop_forced',
] as const;

export type CommandKind = (typeof COMMAND_KINDS)[number];
export type DecisionKind = (typeof DECISION_KINDS)[number];
export type FactKind = (typeof FACT_KINDS)[number];
// The facts of a tool call landing: they reset the Stop block count and clear PAUSED (6-1).
export const TOOL_FACT_KINDS: readonly FactKind[] = ['tool_succeeded', 'tool_failed', 'output_written'];
export type Kind = CommandKind | DecisionKind | FactKind;

export const STEP_KINDS = ['spawn', 'resume', 'ask_human', 'run_check', 'enter_worktree', 'exit_worktree'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const CHECKS = [
  'contract.test', 'contract.health', 'contract.install', 'git.baseline', 'git.worktree_clean', 'git.deps', 'git.merged',
  'spec.lint', 'plan.lint', 'devserver',
] as const;
export type Check = (typeof CHECKS)[number];

export interface Card {
  type: string;
  title: string;
  reason_label?: string;
  reason?: string;
  commands: string[];
  escalation?: string; // E<n>, on the card of an escalation's ask_human step
  // 3-4: an escalation card's closed-list condition (review policy): 1 scope change / spec ambiguity,
  // 2 irreversible action / new dependency, 3 non-convergence / over time box, 4 taste disagreement.
  condition?: 1 | 2 | 3 | 4;
  // What a merge card's evidence is pinned to (1-5): the run branch head and the target's head. A
  // New dependency card carries the builder sha it is about.
  sha?: string;
  target?: string | null;
}

// One reviewer finding (AD-11), as parsed from a ```finding block.
export interface Finding { category: string; location: string; failure_scenario: string; observed?: string }

// The designer's one question (AD-11, 3-2), as parsed from its ```question block: two options and the
// default the design was written for.
export interface DesignQuestion { question: string; a: string; b: string; default: 'a' | 'b' }

// One slice of the plan (AD-27). The slicer writes `depends_on`; the plan keeps it as `deps`. 3-3,
// additive: the slicer's tags, and the roster core/roster.ts derives from them at plan.lint.
export interface SlicePlanEntry { id: string; title?: string; deps?: string[]; acs?: string[]; notes?: string[]; tags?: string[]; roster?: string[] }

// The intake front matter (AD-27) as validated, with slice_timebox_min defaulted. reviewer_overrides
// apply run-wide; started is the exercise's start (ISO-8601 UTC) when it began before the run.
export interface ReviewerOverrides { add: string[]; remove: string[] }
export interface Intake { limit_min: number; slice_timebox_min: number; ui_free: boolean; reviewer_overrides: ReviewerOverrides; started?: string }

// An approved artifact pinned by content (AD-10).
export interface Pin { path: string; sha256: string }

// What stage_completed embeds when RECON ends (AD-10): the cache file, its sha256 and the parsed context.
export interface ReconEmbed { path: string; sha256: string; context: Record<string, unknown> }

// Embedded in every decision command (AD-6).
export interface DecisionBase { prompt_fact_id: string; human_prompt?: unknown; prompt_text?: unknown }
// `start` and `resume` consume a non-decision prompt and embed it the same way (AD-26).
export interface PromptEmbed { prompt_fact_id?: string; human_prompt?: unknown; prompt_text?: unknown }

export interface DataByKind {
  run_started: PromptEmbed & { task: string; repo_hash: string; base_sha: string; branch: string; greenfield?: boolean };
  // rebind_fact_id: the hook's session_started{source:'clear'} fact that a /clear rebind adopts (AD-25).
  session_bound: PromptEmbed & { session: string; supersedes?: string; rebind_fact_id?: string };
  stage_started: { stage: Stage; port?: number; worktree?: string };
  stage_completed: { stage: Stage; recon?: ReconEmbed };
  step_issued: {
    kind: StepKind; stage: Stage; attempt: number; role?: string; agent?: string; agent_id?: string;
    slice?: string; brief_path?: string; output_path?: string; card?: Card; check?: Check;
  };
  step_claimed: { step_id: string; agent_id?: string };
  // output: the redacted projection of the parsed out.md or check result (AD-23).
  step_reported: { step_id: string; note?: string; sha?: string; output?: Record<string, unknown> };
  step_verified: { step_id: string; evidence: string[]; verdict?: string };
  // 3-4: kind 'spawn' turns a reissued resume into a spawn (its agent may be gone).
  step_reissued: { old: string; new: string; output_path?: string; brief_path?: string; kind?: 'spawn' };
  check_ran: {
    check: Check; exit_code: number; duration_ms: number; basis_seq: number;
    command?: string; sha?: string; dirty?: boolean; digest?: string;
  };
  ask_raised: { card: Card; step_id?: string; slice?: string; escalation?: string };
  slice_started: { slice: string };
  slice_closed: { slice: string; check_id: string };
  merged: { sha: string; target?: string }; // target: the main checkout's branch it landed on
  run_completed: Record<string, never>;
  // 3-4: an open step closed without a result: its slice was cut or cleared, or a void covers it.
  step_cancelled: { step_id: string; reason: string };
  // 3-1, additive: the confirmed intake, where the budget clock starts, and the intake out.md's pin.
  intake_confirmed: DecisionBase & { intake?: Intake; clock_start?: string; pins?: Pin[]; evidence?: string[] };
  gate_1_passed: DecisionBase & { pins?: Pin[]; evidence?: string[] };
  gate_2_passed: DecisionBase & { slices: SlicePlanEntry[]; pins?: Pin[]; evidence?: string[] };
  rework_requested: DecisionBase & { target: string; note: string; voids: string[] };
  escalation_ruled: DecisionBase & { escalation: string; choice: string; slice_to?: SliceState };
  // 3-2, additive: a non-default choice voids the designer step and its step_verified (a respawn).
  design_choice_made: DecisionBase & { choice: string; voids?: string[] };
  cut_decided: DecisionBase & { cut: string[] };
  stage_rerun_requested: DecisionBase & { stage: Stage; voids: string[] };
  merge_approved: DecisionBase & { pins?: Pin[]; evidence?: string[]; sha?: string; target?: string };
  run_abandoned: DecisionBase;
  human_prompt: { prompt_id: string; command_name: string; command_args: string; transcript_path?: string };
  prompt_text: { prompt_id: string; prompt: string; transcript_path?: string };
  session_started: { source: string; cwd?: string; transcript_path?: string; supersedes?: string };
  session_ended: { reason?: string };
  subagent_started: { agent_id: string; agent_type?: string };
  subagent_stopped: { agent_id: string; agent_type?: string; agent_transcript_path?: string };
  tool_succeeded: { tool_name: string; tool_use_id?: string; agent_id?: string; command?: string; duration_ms?: number };
  tool_failed: { tool_name: string; tool_use_id?: string; agent_id?: string; command?: string; exit_code: number | null };
  output_written: { path: string; tool_use_id?: string; agent_id?: string; first_line?: string };
  // 6-1 (AD-12), additive: the Stop hook let the holder's turn end because the human rejected a tool
  // call this turn, or because it had already blocked STOP_BLOCK_MAX times in a row (reason: mayStop's).
  stop_yielded: { reason: 'human_rejected'; tool_use_id: string };
  stop_forced: { blocks: number; reason: string };
}

export interface Envelope<K extends Kind = Kind> {
  v: 1;
  id: string;
  ts: string;
  run: string;
  session?: string;
  kind: K;
  actor: string;
  corr: string | null;
  data: DataByKind[K];
}

export type AnyEvent = { [K in Kind]: Envelope<K> }[Kind];

export const isCommandKind = (k: string): k is CommandKind => (COMMAND_KINDS as readonly string[]).includes(k);
export const isDecisionKind = (k: string): k is DecisionKind => (DECISION_KINDS as readonly string[]).includes(k);
export const isFactKind = (k: string): k is FactKind => (FACT_KINDS as readonly string[]).includes(k);

// --- validation -----------------------------------------------------------------------------

type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'stage' | 'step_kind' | 'check' | 'string|null' | 'number|null';
type Shape = Record<string, FieldType>;

const DECISION: Shape = { prompt_fact_id: 'string' };

// Required data fields per kind. Optional fields are not checked; readers ignore unknown fields.
const REQUIRED: Record<Kind, Shape> = {
  run_started: { task: 'string', repo_hash: 'string', base_sha: 'string', branch: 'string' },
  session_bound: { session: 'string' },
  stage_started: { stage: 'stage' },
  stage_completed: { stage: 'stage' },
  step_issued: { kind: 'step_kind', stage: 'stage', attempt: 'number' },
  step_claimed: { step_id: 'string' },
  step_reported: { step_id: 'string' },
  step_verified: { step_id: 'string', evidence: 'array' },
  step_reissued: { old: 'string', new: 'string' },
  check_ran: { check: 'check', exit_code: 'number', duration_ms: 'number', basis_seq: 'number' },
  ask_raised: { card: 'object' },
  slice_started: { slice: 'string' },
  slice_closed: { slice: 'string', check_id: 'string' },
  merged: { sha: 'string' },
  run_completed: {},
  step_cancelled: { step_id: 'string', reason: 'string' },
  intake_confirmed: DECISION,
  gate_1_passed: DECISION,
  gate_2_passed: { ...DECISION, slices: 'array' },
  rework_requested: { ...DECISION, target: 'string', note: 'string', voids: 'array' },
  escalation_ruled: { ...DECISION, escalation: 'string', choice: 'string' },
  design_choice_made: { ...DECISION, choice: 'string' },
  cut_decided: { ...DECISION, cut: 'array' },
  stage_rerun_requested: { ...DECISION, stage: 'stage', voids: 'array' },
  merge_approved: DECISION,
  run_abandoned: DECISION,
  human_prompt: { prompt_id: 'string', command_name: 'string', command_args: 'string' },
  prompt_text: { prompt_id: 'string', prompt: 'string' },
  session_started: { source: 'string' },
  session_ended: {},
  subagent_started: { agent_id: 'string' },
  subagent_stopped: { agent_id: 'string' },
  tool_succeeded: { tool_name: 'string' },
  tool_failed: { tool_name: 'string', exit_code: 'number|null' },
  output_written: { path: 'string' },
  stop_yielded: { reason: 'string', tool_use_id: 'string' },
  stop_forced: { blocks: 'number', reason: 'string' },
};

const COMMAND_ACTORS: readonly string[] = ['cli', 'conductor', 'human'];
export const FACT_ACTOR = 'hook';
const ROLE_ACTOR_RE = /^d2t-factory:[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const isCommandActor = (a: string): boolean => COMMAND_ACTORS.includes(a) || ROLE_ACTOR_RE.test(a);

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function typeOk(v: unknown, t: FieldType): boolean {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'array': return Array.isArray(v);
    case 'object': return typeof v === 'object' && v !== null && !Array.isArray(v);
    case 'stage': return (STAGES as readonly unknown[]).includes(v);
    case 'step_kind': return (STEP_KINDS as readonly unknown[]).includes(v);
    case 'check': return (CHECKS as readonly unknown[]).includes(v);
    case 'string|null': return v === null || typeof v === 'string';
    case 'number|null': return v === null || (typeof v === 'number' && Number.isFinite(v));
  }
}

export type Validation = { ok: true; event: AnyEvent } | { ok: false; errors: string[] };

// Every writer validates before it appends (AD-5).
export function validateEvent(e: unknown): Validation {
  const errors: string[] = [];
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return { ok: false, errors: ['event is not an object'] };
  const x = e as Record<string, unknown>;
  if (x.v !== 1) errors.push('v must be 1');
  if (typeof x.id !== 'string' || !ULID_RE.test(x.id)) errors.push('id must be a ULID');
  if (typeof x.ts !== 'string' || !TS_RE.test(x.ts)) errors.push('ts must be ISO-8601 UTC with ms');
  if (typeof x.run !== 'string' || !x.run) errors.push('run must be a non-empty string');
  if (typeof x.actor !== 'string' || !x.actor) errors.push('actor must be a non-empty string');
  if (x.session !== undefined && typeof x.session !== 'string') errors.push('session must be a string');
  const kind = x.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(REQUIRED, kind)) {
    errors.push(`unknown kind ${JSON.stringify(kind)}`);
    return { ok: false, errors };
  }
  const k = kind as Kind;
  const fact = isFactKind(k);
  if (fact && x.corr !== null) errors.push('facts carry corr: null');
  if (!fact && typeof x.corr !== 'string') errors.push('commands carry a corr string');
  if ((fact || isDecisionKind(k)) && typeof x.session !== 'string') errors.push(`${k} requires session`);
  if (isDecisionKind(k) && x.actor !== 'human') errors.push(`${k} requires actor human`);
  // Hooks are the only fact writer (AD-4).
  if (fact && x.actor !== FACT_ACTOR) errors.push(`${k} requires actor ${FACT_ACTOR}`);
  if (!fact && typeof x.actor === 'string' && x.actor && !isCommandActor(x.actor)) errors.push(`actor ${JSON.stringify(x.actor)} is not cli, conductor, human or d2t-factory:<role>`);
  const data = x.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    errors.push('data must be an object');
  } else {
    for (const [field, t] of Object.entries(REQUIRED[k])) {
      if (!typeOk((data as Record<string, unknown>)[field], t)) errors.push(`${k}.data.${field} must be ${t}`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, event: e as AnyEvent };
}
