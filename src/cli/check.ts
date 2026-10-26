// `factory check <step_id>` (AD-8): runs a claimed run_check step's check, unlocked, then appends
// check_ran + step_reported + step_verified with basis_seq (AD-29). The conductor runs it as a
// background Bash. The step verifies whether the check passed or failed; the result is in
// check_ran.exit_code and the projection in step_reported.output (AD-23).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { acIds, planLint, readSpec, slicePlanEntries, specLint } from '../core/artifacts.ts';
import { CHECK_TIMEOUT_MS, HEALTH_POLL_MS, HEALTH_TIMEOUT_MS } from '../core/config.ts';
import { FactoryError, type ErrorCode } from '../core/errors.ts';
import type { Check } from '../core/events.ts';
import { redact, redactString } from '../core/redact.ts';
import type { RunState, Step } from '../core/reducer.ts';
import { rosterOf } from '../core/roster.ts';
import { latestSlicePlan, latestSpec, uiReference } from '../core/verify.ts';
import { loadRun, readRedactValues } from '../store/load-run.ts';
import { withLock } from '../store/locks.ts';
import { devserverLog, lockDir, runCacheDir } from '../store/paths.ts';
import type { Args } from './args.ts';
import { appendAll, gateOrThrow, makeEvent } from './commit.ts';
import { contractOf, devserverDown, devserverRunning, devserverUp, serverAlive, serverSpec } from './devserver.ts';
import { head, isAncestor, repoRoot, sha256 } from './git.ts';
import { requireHolder, requireRun, requireSession } from './resolve.ts';
import { reissueEvent } from './steps.ts';

interface Result { exit_code: number; command?: string; digest?: string; log: string; output: Record<string, unknown> }

const contractField = (state: RunState, k: string): string | undefined => {
  const v = contractOf(state)?.[k];
  return typeof v === 'string' ? v : undefined;
};

// A contract command's environment: PORT, and (6-4) FACTORY_CACHE_DIR, the run's own tool cache,
// created first.
function sh(command: string, cwd: string, port: number | undefined, timeout: number, cacheDir: string): { code: number; log: string } {
  mkdirSync(cacheDir, { recursive: true });
  const env = { ...process.env, ...(port !== undefined ? { PORT: String(port) } : {}), FACTORY_CACHE_DIR: cacheDir };
  const r = spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env });
  const code = r.status ?? 124; // killed by the timeout
  return { code, log: `$ ${command}\n${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}\n[exit ${code}]\n` };
}

async function httpOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}

// The run contract's `test` or `install`, in the worktree. `install` runs only at SCAFFOLD.
function contractCommand(state: RunState, k: 'test' | 'install'): Result {
  const command = contractField(state, k);
  if (!command || !state.worktree) return { exit_code: 1, log: `no run contract ${k} command`, output: { error: `no run contract ${k} command` } };
  const r = sh(command, state.worktree, state.port, CHECK_TIMEOUT_MS, runCacheDir(state.repo_hash!, state.run_id!));
  return { exit_code: r.code, command, log: r.log, output: {} };
}
const testCheck = (state: RunState): Result => contractCommand(state, 'test');
const installCheck = (state: RunState): Result => contractCommand(state, 'install');

// The last lines the dev server wrote since `from` (a byte offset into devserver.log).
function serverTail(hash: string, runId: string, from: number, lines = 20): string {
  let text = '';
  try { text = readFileSync(devserverLog(hash, runId)).subarray(from).toString('utf8'); } catch { return ''; }
  const rows = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  return rows.length ? `devserver.log:\n${rows.slice(-lines).join('\n')}\n` : '';
}
const logSize = (hash: string, runId: string): number => { try { return statSync(devserverLog(hash, runId)).size; } catch { return 0; } };

// Starts the dev server if it isn't running, then polls `health` until it passes, the server
// dies, or HEALTH_TIMEOUT_MS passes. At BUILD (3-3) and WRAP the server is restarted first, so health
// judges the code at the slice head or the run branch head, not what was running before.
async function healthCheck(state: RunState, hash: string, runId: string, restart = false): Promise<Result> {
  const command = contractField(state, 'health');
  const spec = serverSpec(state);
  if (!command || !spec) return { exit_code: 1, log: 'no run contract health/start command', output: { error: 'no run contract health/start command' } };
  if (restart) await devserverDown(hash, runId);
  const from = logSize(hash, runId);
  const up = await devserverUp(hash, runId, spec);
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  const log = `dev server pid ${up.pid}${up.started ? ' started' : ' already running'} on port ${spec.port}\n`;
  // On failure the log holds what the dev server wrote, then the cause last, so the card's tail keeps it.
  const fail = (error: string): Result => ({ exit_code: 1, command, log: `${log}${serverTail(hash, runId, up.started ? from : 0)}${error}\n`, output: { error } });
  for (;;) {
    const ok = /^https?:\/\//.test(command) ? await httpOk(command) : sh(command, spec.worktree, spec.port, 10_000, runCacheDir(hash, runId)).code === 0;
    // The port answered: it is our server only while the pid we started (or found) still lives.
    // devserverUp refused to spawn while anything else answered there.
    if (ok && (await serverAlive(up.pid))) return { exit_code: 0, command, log: log + 'health passed\n', output: { pid: up.pid } };
    if (ok) return fail(`the dev server exited; something else answers on port ${spec.port}`);
    if (!devserverRunning(hash, runId)) return fail('the dev server exited');
    if (Date.now() >= deadline) return fail(`health did not pass within ${HEALTH_TIMEOUT_MS} ms`);
    await sleep(HEALTH_POLL_MS);
  }
}

function specCheck(state: RunState): Result {
  const spec = latestSpec(state);
  if (!spec?.output_path) return { exit_code: 1, log: 'no verified spec', output: { errors: ['no verified spec'] } };
  const text = readFileSync(spec.output_path, 'utf8');
  const parsed = readSpec(text);
  const lint = parsed ? specLint(parsed.front, parsed.body) : { ok: false, errors: ['the spec no longer parses'], acs: [], assumptions: 0, lines: 0 };
  return {
    exit_code: lint.ok ? 0 : 1, digest: sha256(text), log: lint.errors.join('\n') + '\n',
    output: { spec: spec.id, path: spec.output_path, errors: lint.errors, acs: lint.acs, assumptions: lint.assumptions, lines: lint.lines },
  };
}

// The plan the CLI derives now, and its digest: what plan.lint lints and gate 2 approves. The
// current slicer plan (3-3), each slice with the roster core/roster.ts derives from its tags, the
// confirmed intake and whether a UI reference exists (the current design, or RECON's ui_reference).
export function currentPlan(state: RunState) {
  const spec = latestSpec(state);
  const slicer = latestSlicePlan(state);
  const hasReference = uiReference(state) !== undefined;
  const plan = slicePlanEntries(slicer?.output?.front as Record<string, unknown> | undefined)
    .map((e) => ({ ...e, roster: rosterOf(e.tags ?? [], { intake: state.intake, hasReference }) }));
  return { spec, slicer, plan, digest: sha256(JSON.stringify(plan)) };
}

function planCheck(state: RunState): Result {
  const { spec, slicer, plan, digest } = currentPlan(state);
  if (!spec) return { exit_code: 1, log: 'no verified spec', output: { errors: ['no verified spec'], plan: [] } };
  if (!slicer) return { exit_code: 1, log: 'no verified slice plan', output: { errors: ['no verified slice plan'], plan: [] } };
  const lint = planLint(plan, acIds(spec.output?.front as Record<string, unknown>));
  return { exit_code: lint.ok ? 0 : 1, digest, log: lint.errors.join('\n') + '\n', output: { slicer: slicer.id, errors: lint.errors, plan } };
}

// git.merged (AD-7): the main checkout's current HEAD contains `rev` (the approved commit, or the
// run branch's head).
export function mergedCheck(root: string, rev: string): Result {
  const command = `git merge-base --is-ancestor ${rev} HEAD`;
  let tip: string;
  try { tip = head(root); } catch (e) { return { exit_code: 1, command, log: `${(e as Error).message}\n`, output: { error: 'no HEAD' } }; }
  const ok = isAncestor(root, rev, tip);
  return { exit_code: ok ? 0 : 1, command, log: `$ ${command}\n[exit ${ok ? 0 : 1}]\n`, output: { head: tip } };
}

async function runOne(check: Check | undefined, run: ReturnType<typeof loadRun>, hash: string, runId: string, st?: Step, root?: string): Promise<Result> {
  switch (check) {
    case 'contract.test': return testCheck(run.state);
    case 'contract.install': return installCheck(run.state);
    case 'contract.health': return healthCheck(run.state, hash, runId, st?.stage === 'WRAP' || st?.stage === 'BUILD');
    case 'git.merged': return mergedCheck(root ?? '', run.state.branch ?? '');
    case 'spec.lint': return specCheck(run.state);
    case 'plan.lint': return planCheck(run.state);
    default: throw new FactoryError('BAD_ARGS', `check ${check} does not run as a step`);
  }
}

export async function check(args: Args): Promise<unknown> {
  const session = requireSession(args);
  const [stepId, ...extra] = args.positionals;
  if (!stepId || extra.length) throw new FactoryError('BAD_ARGS', 'usage: factory check <step_id> --session <id>');
  const cwd = process.cwd();
  const { hash, runId } = requireRun(cwd, session);
  const snap = await withLock(lockDir(hash, runId), () => {
    const run = loadRun(hash, runId);
    return { ...run, state: requireHolder(hash, runId, run, session) };
  });
  const st: Step | undefined = Object.hasOwn(snap.state.steps, stepId) ? snap.state.steps[stepId] : undefined;
  if (!st) throw new FactoryError('NOT_FOUND', `no step ${stepId} in run ${runId}`);
  if (st.kind !== 'run_check') throw new FactoryError('BAD_ARGS', `step ${stepId} is ${st.kind}, not run_check`);
  if (st.state !== 'claimed') throw new FactoryError('ILLEGAL_TRANSITION', `step ${stepId} is ${st.state}; claim it first`);
  if (st.claimed_by !== session) throw new FactoryError('CLAIM_TAKEN', `step ${stepId} was claimed by ${st.claimed_by}`);

  // Unlocked, from a basis: its seq, its void count and HEAD (AD-29).
  const basisSeq = snap.state.seq;
  const voids = snap.state.voided.length;
  const at = snap.state.worktree ?? repoRoot(cwd);
  const sha = head(at);
  // A refused or failed check must not leave the step claimed: it is reissued, so next issues it again.
  const refuse = async (code: ErrorCode, message: string): Promise<never> => {
    const again = await withLock(lockDir(hash, runId), () => {
      const run = loadRun(hash, runId);
      const state = requireHolder(hash, runId, run, session);
      const cur = state.steps[stepId];
      if (!['issued', 'claimed', 'reported'].includes(cur.state)) return undefined;
      const e = reissueEvent({ hash, runId, session, root: repoRoot(cwd) }, { state, commands: run.commands }, cur);
      gateOrThrow(state, [e]);
      appendAll(hash, runId, [e]);
      return (e.data as { new: string }).new;
    });
    throw new FactoryError(code, `${message}${again ? `; reissued as step ${again}: run factory next` : ''}`);
  };
  const t0 = Date.now();
  let r: Result;
  try {
    r = await runOne(st.check, snap, hash, runId, st, repoRoot(cwd));
  } catch (e) {
    return refuse(e instanceof FactoryError ? e.code : 'CHECK_FAILED', `${st.check} could not run: ${e instanceof Error ? e.message : String(e)}`);
  }
  const duration_ms = Date.now() - t0;
  const values = readRedactValues(hash, runId);
  if (st.output_path) {
    mkdirSync(dirname(st.output_path), { recursive: true });
    writeFileSync(st.output_path, redactString(r.log, values));
  }
  if (head(at) !== sha) return refuse('ILLEGAL_TRANSITION', `HEAD moved from ${sha} while ${st.check} ran; nothing recorded`);

  const res = await withLock(lockDir(hash, runId), () => {
    const state = requireHolder(hash, runId, loadRun(hash, runId), session);
    const cur = state.steps[stepId];
    if (cur.state !== 'claimed' || cur.claimed_by !== session) return { refused: `step ${stepId} is ${cur.state} now; nothing recorded` };
    if (state.voided.length !== voids) return { refused: `a void landed after basis_seq ${basisSeq}; nothing recorded` };
    const ran = makeEvent(runId, 'check_ran', {
      check: st.check!, exit_code: r.exit_code, duration_ms, basis_seq: basisSeq, sha,
      ...(r.command ? { command: redactString(r.command, values) } : {}), ...(r.digest ? { digest: r.digest } : {}),
    }, { corr: stepId });
    const output = redact({ check: st.check, check_id: ran.id, exit_code: r.exit_code, ...r.output }, values);
    const events = [
      ran,
      makeEvent(runId, 'step_reported', { step_id: stepId, output }, { session, actor: 'cli', corr: stepId }),
      makeEvent(runId, 'step_verified', { step_id: stepId, evidence: [ran.id] }, { corr: stepId }),
    ];
    gateOrThrow(state, events);
    appendAll(hash, runId, events);
    return { out: { step_id: stepId, check: st.check, exit_code: r.exit_code, passed: r.exit_code === 0, check_id: ran.id, duration_ms } };
  });
  if (res.refused !== undefined) return refuse('ILLEGAL_TRANSITION', res.refused);
  return res.out;
}
