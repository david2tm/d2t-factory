// Shared spike-runner helpers: state reset, facts reading, claude args, evidence capture.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SPIKES, WORK } from './target-repo.ts';
import { Pane } from './tmux.ts';
import { SPIKE, FACTS, CLI_LOG, writeState, type State } from '../plugin/bin/common.ts';

export const PLUGIN = join(SPIKES, 'plugin');
export const EVIDENCE = join(WORK, 'evidence');
export { SPIKE, FACTS, CLI_LOG };

export type VerdictKind = 'PASS' | 'FALLBACK' | 'FAIL — no fallback' | 'FAIL' | 'BLOCKED';
export interface Verdict { spike: string; verdict: VerdictKind; evidence: string[]; notes: string; runs?: unknown[]; [k: string]: unknown }

export const SANDBOX_OFF = '{"sandbox":{"enabled":false}}';

export function claudeArgs(model: string, opts: { sandbox: boolean; extra?: string[] }): string[] {
  const a = ['--permission-mode', 'default', '--plugin-dir', PLUGIN, '--model', model];
  if (!opts.sandbox) a.push('--settings', SANDBOX_OFF);
  return a.concat(opts.extra ?? []);
}

export function baseState(over: Partial<State> = {}): State {
  return { run_id: 'spike-run-0000', stage: 'BUILD', bound_all: true, stop_block: false, nudge: false, guard: false, capture_prompts: false, open_steps: [], ...over };
}

// Fresh ~/.factory/spike for a spike run (the previous run's data was already archived).
export function resetSpike(state: State): void {
  rmSync(SPIKE, { recursive: true, force: true });
  mkdirSync(SPIKE, { recursive: true });
  writeState(state);
}

export interface Fact { ts: string; event: string; fact_kind: string | null; session_id: string | null; agent_id: string | null; agent_type: string | null; tool_name: string | null; answer: any; note: string; payload: any; _line: number }

export function readFacts(): Fact[] {
  if (!existsSync(FACTS)) return [];
  return readFileSync(FACTS, 'utf8').split('\n').filter(Boolean).map((l, i) => ({ ...JSON.parse(l), _line: i + 1 }));
}

export function readCli(): any[] {
  if (!existsSync(CLI_LOG)) return [];
  return readFileSync(CLI_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function factRef(f: Fact, extra = ''): string {
  const bits = [f.event, f.tool_name, f.payload?.source, f.agent_type].filter(Boolean).join(' ');
  const ans = f.answer ? ` → ${JSON.stringify(f.answer).slice(0, 220)}` : '';
  return `facts.jsonl:${f._line} ${f.ts} ${bits}${ans}${extra ? ' ' + extra : ''}`;
}

// Archive ~/.factory/spike and pane captures under spikes/.work/evidence/<spike>/<label>/.
export function archive(spike: string, label: string, panes: Pane[], extra: Record<string, unknown> = {}): string {
  const dir = join(EVIDENCE, spike, label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (existsSync(SPIKE)) cpSync(SPIKE, join(dir, 'factory-spike'), { recursive: true });
  for (const p of panes) {
    writeFileSync(join(dir, `pane-${p.name}.log`), p.log.map((e) => `===== T+${(e.t / 1000).toFixed(1)}s [${e.label}] =====\n${e.capture}`).join('\n'));
    writeFileSync(join(dir, `prompts-${p.name}.json`), JSON.stringify(p.promptsSeen, null, 2));
  }
  for (const [k, v] of Object.entries(extra)) writeFileSync(join(dir, k), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  return dir;
}

export function emit(v: Verdict): void {
  const dir = join(EVIDENCE, v.spike);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'verdict.json'), JSON.stringify(v, null, 2));
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
}

export function sessionIds(facts: Fact[]): string[] {
  return [...new Set(facts.filter((f) => f.event === 'SessionStart').map((f) => f.session_id as string))];
}

export function lastSessionId(facts: Fact[]): string | null {
  const ss = facts.filter((f) => f.event === 'SessionStart');
  return ss.length ? (ss[ss.length - 1].session_id as string) : null;
}

export function listDir(d: string): string[] { try { return readdirSync(d); } catch { return []; } }

export function excerpt(s: string, n = 300): string { return s.replace(/\s+/g, ' ').trim().slice(0, n); }

export const argvFlag = (n: string): boolean => process.argv.includes(n);

// Wait until a fact matching `pred` appears (polls facts.jsonl).
export async function waitFact(pred: (f: Fact) => boolean, timeoutMs: number, from = 0): Promise<Fact | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = readFacts().slice(from).find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export function factCount(): number { return readFacts().length; }

export function patchState(fn: (s: State) => void): void {
  const s = JSON.parse(readFileSync(join(SPIKE, 'state.json'), 'utf8')) as State;
  fn(s);
  writeState(s);
}
