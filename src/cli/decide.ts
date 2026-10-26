// `factory decide` (AD-6, AD-26): the only consumer of prompt facts. Takes no decision arguments.
// A decision verifies the open ask_human step it answers. Gate passes and the merge need their
// evidence (AD-7) and pin the sha256 of what was approved (AD-10); reworks carry their voids (AD-33).
// The approved merge itself is not run here: `next` runs it once the conductor has left the
// worktree (AD-8, dry run 2).
import { readFileSync } from 'node:fs';
import { checkOutput, validateIntake } from '../core/artifacts.ts';
import { clockStart, openCutAsk } from '../core/budget.ts';
import { FactoryError, type ErrorCode } from '../core/errors.ts';
import type { AnyEvent, DecisionKind, Pin, Stage } from '../core/events.ts';
import { boardStage, openSteps, type RunState, type Step } from '../core/reducer.ts';
import { redact } from '../core/redact.ts';
import {
  askOpenFor, designVoids, evidenceState, gateEvidence, isIntakeChat, isIntakeConfirm, isParked, latestDesign, latestSpec, mergeEvidence, rerunVoids, reworkVoids, sliceReworkVoids,
  sliceVerdicts,
} from '../core/verify.ts';
import { loadRun, readRedactValues, type LoadedRun } from '../store/load-run.ts';
import { withLock } from '../store/locks.ts';
import { lockDir } from '../store/paths.ts';
import { consumeWithoutCommand } from '../store/sessions.ts';
import type { Args } from './args.ts';
import { currentPlan } from './check.ts';
import { releaseClaims } from './claims.ts';
import { appendAll, gate, makeEvent } from './commit.ts';
import { devserverDown } from './devserver.ts';
import { currentBranch, head, insideRepo, repoHash, repoRoot, sha256, statusDigest } from './git.ts';
import { consumeWith, embed, newestPrompt, supersede, type Prompt } from './prompt.ts';
import { isRun, requireSession, resolveRun, type Resolution } from './resolve.ts';
import { artifactData, reissueEvent, type Ctx } from './steps.ts';

const REASON: Partial<Record<ErrorCode, string>> = { NOT_FOUND: 'no_run', MISSING_EVIDENCE: 'missing_evidence' };

function refuse(p: Prompt, code: 'ILLEGAL_TRANSITION' | 'NOT_FOUND' | 'MISSING_EVIDENCE', message: string): never {
  consumeWithoutCommand(p.prompt_id, REASON[code] ?? 'illegal');
  throw new FactoryError(code, message);
}

const openAsk = (s: RunState, pred: (st: Step) => boolean): Step | undefined => openSteps(s).find((st) => st.kind === 'ask_human' && pred(st));
const GATE_CARD: Record<string, string> = { gate1: 'gate_1', gate2: 'gate_2', gate_1_passed: 'gate_1', gate_2_passed: 'gate_2' };

interface Built { data: Record<string, unknown>; answers?: Step; extra: (decision: AnyEvent) => AnyEvent[] }

// What `/factory merge` is checked against, probed unlocked before the lock (AD-29).
interface MergeProbe { head: string | null; branch: string | null; target: string | null; digest: string | null }

function mergeProbe(c: Ctx, state: RunState): MergeProbe {
  const tryOr = <T>(f: () => T): T | null => { try { return f(); } catch { return null; } };
  const branch = currentBranch(c.root);
  return {
    head: state.worktree ? tryOr(() => head(state.worktree!)) : null,
    branch,
    target: branch ? tryOr(() => head(c.root)) : null,
    digest: tryOr(() => statusDigest(c.root).digest),
  };
}

// A pin of an artifact whose bytes must still be the ones recorded when it was reported.
function pinOf(st: Step | undefined): Pin | { error: string } | null {
  if (!st?.output_path || typeof st.output?.sha256 !== 'string') return null;
  let text = '';
  try { text = readFileSync(st.output_path, 'utf8'); } catch { /* compared below */ }
  const pin = { path: st.output_path, sha256: sha256(text) };
  return pin.sha256 === st.output.sha256 ? pin : { error: `${pin.path} changed since it was verified` };
}

// The CLI's own slice asks (no open subject step): a round's Non-convergence, New dependency, and
// (3-4) Over time box.
const CLI_SLICE_ASKS = ['Non-convergence', 'New dependency', 'Over time box'];
// AD-33: the stages a rerun goes back to. The orientation stage is the run's own: RECON on
// brownfield, FRAME on greenfield (5-2).
const RERUN_STAGES: readonly Stage[] = ['RECON', 'FRAME', 'SPEC', 'DESIGN', 'SLICE_PLAN'];

// The decision's data and side events, or a refusal (the prompt is consumed either way).
function build(p: Prompt, c: Ctx, run: LoadedRun, kind: DecisionKind, base: Record<string, unknown>, probe?: MergeProbe): Built {
  const { state } = run;
  const none = (): AnyEvent[] => [];
  switch (kind) {
    case 'intake_confirmed': {
      // The confirm card over a reported intake (3-1), whose out.md is still the bytes reported: its
      // fields are recorded, the file pinned, and the conversation step verified with the decision.
      if (state.phase !== 'INTAKE') refuse(p, 'ILLEGAL_TRANSITION', `intake_confirmed in ${state.phase}`);
      const card = openAsk(state, isIntakeConfirm);
      const chat = openSteps(state).find((st) => isIntakeChat(st) && st.state === 'reported');
      if (!card || !chat) refuse(p, 'ILLEGAL_TRANSITION', 'intake_confirmed: no recorded intake (the conductor writes it and runs factory done first)');
      const pin = pinOf(chat);
      if (!pin) refuse(p, 'ILLEGAL_TRANSITION', `intake_confirmed: step ${chat.id} has no reported intake`);
      if ('error' in pin) refuse(p, 'MISSING_EVIDENCE', `intake_confirmed: ${pin.error}`);
      const text = readFileSync(pin.path, 'utf8');
      const parsed = checkOutput('intake', text);
      const v = parsed.ok ? validateIntake(parsed.front) : undefined;
      if (!v?.ok) refuse(p, 'MISSING_EVIDENCE', `intake_confirmed: ${pin.path} no longer parses`);
      const values = readRedactValues(c.hash, c.runId);
      const runStarted = run.commands.find((e) => e.kind === 'run_started')?.ts ?? state.last_ts!;
      const data = { ...base, intake: redact(v.value, values), clock_start: clockStart(runStarted, v.value.started), pins: [pin], evidence: [chat.id] };
      // 6-3 (AD-23): the conversation's step_verified embeds the pinned intake for the board.
      const artifact = artifactData(c, pin.path, text, pin.sha256);
      return { data, answers: card, extra: (d) => [makeEvent(c.runId, 'step_verified', { step_id: chat.id, evidence: [d.id], ...(artifact ? { artifact } : {}) }, { corr: chat.id })] };
    }

    case 'cut_decided': {
      // The live cut card (AD-17): cut any subset of its candidates that are still in Backlog, or keep.
      if (state.phase !== 'BUILD') refuse(p, 'ILLEGAL_TRANSITION', `cut_decided in ${state.phase}`);
      if (!openCutAsk(state)) refuse(p, 'ILLEGAL_TRANSITION', 'cut_decided: no open cut card');
      for (const id of base.cut as string[]) {
        const st = state.slices[id]?.state;
        if (st !== 'BACKLOG') refuse(p, 'ILLEGAL_TRANSITION', `cut ${id}: ${st ? `slice ${id} is ${st}` : `no slice ${id}`}; only Backlog slices can be cut`);
      }
      return { data: base, answers: openAsk(state, (st) => st.card?.type === 'cut'), extra: none };
    }

    case 'gate_1_passed':
    case 'gate_2_passed': {
      const g2 = kind === 'gate_2_passed';
      const phase = g2 ? 'SLICE_PLAN' : 'SPEC_DESIGN';
      if (state.phase !== phase) refuse(p, 'ILLEGAL_TRANSITION', `${kind} in ${state.phase}`);
      const card = openAsk(state, (st) => st.card?.type === GATE_CARD[kind]);
      if (!card) refuse(p, 'ILLEGAL_TRANSITION', `${kind}: no open ${GATE_CARD[kind]} card`);
      const plan = g2 ? currentPlan(state) : undefined;
      const ev = gateEvidence(state, g2 ? 'gate2' : 'gate1', { planDigest: plan?.digest });
      if (!ev.ok) refuse(p, 'MISSING_EVIDENCE', `${kind}: ${ev.reason}`);
      // The spec, at gate 1 the design beside it (3-2), at gate 2 the slicer's plan (3-3): each still
      // the bytes that were verified.
      const pins: Pin[] = [];
      for (const st of [ev.spec, ...(!g2 && ev.design ? [ev.design] : []), ...(g2 && plan?.slicer ? [plan.slicer] : [])]) {
        let text = '';
        try { text = readFileSync(st.output_path!, 'utf8'); } catch { /* compared below */ }
        const pin = { path: st.output_path!, sha256: sha256(text) };
        if (pin.sha256 !== st.output?.sha256) refuse(p, 'MISSING_EVIDENCE', `${kind}: ${pin.path} changed since it was verified`);
        pins.push(pin);
      }
      const data = { ...base, pins, evidence: ev.evidence, ...(plan ? { slices: redact(plan.plan, readRedactValues(c.hash, c.runId)) } : {}) };
      return { data, answers: card, extra: none };
    }

    case 'design_choice_made': {
      // The designer's one question (3-2). The default keeps the design as written; the other option
      // voids it, and a fresh designer writes that option (brief: the choice, the previous design).
      if (state.phase !== 'SPEC_DESIGN') refuse(p, 'ILLEGAL_TRANSITION', `design_choice_made in ${state.phase}`);
      const card = openAsk(state, (st) => st.card?.type === 'design_choice');
      if (!card) refuse(p, 'ILLEGAL_TRANSITION', 'design_choice_made: no open design_choice card');
      const q = latestDesign(state)?.output?.question as { default?: unknown } | undefined;
      if (!q) refuse(p, 'ILLEGAL_TRANSITION', 'design_choice_made: the design that asked is no longer current');
      if (base.choice === q.default) return { data: base, answers: card, extra: none };
      return { data: { ...base, voids: designVoids(state, run.commands) }, answers: card, extra: none };
    }

    case 'rework_requested': {
      const target = String(base.target);
      if (/^S\d+$/.test(target)) {
        // A slice goes back only from the merge card (WRAP, before merged): it voids the slice's
        // close and the WRAP checks, and the builder gets the note.
        const card = state.phase === 'WRAP' ? openAsk(state, (st) => st.card?.type === 'merge') : undefined;
        if (!card) refuse(p, 'ILLEGAL_TRANSITION', `rework ${target} in ${state.phase}: only at an open merge card`);
        if (state.slices[target]?.state !== 'CLOSED') refuse(p, 'ILLEGAL_TRANSITION', `rework ${target}: no closed slice ${target}`);
        return { data: { ...base, voids: sliceReworkVoids(state, run.commands, target) }, answers: card, extra: none };
      }
      if (target !== 'gate1' && target !== 'gate2') refuse(p, 'ILLEGAL_TRANSITION', `unknown rework target ${target}`);
      const ask = openAsk(state, (st) => st.card?.type === GATE_CARD[target]);
      if (!ask) refuse(p, 'ILLEGAL_TRANSITION', `rework ${target}: no open ${GATE_CARD[target]} card`);
      return { data: { ...base, voids: reworkVoids(state, run.commands, target) }, answers: ask, extra: none };
    }

    case 'escalation_ruled': {
      const esc = String(base.escalation);
      const ask = Object.values(state.asks).find((a) => a.open && a.escalation === esc);
      if (!ask) refuse(p, 'ILLEGAL_TRANSITION', `no open escalation ${esc}`);
      const subject = ask.step_id ? state.steps[ask.step_id] : undefined;
      const open = subject && ['issued', 'claimed', 'reported'].includes(subject.state);
      const choice = String(base.choice);
      const retry = /^retry(?:\s+([\s\S]*))?$/.exec(choice);
      const answers = openAsk(state, (st) => st.card?.escalation === esc);
      // The CLI's own slice asks: retry is one more builder round; accept closes the slice
      // (Non-convergence) or lets its close go ahead (New dependency). Over time box (3-4): retry
      // grants another full time box and the slice goes where its evidence says (the note goes to
      // its builder); cut moves it to CUT, its commits kept, without deciding the budget cut.
      if (!open && ask.slice && CLI_SLICE_ASKS.includes(ask.card.reason_label ?? '')) {
        if (ask.card.reason_label === 'Over time box') {
          if (retry) return { data: { ...base, slice_to: evidenceState(state, ask.slice) }, answers, extra: none };
          if (choice === 'cut') return { data: { ...base, slice_to: 'CUT' }, answers, extra: none };
          return refuse(p, 'ILLEGAL_TRANSITION', `rule ${esc} ${choice}: the choices are retry <note…> or cut`);
        }
        if (retry) return { data: { ...base, slice_to: 'BUILDING' }, answers, extra: none };
        if (choice === 'accept') return { data: { ...base, slice_to: ask.card.reason_label === 'Non-convergence' ? 'CLOSED' : evidenceState(state, ask.slice) }, answers, extra: none };
        return refuse(p, 'ILLEGAL_TRANSITION', `rule ${esc} ${choice}: the choices are retry <note…> or accept`);
      }
      // The retry brief carries this ruling's note and the card's reason (briefText's retryNotes).
      // Its slice goes where the evidence says (3-4): work that finished meanwhile counts.
      if (retry && open) {
        const data = { ...base, ...(ask.slice ? { slice_to: evidenceState(state, ask.slice) } : {}) };
        return { data, answers, extra: (d) => [reissueEvent(c, { state, commands: [...run.commands, d] }, subject)] };
      }
      // accept only over a parsed DONE contract: SPEC must not proceed without a usable one. And
      // only when the card offers it: another run's exclusive claim (5-1) cannot be accepted.
      const acceptable = open && subject.role === 'scaffolder' && subject.output?.status === 'DONE' && !subject.output.failure
        && (ask.card.commands ?? []).includes(`/factory rule ${esc} accept`);
      if (choice === 'accept' && acceptable) {
        const failing = state.checks.filter((x) => x.seq > subject.issued_seq && x.exit_code !== 0).map((x) => x.id);
        return { data: base, answers, extra: (d) => [makeEvent(c.runId, 'step_verified', { step_id: subject.id, evidence: [...failing, d.id] }, { corr: subject.id })] };
      }
      const legal = acceptable ? 'retry <note…> or accept' : 'retry <note…>';
      return refuse(p, 'ILLEGAL_TRANSITION', `rule ${esc} ${choice}: the choices are ${legal}`);
    }

    case 'merge_approved': {
      if (state.phase !== 'WRAP') refuse(p, 'ILLEGAL_TRANSITION', `merge_approved in ${state.phase}`);
      const card = openAsk(state, (st) => st.card?.type === 'merge');
      if (!card) refuse(p, 'ILLEGAL_TRANSITION', 'merge_approved: no open merge card');
      if (!card.card!.commands.includes('/factory merge')) refuse(p, 'ILLEGAL_TRANSITION', `merge_approved: the card offers no merge (${card.card!.reason ?? ''})`);
      const m = probe!;
      if (!m.branch) refuse(p, 'ILLEGAL_TRANSITION', 'merge_approved: the main checkout is on a detached HEAD');
      const baseline = state.checks.find((x) => x.check === 'git.baseline' && x.digest)?.digest;
      if (!m.digest || m.digest !== baseline) refuse(p, 'MISSING_EVIDENCE', 'merge_approved: the main checkout differs from its baseline');
      const ev = mergeEvidence(state, { head: m.head, target: m.target });
      if (!ev.ok) refuse(p, 'MISSING_EVIDENCE', `merge_approved: ${ev.reason}`);
      // The spec, then every rostered reviewer's latest verified output, slice by slice (3-3).
      const reviews = state.slice_order.filter((id) => state.slices[id].state !== 'CUT').flatMap((id) => sliceVerdicts(state, id).map((v) => v.step));
      const pins: Pin[] = [];
      for (const st of [latestSpec(state), ...reviews]) {
        const pin = pinOf(st);
        if (pin && 'error' in pin) refuse(p, 'MISSING_EVIDENCE', `merge_approved: ${pin.error}`);
        if (pin) pins.push(pin);
      }
      return { data: { ...base, pins, evidence: [...ev.evidence, card.id], sha: m.head, target: m.branch }, answers: card, extra: none };
    }

    case 'stage_rerun_requested': {
      // AD-33 (3-4): only while parked (every open step is a card, or the subject of an open ask).
      // The voids send the stage and everything after it back; every open ask closes and its card
      // (and subject) is cancelled. Code already built stays on the run branch.
      const stage = base.stage as Stage;
      if (!RERUN_STAGES.includes(stage)) refuse(p, 'ILLEGAL_TRANSITION', `rerun ${stage}: only ${RERUN_STAGES.join(', ')} can be rerun`);
      if (stage === 'RECON' && state.greenfield) refuse(p, 'ILLEGAL_TRANSITION', 'rerun RECON: a greenfield run orients with FRAME');
      if (stage === 'FRAME' && !state.greenfield) refuse(p, 'ILLEGAL_TRANSITION', 'rerun FRAME: a brownfield run orients with RECON');
      if (!isParked(state)) {
        const busy = openSteps(state).find((st) => st.kind !== 'ask_human' && !askOpenFor(state, st.id));
        refuse(p, 'ILLEGAL_TRANSITION', `rerun ${stage}: only while parked at a card${busy ? `; step ${busy.id} (${busy.role ?? busy.check ?? busy.kind}) is ${busy.state}` : '; no card is open'}`);
      }
      const open = openSteps(state);
      return {
        data: { ...base, voids: rerunVoids(state, run.commands, stage) },
        extra: () => open.map((st) => makeEvent(c.runId, 'step_cancelled', { step_id: st.id, reason: `rerun ${stage}` }, { corr: st.id })),
      };
    }

    default:
      return { data: base, extra: none };
  }
}

export async function decide(args: Args): Promise<unknown> {
  const session = requireSession(args);
  const extra = Object.keys(args.flags).filter((f) => f !== 'session');
  if (args.positionals.length || extra.length) throw new FactoryError('BAD_ARGS', 'factory decide takes no decision arguments; it reads the typed /factory prompt');
  const cwd = process.cwd();
  // 5-2: outside a git repo there is no run: a task or bare /factory resolves to none (`start`
  // initialises the directory), and a decision is NOT_FOUND. Nothing is written to the directory.
  const hash = insideRepo(cwd) ? repoHash(cwd) : null;
  const p = newestPrompt(session); // forged → consumed + NO_HUMAN_PROMPT
  supersede(p.older);

  if (!('decision' in p.parsed)) {
    // Not consumed: `start` / `resume` consume it and act only on it.
    const parsed = p.parsed;
    const resolution: Resolution = hash === null ? { none: true } : resolveRun(cwd, hash, parsed.intent === 'resume' && parsed.run_id ? { runId: parsed.run_id } : {});
    return { ...parsed, prompt_id: p.prompt_id, resolution };
  }

  const dec = p.parsed.decision;
  if (hash === null) refuse(p, 'NOT_FOUND', `${cwd} is not inside a git repository: no run to decide on`);
  let r: Resolution;
  try {
    r = resolveRun(cwd, hash, { runId: dec.run_id, boundSession: session });
  } catch (e) {
    if (e instanceof FactoryError && e.code === 'NOT_FOUND') refuse(p, 'NOT_FOUND', e.message);
    throw e;
  }
  if (!isRun(r)) refuse(p, 'NOT_FOUND', 'list' in r ? `several live runs: ${r.list.map((x) => x.run_id).join(', ')}` : 'no live run in this repo');
  const id = r.run_id;
  const c: Ctx = { hash, runId: id, session, root: repoRoot(cwd) };
  const probe = dec.kind === 'merge_approved' ? mergeProbe(c, loadRun(hash, id).state) : undefined;

  const res = await withLock(lockDir(hash, id), () => {
    const run = loadRun(hash, id);
    const { state } = run;
    const b = build(p, c, run, dec.kind, { ...dec.data, ...embed(p) }, probe);
    const e = makeEvent(id, dec.kind, b.data as never, { session, actor: 'human', corr: p.human.id });
    const events: AnyEvent[] = [e];
    const verified: string[] = [];
    if (b.answers) {
      // An unclaimed card is claimed by the decider first.
      if (b.answers.state === 'issued') events.push(makeEvent(id, 'step_claimed', { step_id: b.answers.id }, { session, corr: b.answers.id }));
      events.push(makeEvent(id, 'step_verified', { step_id: b.answers.id, evidence: [p.human.id, e.id] }, { corr: b.answers.id }));
      verified.push(b.answers.id);
    }
    events.push(...b.extra(e));
    const g = gate(state, events);
    if (!g.ok) refuse(p, 'ILLEGAL_TRANSITION', g.reason);
    consumeWith(p, 'decided', () => appendAll(hash, id, events));
    for (const x of events) if (x.kind === 'step_verified' && !verified.includes((x.data as { step_id: string }).step_id)) verified.push((x.data as { step_id: string }).step_id);
    const reissued = events.find((x) => x.kind === 'step_reissued');
    return { state: g.state, out: { decision: dec.kind, run_id: id, phase: g.state.phase, stage: boardStage(g.state), verified, prompt_id: p.prompt_id, ...(reissued ? { reissued: (reissued.data as { new: string }).new } : {}) } };
  });
  // AD-20: once run_abandoned is on disk, the dev server is killed, then the port and the
  // exclusive claim are released.
  // A server the CLI cannot stop keeps its claims: the decision stands, and the answer says how to
  // stop it by hand (the next `factory next` releases them once it is gone).
  if (res.state.phase === 'ABANDONED') {
    try {
      await devserverDown(hash, id);
    } catch (e) {
      return { ...res.out, devserver_error: e instanceof Error ? e.message : String(e) };
    }
    releaseClaims(hash, id, res.state.port);
  }
  return res.out;
}
