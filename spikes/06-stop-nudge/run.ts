// Spike 06 — Stop and nudge (AD-12). Runs first; no fallback.
// Passes when: in BUILD with steps open, a stop is blocked; parked at a gate, a stop is
// allowed; after /clear, the first turn resumes the run with no human input.
import { setTimeout as sleep } from 'node:timers/promises';
import { Pane, killServer } from '../lib/tmux.ts';
import { createTargetRepo } from '../lib/target-repo.ts';
import {
  claudeArgs, resetSpike, baseState, readFacts, readCli, waitFact, patchState, archive, emit, factRef, excerpt, type Fact, type Verdict,
} from '../lib/spike.ts';

const SPIKE_NAME = '06-stop-nudge';
const BUILD_STEPS = [{ step_id: 'S1-builder', kind: 'spawn' as const, claimed: true }];
const NEUTRAL = 'hi';
const IDLE_WINDOW_MS = 45_000;

interface Phase { pass: boolean; evidence: string[]; notes: string[] }

function turnFacts(from: number, session?: string): Fact[] {
  return readFacts().filter((f) => f._line > from && (!session || f.session_id === session));
}

async function waitTurnEnd(from: number, timeoutMs: number): Promise<Fact | null> {
  // A turn has ended when a Stop fact with no block answer is logged.
  return waitFact((f) => f._line > from && f.event === 'Stop' && !f.answer, timeoutMs);
}

function cliCallsSince(ts: string, verb: string): any[] {
  return readCli().filter((c) => c.ts > ts && c.argv?.[0] === verb && c.phase !== 'enter');
}

// After /clear: wait IDLE_WINDOW_MS with zero input, then send a neutral prompt.
async function clearProbe(pane: Pane, label: string): Promise<Phase & { newSession: string | null; nudged: boolean; zeroInputTurn: boolean; neutralResumed: boolean }> {
  const ev: string[] = [];
  const notes: string[] = [];
  const mark = readFacts().length;
  await pane.type('/clear');
  const ss = await waitFact((f) => f._line > mark && f.event === 'SessionStart' && f.payload?.source === 'clear', 30_000);
  if (!ss) return { pass: false, evidence: ['no SessionStart(clear) fact within 30 s'], notes, newSession: null, nudged: false, zeroInputTurn: false, neutralResumed: false };
  const nudged = Boolean(ss.answer?.hookSpecificOutput?.additionalContext);
  ev.push(`[${label}] ` + factRef(ss, `bound=${(ss as any).bound} ppid=${(ss as any).ppid}`));
  const newSession = ss.session_id;
  const tClear = new Date().toISOString();
  await sleep(IDLE_WINDOW_MS);
  const idle = turnFacts(ss._line, newSession ?? undefined).filter((f) => ['UserPromptSubmit', 'PreToolUse', 'Stop'].includes(f.event));
  const nextIdle = cliCallsSince(tClear, 'next');
  const zeroInputTurn = idle.length > 0 || nextIdle.length > 0;
  ev.push(`[${label}] zero-input window ${IDLE_WINDOW_MS / 1000}s after /clear: ${idle.length} turn facts, ${nextIdle.length} \`factory next\` calls`);
  pane.snap(`${label}:after-idle-window`);
  let neutralResumed = zeroInputTurn && nextIdle.length > 0;
  if (!zeroInputTurn) {
    const m2 = readFacts().length;
    const tSend = new Date().toISOString();
    await pane.type(NEUTRAL);
    const end = await waitTurnEnd(m2, 180_000);
    const turn = turnFacts(m2, newSession ?? undefined);
    const firstTool = turn.find((f) => f.event === 'PreToolUse');
    const nexts = cliCallsSince(tSend, 'next');
    neutralResumed = nexts.length > 0;
    ev.push(`[${label}] neutral prompt ${JSON.stringify(NEUTRAL)} → first tool: ${firstTool ? factRef(firstTool, JSON.stringify(firstTool.payload?.tool_input?.command ?? '')) : 'none'}; \`factory next\` calls this turn: ${nexts.length}`);
    if (end) ev.push(`[${label}] ` + factRef(end, `last_assistant_message=${JSON.stringify(excerpt(end.payload?.last_assistant_message ?? '', 160))}`));
    const cap = pane.snap(`${label}:after-neutral`);
    const gate = cap.split('\n').filter((l) => /Gate 2|approve gate2/i.test(l)).slice(0, 2).map((l) => l.trim());
    if (gate.length) ev.push(`[${label}] pane: ${gate.join(' / ')}`);
  }
  return { pass: nudged && (zeroInputTurn || neutralResumed), evidence: ev, notes, newSession, nudged, zeroInputTurn, neutralResumed };
}

async function runOnce(sandbox: boolean): Promise<any> {
  const label = sandbox ? 'sandbox-on' : 'sandbox-off';
  resetSpike(baseState({ bound_all: false, bound_sessions: [], bound_ppids: [], resolve: 'session', script: 'stop-nudge', stop_block: true, nudge: false, open_steps: BUILD_STEPS }));
  const repo = createTargetRepo(SPIKE_NAME);
  const pane = await Pane.start({ name: `s06-${label}`, cwd: repo, claudeArgs: claudeArgs('haiku', { sandbox, extra: ['--allowedTools', 'Bash(factory *)', 'Bash(factory:*)'] }) });
  const result: any = { label, sandbox };
  try {
    const ss = await waitFact((f) => f.event === 'SessionStart' && f.payload?.source === 'startup', 30_000);
    if (!ss) throw new Error('no SessionStart(startup) fact — plugin hooks not loaded?');
    const sid = ss.session_id as string;
    patchState((s) => { s.bound_sessions = [sid]; s.bound_ppids = [(ss as any).ppid]; s.bound_cwd = ss.payload.cwd; });
    result.startup_session = sid;

    // Phase A — BUILD with an open step: Stop must block.
    const mA = readFacts().length;
    await pane.type('Reply with just the word READY.');
    const endA = await waitTurnEnd(mA, 240_000);
    const fa = turnFacts(mA, sid);
    const blocks = fa.filter((f) => f.event === 'Stop' && f.answer?.decision === 'block');
    const nexts = fa.filter((f) => f.event === 'PreToolUse' && /^\s*factory next/.test(f.payload?.tool_input?.command ?? ''));
    const A: Phase = { pass: blocks.length > 0 && nexts.length > 0 && Boolean(endA), evidence: [], notes: [] };
    for (const b of blocks.slice(0, 2)) A.evidence.push('[A] ' + factRef(b));
    for (const n of nexts.slice(0, 1)) A.evidence.push('[A] ' + factRef(n, JSON.stringify(n.payload.tool_input.command)));
    if (endA) A.evidence.push('[A] ' + factRef(endA, `note=${JSON.stringify(endA.note)}`));
    A.notes.push(`Stop blocks in phase A: ${blocks.length} (8-continuation cap ${blocks.length >= 8 ? 'REACHED' : 'not reached'})`);
    const capA = pane.snap('A:end');
    const cardLine = capA.split('\n').find((l) => /Gate 2/i.test(l));
    if (cardLine) A.evidence.push(`[A] pane: ${cardLine.trim()}`);
    result.A = A;

    // Phase B — parked at a gate (every open step ask_human): Stop must be allowed.
    patchState((s) => { s.stage = 'SLICE_PLAN'; s.open_steps = [{ step_id: 'gate2-ask', kind: 'ask_human' }]; });
    const mB = readFacts().length;
    await pane.type('Reply with just the word OK.');
    const endB = await waitFact((f) => f._line > mB && f.event === 'Stop', 120_000);
    await sleep(3000);
    const blocksB = turnFacts(mB, sid).filter((f) => f.event === 'Stop' && f.answer?.decision === 'block');
    const B: Phase = { pass: Boolean(endB) && !endB!.answer && blocksB.length === 0, evidence: [], notes: [] };
    if (endB) B.evidence.push('[B] ' + factRef(endB, `note=${JSON.stringify(endB.note)}`));
    B.notes.push(`Stop blocks in phase B: ${blocksB.length}`);
    result.B = B;

    // Phase C — back in BUILD with steps open, nudge on; /clear. Spine-literal resolution first
    // (hooks resolve the run only by session_id, AD-25).
    patchState((s) => { s.stage = 'BUILD'; s.open_steps = BUILD_STEPS; s.nudge = true; s.resolve = 'session'; });
    const C = await clearProbe(pane, 'C-session');
    result.C_session = C;

    // Phase C' — same, but the hook resolves the run by the Claude process (hook ppid), a
    // spike-only alternative, to separate "the nudge doesn't resume" from "the hook can't find the run".
    patchState((s) => { s.stage = 'BUILD'; s.open_steps = BUILD_STEPS; s.resolve = 'ppid'; });
    const Cp = await clearProbe(pane, 'C-ppid');
    result.C_ppid = Cp;

    // Probe — SessionStart `initialUserMessage` (documented for -p only): does it start a turn interactively?
    patchState((s) => { s.stage = 'BUILD'; s.open_steps = BUILD_STEPS; s.resolve = 'ppid'; s.initial_user_message = 'Resume the bound factory run.'; });
    const mI = readFacts().length;
    await pane.type('/clear');
    const ssI = await waitFact((f) => f._line > mI && f.event === 'SessionStart' && f.payload?.source === 'clear', 30_000);
    await sleep(IDLE_WINDOW_MS);
    const turnI = ssI ? turnFacts(ssI._line, ssI.session_id ?? undefined).filter((f) => ['UserPromptSubmit', 'PreToolUse', 'Stop'].includes(f.event)) : [];
    result.initialUserMessage_probe = { started_turn: turnI.length > 0, evidence: ssI ? [factRef(ssI), `turn facts in ${IDLE_WINDOW_MS / 1000}s: ${turnI.length}`] : ['no SessionStart(clear)'] };
    pane.snap('initialUserMessage:after-window');
    patchState((s) => { delete s.initial_user_message; });
    result.session_ids = [...new Set(readFacts().map((f) => f.session_id).filter(Boolean))];
    result.ppids = [...new Set(readFacts().filter((f) => f.event === 'SessionStart').map((f) => (f as any).ppid))];
  } catch (e) {
    result.error = String((e as Error).stack ?? e);
  } finally {
    pane.kill();
    await sleep(1500);
    result.archive = archive(SPIKE_NAME, label, [pane]);
  }
  const literal = Boolean(result.C_session?.pass);
  const viaPpid = Boolean(result.C_ppid?.pass);
  result.pass = Boolean(result.A?.pass && result.B?.pass && literal);
  result.pass_with_ppid_resolution = Boolean(result.A?.pass && result.B?.pass && viaPpid);
  return result;
}

async function main(): Promise<void> {
  const runs: any[] = [];
  const first = await runOnce(true);
  runs.push(first);
  if (!first.pass) runs.push(await runOnce(false));
  killServer();
  const r = runs[0];
  const evidence = [
    ...(r.A?.evidence ?? []), ...(r.B?.evidence ?? []), ...(r.C_session?.evidence ?? []), ...(r.C_ppid?.evidence ?? []),
    ...(r.initialUserMessage_probe?.evidence ?? []).map((e: string) => '[initialUserMessage probe] ' + e),
    `session ids seen (startup + one per /clear): ${(r.session_ids ?? []).join(', ')}`,
    `hook ppid per SessionStart: ${(r.ppids ?? []).join(', ')}`,
  ];
  const v: Verdict = {
    spike: SPIKE_NAME,
    verdict: r.pass ? 'PASS' : 'FAIL — no fallback',
    evidence,
    notes: [
      `A (BUILD, stop blocked)=${r.A?.pass} B (parked, stop allowed)=${r.B?.pass}`,
      `C spine-literal session resolution: nudged=${r.C_session?.nudged} zero-input turn=${r.C_session?.zeroInputTurn} neutral-prompt resume=${r.C_session?.neutralResumed}`,
      `C ppid resolution: nudged=${r.C_ppid?.nudged} zero-input turn=${r.C_ppid?.zeroInputTurn} neutral-prompt resume=${r.C_ppid?.neutralResumed}`,
      `initialUserMessage started a turn interactively: ${r.initialUserMessage_probe?.started_turn}`,
      ...(r.A?.notes ?? []), ...(r.B?.notes ?? []),
      r.error ? `error: ${r.error}` : '',
    ].filter(Boolean).join(' | '),
    runs,
  };
  emit(v);
}

await main();
process.exit(0);
