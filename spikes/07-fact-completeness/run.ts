// Spike 07 — Fact completeness (AD-13, AD-31).
// Passes when: over 20 builder steps, the count of output_written equals the count of Write
// calls into artifacts/. Fallback: make the Write|Edit PostToolUse hook synchronous.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pane, killServer } from '../lib/tmux.ts';
import { createTargetRepo } from '../lib/target-repo.ts';
import { turn } from '../lib/turn.ts';
import { claudeArgs, resetSpike, baseState, readFacts, waitFact, archive, emit, SPIKE, type Verdict } from '../lib/spike.ts';

const SPIKE_NAME = '07-fact-completeness';
const STEPS = 20;
const BATCH = 5;
const RUN_DIR = join(SPIKE, 'runs', 'spike-run-0000');
const ART = join(RUN_DIR, 'artifacts');

function transcriptWrites(paths: string[]): { total: number; ids: Set<string> } {
  const ids = new Set<string>();
  for (const p of paths) {
    if (!p || !existsSync(p)) continue;
    for (const l of readFileSync(p, 'utf8').split('\n')) {
      if (!l) continue;
      try {
        const e = JSON.parse(l);
        const content = e.message?.content;
        if (e.type !== 'assistant' || !Array.isArray(content)) continue;
        for (const b of content) if (b.type === 'tool_use' && b.name === 'Write' && String(b.input?.file_path ?? '').startsWith(ART)) ids.add(b.id);
      } catch { /* skip */ }
    }
  }
  return { total: ids.size, ids };
}

async function runOnce(sandbox: boolean): Promise<any> {
  const label = sandbox ? 'sandbox-on' : 'sandbox-off';
  const steps = Array.from({ length: STEPS }, (_, i) => `step-${String(i + 1).padStart(2, '0')}`);
  resetSpike(baseState({ bound_all: true, guard: true, run_dir: RUN_DIR, open_steps: steps.map((s) => ({ step_id: s, kind: 'spawn' as const, claimed: true })) }));
  const repo = createTargetRepo(`${SPIKE_NAME}-${label}`);
  const pane = await Pane.start({ name: `s07-${label}`, cwd: repo, claudeArgs: claudeArgs('haiku', { sandbox, extra: ['--allowedTools', `Write(/${ART}/**)`, `Edit(/${ART}/**)`, `Write(${ART}/**)`] }) });
  const result: any = { label, sandbox };
  try {
    await waitFact((f) => f.event === 'SessionStart', 30_000);
    const prompts: string[] = [];
    for (let b = 0; b < STEPS / BATCH; b++) {
      const batch = steps.slice(b * BATCH, (b + 1) * BATCH);
      // Long prompts typed through tmux arrive truncated, so each batch's instructions go in a
      // file in the session's cwd and the typed prompt stays short.
      const briefs = batch.map((s) => `- ${s}: brief "Use the Write tool to create ${join(ART, 'steps', s, 'out.md')} with the content: STATUS: DONE (newline) ${s} complete. Use Write exactly once and no other tool."`).join('\n');
      const file = `batch-${b + 1}.md`;
      writeFileSync(join(repo, file), `Launch these ${BATCH} agents in parallel in ONE message, each with the Agent tool, subagent_type "d2t-factory:builder-lite", running in the foreground. Do not write any of the files yourself. Wait for all of them, then reply BATCH DONE.\n\n${briefs}\n`);
      const t = await turn(pane, `Read ${file} in the current directory and follow it exactly.`, { timeoutMs: 360_000, approve: true });
      prompts.push(...t.prompts);
    }
    await sleep(20_000); // let async hooks land while the session is still alive (interactive)
    result.prompts = prompts;
    const facts = readFacts();
    const ow = facts.filter((f) => f.fact_kind === 'output_written');
    const preWrites = facts.filter((f) => f.event === 'PreToolUse' && f.tool_name === 'Write' && String(f.payload?.tool_input?.file_path ?? '').startsWith(ART));
    const denies = preWrites.filter((f) => f.answer?.hookSpecificOutput?.permissionDecision === 'deny');
    const subStops = facts.filter((f) => f.event === 'SubagentStop');
    const subStarts = facts.filter((f) => f.event === 'SubagentStart');
    // Ground truth: main + subagent transcripts. Subagent transcripts are also globbed from
    // <transcript>/subagents/ so a lost async SubagentStop cannot hide a Write.
    const mains = [...new Set(facts.map((f) => f.payload?.transcript_path).filter(Boolean))] as string[];
    const globbed = mains.flatMap((m) => { const d = join(m.replace(/\.jsonl$/, ''), 'subagents'); return existsSync(d) ? readdirSync(d).filter((x) => x.endsWith('.jsonl')).map((x) => join(d, x)) : []; });
    const transcripts = [...new Set([...mains, ...globbed, ...subStops.map((f) => f.payload?.agent_transcript_path)].filter(Boolean))];
    result.transcripts_scanned = transcripts.length;
    const tw = transcriptWrites(transcripts);
    const owIds = new Set(ow.map((f) => f.payload?.tool_use_id));
    const missing = [...tw.ids].filter((id) => !owIds.has(id));
    const files = existsSync(join(ART, 'steps')) ? readdirSync(join(ART, 'steps')).filter((d) => existsSync(join(ART, 'steps', d, 'out.md'))) : [];
    Object.assign(result, {
      output_written: ow.length, write_calls_transcripts: tw.total, write_pretooluse: preWrites.length, guard_denies: denies.length,
      files_on_disk: files.length, subagent_start: subStarts.length, subagent_stop: subStops.length, missing_tool_use_ids: missing,
      first_ow: ow[0] ? `facts.jsonl:${ow[0]._line} ${ow[0].ts} PostToolUse Write agent_id=${ow[0].agent_id} ${ow[0].payload?.tool_input?.file_path}` : null,
    });
    const subWriteSteps = new Set(preWrites.filter((f) => f.agent_id).map((f) => String(f.payload?.tool_input?.file_path).split('/').slice(-2, -1)[0]));
    result.builder_steps_with_write = subWriteSteps.size;
    result.condition_reproduced = subWriteSteps.size >= STEPS;
    result.counts_match = ow.length === tw.total && missing.length === 0;
    result.pass = result.condition_reproduced && result.counts_match;
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
    `[${r.label}] builder steps (subagents) that wrote into artifacts/: ${r.builder_steps_with_write}/${STEPS}`,
    `[${r.label}] output_written facts=${r.output_written}; Write tool_use into artifacts/ in transcripts=${r.write_calls_transcripts}; sync PreToolUse Write=${r.write_pretooluse}; guard denies=${r.guard_denies}; out.md files on disk=${r.files_on_disk}; SubagentStart=${r.subagent_start} SubagentStop=${r.subagent_stop}; transcripts scanned=${r.transcripts_scanned}`,
    r.first_ow && `[${r.label}] e.g. ${r.first_ow}`,
    `[${r.label}] Write tool_use ids with no output_written: ${JSON.stringify(r.missing_tool_use_ids ?? [])}`,
    `[${r.label}] permission prompts: ${(r.prompts ?? []).length}`,
    r.error && `[${r.label}] error: ${String(r.error).split('\n')[0]}`,
  ].filter(Boolean) as string[];
}

async function main(): Promise<void> {
  const runs: any[] = [await runOnce(true)];
  if (!runs[0].pass) runs.push(await runOnce(false));
  killServer();
  const on = runs[0];
  const verdict: Verdict['verdict'] = on.pass ? 'PASS' : on.condition_reproduced && !on.counts_match ? 'FALLBACK' : 'BLOCKED';
  const v: Verdict = {
    spike: SPIKE_NAME,
    verdict,
    evidence: [...ev(on), ...(runs[1] ? ev(runs[1]) : [])],
    notes: verdict === 'PASS' ? 'Async PostToolUse produced one output_written per Write into artifacts/ (joined by tool_use_id) in an interactive session.'
      : verdict === 'FALLBACK' ? 'Counts differ under the sandbox; fallback: make the Write|Edit PostToolUse hook synchronous.'
      : `Condition not reproduced: only ${on.builder_steps_with_write} builder steps wrote into artifacts/ (need ${STEPS}).`,
    runs,
  };
  emit(v);
}

await main();
process.exit(0);
