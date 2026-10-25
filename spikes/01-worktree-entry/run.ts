// Spike 01 — Worktree entry (AD-15, AD-35).
// Passes when: in the default permission mode after setup, entering takes zero prompts, both
// in a fresh session and after /clear.
// Fallback: .claude/worktrees/factory-<run-id> plus .git/info/exclude (its own check runs here too).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pane, killServer } from '../lib/tmux.ts';
import { createTargetRepo, git } from '../lib/target-repo.ts';
import { turn, type TurnResult } from '../lib/turn.ts';
import { claudeArgs, resetSpike, baseState, readFacts, waitFact, archive, emit, factRef, excerpt, type Fact, type Verdict } from '../lib/spike.ts';

const SPIKE_NAME = '01-worktree-entry';

function repoHash(repo: string): string {
  const common = git(repo, 'rev-parse', '--git-common-dir');
  return createHash('sha256').update(realpathSync(join(repo, common))).digest('hex').slice(0, 12);
}

function inside(p: string | undefined, dir: string): boolean {
  if (!p) return false;
  let rp = p;
  try { rp = realpathSync(p); } catch { /* keep */ }
  const d = realpathSync(dir);
  return rp === d || rp.startsWith(d + sep);
}

function entryEvidence(t: TurnResult, wt: string, label: string): { entered: boolean; ev: string[] } {
  const ev: string[] = [];
  const pre = t.facts.find((f) => f.event === 'PreToolUse' && f.tool_name === 'EnterWorktree');
  const post = t.facts.find((f) => (f.event === 'PostToolUse' || f.event === 'PostToolUseFailure') && f.tool_name === 'EnterWorktree');
  const cwdc = t.facts.find((f) => f.event === 'CwdChanged');
  if (pre) ev.push(`[${label}] ` + factRef(pre, `tool_input=${JSON.stringify(pre.payload?.tool_input)}`));
  if (post) ev.push(`[${label}] ` + factRef(post, excerpt(JSON.stringify(post.payload?.tool_response ?? post.payload?.error ?? ''), 200)));
  if (cwdc) ev.push(`[${label}] ` + factRef(cwdc, excerpt(JSON.stringify({ old: cwdc.payload?.old_cwd, new: cwdc.payload?.new_cwd ?? cwdc.payload?.cwd }), 220)));
  if (t.stop) ev.push(`[${label}] ` + factRef(t.stop, `cwd=${t.stop.payload?.cwd}`));
  ev.push(`[${label}] permission prompts: ${t.prompts.length}${t.prompts.length ? ' — ' + t.prompts.map((p) => excerpt(p, 260)).join(' || ') : ''}`);
  const entered = Boolean(post && post.event === 'PostToolUse') && (inside(t.stop?.payload?.cwd, wt) || inside(cwdc?.payload?.new_cwd, wt));
  return { entered, ev };
}

const ENTER = (p: string) => `Call the EnterWorktree tool with path set to ${p} (an existing git worktree). Do nothing else, then reply ENTERED.`;

async function scenario(placement: 'factory' | 'fallback', sandbox: boolean): Promise<any> {
  const label = `${placement}-${sandbox ? 'sandbox-on' : 'sandbox-off'}`;
  resetSpike(baseState({ bound_all: true }));
  const repo = createTargetRepo(`${SPIKE_NAME}-${label}`);
  const hash = repoHash(repo);
  const ids = ['spike-wt-a1b2', 'spike-wt-c3d4'];
  const wts = ids.map((id) => placement === 'factory'
    ? join(homedir(), '.factory', hash, 'worktrees', id)
    : join(repo, '.claude', 'worktrees', `factory-${id}`));
  if (placement === 'fallback') {
    mkdirSync(join(repo, '.git', 'info'), { recursive: true });
    appendFileSync(join(repo, '.git', 'info', 'exclude'), '\n.claude/worktrees/\n');
  }
  for (const [i, id] of ids.entries()) git(repo, 'worktree', 'add', '-q', wts[i], '-b', `factory/${id}`, 'HEAD');
  const result: any = { label, placement, sandbox, repo, worktrees: wts, repo_hash: hash };
  const pane = await Pane.start({ name: `s01-${label}`, cwd: repo, claudeArgs: claudeArgs('haiku', { sandbox }) });
  try {
    await waitFact((f) => f.event === 'SessionStart', 30_000);
    // Fresh session.
    const t1 = await turn(pane, ENTER(wts[0]), { timeoutMs: 180_000, approve: true });
    const e1 = entryEvidence(t1, wts[0], `${label} fresh`);
    result.fresh = { prompts: t1.prompts, entered: e1.entered, evidence: e1.ev };
    // After /clear.
    const mark = readFacts().length;
    await pane.type('/clear');
    const ss = await waitFact((f) => f._line > mark && f.event === 'SessionStart' && f.payload?.source === 'clear', 30_000);
    const cwdAfterClear = ss?.payload?.cwd;
    result.cwd_after_clear = cwdAfterClear;
    result.cwd_after_clear_inside_wt0 = inside(cwdAfterClear, wts[0]);
    // If /clear kept us inside wt0, enter the second worktree; otherwise re-enter wt0.
    const target = result.cwd_after_clear_inside_wt0 ? wts[1] : wts[0];
    const t2 = await turn(pane, ENTER(target), { timeoutMs: 180_000, approve: true });
    const e2 = entryEvidence(t2, target, `${label} after-clear`);
    result.after_clear = { target, prompts: t2.prompts, entered: e2.entered, evidence: [ss ? `[${label} after-clear] ` + factRef(ss, `cwd=${cwdAfterClear}`) : 'no SessionStart(clear)', ...e2.ev] };
    result.main_checkout_status = execFileSync('git', ['status', '--porcelain=v2', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' }).trim();
  } catch (e) {
    result.error = String((e as Error).stack ?? e);
  } finally {
    pane.kill();
    await sleep(1500);
    result.archive = archive(SPIKE_NAME, label, [pane]);
    for (const w of wts) { try { git(repo, 'worktree', 'remove', '--force', w); } catch { /* ignore */ } }
  }
  result.pass = Boolean(result.fresh?.entered && result.after_clear?.entered && result.fresh.prompts.length === 0 && result.after_clear.prompts.length === 0);
  return result;
}

async function main(): Promise<void> {
  const runs: any[] = [];
  const primary = await scenario('factory', true);
  runs.push(primary);
  let primaryOff: any = null;
  if (!primary.pass) { primaryOff = await scenario('factory', false); runs.push(primaryOff); }
  let fb: any = null;
  let fbOff: any = null;
  if (!primary.pass) {
    fb = await scenario('fallback', true); runs.push(fb);
    if (!fb.pass) { fbOff = await scenario('fallback', false); runs.push(fbOff); }
  }
  killServer();
  const ev = (r: any) => r ? [...(r.fresh?.evidence ?? []), ...(r.after_clear?.evidence ?? []), r.error ? `[${r.label}] error: ${String(r.error).split('\n')[0]}` : ''].filter(Boolean) : [];
  let verdict: Verdict['verdict'];
  let notes: string;
  if (primary.pass) { verdict = 'PASS'; notes = '~/.factory worktree entered with zero prompts, fresh and after /clear.'; }
  else if (fb?.pass) { verdict = 'FALLBACK'; notes = `~/.factory placement prompted (sandbox on: ${primary.fresh?.prompts.length ?? '?'} fresh / ${primary.after_clear?.prompts.length ?? '?'} after /clear; sandbox off: ${primaryOff?.fresh?.prompts.length ?? '?'} / ${primaryOff?.after_clear?.prompts.length ?? '?'}). Fallback .claude/worktrees/factory-<run-id> + .git/info/exclude entered with zero prompts, fresh and after /clear; main checkout status with the exclude: ${JSON.stringify(fb.main_checkout_status)}.`; }
  else { verdict = 'FAIL'; notes = 'Neither placement entered with zero prompts.'; }
  notes += ` cwd after /clear (primary): ${primary.cwd_after_clear} (inside first worktree: ${primary.cwd_after_clear_inside_wt0}).`;
  emit({ spike: SPIKE_NAME, verdict, evidence: [...ev(primary), ...ev(primaryOff), ...ev(fb), ...ev(fbOff)], notes, runs });
}

await main();
process.exit(0);
