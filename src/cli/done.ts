// `factory done <step_id> [--note text | --stdin]`: the conductor's claim (AD-5), step_reported.
// For an agent step the CLI parses out.md (AD-11) and embeds the projection (AD-23); a parse
// failure is MISSING_EVIDENCE and reissues the step with the parser error in its brief; at
// MAX_STEP_ATTEMPTS it raises Non-convergence instead (3-4). A cancelled step is ILLEGAL_TRANSITION.
// The INTAKE conversation (3-1) is the conductor's own out.md: a parse failure appends nothing and the
// step stays claimed; a `done` on the reported step re-reports it (reissued with the same out.md).
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_STEP_ATTEMPTS } from '../core/config.ts';
import { FactoryError } from '../core/errors.ts';
import type { AnyEvent } from '../core/events.ts';
import { openSteps, type Step } from '../core/reducer.ts';
import { isAppReviewer } from '../core/roster.ts';
import { isIntakeChat, isIntakeConfirm } from '../core/verify.ts';
import { loadRun, type LoadedRun } from '../store/load-run.ts';
import { withLock } from '../store/locks.ts';
import { lockDir, playwrightDir, realish, stepDir } from '../store/paths.ts';
import { flagString, type Args } from './args.ts';
import { appendAll, gateOrThrow, makeEvent } from './commit.ts';
import { repoRoot } from './git.ts';
import { requireHolder, requireRun, requireSession } from './resolve.ts';
import { commitBuilder, evidenceFor, isAgent, projection, readOutput, reissueEvent, reissueOrEscalate, reportEvents, scaffoldCopy, type Ctx } from './steps.ts';
import { inWorktree } from './worktree.ts';

// The intake report: step_reported{output}, or for a reported step a re-report: step_reissued (same
// out.md), the new step claimed and reported, and every open confirm card closed as superseded.
// Throws MISSING_EVIDENCE (nothing appended) when the out.md does not parse.
function intakeEvents(c: Ctx, run: Pick<LoadedRun, 'state' | 'commands'>, st: Step, note: string | undefined): { events: AnyEvent[]; reported: string } {
  const { state } = run;
  if (st.state !== 'claimed' && st.state !== 'reported') throw new FactoryError('ILLEGAL_TRANSITION', `step_reported: step ${st.id} is ${st.state}`);
  const o = readOutput(state, st, 'intake');
  if (!o.result.ok) throw new FactoryError('MISSING_EVIDENCE', `${o.result.error}; fix ${st.output_path} and run factory done ${st.id} again`);
  const report = (id: string): AnyEvent =>
    makeEvent(c.runId, 'step_reported', { step_id: id, ...(note !== undefined ? { note } : {}), output: projection(c, o) }, { session: c.session, actor: 'conductor', corr: id });
  if (st.state === 'claimed') return { events: [report(st.id)], reported: st.id };
  const re = reissueEvent(c, run, st, {}, { output_path: st.output_path });
  const id = (re.data as { new: string }).new;
  const stale = openSteps(state).filter(isIntakeConfirm).flatMap((card) => [
    ...(card.state === 'issued' ? [makeEvent(c.runId, 'step_claimed', { step_id: card.id }, { session: c.session, corr: card.id })] : []),
    makeEvent(c.runId, 'step_verified', { step_id: card.id, evidence: [`superseded:${id}`] }, { corr: card.id }),
  ]);
  return { events: [...stale, re, makeEvent(c.runId, 'step_claimed', { step_id: id }, { session: c.session, corr: id }), report(id)], reported: id };
}

export async function done(args: Args): Promise<unknown> {
  const session = requireSession(args);
  const [stepId, ...extra] = args.positionals;
  if (!stepId || extra.length) throw new FactoryError('BAD_ARGS', 'usage: factory done <step_id> [--note text | --stdin] --session <id>');
  const flagNote = flagString(args, 'note');
  const stdin = args.flags.stdin === true;
  if (args.flags.stdin !== undefined && !stdin) throw new FactoryError('BAD_ARGS', '--stdin takes no value');
  if (flagNote !== undefined && stdin) throw new FactoryError('BAD_ARGS', 'pass --note or --stdin, not both');
  const note = stdin ? readFileSync(0, 'utf8') : flagNote;
  const cwd = process.cwd();
  const { hash, runId } = requireRun(cwd, session);
  const c: Ctx = { hash, runId, session, root: repoRoot(cwd) };

  // Unlocked: read and check the output; for a scaffolder copy the gitignored files, and for a
  // builder whose output parses commit the worktree (AD-29, AD-30). A parse error commits nothing.
  const snap = loadRun(hash, runId);
  const pre = Object.hasOwn(snap.state.steps, stepId) ? snap.state.steps[stepId] : undefined;
  const out = pre && isAgent(pre) ? readOutput(snap.state, pre) : undefined;
  const mine = pre?.state === 'claimed' && pre.claimed_by === session;
  const copyError = out && pre?.role === 'scaffolder' && mine ? scaffoldCopy(c, snap.state, out) : undefined;
  const sha = out && pre && mine ? commitBuilder(snap.state, pre, out) : undefined;

  let parseError: string | undefined; // MISSING_EVIDENCE after the reissue is appended
  const res = await withLock(lockDir(hash, runId), () => {
    const run = loadRun(hash, runId);
    const state = requireHolder(hash, runId, run, session);
    const st = Object.hasOwn(state.steps, stepId) ? state.steps[stepId] : undefined;
    if (!st) throw new FactoryError('NOT_FOUND', `no step ${stepId} in run ${runId}`);
    if (st.state === 'claimed' && st.claimed_by !== session) throw new FactoryError('CLAIM_TAKEN', `step ${stepId} was claimed by ${st.claimed_by}`);
    if (st.kind === 'run_check') throw new FactoryError('BAD_ARGS', `step ${stepId} is a run_check: run factory check ${stepId}`);
    if (isIntakeChat(st) && st.output_path) {
      const r = intakeEvents(c, { state, commands: run.commands }, st, note);
      const after = gateOrThrow(state, r.events);
      appendAll(hash, runId, r.events);
      return { after, reported: r.reported };
    }
    if (st.state !== 'claimed') throw new FactoryError('ILLEGAL_TRANSITION', `step_reported: step ${st.id} is ${st.state}`);
    // 3-4: a step escalated at the reissue cap waits for the ruling; a second done raises nothing.
    const ask = Object.values(state.asks).find((a) => a.open && a.step_id === st.id);
    if (ask) throw new FactoryError('ILLEGAL_TRANSITION', `step ${st.id} is the subject of open escalation ${ask.escalation}: the human rules it first`);
    let events: AnyEvent[];
    let attempts = 0;
    if (isAgent(st)) {
      const o = out && pre?.output_path === st.output_path ? out : readOutput(state, st);
      if (!o.result.ok) {
        parseError = o.result.error;
        const r = reissueOrEscalate(c, { state, commands: run.commands }, st, { error: o.result.error });
        events = [r.event];
        attempts = r.attempts;
      } else {
        events = reportEvents(c, state, st, o, { evidence: evidenceFor({ ...run, state }, st, o), note, actor: 'conductor', copyError, sha: o === out ? sha : undefined });
      }
    } else if (st.kind === 'enter_worktree' && !inWorktree(cwd, state.worktree)) {
      // Not entered (this call's cwd is outside): nothing could ever verify it, so it is reissued.
      parseError = `cwd ${realish(cwd)} is outside the worktree ${state.worktree}`;
      events = [reissueEvent(c, { state, commands: run.commands }, st)];
    } else if (st.kind === 'exit_worktree' && inWorktree(cwd, state.worktree)) {
      parseError = `cwd ${realish(cwd)} is still inside the worktree ${state.worktree}`;
      events = [reissueEvent(c, { state, commands: run.commands }, st)];
    } else {
      events = [makeEvent(runId, 'step_reported', { step_id: stepId, ...(note !== undefined ? { note } : {}) }, { session, actor: 'conductor', corr: stepId })];
      // Worktree entered or left: verified by this call's own cwd (AD-7).
      if (st.kind === 'enter_worktree' || st.kind === 'exit_worktree') events.push(makeEvent(runId, 'step_verified', { step_id: stepId, evidence: [`cwd:${realish(cwd)}`] }, { corr: stepId }));
    }
    const after = gateOrThrow(state, events);
    appendAll(hash, runId, events);
    const reissued = events.find((e) => e.kind === 'step_reissued');
    const raised = events.find((e) => e.kind === 'ask_raised');
    return { after, reissued: reissued ? (reissued.data as { new: string }).new : undefined, escalation: raised ? (raised.data as { escalation?: string }).escalation : undefined, attempts };
  });
  if (parseError !== undefined && 'escalation' in res && res.escalation) {
    throw new FactoryError('MISSING_EVIDENCE', `${parseError}; that was attempt ${res.attempts} (cap ${MAX_STEP_ATTEMPTS}): raised ${res.escalation} (Non-convergence): run factory next`);
  }
  if (parseError !== undefined) throw new FactoryError('MISSING_EVIDENCE', `${parseError}; reissued as step ${res.reissued}: run factory next`);
  // An intake re-report answers with the new step: the next `done` names it.
  if ('reported' in res && res.reported) {
    const id = res.reported;
    return { step_id: id, state: res.after.steps[id].state, ...(id !== stepId ? { reissued_from: stepId } : {}) };
  }
  const st = res.after.steps[stepId];
  const ask = Object.values(res.after.asks).find((a) => a.open && a.step_id === stepId);
  const shots = isAppReviewer(st.role) ? copyScreenshots(st.role!, stepId, stepDir(hash, runId, stepId)) : [];
  return { step_id: stepId, state: st.state, ...(ask ? { escalation: ask.escalation } : {}), ...(shots.length ? { screenshots: shots } : {}) };
}

// A reported running-app reviewer's screenshots (`<step_id>-*.png` in its Playwright output dir)
// are copied into the step dir, beside its out.md. Never fatal: a missing dir copies nothing.
function copyScreenshots(role: string, stepId: string, dest: string): string[] {
  const dir = playwrightDir(role);
  let names: string[];
  try { names = readdirSync(dir).filter((n) => n.startsWith(`${stepId}-`) && n.endsWith('.png')); } catch { return []; }
  const out: string[] = [];
  for (const n of names.sort()) {
    try {
      mkdirSync(dest, { recursive: true });
      copyFileSync(join(dir, n), join(dest, n));
      out.push(join(dest, n));
    } catch { /* skipped */ }
  }
  return out;
}
