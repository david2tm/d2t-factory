// AD-7: the only home of attribution (facts → step) and of claim → evidence. Pure: no I/O; the CLI
// hands in the facts, the commands and realpaths it read.
import { CLAIM_OVERDUE_MS, MAX_RETRIGGER_ROUNDS } from './config.ts';
import type { AnyEvent, Check, Envelope, ScaffoldRepair, Stage } from './events.ts';
import { isTerminal, openSteps, type RunState, type Slice, type SliceState, type Step } from './reducer.ts';
import { isAppReviewer, isDiffReviewer, REVIEWERS, sliceRoster } from './roster.ts';

export type CheckEntry = RunState['checks'][number];

// AD-33: a voided event counts as absent. A rework voids the reworked step itself (its step_id is
// its step_issued id) along with its step_verified and checks, so a voided step is not verified.
export const isVoided = (s: RunState, id: string): boolean => s.voided.includes(id);
export const isVerified = (s: RunState, st: Step | undefined): boolean => Boolean(st) && st!.state === 'verified' && !isVoided(s, st!.id);

// The newest step matching `pred` that was not superseded by a reissue nor cancelled (3-4).
export function latestStep(s: RunState, pred: (st: Step) => boolean): Step | undefined {
  for (let i = s.step_order.length - 1; i >= 0; i--) {
    const st = s.steps[s.step_order[i]];
    if (st.state !== 'reissued' && st.state !== 'cancelled' && pred(st)) return st;
  }
  return undefined;
}

export const latestByRole = (s: RunState, role: string): Step | undefined => latestStep(s, (st) => st.role === role);

// The newest run_check step for `check` issued after `afterSeq`.
export const latestCheckStep = (s: RunState, check: Check, afterSeq = -1): Step | undefined =>
  latestStep(s, (st) => st.kind === 'run_check' && st.check === check && st.issued_seq > afterSeq);

// The newest ask_human step whose card has this type.
export const latestAsk = (s: RunState, type: string): Step | undefined => latestStep(s, (st) => st.kind === 'ask_human' && st.card?.type === type);

export const checkById = (s: RunState, id: unknown): CheckEntry | undefined => s.checks.find((c) => c.id === id);

// "The current spec" (AD-10): the newest spec-writer step, if it is verified and not voided.
export function latestSpec(s: RunState): Step | undefined {
  const st = latestByRole(s, 'spec-writer');
  return st && isVerified(s, st) && st.output ? st : undefined;
}

// --- the designer (3-2) ------------------------------------------------------------------------

// AD-27: the designer runs iff RECON found a UI surface and the confirmed intake did not mark the task
// UI-free. A run without the 3-1 intake fields never has one.
export const designerRequired = (s: RunState): boolean => s.recon?.context?.ui_surface === true && s.intake !== undefined && s.intake.ui_free !== true;

// Brownfield inherits the repo's look; anything else invents it.
export const designMode = (s: RunState): 'inherit' | 'invent' => (s.recon?.context?.origin === 'brownfield' ? 'inherit' : 'invent');

// "The current design": the newest designer step, if it is verified and not voided.
export function latestDesign(s: RunState): Step | undefined {
  const st = latestByRole(s, 'designer');
  return st && isVerified(s, st) && st.output ? st : undefined;
}

// The design_choice card issued for a designer step (after it).
export const designChoiceFor = (s: RunState, d: Step): Step | undefined =>
  latestStep(s, (st) => st.kind === 'ask_human' && st.card?.type === 'design_choice' && st.issued_seq > d.issued_seq);

// At most one question per run: once a design_choice card was answered, no designer may ask again.
export const designQuestionAnswered = (s: RunState): boolean =>
  s.step_order.some((id) => s.steps[id].kind === 'ask_human' && s.steps[id].card?.type === 'design_choice' && s.steps[id].state === 'verified');

// The design gate 1 can show: the current design, with its question (if it asked one) answered.
export function readyDesign(s: RunState): Step | undefined {
  const d = latestDesign(s);
  if (!d) return undefined;
  if (d.output?.question && !isVerified(s, designChoiceFor(s, d))) return undefined;
  return d;
}

// A step and the step_verified events of it: what voiding it takes (AD-33).
const withVerified = (st: Step, commands: readonly AnyEvent[]): string[] =>
  [st.id, ...commands.filter((e) => e.kind === 'step_verified' && (e as Envelope<'step_verified'>).data.step_id === st.id).map((e) => e.id)];

// AD-33: what sends the current design back: the designer step and its step_verified.
export function designVoids(s: RunState, commands: readonly AnyEvent[]): string[] {
  const d = latestDesign(s);
  return d ? withVerified(d, commands) : [];
}

// --- the slicer (3-3) --------------------------------------------------------------------------

// "The current slice plan": the newest slicer step, if it is verified and not voided.
export function latestSlicePlan(s: RunState): Step | undefined {
  const st = latestByRole(s, 'slicer');
  return st && isVerified(s, st) && st.output ? st : undefined;
}

// reviewer-ui's reference: the current design, else RECON's ui_reference (a path or a kit's name).
export function uiReference(s: RunState): string | undefined {
  const d = latestDesign(s);
  if (d) return String(d.output?.path ?? d.output_path);
  const ref = s.recon?.context?.ui_reference;
  return typeof ref === 'string' && ref.trim() ? ref : undefined;
}

// The INTAKE ask_human steps (3-1): the conversation (its card has no commands; the conductor writes
// its out.md) and the confirm card that `/factory approve intake` answers.
const intakeAsk = (st: Step): boolean => st.kind === 'ask_human' && st.stage === 'INTAKE' && st.card?.type === 'intake';
export const isIntakeChat = (st: Step): boolean => intakeAsk(st) && !st.card!.commands.length;
export const isIntakeConfirm = (st: Step): boolean => intakeAsk(st) && st.card!.commands.length > 0;

// An open escalation ask whose subject is this step.
export const askOpenFor = (s: RunState, stepId: string): boolean => Object.values(s.asks).some((a) => a.open && a.step_id === stepId);

// --- the SCAFFOLD repair round (6-4, AD-8, AD-24) ----------------------------------------------

// A repair round: the step_reissued that resumed (or respawned) the scaffolder with a repair brief.
export interface RepairRound { old: string; new: string; repair: ScaffoldRepair }

const repairRounds = (commands: readonly AnyEvent[]): RepairRound[] =>
  commands.filter((e): e is Envelope<'step_reissued'> => e.kind === 'step_reissued' && Boolean((e as Envelope<'step_reissued'>).data.repair))
    .map((e) => ({ old: e.data.old, new: e.data.new, repair: e.data.repair! }));

// Rounds used: the repair reissues whose new step is not voided.
export const scaffoldRepairs = (s: RunState, commands: readonly AnyEvent[]): number => repairRounds(commands).filter((r) => !isVoided(s, r.new)).length;

// The active repair: the latest repair reissue with no escalation_ruled or stage_rerun_requested
// after it (a human ruling ends it; a rerun answers the card like one). While it is active, the
// scaffolder's briefs carry the repair section and its failure card names both rounds.
export function activeScaffoldRepair(commands: readonly AnyEvent[]): RepairRound | undefined {
  const i = commands.findLastIndex((e) => e.kind === 'step_reissued' && Boolean((e as Envelope<'step_reissued'>).data.repair));
  if (i < 0 || commands.slice(i + 1).some((e) => e.kind === 'escalation_ruled' || e.kind === 'stage_rerun_requested')) return undefined;
  const d = (commands[i] as Envelope<'step_reissued'>).data;
  return { old: d.old, new: d.new, repair: d.repair! };
}

// Has the human ruled an ask about a scaffolder? Then no repair round follows (6-4).
export function scaffoldRuled(s: RunState, commands: readonly AnyEvent[]): boolean {
  return commands.some((e) => {
    if (e.kind !== 'escalation_ruled') return false;
    const ask = Object.values(s.asks).find((a) => a.escalation === (e as Envelope<'escalation_ruled'>).data.escalation);
    return Boolean(ask?.step_id && s.steps[ask.step_id]?.role === 'scaffolder');
  });
}

// AD-12: parked = every open step waits on the human (an ask_human step, or the subject of an open
// ask). `/factory rerun` is legal only here (3-4).
export function isParked(s: RunState): boolean {
  if (isTerminal(s)) return false;
  const open = openSteps(s);
  return open.length > 0 && open.every((st) => st.kind === 'ask_human' || askOpenFor(s, st.id));
}

// --- claim overlay (the dashboard's CLAIMED / VERIFIED chip) ---------------------------------

export type WaitingOn = 'human' | 'checks';
export interface ClaimOverlay { state: 'claimed' | 'verified' | null; overdue_at: string | null; waiting_on: WaitingOn | null; waiting_for: string | null; evidence: string[] }

const CONTRACT_CHECKS = ['contract.install', 'contract.health', 'contract.test'] as const;

// 6-3 (AD-7): what a CLAIMED step waits on besides its hook facts. `human`: an ask_human step, or the
// subject of an open ask (waiting_for: that ask's card title, else the step's own). `checks`: a
// scaffolder that reported DONE with no failure and no open ask (schedule.ts SCAFFOLD's condition,
// so the gaps before each check is issued count too); waiting_for names the contract checks not yet
// verified (`install, health, test`).
function waitingOf(s: RunState, st: Step): { waiting_on: WaitingOn | null; waiting_for: string | null } {
  const ask = Object.values(s.asks).find((a) => a.open && a.step_id === st.id);
  if (ask || st.kind === 'ask_human') return { waiting_on: 'human', waiting_for: ask?.card?.title ?? st.card?.title ?? null };
  if (st.role === 'scaffolder' && st.state === 'reported' && st.output?.status === 'DONE' && !st.output.failure) {
    const left = CONTRACT_CHECKS.filter((c) => !isVerified(s, latestCheckStep(s, c, st.issued_seq))).map((c) => c.replace('contract.', ''));
    return { waiting_on: 'checks', waiting_for: left.join(', ') || null };
  }
  return { waiting_on: null, waiting_for: null };
}

// AD-7: only a reported step carries a claim. It is VERIFIED once the CLI appended step_verified and
// nothing voided it (with that event's evidence ids), else CLAIMED; overdue_at is when a CLAIMED chip
// reads UNVERIFIED. A claim waiting on the human or on the CLI's checks (6-3) is never overdue: its
// overdue_at is null. The caller compares overdue_at with its own clock: no `now` here.
export function claimOverlay(s: RunState, st: Step, reportedTs: string | undefined, verifiedEvidence: readonly string[] = []): ClaimOverlay {
  const at = reportedTs ? Date.parse(reportedTs) : NaN;
  if (!Number.isFinite(at)) return { state: null, overdue_at: null, waiting_on: null, waiting_for: null, evidence: [] };
  const overdue_at = new Date(at + CLAIM_OVERDUE_MS).toISOString();
  if (isVerified(s, st)) return { state: 'verified', overdue_at, waiting_on: null, waiting_for: null, evidence: [...verifiedEvidence] };
  const w = waitingOf(s, st);
  return { state: 'claimed', overdue_at: w.waiting_on ? null : overdue_at, ...w, evidence: [] };
}

// --- agent steps -----------------------------------------------------------------------------

export type AgentEvidence =
  | { ok: true; evidence: string[]; agent_id: string }
  | { ok: false; reason: string; stopped: boolean };

type Fact<K extends AnyEvent['kind']> = Envelope<K>;
const facts = <K extends AnyEvent['kind']>(all: readonly AnyEvent[], kind: K): Fact<K>[] => all.filter((f) => f.kind === kind) as Fact<K>[];

// Agent step done = `output_written` at the step's output realpath, whose agent_id then has a
// `subagent_stopped`. agent_type, when both sides have it, must agree. `stopped` says whether a stop
// attributable to the step arrived at all (the orphan rule): by that agent_id, by the claim's
// agent_id, or by the step's agent type at or after the claim. A resumed agent keeps its agent_id,
// so with a claim time only stops at or after the claim count: round 1's stop never verifies round 2.
export function agentEvidence(st: Step, all: readonly AnyEvent[], o: { output: string; claimed_ts?: string }): AgentEvidence {
  const typeOk = (t: string | undefined): boolean => !t || !st.agent || t === st.agent;
  const stops = facts(all, 'subagent_stopped').filter((f) => typeOk(f.data.agent_type) && (!o.claimed_ts || f.ts >= o.claimed_ts));
  const outs = facts(all, 'output_written').filter((f) => f.data.path === o.output);
  const ids = new Set(outs.map((f) => f.data.agent_id).filter((x): x is string => Boolean(x)));
  if (st.agent_id) ids.add(st.agent_id);
  const stopped = stops.some((f) => ids.has(f.data.agent_id) || (Boolean(o.claimed_ts) && f.data.agent_type === st.agent && f.ts >= o.claimed_ts!));
  const out = [...outs].reverse().find((f) => f.data.agent_id);
  if (!outs.length) return { ok: false, reason: `no output_written for ${o.output}`, stopped };
  if (!out) return { ok: false, reason: 'the output_written fact has no agent_id', stopped };
  const stop = stops.find((f) => f.data.agent_id === out.data.agent_id);
  if (!stop) return { ok: false, reason: `no subagent_stopped for agent ${out.data.agent_id}`, stopped };
  return { ok: true, evidence: [out.id, stop.id], agent_id: out.data.agent_id! };
}

// AD-24: a claim held by a superseded session. Agent steps with full evidence are verified as they
// are; a stopped agent without a parseable output, and any claimed run_check or enter_worktree,
// are reissued; a running agent is left alone.
export function classifyOrphan(st: Step, o: { parsed: boolean; evidence?: AgentEvidence }): 'verify' | 'reissue' | 'wait' {
  if (st.kind === 'run_check' || st.kind === 'enter_worktree' || st.kind === 'exit_worktree') return 'reissue';
  if (st.kind !== 'spawn' && st.kind !== 'resume') return 'wait';
  const ev = o.evidence;
  if (ev?.ok) return o.parsed ? 'verify' : 'reissue';
  return ev?.stopped ? 'reissue' : 'wait';
}

// --- gates -----------------------------------------------------------------------------------

export type GateEvidence = { ok: true; spec: Step; check: CheckEntry; evidence: string[]; design?: Step } | { ok: false; reason: string };

// The newest passing, unvoided check of this kind after `afterSeq`.
const passing = (s: RunState, check: Check, afterSeq: number): CheckEntry | undefined =>
  [...s.checks].reverse().find((c) => c.check === check && c.seq > afterSeq && !isVoided(s, c.id) && c.exit_code === 0);

// Gate 1: a passing spec.lint of exactly the current spec's bytes, newer than that spec; when the
// designer is required (AD-7), also the ready design, returned with the evidence.
// Gate 2: also a passing plan.lint of exactly the plan the CLI derives now (`planDigest`).
export function gateEvidence(s: RunState, gate: 'gate1' | 'gate2', o: { planDigest?: string } = {}): GateEvidence {
  const spec = latestSpec(s);
  if (!spec) return { ok: false, reason: 'no verified spec' };
  const lint = passing(s, 'spec.lint', spec.issued_seq);
  if (!lint || lint.digest !== spec.output?.sha256) return { ok: false, reason: `no passing spec.lint newer than the verified spec ${spec.id}` };
  if (gate === 'gate1') {
    if (!designerRequired(s)) return { ok: true, spec, check: lint, evidence: [lint.id, spec.id] };
    const design = readyDesign(s);
    if (!design) return { ok: false, reason: 'no verified design with its question answered' };
    return { ok: true, spec, check: lint, evidence: [lint.id, spec.id, design.id], design };
  }
  const plan = passing(s, 'plan.lint', lint.seq);
  if (!plan || !o.planDigest || plan.digest !== o.planDigest) return { ok: false, reason: 'no passing plan.lint of the current plan' };
  return { ok: true, spec, check: plan, evidence: [plan.id, lint.id, spec.id] };
}

// AD-33: what a gate rework voids. Gate 1: the current spec step, its step_verified and the
// spec.lint checks of it, plus the current design step and its step_verified. Gate 2 (3-3): the
// current slicer step and its step_verified, and the unvoided plan.lint checks; a fresh slicer is due.
export function reworkVoids(s: RunState, commands: readonly AnyEvent[], target: 'gate1' | 'gate2'): string[] {
  if (target === 'gate2') {
    const plan = latestSlicePlan(s);
    return [...(plan ? withVerified(plan, commands) : []), ...s.checks.filter((c) => c.check === 'plan.lint' && !isVoided(s, c.id)).map((c) => c.id)];
  }
  const spec = latestSpec(s);
  const design = designVoids(s, commands);
  if (!spec) return design;
  const lints = s.checks.filter((c) => c.check === 'spec.lint' && c.seq > spec.issued_seq && !isVoided(s, c.id)).map((c) => c.id);
  return [...withVerified(spec, commands), ...lints, ...design];
}

// --- slices (AD-30) --------------------------------------------------------------------------

// The live slices (3-4), in plan order: started, and not CLOSED or CUT.
export const liveSlices = (s: RunState): Slice[] =>
  s.slice_order.map((id) => s.slices[id]).filter((sl) => sl.state !== 'BACKLOG' && sl.state !== 'CLOSED' && sl.state !== 'CUT');

const settledSlice = (sl: Slice | undefined): boolean => sl?.state === 'CLOSED' || sl?.state === 'CUT';

// Where a slice's review cycle starts: after the run last left WRAP. A slice rework is decided only
// at the merge card (WRAP), so for the reworked slice this is its latest rework; before any WRAP
// it is the whole slice (no reviewer of a slice runs before its slice_started).
export const reviewSince = (s: RunState): number =>
  s.step_order.reduce((m, id) => (s.steps[id].stage === 'WRAP' ? Math.max(m, s.steps[id].issued_seq) : m), -1);

// The newest verified step of a rostered reviewer on the slice in this review cycle, issued before
// `before` (a seq).
export function latestReview(s: RunState, slice: string, role: string, before = Infinity): Step | undefined {
  const since = reviewSince(s);
  return latestStep(s, (st) => st.role === role && st.slice === slice && st.issued_seq > since && st.issued_seq < before && isVerified(s, st));
}

// Who reviews the slice's next round (AD-30), from the reviews issued before `before`. The full
// roster when no rostered reviewer has run since slice_started or the latest rework (round 1, and
// the first round after a rework), and when every one approved (a builder round that no finding
// asked for, like a New dependency retry). Otherwise only the roles whose latest verdict is FINDINGS,
// plus any rostered role that has not run yet (one a failing health check kept out).
export function dueReviewers(s: RunState, slice: string, before = Infinity): string[] {
  const roster = sliceRoster(s.slices[slice]);
  const latest = roster.map((r) => latestReview(s, slice, r, before));
  if (latest.every((st) => !st) || latest.every((st) => st?.verdict === 'APPROVE')) return roster;
  return roster.filter((_, i) => latest[i]?.verdict !== 'APPROVE');
}

// The current round of a slice: its newest verified builder step, then the newest contract.test
// issued after it, then (issued after that test) the newest contract.health and the newest step of
// each rostered reviewer. `due` is who reviews this round, fixed at the test. Round order is builder →
// commit → test → the diff reviewers with health (only when a running-app reviewer is due) → the
// running-app reviewers once health passed, so a reviewer only ever sees code whose tests pass.
export interface Round {
  builder?: Step; test?: Step; testCheck?: CheckEntry; health?: Step; healthCheck?: CheckEntry;
  reviewers: Record<string, Step>; due: string[];
}

export function roundOf(s: RunState, slice: string): Round {
  const builder = latestStep(s, (st) => st.role === 'builder' && st.slice === slice && isVerified(s, st));
  if (!builder) return { reviewers: {}, due: [] };
  const test = latestStep(s, (st) => st.kind === 'run_check' && st.check === 'contract.test' && st.slice === slice && st.issued_seq > builder.issued_seq);
  const testCheck = test && isVerified(s, test) ? checkById(s, test.output?.check_id) : undefined;
  if (!test) return { builder, reviewers: {}, due: [] };
  const health = latestStep(s, (st) => st.kind === 'run_check' && st.check === 'contract.health' && st.slice === slice && st.issued_seq > test.issued_seq);
  const healthCheck = health && isVerified(s, health) ? checkById(s, health.output?.check_id) : undefined;
  const reviewers: Record<string, Step> = {};
  for (const role of sliceRoster(s.slices[slice])) {
    const st = latestStep(s, (x) => x.role === role && x.slice === slice && x.issued_seq > test.issued_seq);
    if (st) reviewers[role] = st;
  }
  return { builder, test, testCheck, health, healthCheck, reviewers, due: dueReviewers(s, slice, test.issued_seq) };
}

const passed = (s: RunState, st: Step | undefined, c: CheckEntry | undefined): boolean => isVerified(s, st) && c?.exit_code === 0;

// What the round still has to issue: the due diff reviewers not issued yet, contract.health when a
// running-app reviewer is due and health has not run, and once health passed the due running-app
// reviewers not issued yet. Nothing before the round's test passed.
export function roundNext(s: RunState, r: Round): { reviewers: string[]; health: boolean } {
  if (!r.test || !passed(s, r.test, r.testCheck)) return { reviewers: [], health: false };
  const left = (role: string): boolean => !r.reviewers[role];
  const diff = r.due.filter((x) => isDiffReviewer(x) && left(x));
  const app = r.due.filter(isAppReviewer);
  if (!app.length) return { reviewers: diff, health: false };
  if (!r.health) return { reviewers: diff, health: true };
  return { reviewers: [...diff, ...(passed(s, r.health, r.healthCheck) ? app.filter(left) : [])], health: false };
}

// The round is settled once its test passed, nothing is left to issue, and health and every
// reviewer it issued are verified.
const settled = (s: RunState, r: Round): boolean => {
  const next = roundNext(s, r);
  return passed(s, r.test, r.testCheck) && !next.health && !next.reviewers.length && (!r.health || isVerified(s, r.health)) && Object.values(r.reviewers).every((st) => isVerified(s, st));
};

// What a round failed on, for the builder's next brief and the Non-convergence card: a failing slice
// test (at once), or once the round settled a failing contract.health and/or FINDINGS. `findings`
// holds every reviewer of the round at FINDINGS, in roster order. Null when the round did not fail.
export interface RoundFailure { kind: 'test' | 'health' | 'findings'; step: Step; findings: Step[] }

export function roundFailure(s: RunState, r: Round): RoundFailure | null {
  if (r.test && isVerified(s, r.test) && r.testCheck && r.testCheck.exit_code !== 0) return { kind: 'test', step: r.test, findings: [] };
  if (!settled(s, r)) return null;
  const findings = REVIEWERS.map((role) => r.reviewers[role]).filter((st): st is Step => Boolean(st) && isVerified(s, st) && st.verdict === 'FINDINGS');
  if (r.health && r.healthCheck && r.healthCheck.exit_code !== 0) return { kind: 'health', step: r.health, findings };
  return findings.length ? { kind: 'findings', step: findings[0], findings } : null;
}

// Slice close (AD-30): every reviewer due this round approved after a passing contract.test that
// ran after the last builder commit, every rostered role's latest verdict in this review cycle is
// APPROVE, and no builder step of the slice is open. The CLI
// also checks that the test's sha contains the builder's sha and runs git.deps before it appends
// slice_closed.
export type CloseEvidence = { ok: true; builder: Step; check: CheckEntry } | { ok: false; reason: string };

export function closeEvidence(s: RunState, slice: string): CloseEvidence {
  const sl = s.slices[slice];
  if (!sl || sl.state !== 'IN_REVIEW') return { ok: false, reason: `slice ${slice} is ${sl?.state ?? 'unknown'}` };
  // 3-4: another slice's builder may be at work; only this slice's own builder blocks its close.
  if (openSteps(s).some((st) => st.role === 'builder' && st.slice === slice)) return { ok: false, reason: 'a builder step of the slice is open' };
  const r = roundOf(s, slice);
  if (!r.builder?.sha) return { ok: false, reason: 'no verified builder commit' };
  if (!r.testCheck || r.testCheck.exit_code !== 0 || !r.testCheck.sha) return { ok: false, reason: 'no passing contract.test after the last builder commit' };
  // This round's reviewers first (a role is due unless it already approved in this cycle), then
  // every rostered role's latest verdict.
  for (const role of r.due) {
    const st = r.reviewers[role];
    if (!st || !isVerified(s, st) || st.verdict !== 'APPROVE') return { ok: false, reason: `no ${role} APPROVE` };
  }
  const since = reviewSince(s);
  for (const role of sliceRoster(sl)) {
    const st = latestStep(s, (x) => x.role === role && x.slice === slice && x.issued_seq > since);
    if (!st || !isVerified(s, st) || st.verdict !== 'APPROVE') return { ok: false, reason: `no ${role} APPROVE` };
  }
  return { ok: true, builder: r.builder, check: r.testCheck };
}

// The latest verified verdict of each rostered reviewer of a slice (the merge card's rows, the
// merge pins).
export const sliceVerdicts = (s: RunState, slice: string): { role: string; step?: Step }[] =>
  sliceRoster(s.slices[slice]).map((role) => ({ role, step: latestStep(s, (st) => st.role === role && st.slice === slice && isVerified(s, st)) }));

// --- the build loop (3-4, AD-30) --------------------------------------------------------------

// A failed round that the slice's builder must fix next: the round settled (or its test failed) with
// nothing of the slice still open, under MAX_RETRIGGER_ROUNDS. At the cap the CLI raises
// Non-convergence instead.
function owesRound(s: RunState, sl: Slice): boolean {
  if (sl.state !== 'IN_REVIEW' && sl.state !== 'FINDINGS_QUEUED') return false;
  if (openSteps(s).some((st) => st.slice === sl.id)) return false;
  const r = roundOf(s, sl.id);
  if (!r.builder || !r.test || !isVerified(s, r.test)) return false;
  const next = roundNext(s, r);
  if (next.health || next.reviewers.length) return false;
  return roundFailure(s, r) !== null && sl.rounds < MAX_RETRIGGER_ROUNDS;
}

// The slice wants a builder step now: BUILDING with nothing of it open (a fresh start, a retry, a
// rework), or a failed round it owes. ESCALATED slices get nothing new.
export function wantsBuilder(s: RunState, slice: string): boolean {
  const sl = s.slices[slice];
  if (!sl) return false;
  if (sl.state === 'BUILDING') return !openSteps(s).some((st) => st.slice === slice);
  return owesRound(s, sl);
}

// A running-app reviewer of the slice's current round is still due: one is on the round and has not
// been verified, whether health is still to run, passed, or failed (then it runs in the next round,
// and must still judge this slice's code, not the next slice's).
function appStillDue(s: RunState, r: Round): boolean {
  return r.due.some((role) => isAppReviewer(role) && !isVerified(s, r.reviewers[role]));
}

// The next Backlog slice that may start now (AD-30): the first one in plan order, once its
// depends_on slices are all CLOSED or CUT, no slice is BUILDING, ESCALATED or owes a builder round,
// every slice in review has a passing round test and no running-app reviewer still due (health
// restarts the dev server at the worktree head), and the cut card is not open.
export function nextBacklog(s: RunState): Slice | undefined {
  const sl = s.slice_order.map((id) => s.slices[id]).find((x) => x.state === 'BACKLOG');
  if (!sl || !sl.deps.every((d) => settledSlice(s.slices[d]))) return undefined;
  if (Object.values(s.asks).some((a) => a.open && a.card?.type === 'cut')) return undefined;
  for (const x of liveSlices(s)) {
    if (x.state === 'BUILDING' || x.state === 'ESCALATED' || owesRound(s, x)) return undefined;
    const r = roundOf(s, x.id);
    if (!passed(s, r.test, r.testCheck) || appStillDue(s, r)) return undefined;
  }
  return sl;
}

// The state a slice's evidence implies (3-4), for a ruling's slice_to: BUILDING while a builder step
// of it is open, with no verified builder, or when the escalation came from BUILDING after a round
// that already ran its test (a retry or a rework waiting for its builder); else FINDINGS_QUEUED when
// a reviewer of the current round reported FINDINGS, else IN_REVIEW. Work that finished while the
// slice was ESCALATED counts.
export function evidenceState(s: RunState, slice: string): SliceState {
  const sl = s.slices[slice];
  const r = roundOf(s, slice);
  if (openSteps(s).some((st) => st.role === 'builder' && st.slice === slice) || !r.builder || r.builder.issued_seq < reviewSince(s)) return 'BUILDING';
  if (sl?.state === 'ESCALATED' && sl.escalated_from === 'BUILDING' && r.test) return 'BUILDING';
  return Object.values(r.reviewers).some((st) => isVerified(s, st) && st.verdict === 'FINDINGS') ? 'FINDINGS_QUEUED' : 'IN_REVIEW';
}

// The slice's own builder commits, oldest first (3-4): git.deps diffs only these, so a dependency
// another slice added (and the human accepted there) is not raised again.
export const sliceDeps = (s: RunState, slice: string): string[] =>
  s.step_order.map((id) => s.steps[id]).filter((st) => st.role === 'builder' && st.slice === slice && isVerified(s, st) && st.sha).map((st) => st.sha!);

// Board order of the stages; DESIGN runs beside SPEC.
const STAGE_RANK: Record<Stage, number> = { INTAKE: 0, RECON: 1, FRAME: 1, SCAFFOLD: 2, SPEC: 3, DESIGN: 3, SLICE_PLAN: 4, BUILD: 5, WRAP: 6 };

// AD-33: what `/factory rerun <stage>` voids: the stage's steps with their step_verified and its lint
// checks; every later gate pass (with its card) and every later-stage step; every slice-bound step
// and slice_closed. A RECON rerun keeps SCAFFOLD (the worktree and a verified run contract stand).
// The code already built stays on the run branch. Already voided ids are left out.
export function rerunVoids(s: RunState, commands: readonly AnyEvent[], stage: Stage): string[] {
  const rank = STAGE_RANK[stage];
  const verifiedOf = new Map<string, string[]>();
  for (const e of commands) {
    if (e.kind !== 'step_verified') continue;
    const id = (e as Envelope<'step_verified'>).data.step_id;
    verifiedOf.set(id, [...(verifiedOf.get(id) ?? []), e.id]);
  }
  const gate1 = rank <= STAGE_RANK.SPEC;
  const gate2 = rank <= STAGE_RANK.SLICE_PLAN;
  const out: string[] = [];
  for (const id of s.step_order) {
    const st = s.steps[id];
    const later = STAGE_RANK[st.stage] > rank && !(rank === STAGE_RANK.RECON && st.stage === 'SCAFFOLD');
    const gateCard = st.kind === 'ask_human' && ((gate1 && st.card?.type === 'gate_1') || (gate2 && st.card?.type === 'gate_2'));
    if (st.stage === stage || later || gateCard || st.slice) out.push(id, ...(verifiedOf.get(id) ?? []));
  }
  const lints = s.checks.filter((c) => (c.check === 'spec.lint' && (stage === 'SPEC' || rank < STAGE_RANK.SPEC)) || (c.check === 'plan.lint' && gate2)).map((c) => c.id);
  const kinds = new Set<string>(['slice_closed', 'merge_approved', ...(gate1 ? ['gate_1_passed'] : []), ...(gate2 ? ['gate_2_passed'] : [])]);
  const events = commands.filter((e) => kinds.has(e.kind)).map((e) => e.id);
  return [...new Set([...out, ...lints, ...events])].filter((id) => !isVoided(s, id));
}

// --- WRAP and merge --------------------------------------------------------------------------

// The newest unvoided WRAP run_check step of `check`, and its result when verified.
export function wrapCheck(s: RunState, check: Check): { step?: Step; result?: CheckEntry } {
  const step = latestStep(s, (st) => st.kind === 'run_check' && st.stage === 'WRAP' && st.check === check && !isVoided(s, st.id));
  return { step, result: step && isVerified(s, step) ? checkById(s, step.output?.check_id) : undefined };
}

// The inline git.baseline the CLI ran at WRAP for `head`, after the WRAP checks it follows.
export const wrapBaseline = (s: RunState, head: string, afterSeq: number): CheckEntry | undefined =>
  [...s.checks].reverse().find((c) => c.check === 'git.baseline' && c.sha === head && c.seq > afterSeq && !isVoided(s, c.id));

export const openMergeCard = (s: RunState): Step | undefined =>
  openSteps(s).find((st) => st.kind === 'ask_human' && st.card?.type === 'merge');

// An approved merge the CLI has not run yet (dry run 2): WRAP, merge_approved, and no git.merged
// check after the last merge_approved. A failed git.merged ends it (the card comes back); only a
// successful one (then `merged`) spends the approval.
export function mergePending(s: RunState, commands: readonly AnyEvent[]): boolean {
  if (s.phase !== 'WRAP' || !s.merge_approved) return false;
  const at = commands.findLastIndex((e) => e.kind === 'merge_approved');
  return at >= 0 && !commands.slice(at + 1).some((e) => e.kind === 'check_ran' && (e as Envelope<'check_ran'>).data.check === 'git.merged');
}

// The approved commit and target branch of the last merge_approved.
export function approvedMerge(commands: readonly AnyEvent[]): { sha?: string; target?: string } {
  const e = commands.findLast((x) => x.kind === 'merge_approved') as Envelope<'merge_approved'> | undefined;
  return { sha: e?.data.sha, target: e?.data.target };
}

export type MergeEvidence = { ok: true; card: Step; evidence: string[] } | { ok: false; reason: string };

// Merge (AD-7, AD-8): an open merge card that offers the merge, pinned to the run branch head and
// target the caller probed now, with passing WRAP health and test at that head and the baseline
// after them. Any commit after the card makes it stale.
export function mergeEvidence(s: RunState, o: { head: string | null; target: string | null }): MergeEvidence {
  const card = openMergeCard(s);
  if (!card?.card) return { ok: false, reason: 'no open merge card' };
  if (!card.card.commands.includes('/factory merge')) return { ok: false, reason: `the merge card offers no merge: ${card.card.reason ?? ''}` };
  if (!o.head || card.card.sha !== o.head) return { ok: false, reason: `the run branch moved since the card (card ${card.card.sha?.slice(0, 12)}, now ${o.head?.slice(0, 12) ?? 'none'})` };
  if ((card.card.target ?? null) !== o.target) return { ok: false, reason: `the target moved since the card (card ${card.card.target?.slice(0, 12) ?? 'none'}, now ${o.target?.slice(0, 12) ?? 'none'})` };
  const checks = (['contract.health', 'contract.test'] as const).map((c) => wrapCheck(s, c).result);
  if (checks.some((c) => !c || c.exit_code !== 0 || c.sha !== o.head)) return { ok: false, reason: 'no passing WRAP contract.health and contract.test at the run branch head' };
  const base = wrapBaseline(s, o.head, Math.max(...checks.map((c) => c!.seq)));
  if (!base || base.exit_code !== 0) return { ok: false, reason: 'no passing git.baseline at the run branch head' };
  return { ok: true, card, evidence: [...checks.map((c) => c!.id), base.id] };
}

// AD-33: what `rework S<n>` at the merge card voids: the slice's slice_closed, and every WRAP check
// (the run_check steps, their step_verified and check_ran, and the inline git.baseline) since the
// last stage_completed{BUILD}.
export function sliceReworkVoids(s: RunState, commands: readonly AnyEvent[], slice: string): string[] {
  const live = (id: string): boolean => !isVoided(s, id);
  const closed = commands.filter((e) => e.kind === 'slice_closed' && (e as Envelope<'slice_closed'>).data.slice === slice).map((e) => e.id);
  let from = -1;
  commands.forEach((e, i) => { if (e.kind === 'stage_completed' && (e as Envelope<'stage_completed'>).data.stage === 'BUILD') from = i; });
  const steps = s.step_order.filter((id) => s.steps[id].kind === 'run_check' && s.steps[id].stage === 'WRAP');
  const after = commands.slice(from + 1);
  const verified = after.filter((e) => e.kind === 'step_verified' && steps.includes((e as Envelope<'step_verified'>).data.step_id)).map((e) => e.id);
  const checks = after.filter((e) => e.kind === 'check_ran' && ['contract.health', 'contract.test', 'git.baseline'].includes((e as Envelope<'check_ran'>).data.check)).map((e) => e.id);
  return [...new Set([...closed, ...steps, ...verified, ...checks])].filter(live);
}
