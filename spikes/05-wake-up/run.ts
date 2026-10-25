// Spike 05 — Wake-up (AD-17).
// Passes when: with a builder running for 10 minutes and a cut deadline at +3 minutes, the
// conductor wakes within 5 s of the deadline and prints the CUT card.
// Fallback: budget check on every `next`, plus the slice time box.
import { setTimeout as sleep } from 'node:timers/promises';
import { Pane, killServer } from '../lib/tmux.ts';
import { join } from 'node:path';
import { createTargetRepo, SPIKES } from '../lib/target-repo.ts';
import { claudeArgs, resetSpike, baseState, readFacts, readCli, waitFact, patchState, archive, emit, factRef, excerpt, type Verdict } from '../lib/spike.ts';

const SPIKE_NAME = '05-wake-up';
const WORK = join(SPIKES, '05-wake-up', 'work.ts');
const CUT_AFTER_MS = 180_000;
const WAKE_LIMIT_MS = 5_000;

const CONDUCTOR = [
  'You are the factory conductor for an infrastructure test. Rules:',
  '1. When `factory next` (or `factory next --wait <ms>`) returns a `wait` object, immediately run `factory next --wait <retry_after_ms>` with the Bash tool using run_in_background: true, then end your turn with one short line.',
  '2. When a background `factory next --wait` finishes, read its output. If it contains a step of kind ask_human with a card, print the card verbatim (title, reason, and each command on its own line) as the last lines of your turn and end your turn.',
  '3. Never poll, never sleep, never run other commands.',
].join('\n');

async function runOnce(sandbox: boolean): Promise<any> {
  const label = sandbox ? 'sandbox-on' : 'sandbox-off';
  resetSpike(baseState({ bound_all: true, script: 'wakeup', stop_block: true, deadline_ms: Date.now() + 3_600_000, open_steps: [{ step_id: 'builder-S2', kind: 'spawn', claimed: true, background: true }] }));
  const repo = createTargetRepo(`${SPIKE_NAME}-${label}`);
  const pane = await Pane.start({ name: `s05-${label}`, cwd: repo, claudeArgs: claudeArgs('haiku', { sandbox, extra: ['--append-system-prompt', CONDUCTOR, '--allowedTools', 'Bash(factory *)', 'Bash(factory:*)', `Bash(node ${WORK}:*)`, `Bash(node ${WORK} *)`] }) });
  const result: any = { label, sandbox };
  try {
    await waitFact((f) => f.event === 'SessionStart', 30_000);
    // Start the 10-minute builder in the background.
    const m0 = readFacts().length;
    await pane.type('Use the Agent tool with subagent_type "d2t-factory:builder-lite" and run_in_background: true, with this brief: "Run the Bash command `node ' + WORK + ' 590` in the foreground with timeout 600000 (a 10-minute build stand-in), then reply STATUS: DONE." Do not wait for it. Then reply STARTED.');
    const sub = await waitFact((f) => f._line > m0 && f.event === 'SubagentStart', 120_000);
    await waitFact((f) => f._line > m0 && f.event === 'Stop' && !f.answer, 120_000);
    result.builder_started = sub ? factRef(sub) : null;
    // Cut deadline at +3 minutes from now; the conductor enters the wait loop.
    const deadline = Date.now() + CUT_AFTER_MS;
    patchState((s) => { s.deadline_ms = deadline; });
    result.deadline = new Date(deadline).toISOString();
    const m1 = readFacts().length;
    await pane.type('Run `factory next` and follow the conductor rules.');
    await waitFact((f) => f._line > m1 && f.event === 'Stop' && !f.answer, 120_000);
    const bg = readFacts().slice(m1).find((f) => f.event === 'PreToolUse' && /factory next --wait/.test(f.payload?.tool_input?.command ?? ''));
    result.background_wait = bg ? factRef(bg, `run_in_background=${bg.payload?.tool_input?.run_in_background}`) : null;
    const mIdle = readFacts().length;
    // Watch the pane for the printed card around the deadline.
    let cardSeenAt: number | null = null;
    while (Date.now() < deadline + 120_000) {
      const cap = pane.capture();
      if (cardSeenAt === null && Date.now() >= deadline - 2000 && /\/factory cut S2/.test(cap)) { cardSeenAt = Date.now(); pane.snap('card-seen'); }
      if (cardSeenAt && Date.now() - cardSeenAt > 15_000) break;
      await sleep(250);
    }
    const after = readFacts().slice(mIdle);
    const preDeadlineActivity = after.filter((f) => Date.parse(f.ts) < deadline && ['UserPromptSubmit', 'PreToolUse'].includes(f.event) && f.agent_id === null);
    const woke = after.find((f) => Date.parse(f.ts) >= deadline - 1000 && f.agent_id === null && ['PreToolUse', 'Stop', 'UserPromptSubmit'].includes(f.event));
    const cutStop = after.find((f) => f.event === 'Stop' && f.agent_id === null && /CUT/.test(f.payload?.last_assistant_message ?? ''));
    const waitExit = readCli().find((c) => c.argv?.[0] === 'next' && c.argv?.includes('--wait') && c.phase !== 'enter' && Array.isArray(c.out?.steps) && c.out.steps.length);
    result.wait_exit = waitExit ? `${waitExit.ts} exit=${waitExit.exit}` : null;
    result.wake_fact = woke ? factRef(woke) : null;
    result.wake_ms = woke ? Date.parse(woke.ts) - deadline : null;
    result.card_seen_ms = cardSeenAt ? cardSeenAt - deadline : null;
    result.cut_stop = cutStop ? factRef(cutStop, `last_assistant_message=${JSON.stringify(excerpt(cutStop.payload.last_assistant_message, 200))}`) : null;
    result.polled_before_deadline = preDeadlineActivity.length;
    const subStop = readFacts().find((f) => f.event === 'SubagentStop');
    result.builder_running_at_deadline = !subStop || Date.parse(subStop.ts) > deadline;
    result.builder_stop = subStop ? factRef(subStop, `last=${JSON.stringify(excerpt(subStop.payload?.last_assistant_message ?? '', 120))}`) : null;
    result.pass = Boolean(result.builder_running_at_deadline && bg && woke && cutStop && result.card_seen_ms !== null && result.card_seen_ms <= WAKE_LIMIT_MS);
  } catch (e) {
    result.error = String((e as Error).stack ?? e);
    result.pass = false;
  } finally {
    pane.kill();
    await sleep(1500);
    result.archive = archive(SPIKE_NAME, label, [pane]);
  }
  return result;
}

function ev(r: any): string[] {
  return [
    r.builder_started && `[${r.label}] builder: ${r.builder_started}`,
    `[${r.label}] cut deadline ${r.deadline}`,
    r.background_wait && `[${r.label}] ${r.background_wait}`,
    r.wait_exit && `[${r.label}] cli.jsonl next --wait returned CUT card at ${r.wait_exit}`,
    r.wake_fact && `[${r.label}] first conductor hook after deadline (+${r.wake_ms} ms): ${r.wake_fact}`,
    `[${r.label}] pane shows CUT card at deadline +${r.card_seen_ms ?? 'never'} ms`,
    r.cut_stop && `[${r.label}] ${r.cut_stop}`,
    `[${r.label}] conductor tool calls between the wait and the deadline: ${r.polled_before_deadline}`,
    `[${r.label}] builder still running at the deadline: ${r.builder_running_at_deadline}${r.builder_stop ? ' — ' + r.builder_stop : ''}`,
    r.error && `[${r.label}] error: ${String(r.error).split('\n')[0]}`,
  ].filter(Boolean) as string[];
}

async function main(): Promise<void> {
  const runs: any[] = [await runOnce(true)];
  if (!runs[0].pass) runs.push(await runOnce(false));
  killServer();
  const on = runs[0];
  const v: Verdict = {
    spike: SPIKE_NAME,
    verdict: on.pass ? 'PASS' : 'FALLBACK',
    evidence: [...ev(on), ...(runs[1] ? ev(runs[1]) : [])],
    notes: on.pass
      ? `Background \`factory next --wait\` exit woke the idle conductor; CUT card on screen ${on.card_seen_ms} ms after the deadline (limit ${WAKE_LIMIT_MS} ms).`
      : `Wake within ${WAKE_LIMIT_MS} ms not shown under the sandbox; fallback: budget check on every \`next\` plus the slice time box.`,
    runs,
  };
  emit(v);
}

await main();
process.exit(0);
