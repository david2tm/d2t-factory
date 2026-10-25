// `factory next [--wait ms]` (AD-3, AD-24): advances the run on evidence, then issues due steps.
// Each round reads the run unlocked, runs the git probes, worktree creation, commits and file reads
// there (AD-8, AD-29), then takes the lock and appends only if nothing changed meanwhile; otherwise
// it goes round again. When a round has nothing to append, it issues what `due` returns.
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { checkOutput, isDependencyFile } from '../core/artifacts.ts';
import { cutCandidates, deadlinesAhead, nextDeadlineMs, sliceTimebox } from '../core/budget.ts';
import { cutCard, newDependencyCard, nonConvergenceCard, overTimeboxCard, roundWhy, scaffoldFailureCard } from '../core/cards.ts';
import { MAX_RETRIGGER_ROUNDS, WAIT_POLL_MS } from '../core/config.ts';
import { FactoryError } from '../core/errors.ts';
import type { AnyEvent, Envelope } from '../core/events.ts';
import { redact, redactString } from '../core/redact.ts';
import { isTerminal, openSteps, type RunState, type Step } from '../core/reducer.ts';
import { due, mergeCardCurrent, type ScheduleCtx, type WrapProbe } from '../core/schedule.ts';
import {
  askOpenFor, checkById, claimOverlay, classifyOrphan, closeEvidence, isIntakeChat, isVerified, isVoided, latestByRole, latestCheckStep, liveSlices, nextBacklog, openMergeCard,
  roundFailure, roundOf, sliceDeps, wrapBaseline, wrapCheck,
} from '../core/verify.ts';
import { ulid } from '../store/ids.ts';
import { loadRun, readRedactValues, type LoadedRun } from '../store/load-run.ts';
import { withLock } from '../store/locks.ts';
import { commandsFile, factsDir, lockDir, outFile, realish, reconFile } from '../store/paths.ts';
import { flagString, type Args } from './args.ts';
import { writeBrief, writeIntakeBrief } from './brief.ts';
import { claimPort, refusedExclusive, releaseClaims, scaffoldConflict } from './claims.ts';
import { appendAll, gateOrThrow, makeEvent, stepView } from './commit.ts';
import { contractOf, devserverDown } from './devserver.ts';
import {
  commitAll, currentBranch, diffNames, diffStat, dirty, head, headTreeEmpty, isAncestor, mergeInProgress, mergeInto, repoRoot, sha256, statusDigest, trackedClean, worktreeRemove,
} from './git.ts';
import { writeRecording } from './record.ts';
import { requireHolder, requireRun, requireSession } from './resolve.ts';
import {
  commitBuilder, evidenceFor, isAgent, raise, readOutput, redactCard, reissueOrEscalate, reportEvents, scaffoldCopy, verifiedEvent, type Ctx,
} from './steps.ts';
import { inWorktree, prepareWorktree } from './worktree.ts';

interface NextOut { steps?: Record<string, unknown>[]; in_flight?: string[]; wait?: { retry_after_ms: number }; done?: true; [k: string]: unknown }
interface Prepared { events: AnyEvent[]; report?: Record<string, unknown> }

const MAX_ROUNDS = 12;

// The recon cache for this base commit, when it parses as a finished context.
function readCache(hash: string, baseSha: string): string | null {
  try {
    const text = readFileSync(reconFile(hash, baseSha), 'utf8');
    const r = checkOutput('recon', text);
    return r.ok && r.status === 'DONE' ? text : null;
  } catch {
    return null;
  }
}

// The builder agent a new round of a slice may resume: the agent of its newest verified builder
// step, if that agent was first spawned (claimed) after the run's latest session_bound. After a
// takeover or /clear the old agent is gone, so the round is a spawn. 3-4: one per live slice.
function resumeAgent(run: LoadedRun, slice: string): string | undefined {
  const s = run.state;
  const sl = s.slices[slice];
  if (!sl || !['BUILDING', 'FINDINGS_QUEUED', 'IN_REVIEW'].includes(sl.state)) return undefined;
  const builders = s.step_order.map((id) => s.steps[id]).filter((st) => st.role === 'builder' && st.slice === sl.id);
  const agentOf = (st: Step): string | undefined => {
    if (st.kind === 'resume') return st.agent_id;
    const ev = evidenceFor(run, st, readOutput(s, st));
    return ev.ok ? ev.agent_id : undefined;
  };
  const prev = roundOf(s, sl.id).builder;
  const id = prev && agentOf(prev);
  const origin = id ? builders.find((st) => agentOf(st) === id) : undefined;
  if (!origin) return undefined;
  const claimed = run.commands.findIndex((e) => e.kind === 'step_claimed' && (e as Envelope<'step_claimed'>).data.step_id === origin.id);
  const bound = run.commands.findLastIndex((e) => e.kind === 'session_bound');
  return claimed > bound ? id : undefined;
}

function resumeAgents(run: LoadedRun): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sl of liveSlices(run.state)) {
    const id = resumeAgent(run, sl.id);
    if (id) out[sl.id] = id;
  }
  return out;
}

// A RECON rerun (3-4) refreshes the recon cache: the cache no longer stands in for a recon agent.
const reconRerun = (run: Pick<LoadedRun, 'commands'>): boolean =>
  run.commands.some((e) => e.kind === 'stage_rerun_requested' && (e as Envelope<'stage_rerun_requested'>).data.stage === 'RECON');

// WRAP, unlocked: integrate the main checkout's current branch head into the run branch when the
// run branch doesn't contain it yet (a clean merge only, committed by the CLI without the repo's
// commit hooks; a conflict is aborted and reported), then probe what the merge card needs. Only the
// holder integrates; for anyone else an unintegrated target is a problem.
function wrapProbe(c: Ctx, state: RunState, integrate: boolean): WrapProbe | undefined {
  const wt = state.worktree;
  if (!wt || !existsSync(wt) || !state.base_sha) return undefined;
  const problems: string[] = [];
  const branch = currentBranch(c.root);
  const target = branch ? head(c.root) : null;
  if (!branch) problems.push('the main checkout is on a detached HEAD: check out the branch to merge into');
  else if (target && !isAncestor(wt, target, head(wt))) {
    if (mergeInProgress(wt)) problems.push(`a merge is in progress in the worktree: commit the resolution on ${state.branch}`);
    else if (!integrate) problems.push(`${branch} is not integrated into ${state.branch} yet`);
    else {
      const m = mergeInto(wt, target, `factory: integrate ${branch} into ${state.branch}`, { noVerify: true });
      if (!m.ok) {
        problems.push(m.conflicts.length
          ? `conflicts with ${branch}: ${m.conflicts.join(', ')} (merge ${branch} into ${state.branch} in the worktree, resolve and commit)`
          : `cannot integrate ${branch}: ${m.error.split('\n')[0]}`);
      }
    }
  }
  const tip = head(wt);
  // The run's own change: from the merge base with the target, so the target's commits don't count.
  const diffstat = target ? diffStat(wt, target, tip, '...') : diffStat(wt, state.base_sha, tip);
  const values = readRedactValues(c.hash, c.runId);
  return { head: tip, target, branch, diffstat, problems: problems.map((x) => redactString(x, values)) };
}

function probe(run: LoadedRun, c: Ctx, cwd: string, holder: boolean): ScheduleCtx {
  const { state } = run;
  return {
    in_worktree: inWorktree(cwd, state.worktree),
    recon_cached: state.phase === 'ORIENT' && !state.greenfield && !latestByRole(state, 'recon') && !reconRerun(run) && readCache(c.hash, state.base_sha ?? '') !== null,
    ...(state.phase === 'BUILD' ? { resume_agents: resumeAgents(run) } : {}),
    ...(state.phase === 'WRAP' ? { wrap: wrapProbe(c, state, holder) } : {}),
  };
}

// The baseline digest `start` recorded (AD-8).
const baseline = (s: RunState): string | undefined => s.checks.find((x) => x.check === 'git.baseline' && x.digest)?.digest;

function gitCheck(c: Ctx, state: RunState, check: 'git.baseline' | 'git.worktree_clean' | 'git.deps', pass: boolean, extra: { digest?: string; command: string; sha?: string }, t0: number): AnyEvent {
  return makeEvent(c.runId, 'check_ran', { check, exit_code: pass ? 0 : 1, duration_ms: Date.now() - t0, basis_seq: state.seq, ...extra }, { corr: state.run_id! });
}

// At WRAP the check is pinned to the run branch head it vouches for (`sha`).
function baselineCheck(c: Ctx, state: RunState, sha?: string): { event: AnyEvent; pass: boolean } {
  const t0 = Date.now();
  const s = statusDigest(c.root);
  const pass = s.digest === baseline(state);
  return { event: gitCheck(c, state, 'git.baseline', pass, { digest: s.digest, command: s.command, ...(sha ? { sha } : {}) }, t0), pass };
}

// Publish the RECON output as <repo-hash>/recon/<base_sha>.md, only if absent (temp + link); a
// RECON rerun (3-4) overwrites it (temp + rename).
function publishRecon(c: Ctx, state: RunState, text: string, overwrite = false): void {
  const dest = reconFile(c.hash, state.base_sha!);
  if (existsSync(dest) && !overwrite) return;
  const tmp = `${dest}.${process.pid}.tmp`;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(tmp, text);
  if (overwrite) { renameSync(tmp, dest); return; }
  try { linkSync(tmp, dest); } catch { /* another run published first */ } finally { rmSync(tmp, { force: true }); }
}

// ORIENT ends: the verified recon output (or the cache on a hit) becomes the cache; the main
// checkout is checked against the baseline; stage_completed embeds the context and its sha256.
// A changed checkout is recorded here and stops the run at SCAFFOLD's own baseline check. After a
// RECON rerun (3-4) the new output overwrites the cache, and a verified scaffolder (the worktree and
// its run contract stand) completes SCAFFOLD at once. Greenfield (5-2): the verified framer output
// itself is embedded (in the same `recon` field) under stage FRAME; nothing goes to the cache.
function completeOrient(c: Ctx, run: LoadedRun, ctx: ScheduleCtx): AnyEvent[] {
  const { state } = run;
  const role = state.greenfield ? 'framer' : 'recon';
  const r = latestByRole(state, role);
  let path: string;
  let text: string | null;
  if (state.greenfield) {
    if (!r || !isVerified(state, r)) return [];
    path = r.output_path!;
    text = readFileSync(path, 'utf8');
  } else {
    if (r && isVerified(state, r)) publishRecon(c, state, readFileSync(r.output_path!, 'utf8'), reconRerun(run));
    else if (!(ctx.recon_cached && !r)) return [];
    path = reconFile(c.hash, state.base_sha!);
    text = readCache(c.hash, state.base_sha!);
  }
  if (text === null) return [];
  const parsed = checkOutput(role, text);
  const front = parsed.ok ? parsed.front : {};
  const b = baselineCheck(c, state);
  const recon = redact({ path, sha256: sha256(text), context: front }, readRedactValues(c.hash, c.runId));
  const events = [b.event, makeEvent(c.runId, 'stage_completed', { stage: state.greenfield ? 'FRAME' : 'RECON', recon }, { corr: r?.id ?? b.event.id })];
  const sc = latestByRole(state, 'scaffolder');
  if (sc && isVerified(state, sc)) events.push(makeEvent(c.runId, 'stage_completed', { stage: 'SCAFFOLD' }, { corr: sc.id }));
  return events;
}

// SCAFFOLD starts: the port claim, then the worktree (AD-15, AD-20).
function startScaffold(c: Ctx, state: RunState): AnyEvent[] {
  const port = claimPort(c.runId);
  const worktree = prepareWorktree(c.root, c.runId, state.base_sha!, state.branch!);
  return [makeEvent(c.runId, 'stage_started', { stage: 'SCAFFOLD', port, worktree }, { corr: state.run_id! })];
}

// What a failed check's log ends with, for its line on a card: the last 3 non-empty lines of its
// (already redacted) log, without the `$ cmd` and `[exit N]` lines, joined with ` / `, at most
// TAIL_MAX chars (the end kept). Empty when the log is missing or says nothing more.
const TAIL_MAX = 240;
export function logTail(text: string): string {
  const rows = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^\$ /.test(l) && !/^\[exit -?\d+\]$/.test(l));
  const t = rows.slice(-3).join(' / ');
  return t.length > TAIL_MAX ? `…${t.slice(-(TAIL_MAX - 1))}` : t;
}
function stepTail(st: Step): string {
  if (!st.output_path) return '';
  try { return logTail(readFileSync(st.output_path, 'utf8')); } catch { return ''; }
}

// SCAFFOLD done: the install verified, and (once it passed) health and test verified → the inline
// git checks and one run per repo (AD-15: another live run holding exclusive/ blocks any run; a run
// whose contract lists a shared service claims it, and is blocked by a live run already past
// SCAFFOLD); then step_verified or the scaffold_failure card naming every failure, each failed
// check with the tail of its log. A failed install raises the card without health and test.
// A blocked run can only retry (once the other run ends) or abandon: no accept. Greenfield (5-2):
// with nothing else failing, the CLI commits the scaffolded project as `factory: scaffold
// (<step_id>)`; a scaffolder that created no project files fails. A greenfield failure offers retry
// or abandon only.
function finishScaffold(c: Ctx, run: LoadedRun, sc: Step): AnyEvent[] {
  const { state } = run;
  const install = latestCheckStep(state, 'contract.install', sc.issued_seq);
  if (!install || install.state !== 'verified') return [];
  const installed = checkById(state, install.output?.check_id)?.exit_code === 0;
  const steps = [install, ...(installed ? (['contract.health', 'contract.test'] as const).map((k) => latestCheckStep(state, k, sc.issued_seq)) : [])];
  if (steps.some((st) => !st || st.state !== 'verified')) return [];
  const checks = steps.map((st) => checkById(state, st!.output?.check_id));
  const t0 = Date.now();
  const wt = state.worktree!;
  const clean = gitCheck(c, state, 'git.worktree_clean', trackedClean(wt), { command: 'git status --porcelain=v2 --untracked-files=no' }, t0);
  const changed = state.greenfield && dirty(wt);
  const empty = state.greenfield && !changed && headTreeEmpty(wt);
  const base = baselineCheck(c, state);
  const services = contractOf(state)?.services;
  const shared = Array.isArray(services) && services.some((x) => (x as { shared?: unknown }).shared === true);
  const conflict = scaffoldConflict(c.hash, c.runId, shared);
  const failures = [
    ...checks.map((x, i) => {
      if (x && x.exit_code === 0) return null;
      const tail = stepTail(steps[i]!);
      return `${steps[i]!.check} failed${x ? ` (exit ${x.exit_code})` : ''}${tail ? `: ${tail}` : ''}`;
    }),
    (clean.data as { exit_code: number }).exit_code === 0 ? null : 'tracked files changed in the worktree',
    base.pass ? null : 'the main checkout differs from its baseline',
    conflict ? refusedExclusive(conflict) : null,
    empty ? 'the scaffolder created no project files' : null,
  ].filter((x): x is string => Boolean(x));
  const events = [clean, base.event];
  if (failures.length) {
    // Greenfield offers no accept: an accepted scaffold would have no scaffold commit. Nor does a
    // failed install: health and test never ran.
    events.push(raise(c, state, sc, (e) => scaffoldFailureCard({ escalation: e, failures, accept: !conflict && !state.greenfield && installed })));
  } else {
    // Idempotent: a round that is not appended leaves the commit, and the next finds a clean worktree.
    const scaffold = state.greenfield ? [`scaffold:${changed ? commitAll(wt, `factory: scaffold (${sc.id})`) : head(wt)}`] : [];
    const out = readOutput(state, sc);
    const ev = evidenceFor(run, sc, out);
    const evidence = [...checks.map((x) => x!.id), clean.id, base.event.id, ...scaffold, ...(ev.ok ? ev.evidence : [])];
    events.push(makeEvent(c.runId, 'step_verified', { step_id: sc.id, evidence }, { corr: sc.id }));
  }
  return events;
}

// --- BUILD (AD-30) ----------------------------------------------------------------------------

// The dependency files a slice's own builder commits changed (3-4): the net diff from before its
// first commit to its last, limited to the files those commits touched, so another slice's commits in
// between (and a dependency it added) don't count, and a change undone later doesn't either.
function sliceDepFiles(wt: string, shas: readonly string[]): string[] {
  if (!shas.length) return [];
  const touched = new Set(shas.flatMap((x) => diffNames(wt, `${x}^`, x)));
  return diffNames(wt, `${shas[0]}^`, shas.at(-1)!).filter((f) => touched.has(f) && isDependencyFile(f));
}

// The slice machine's CLI side (3-4: over every live slice, in plan order): raise the cut card once
// the budget clock passes the cut point (AD-17); for each live slice not ESCALATED, close it on its
// evidence after the inline git.deps over its own builder commits (brownfield: a change raises New
// dependency unless the human accepted it for this commit), raise Non-convergence at the round cap,
// or raise Over time box once its net time reaches its limit; then start the next Backlog slice when
// the pipeline allows it. With every slice closed or cut, BUILD completes.
function buildEvents(c: Ctx, run: LoadedRun): AnyEvent[] {
  const { state } = run;
  const corr = state.run_id!;
  const now = Date.now();
  const cut = cutCandidates(state, now);
  if (cut.length) {
    const card = redactCard(cutCard(cut.map((id) => ({ id, title: state.slices[id].title }))), readRedactValues(c.hash, c.runId));
    return [makeEvent(c.runId, 'ask_raised', { card }, { corr })];
  }
  for (const sl of liveSlices(state)) {
    if (sl.state === 'ESCALATED') continue;
    const idle = !openSteps(state).some((st) => st.slice === sl.id);
    const ce = idle ? closeEvidence(state, sl.id) : undefined;
    if (ce?.ok && state.worktree && state.base_sha && isAncestor(state.worktree, ce.builder.sha!, ce.check.sha!)) {
      const close = makeEvent(c.runId, 'slice_closed', { slice: sl.id, check_id: ce.check.id }, { corr: ce.check.id });
      if (state.greenfield) return [close];
      const t0 = Date.now();
      const shas = sliceDeps(state, sl.id);
      const files = sliceDepFiles(state.worktree, shas);
      const deps = gitCheck(c, state, 'git.deps', !files.length, { command: `git diff --name-only ${shas[0] ?? ce.builder.sha}^..${ce.builder.sha} (the files ${sl.id}'s own commits touched)`, sha: ce.builder.sha }, t0);
      const accepted = Object.values(state.asks).some((a) => !a.open && a.slice === sl.id && a.card.reason_label === 'New dependency' && a.card.sha === ce.builder.sha);
      if (files.length && !accepted) return [deps, raise(c, state, ce.builder, (e) => newDependencyCard({ escalation: e, slice: sl.id, files, sha: ce.builder.sha! }), sl.id)];
      return [deps, close];
    }
    const r = idle ? roundOf(state, sl.id) : undefined;
    const fail = r ? roundFailure(state, r) : null;
    if (r?.builder && fail && sl.rounds >= MAX_RETRIGGER_ROUNDS && (sl.state === 'FINDINGS_QUEUED' || sl.state === 'IN_REVIEW')) {
      // The failing check, and each reviewer still at FINDINGS (3-3).
      const why = roundWhy({
        ...(fail.kind === 'findings' ? {} : { check: { name: String(fail.step.check), exit_code: fail.step.output?.exit_code } }),
        findings: fail.findings.map((st) => ({ role: st.role!, n: Array.isArray(st.output?.findings) ? (st.output!.findings as unknown[]).length : 0 })),
      });
      // accept closes the slice without git.deps, so the card says what it would accept.
      const deps = state.worktree && !state.greenfield ? sliceDepFiles(state.worktree, sliceDeps(state, sl.id)) : [];
      return [raise(c, state, r.builder, (e) => nonConvergenceCard({ escalation: e, slice: sl.id, rounds: sl.rounds, why, deps }), sl.id)];
    }
    // The time box (AD-17): work in flight finishes; nothing new is issued while ESCALATED.
    const tb = sliceTimebox(state, run.commands, sl.id, now);
    if (tb?.over) {
      return [raise(c, state, undefined, (e) => overTimeboxCard({ escalation: e, slice: sl.id, elapsed_min: Math.floor(tb.elapsed_ms / 60_000), limit_min: tb.limit_min }), sl.id)];
    }
  }
  const next = nextBacklog(state);
  if (next) return [makeEvent(c.runId, 'slice_started', { slice: next.id }, { corr })];
  if (state.slice_order.every((id) => state.slices[id].state === 'CLOSED' || state.slices[id].state === 'CUT')) {
    return [makeEvent(c.runId, 'stage_completed', { stage: 'BUILD' }, { corr })];
  }
  return [];
}

// --- WRAP and housekeeping -------------------------------------------------------------------

// A merge card pinned to an older head or target is stale: it is closed, and `due` raises a fresh
// one after fresh checks. Once WRAP health and test have run at the head (pass or fail), the CLI
// runs the inline git.baseline the card needs.
function wrapEvents(c: Ctx, run: LoadedRun, ctx: ScheduleCtx): AnyEvent[] {
  const { state } = run;
  const p = ctx.wrap;
  if (!p) return [];
  const card = openMergeCard(state);
  const close = (st: Step): AnyEvent[] => [
    ...(st.state === 'issued' ? [makeEvent(c.runId, 'step_claimed', { step_id: st.id }, { session: c.session, corr: st.id })] : []),
    makeEvent(c.runId, 'step_verified', { step_id: st.id, evidence: [`superseded:${p.head}:${p.target ?? 'detached'}`] }, { corr: st.id }),
  ];
  if (card && !mergeCardCurrent(state, card, p)) return close(card);
  if (p.problems.length) return [];
  const checks = (['contract.health', 'contract.test'] as const).map((k) => wrapCheck(state, k).result);
  if (checks.some((x) => !x || x.sha !== p.head)) return [];
  const base = wrapBaseline(state, p.head, Math.max(...checks.map((x) => x!.seq)));
  if (!base) return [baselineCheck(c, state, p.head).event];
  // A card blocked only by a changed main checkout: once the human restores it, a fresh baseline
  // and (from `due`) a fresh card that offers the merge.
  if (card && base.exit_code !== 0 && statusDigest(c.root).digest === baseline(state)) return [...close(card), baselineCheck(c, state, p.head).event];
  return [];
}

// After `merged`, from outside the worktree: stop the dev server, remove the worktree (a failure is
// reported, never fatal), then run_completed. The claims are released by `advance` once that append
// has made the fold terminal (AD-20); the recording follows it.
async function housekeeping(c: Ctx, run: LoadedRun, ctx: ScheduleCtx): Promise<Prepared> {
  const { state } = run;
  if (ctx.in_worktree || openSteps(state).length) return { events: [] };
  const server = await devserverDown(c.hash, c.runId);
  const rm = state.worktree ? worktreeRemove(c.root, state.worktree) : { ok: true as const };
  const report = { devserver_stopped: server.stopped, worktree_removed: rm.ok, ...(rm.ok ? {} : { worktree_error: rm.error }), port_released: state.port ?? null };
  return { events: [makeEvent(c.runId, 'run_completed', {}, { corr: state.run_id! })], report };
}

// One step's progress on evidence, unlocked. Orphans are claims held by another session (AD-24).
function stepEvents(c: Ctx, run: LoadedRun, st: Step, ctx: ScheduleCtx, cwd: string): AnyEvent[] {
  const { state } = run;
  if ((st.kind === 'enter_worktree' && ctx.in_worktree) || (st.kind === 'exit_worktree' && !ctx.in_worktree)) {
    const claim = st.state === 'issued' ? [makeEvent(c.runId, 'step_claimed', { step_id: st.id }, { session: c.session, corr: st.id })] : [];
    return [...claim, makeEvent(c.runId, 'step_verified', { step_id: st.id, evidence: [`cwd:${realish(cwd)}`] }, { corr: st.id })];
  }
  const orphan = st.state === 'claimed' && st.claimed_by !== undefined && st.claimed_by !== c.session;
  // An orphan already escalated at the reissue cap waits for the ruling.
  if (orphan && askOpenFor(state, st.id)) return [];
  if (orphan) {
    if (!isAgent(st)) return classifyOrphan(st, { parsed: false }) === 'reissue' ? [reissueOrEscalate(c, run, st).event] : [];
    const out = readOutput(state, st);
    const ev = evidenceFor(run, st, out);
    const verdict = classifyOrphan(st, { parsed: out.result.ok, evidence: ev });
    if (verdict === 'reissue') return [reissueOrEscalate(c, run, st, { error: out.result.ok ? 'the agent stopped before its output was attributed' : out.result.error }).event];
    if (verdict === 'verify') {
      return reportEvents(c, state, st, out, {
        evidence: ev, actor: 'cli', copyError: st.role === 'scaffolder' ? scaffoldCopy(c, state, out) : undefined, sha: commitBuilder(state, st, out),
      });
    }
    return [];
  }
  // A report waiting for its facts (async hooks).
  const status = st.output?.status;
  if (isAgent(st) && st.state === 'reported' && st.role !== 'scaffolder' && typeof status === 'string' && status !== 'ESCALATE' && !askOpenFor(state, st.id)) {
    const ev = evidenceFor(run, st, readOutput(state, st));
    if (ev.ok) return [verifiedEvent(c, st, ev.evidence, status)];
  }
  return [];
}

// Everything one round would append, computed unlocked from a snapshot.
async function prepare(c: Ctx, run: LoadedRun, ctx: ScheduleCtx, cwd: string): Promise<Prepared> {
  const { state } = run;
  // 3-4: an open step (not a card) whose slice was cut or cleared, or that a void covers, is
  // cancelled, so its role is free again. `done` on it is then ILLEGAL_TRANSITION. A claimed builder
  // of such a slice is still editing the worktree: it keeps the builder role (and the writer slot)
  // until its `done` commits and reports it, and is cancelled then. A card whose escalation was
  // closed without a ruling (its subject was cancelled) is cancelled too.
  const cancels = openSteps(state).flatMap((st) => {
    if (st.kind === 'ask_human') {
      const esc = st.card?.escalation;
      const closed = esc !== undefined && Object.values(state.asks).some((a) => a.escalation === esc && !a.open);
      return closed ? [makeEvent(c.runId, 'step_cancelled', { step_id: st.id, reason: `${esc} is closed` }, { corr: st.id })] : [];
    }
    const sl = st.slice ? state.slices[st.slice] : undefined;
    const dead = Boolean(st.slice) && (!sl || sl.state === 'CUT');
    if (dead && st.role === 'builder' && st.state === 'claimed' && !isVoided(state, st.id)) return [];
    const reason = isVoided(state, st.id) ? 'voided' : st.slice && !sl ? `slice ${st.slice} is gone` : sl?.state === 'CUT' ? `slice ${st.slice} is cut` : null;
    return reason ? [makeEvent(c.runId, 'step_cancelled', { step_id: st.id, reason }, { corr: st.id })] : [];
  });
  if (cancels.length) return { events: cancels };
  for (const st of openSteps(state)) {
    const ev = stepEvents(c, run, st, ctx, cwd);
    if (ev.length) return { events: ev };
  }
  if (state.phase === 'ORIENT') return { events: completeOrient(c, run, ctx) };
  if (state.phase === 'SCAFFOLD') {
    if (!state.worktree) return { events: startScaffold(c, state) };
    const sc = latestByRole(state, 'scaffolder');
    if (sc && sc.state === 'reported' && sc.output?.status === 'DONE' && !sc.output.failure && !askOpenFor(state, sc.id)) return { events: finishScaffold(c, run, sc) };
  }
  if (state.phase === 'BUILD') return { events: buildEvents(c, run) };
  if (state.phase === 'WRAP') return { events: wrapEvents(c, run, ctx) };
  if (state.phase === 'MERGED') return housekeeping(c, run, ctx);
  return { events: [] };
}

// Under the lock: append step_issued for each due step, with its brief and output path.
function issueDue(c: Ctx, run: LoadedRun, state: RunState, ctx: ScheduleCtx): RunState {
  let s = state;
  for (const d of due(s, ctx)) {
    const id = ulid(); // step_id = this event's id
    const data = { ...d };
    if (d.card) data.card = redactCard(d.card, readRedactValues(c.hash, c.runId));
    const agentStep = d.kind === 'spawn' || d.kind === 'resume';
    // The INTAKE conversation: the conductor writes this out.md after talking with the human (3-1).
    const intakeChat = d.kind === 'ask_human' && d.stage === 'INTAKE' && d.card?.type === 'intake' && !d.card.commands.length;
    if (agentStep || d.kind === 'run_check' || intakeChat) data.output_path = outFile(c.hash, c.runId, id);
    if (agentStep && d.role) data.brief_path = writeBrief(c.hash, c.runId, s, run.commands, { id, role: d.role, stage: d.stage, attempt: d.attempt, output_path: data.output_path!, slice: d.slice }, c.root);
    if (intakeChat) data.brief_path = writeIntakeBrief(c.hash, c.runId, s, { id, output_path: data.output_path! });
    const e = makeEvent(c.runId, 'step_issued', data, { id, corr: id });
    s = gateOrThrow(s, [e]);
    appendAll(c.hash, c.runId, [e]);
  }
  return s;
}

// With nothing to issue but work or cards in flight, the conductor sleeps (a background
// `next --wait`, AD-17) until the next deadline: the cut point, the earliest overdue_at of an agent
// report still waiting for its facts, or (3-4) a live slice's time box end. With only cards in flight
// (ask_human: the human's turn) and no deadline ahead there is no wait: the conductor ends its turn.
function view(state: RunState, commands: readonly AnyEvent[]): NextOut {
  const open = openSteps(state);
  const steps = open.filter((st) => st.state === 'issued').map((st) => stepView(st, state));
  const in_flight = open.filter((st) => st.state !== 'issued').map((st) => st.id);
  if (steps.length || !in_flight.length) return { steps, in_flight };
  const reportedAt = new Map<string, string>();
  for (const e of commands) if (e.kind === 'step_reported') reportedAt.set(e.data.step_id, e.ts);
  const overdue = open.filter((st) => st.state === 'reported' && (st.kind === 'spawn' || st.kind === 'resume') && !askOpenFor(state, st.id))
    .map((st) => claimOverlay(state, st, reportedAt.get(st.id)).overdue_at).filter((x): x is string => x !== null);
  const now = Date.now();
  const timeboxes = state.phase === 'BUILD'
    ? liveSlices(state).filter((sl) => sl.state !== 'ESCALATED').map((sl) => sliceTimebox(state, commands, sl.id, now)?.ends_at).filter((x): x is string => typeof x === 'string')
    : [];
  const cardsOnly = open.every((st) => st.kind === 'ask_human' || askOpenFor(state, st.id));
  if (cardsOnly && !deadlinesAhead(state, now, overdue, timeboxes).length) return { steps, in_flight };
  return { steps, in_flight, wait: { retry_after_ms: nextDeadlineMs(state, now, overdue, timeboxes) } };
}

// The WRAP recording, named after the run, once run_completed is in (AD-18). Never fatal.
function recordRun(c: Ctx): Record<string, unknown> {
  try {
    return { recording: writeRecording(c.runId, [{ hash: c.hash, runId: c.runId }]).path };
  } catch (e) {
    return { recording_error: e instanceof Error ? e.message : String(e) };
  }
}

// A terminal run (run_completed or run_abandoned on disk) gives up its claims: the dev server is
// killed first, then the port and the exclusive claim are released (AD-20). Idempotent.
async function releaseTerminal(hash: string, runId: string, state: RunState): Promise<void> {
  await devserverDown(hash, runId);
  releaseClaims(hash, runId, state.port);
}

export async function advance(hash: string, runId: string, session: string, cwd: string): Promise<NextOut> {
  const c: Ctx = { hash, runId, session, root: repoRoot(cwd) };
  let report: Record<string, unknown> = {};
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const run = loadRun(hash, runId);
    if (isTerminal(run.state)) {
      await releaseTerminal(hash, runId, run.state);
      return { done: true, ...report };
    }
    // A non-holder's first round only takes the lock (which adopts a /clear rebind or refuses).
    const holder = run.state.holder === session && round < MAX_ROUNDS - 1;
    const ctx = probe(run, c, cwd, holder);
    const prep: Prepared = holder ? await prepare(c, run, ctx, cwd) : { events: [] };
    const events = prep.events;
    const r = await withLock(lockDir(hash, runId), (): { out?: NextOut; appended?: true } => {
      const cur = loadRun(hash, runId);
      if (isTerminal(cur.state)) return { out: { done: true } };
      const state = requireHolder(hash, runId, cur, session);
      if (state.seq !== run.state.seq) return {}; // changed meanwhile (or adopted): go round again
      if (events.length) {
        gateOrThrow(state, events);
        appendAll(hash, runId, events);
        return { appended: true };
      }
      return { out: view(issueDue(c, cur, state, ctx), cur.commands) };
    });
    if (r.appended && prep.report) report = { ...report, ...prep.report };
    if (r.appended && events.some((e) => e.kind === 'run_completed')) report = { ...report, ...recordRun(c) };
    if (r.out?.done) await releaseTerminal(hash, runId, loadRun(hash, runId).state); // ended meanwhile
    if (r.out) return { ...r.out, ...report };
  }
  throw new FactoryError('LOCKED', `run ${runId} kept changing; try factory next again`);
}

// The command log plus every fact file: `--wait` wakes on either.
function size(hash: string, runId: string): number {
  const at = (f: string): number => { try { return statSync(f).size; } catch { return 0; } };
  let n = at(commandsFile(hash, runId));
  try { for (const f of readdirSync(factsDir(hash, runId))) n += at(join(factsDir(hash, runId), f)); } catch { /* no facts yet */ }
  return n;
}

// `--wait ms` (AD-17): the conductor runs it as a background Bash and ends its turn. Unlocked, it
// polls the logs' size; on a change it advances the run, and returns early only when that issued
// steps or ended the run. Otherwise it sleeps on until the wait ends (or the next deadline, if
// sooner), then answers once more: past the cut point that answer raises the cut card.
export async function next(args: Args): Promise<NextOut> {
  const session = requireSession(args);
  const w = flagString(args, 'wait');
  const waitMs = w === undefined ? 0 : /^\d+$/.test(w) ? Number(w) : NaN;
  if (!Number.isSafeInteger(waitMs)) throw new FactoryError('BAD_ARGS', `--wait must be a non-negative integer of ms, got ${w}`);
  const cwd = process.cwd();
  const { hash, runId } = requireRun(cwd, session);
  // The size is taken before each advance, so an append that lands while it runs is not missed.
  let start = size(hash, runId);
  let out = await advance(hash, runId, session, cwd);
  if (!waitMs || !out.wait) return out;
  let deadline = Date.now() + Math.min(waitMs, out.wait.retry_after_ms);
  for (;;) {
    while (Date.now() < deadline && size(hash, runId) === start) await sleep(Math.min(WAIT_POLL_MS, Math.max(1, deadline - Date.now())));
    if (Date.now() >= deadline) return advance(hash, runId, session, cwd);
    start = size(hash, runId);
    out = await advance(hash, runId, session, cwd);
    if (out.done || out.steps?.length || !out.wait) return out;
    deadline = Math.min(deadline, Date.now() + out.wait.retry_after_ms);
  }
}
