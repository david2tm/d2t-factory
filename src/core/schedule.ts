// What `next` issues (AD-3, AD-24). Pure: reads state only (AD-23) plus the probes the CLI made
// before taking the lock, and returns step_issued data; the CLI adds paths and briefs and appends.
import type { Check, DataByKind, SlicePlanEntry } from './events.ts';
import { validateIntake } from './artifacts.ts';
import { designChoiceCard, gate1Card, gate2Card, intakeCard, intakeConfirmCard, mergeCard } from './cards.ts';
import type { DesignQuestion } from './events.ts';
import { boardStage, isTerminal, openSteps, type Ask, type RunState, type Step } from './reducer.ts';
import { isAppReviewer } from './roster.ts';
import {
  askOpenFor, designChoiceFor, designerRequired, designMode, isIntakeChat, isIntakeConfirm, isVerified, isVoided, latestByRole, latestCheckStep,
  latestSpec, latestStep, liveSlices, readyDesign, roundNext, roundOf, sliceVerdicts, wantsBuilder, wrapBaseline, wrapCheck,
} from './verify.ts';

export type DueStep = DataByKind['step_issued'];

// WRAP's git probe, made unlocked by the CLI after it tried to integrate the target (AD-8).
export interface WrapProbe {
  head: string; // the run branch head in the worktree
  target: string | null; // the head of the main checkout's current branch (null: detached)
  branch: string | null; // that branch's name
  diffstat: string; // git diff --shortstat base..head
  problems: string[]; // why no merge can be offered right now (conflicts, detached HEAD, …), redacted
}

// A card already raised for this head and target still says all there is to say: no git merge
// failed after it, no newer git.baseline ran at the head, and it names every current probe problem.
export function mergeCardCurrent(s: RunState, card: Step, p: WrapProbe): boolean {
  if (card.card?.sha !== p.head || (card.card.target ?? null) !== p.target) return false;
  const after = s.checks.filter((c) => c.seq > card.issued_seq && !isVoided(s, c.id));
  if (after.some((c) => (c.check === 'git.merged' && c.exit_code !== 0) || (c.check === 'git.baseline' && c.sha === p.head))) return false;
  return p.problems.every((x) => (card.card!.reason ?? '').includes(x));
}

export interface ScheduleCtx {
  in_worktree: boolean; // the caller's realpath cwd is inside the run's worktree
  recon_cached: boolean; // brownfield: <repo-hash>/recon/<base_sha>.md exists and parses
  // 3-4: per slice, the builder agent a new round of it may resume (spawned under the current session_bound).
  resume_agents?: Record<string, string>;
  wrap?: WrapProbe;
}

const NO_CTX: ScheduleCtx = { in_worktree: false, recon_cached: false };

const agent = (role: string, stage: DueStep['stage'], attempt: number, slice?: string): DueStep =>
  ({ kind: 'spawn', stage, attempt, role, agent: `d2t-factory:${role}`, ...(slice ? { slice } : {}) });
const runCheck = (check: Check, stage: DueStep['stage'], slice?: string): DueStep => ({ kind: 'run_check', stage, attempt: 1, check, ...(slice ? { slice } : {}) });

const lintView = (st: Step): { ok: boolean; errors: string[] } => ({
  ok: st.output?.exit_code === 0,
  errors: Array.isArray(st.output?.errors) ? (st.output!.errors as string[]) : [],
});

// INTAKE (3-1): the conversation step (the CLI adds its output_path and brief), then, once the
// conductor reported a valid intake, the confirm card showing its fields. A re-report closes the
// stale card (done.ts), so a fresh one is due.
function intake(s: RunState): DueStep[] {
  const open = openSteps(s);
  const chat = open.find(isIntakeChat);
  if (!chat) return [{ kind: 'ask_human', stage: 'INTAKE', attempt: 1, card: intakeCard() }];
  if (chat.state !== 'reported' || open.some(isIntakeConfirm)) return [];
  const v = validateIntake((chat.output?.front ?? {}) as Record<string, unknown>);
  return v.ok ? [{ kind: 'ask_human', stage: 'INTAKE', attempt: 1, card: intakeConfirmCard(v.value) }] : [];
}

// ORIENT: RECON (brownfield) is one recon agent unless the cache hit; FRAME (greenfield, 5-2) is one
// framer agent, never cached. A rerun voids the verified one, so a fresh one is due with attempt + 1.
// The CLI completes the stage.
function orient(s: RunState, ctx: ScheduleCtx): DueStep[] {
  const [role, stage] = s.greenfield ? ['framer', 'FRAME'] as const : ['recon', 'RECON'] as const;
  if (!s.greenfield && ctx.recon_cached) return [];
  const r = latestByRole(s, role);
  if (!r) return [agent(role, stage, 1)];
  if (r.state === 'verified' && isVoided(s, r.id)) return [agent(role, stage, r.attempt + 1)];
  return [];
}

// SCAFFOLD: the CLI makes the worktree; the conductor enters it; the scaffolder writes the run
// contract; then the contract's install in the worktree, and once it passed the health and test
// checks. A failed install runs neither: the CLI raises the card. The CLI verifies the scaffolder
// when all three pass.
function scaffold(s: RunState, ctx: ScheduleCtx): DueStep[] {
  if (!s.worktree) return [];
  if (!ctx.in_worktree) {
    const open = openSteps(s).some((st) => st.kind === 'enter_worktree');
    return open ? [] : [{ kind: 'enter_worktree', stage: 'SCAFFOLD', attempt: 1 }];
  }
  const sc = latestByRole(s, 'scaffolder');
  if (!sc) return [agent('scaffolder', 'SCAFFOLD', 1)];
  if (sc.state !== 'reported' || sc.output?.status !== 'DONE' || sc.output.failure || askOpenFor(s, sc.id)) return [];
  const install = latestCheckStep(s, 'contract.install', sc.issued_seq);
  if (!install) return [runCheck('contract.install', 'SCAFFOLD')];
  if (install.state !== 'verified' || install.output?.exit_code !== 0) return [];
  return (['contract.health', 'contract.test'] as const).filter((c) => !latestCheckStep(s, c, sc.issued_seq)).map((c) => runCheck(c, 'SCAFFOLD'));
}

const assumptionsOf = (st: Step): number => {
  const front = st.output?.front as Record<string, unknown> | undefined;
  return Array.isArray(front?.assumptions) ? front.assumptions.length : 0;
};

// SPEC + gate 1: spec-writer → spec.lint → the gate_1 card. A gate-1 rework voids the spec, so a
// fresh spec-writer is due. With a designer the card also waits for the ready design (3-2).
function spec(s: RunState): DueStep[] {
  const sw = latestByRole(s, 'spec-writer');
  if (!sw || (sw.state === 'verified' && isVoided(s, sw.id))) return [agent('spec-writer', 'SPEC', (sw?.attempt ?? 0) + 1)];
  if (!isVerified(s, sw)) return [];
  const lint = latestCheckStep(s, 'spec.lint', sw.issued_seq);
  if (!lint) return [runCheck('spec.lint', 'SPEC')];
  if (lint.state !== 'verified') return [];
  const gate = latestStep(s, (st) => st.kind === 'ask_human' && st.card?.type === 'gate_1' && st.issued_seq > lint.issued_seq && !isVoided(s, st.id));
  if (gate) return [];
  const withDesign = designerRequired(s);
  const d = withDesign ? readyDesign(s) : undefined;
  if (withDesign && !d) return [];
  const design = d ? { path: String(d.output?.path ?? d.output_path), mode: String((d.output?.front as Record<string, unknown> | undefined)?.mode ?? designMode(s)), assumptions: assumptionsOf(d) } : undefined;
  return [{ kind: 'ask_human', stage: 'SPEC', attempt: 1, card: gate1Card({ spec_path: String(sw.output?.path ?? sw.output_path), assumptions: assumptionsOf(sw), lint: lintView(lint), ...(design ? { design } : {}) }) }];
}

// DESIGN (3-2), beside SPEC: the designer when one is required; a voided design (a non-default
// choice, a gate-1 rework) is due again with attempt + 1. A verified design that asked its one
// question gets the design_choice card, once.
function design(s: RunState): DueStep[] {
  if (!designerRequired(s)) return [];
  const d = latestByRole(s, 'designer');
  if (!d || (d.state === 'verified' && isVoided(s, d.id))) return [agent('designer', 'DESIGN', (d?.attempt ?? 0) + 1)];
  if (!isVerified(s, d) || !d.output?.question || designChoiceFor(s, d)) return [];
  return [{ kind: 'ask_human', stage: 'DESIGN', attempt: 1, card: designChoiceCard(d.output.question as DesignQuestion) }];
}

// SLICE_PLAN + gate 2 (3-3): slicer → plan.lint → the gate_2 card. plan.lint lints the current
// slicer plan and adds each slice's roster. A gate-2 rework voids the slicer (and its lint), so a
// fresh slicer is due with attempt + 1.
function slicePlan(s: RunState): DueStep[] {
  if (!latestSpec(s)) return [];
  const sl = latestByRole(s, 'slicer');
  if (!sl || (sl.state === 'verified' && isVoided(s, sl.id))) return [agent('slicer', 'SLICE_PLAN', (sl?.attempt ?? 0) + 1)];
  if (!isVerified(s, sl)) return [];
  const lint = latestCheckStep(s, 'plan.lint', sl.issued_seq);
  if (!lint) return [runCheck('plan.lint', 'SLICE_PLAN')];
  if (lint.state !== 'verified') return [];
  if (latestStep(s, (st) => st.kind === 'ask_human' && st.card?.type === 'gate_2' && st.issued_seq > lint.issued_seq && !isVoided(s, st.id))) return [];
  const slices = Array.isArray(lint.output?.plan) ? (lint.output!.plan as SlicePlanEntry[]) : [];
  return [{ kind: 'ask_human', stage: 'SLICE_PLAN', attempt: 1, card: gate2Card({ slices, lint: lintView(lint) }) }];
}

// BUILD (AD-30, 3-4): the live slices in plan order, each round builder → (CLI commit) →
// contract.test → the round's diff reviewers, with contract.health (the CLI restarts the dev server at
// the worktree head) when a running-app reviewer is due → the running-app reviewers once health
// passed. Round 1 and the first round after a rework review with the full roster; after FINDINGS only
// the raising reviewers re-check. A failing test or health check, or any FINDINGS, sends the slice back
// to the builder (resumed when it can be) once nothing of the round is open, until
// MAX_RETRIGGER_ROUNDS; then the CLI raises Non-convergence. The CLI starts and closes slices.
// Pipelining: the worktree has one writer at a time (a builder step, a contract.test/contract.health
// check, or the running-app reviewers), while diff reviewers read at their slice's sha and may run
// beside any of them. One step per role (AD-3), earliest slice first, so the builder goes to the
// earliest slice that wants it. Nothing new is issued for an ESCALATED slice.
type Writer = 'builder' | 'check' | 'app';

function build(s: RunState, ctx: ScheduleCtx): DueStep[] {
  const open = openSteps(s);
  const roles = new Set(open.map((st) => st.role).filter((r): r is string => Boolean(r)));
  const writerOf = (st: Step): Writer | null =>
    st.role === 'builder' ? 'builder' : st.stage === 'BUILD' && (st.check === 'contract.test' || st.check === 'contract.health') ? 'check' : isAppReviewer(st.role) ? 'app' : null;
  let writer: Writer | null = open.map(writerOf).find((w) => w !== null) ?? null;
  const live = liveSlices(s).filter((sl) => sl.state !== 'ESCALATED');
  // A passing health with its running-app reviewers still to issue: no builder may move the head
  // first, or they would judge it with stale health.
  const healthHeld = live.some((sl) => (sl.state === 'IN_REVIEW' || sl.state === 'FINDINGS_QUEUED') && roundNext(s, roundOf(s, sl.id)).reviewers.some(isAppReviewer));
  const out: DueStep[] = [];
  for (const sl of live) {
    if (wantsBuilder(s, sl.id)) {
      if (writer || roles.has('builder') || healthHeld) continue;
      const id = ctx.resume_agents?.[sl.id];
      out.push({ kind: id ? 'resume' : 'spawn', stage: 'BUILD', attempt: 1, role: 'builder', agent: 'd2t-factory:builder', slice: sl.id, ...(id ? { agent_id: id } : {}) });
      writer = 'builder';
      roles.add('builder');
      continue;
    }
    if (sl.state !== 'IN_REVIEW' && sl.state !== 'FINDINGS_QUEUED') continue;
    const r = roundOf(s, sl.id);
    if (!r.builder) continue;
    if (!r.test) {
      if (!writer) { out.push(runCheck('contract.test', 'BUILD', sl.id)); writer = 'check'; }
      continue;
    }
    if (!isVerified(s, r.test)) continue;
    const next = roundNext(s, r);
    for (const role of next.reviewers) {
      if (roles.has(role)) continue;
      if (isAppReviewer(role)) {
        if (writer && writer !== 'app') continue;
        writer = 'app';
      }
      out.push(agent(role, 'BUILD', 1, sl.id));
      roles.add(role);
    }
    if (next.health && !writer) { out.push(runCheck('contract.health', 'BUILD', sl.id)); writer = 'check'; }
  }
  return out;
}

// WRAP: health and test at the run branch head, the CLI's inline git.baseline, then the merge card.
// A conflict or another probe problem goes straight to a card without merge. Any new head (or a
// moved target) needs fresh checks and a fresh card; the CLI closes the stale one.
function wrap(s: RunState, ctx: ScheduleCtx): DueStep[] {
  const p = ctx.wrap;
  if (!p || openSteps(s).some((st) => st.kind === 'ask_human' && st.card?.type === 'merge')) return [];
  const last = latestStep(s, (st) => st.kind === 'ask_human' && st.card?.type === 'merge' && !isVoided(s, st.id));
  if (last && mergeCardCurrent(s, last, p)) return [];
  // A failed git merge is shown, but the merge stays on offer: decide re-checks everything.
  const failed = last ? s.checks.filter((c) => c.check === 'git.merged' && c.seq > last.issued_seq && c.exit_code !== 0) : [];
  const notes = failed.length ? [`the last git merge failed (exit ${failed.at(-1)!.exit_code}) and was aborted`] : [];
  const problems = p.problems;
  const slices = s.slice_order.map((id) => s.slices[id]).filter((sl) => sl.state !== 'CUT').map((sl) => ({
    id: sl.id, title: sl.title, rounds: sl.rounds, verdicts: sliceVerdicts(s, sl.id).map((v) => ({ role: v.role, verdict: v.step?.verdict })),
  }));
  const card = (test?: { exit_code: number }, extra: string[] = []) => [{
    kind: 'ask_human' as const, stage: 'WRAP' as const, attempt: 1,
    card: mergeCard({ slices, sha: p.head, target: p.target, branch: p.branch, diffstat: p.diffstat, test, problems: [...problems, ...extra], notes }),
  }];
  if (p.problems.length) return card();
  // health first: it restarts the dev server, which a test may use. The test follows once health
  // at this head is verified (passed or failed).
  const checks = (['contract.health', 'contract.test'] as const).map((c) => ({ c, ...wrapCheck(s, c) }));
  for (const x of checks) {
    if (!x.step || (x.result && x.result.sha !== p.head)) return [runCheck(x.c, 'WRAP')];
    if (!x.result) return []; // still running
  }
  const base = wrapBaseline(s, p.head, Math.max(...checks.map((x) => x.result!.seq)));
  if (!base) return []; // the CLI runs it inline
  const failing = [
    ...checks.filter((x) => x.result!.exit_code !== 0).map((x) => `${x.c} failed (exit ${x.result!.exit_code})`),
    ...(base.exit_code === 0 ? [] : ['the main checkout differs from its baseline']),
  ];
  return card({ exit_code: checks[1].result!.exit_code }, failing);
}

// MERGED: a conductor still inside the worktree leaves it first; the CLI then removes it.
function merged(s: RunState, ctx: ScheduleCtx): DueStep[] {
  if (!ctx.in_worktree || openSteps(s).some((st) => st.kind === 'exit_worktree')) return [];
  return [{ kind: 'exit_worktree', stage: 'WRAP', attempt: 1 }];
}

// The ask_human step that carries an open ask: an escalation's by its id, the cut card by its type.
const carries = (st: Step, ask: Ask): boolean => st.kind === 'ask_human' && (ask.escalation ? st.card?.escalation === ask.escalation : st.card?.type === ask.card.type);

export function due(state: RunState, ctx: ScheduleCtx = NO_CTX): DueStep[] {
  if (isTerminal(state)) return [];
  const out: DueStep[] = [];
  // Every open escalation, and the CLI's live cut card, reaches the human as an ask_human step
  // carrying its card (AD-12, AD-17).
  for (const ask of Object.values(state.asks)) {
    if (!ask.open || (!ask.escalation && ask.card?.type !== 'cut')) continue;
    if (openSteps(state).some((st) => carries(st, ask))) continue;
    out.push({ kind: 'ask_human', stage: boardStage(state), attempt: 1, card: ask.escalation ? { ...ask.card, escalation: ask.escalation } : ask.card });
  }
  switch (state.phase) {
    case 'INTAKE': out.push(...intake(state)); break;
    case 'ORIENT': out.push(...orient(state, ctx)); break;
    case 'SCAFFOLD': out.push(...scaffold(state, ctx)); break;
    case 'SPEC_DESIGN': out.push(...spec(state), ...design(state)); break;
    case 'SLICE_PLAN': out.push(...slicePlan(state)); break;
    case 'BUILD': out.push(...build(state, ctx)); break;
    case 'WRAP': out.push(...wrap(state, ctx)); break;
    case 'MERGED': out.push(...merged(state, ctx)); break;
  }
  return out;
}
