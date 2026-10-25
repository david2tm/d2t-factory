// Spike 03 — Sandboxed writes (AD-35).
// Passes when: with the sandbox enabled, `factory start` writes commands.jsonl without a prompt.
// Fallback: manual allowWrite documented in the README.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pane, killServer } from '../lib/tmux.ts';
import { createTargetRepo } from '../lib/target-repo.ts';
import { turn } from '../lib/turn.ts';
import { claudeArgs, resetSpike, baseState, waitFact, readCli, archive, emit, factRef, excerpt, EVIDENCE, type Verdict } from '../lib/spike.ts';

const SPIKE_NAME = '03-sandboxed-writes';

function commandsFiles(): string[] {
  const root = join(homedir(), '.factory');
  const out: string[] = [];
  for (const h of existsSync(root) ? readdirSync(root) : []) {
    const runs = join(root, h, 'runs');
    if (!existsSync(runs)) continue;
    for (const r of readdirSync(runs)) if (existsSync(join(runs, r, 'commands.jsonl'))) out.push(join(runs, r, 'commands.jsonl'));
  }
  return out;
}

async function runOnce(sandbox: boolean): Promise<any> {
  const label = sandbox ? 'sandbox-on' : 'sandbox-off';
  resetSpike(baseState({ bound_all: true }));
  const before = new Set(commandsFiles());
  const repo = createTargetRepo(`${SPIKE_NAME}-${label}`);
  const pane = await Pane.start({ name: `s03-${label}`, cwd: repo, claudeArgs: claudeArgs('haiku', { sandbox }) });
  const result: any = { label, sandbox };
  try {
    await waitFact((f) => f.event === 'SessionStart', 30_000);
    const t = await turn(pane, 'Run this exact Bash command once: factory start "demo task" — do not modify it and do not disable the sandbox. Then reply DONE.', { timeoutMs: 180_000, approve: true });
    const pre = t.facts.filter((f) => f.event === 'PreToolUse' && f.tool_name === 'Bash');
    const post = t.facts.filter((f) => (f.event === 'PostToolUse' || f.event === 'PostToolUseFailure') && f.tool_name === 'Bash');
    const created = commandsFiles().filter((f) => !before.has(f));
    const cli = readCli().filter((c) => c.argv?.[0] === 'start' && c.phase !== 'enter');
    result.prompts = t.prompts;
    result.created = created.map((f) => ({ path: f, first_line: readFileSync(f, 'utf8').split('\n')[0].slice(0, 200) }));
    result.evidence = [
      ...pre.map((f) => `[${label}] ` + factRef(f, `command=${JSON.stringify(f.payload?.tool_input?.command)} dangerouslyDisableSandbox=${f.payload?.tool_input?.dangerouslyDisableSandbox ?? false}`)),
      ...post.map((f) => `[${label}] ` + factRef(f, excerpt(JSON.stringify(f.payload?.tool_response ?? f.payload?.error ?? ''), 200))),
      ...cli.map((c) => `[${label}] cli.jsonl start exit=${c.exit} out=${excerpt(JSON.stringify(c.out), 200)}`),
      ...result.created.map((c: any) => `[${label}] ${c.path}: ${c.first_line}`),
      `[${label}] permission prompts: ${t.prompts.length}${t.prompts.length ? ' — ' + t.prompts.map((p) => excerpt(p, 240)).join(' || ') : ''}`,
    ];
    result.disabled_sandbox = pre.some((f) => f.payload?.tool_input?.dangerouslyDisableSandbox);
    result.pass = created.length > 0 && t.prompts.length === 0 && !result.disabled_sandbox;
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

async function main(): Promise<void> {
  const runs: any[] = [await runOnce(true)];
  if (!runs[0].pass) runs.push(await runOnce(false));
  killServer();
  const absent = join(EVIDENCE, 'sandbox-mkdir-absent.txt');
  const extra = existsSync(absent) ? [`precondition observation: ${readFileSync(absent, 'utf8').replace(/\n/g, ' | ')}`] : [];
  const on = runs[0];
  const v: Verdict = {
    spike: SPIKE_NAME,
    verdict: on.pass ? 'PASS' : 'FALLBACK',
    evidence: [...(on.evidence ?? []), ...(runs[1]?.evidence ?? []), ...extra],
    notes: on.pass
      ? 'Sandboxed Bash ran `factory start` with no prompt and the sandbox kept on; commands.jsonl written under ~/.factory/<repo-hash>/runs/. Precondition: ~/.factory must already exist — the sandbox cannot create it (allowWrite does not cover creating the directory itself), so `factory setup` must mkdir it.'
      : 'Criterion missed under the sandbox; manual allowWrite documented in the README is the fallback.',
    runs,
  };
  emit(v);
}

await main();
process.exit(0);
