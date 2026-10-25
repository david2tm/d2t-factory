// Shared helpers for the spike plugin's hook and fake CLI. Node built-ins only.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, basename, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

export const HOME = homedir();
export const FACTORY = join(HOME, '.factory');
export const SPIKE = join(FACTORY, 'spike');
export const FACTS = join(SPIKE, 'facts.jsonl');
export const STATE = join(SPIKE, 'state.json');
export const CLI_LOG = join(SPIKE, 'cli.jsonl');
export const INBOX = join(SPIKE, 'inbox');
export const ERRORS = join(SPIKE, 'hook-errors.log');

export interface Step { step_id: string; kind: 'spawn' | 'resume' | 'ask_human' | 'run_check' | 'enter_worktree'; claimed?: boolean; background?: boolean; card?: unknown }
export interface State {
  run_id: string;
  stage: string;
  bound_all?: boolean; // treat every session as bound (else bound_sessions / resolve)
  stop_block: boolean;
  nudge: boolean;
  guard: boolean;
  capture_prompts: boolean;
  open_steps: Step[];
  run_dir?: string; // absolute; artifacts live at <run_dir>/artifacts/steps/<step_id>/
  script?: string; // which fake-`next` script to follow
  deadline_ms?: number; // epoch ms (wake-up spike)
  [k: string]: unknown;
}

export function ulid(): string {
  // Not a real ULID; time-sortable enough for spike logs.
  return Date.now().toString(36).padStart(10, '0') + randomBytes(8).toString('hex');
}

export function now(): string { return new Date().toISOString(); }

export function readState(): State | null {
  try { return JSON.parse(readFileSync(STATE, 'utf8')) as State; } catch { return null; }
}

export function writeState(s: State): void {
  mkdirSync(SPIKE, { recursive: true });
  const tmp = STATE + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, STATE);
}

export function appendLine(file: string, obj: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(obj) + '\n');
}

// realpath that tolerates not-yet-existing leaves (resolves the nearest existing ancestor).
export function realish(p: string): string {
  let cur = resolve(p.replace(/^~(?=$|\/)/, HOME));
  const rest: string[] = [];
  for (;;) {
    if (existsSync(cur)) {
      try { return join(realpathSync(cur), ...rest.reverse()); } catch { return join(cur, ...rest.reverse()); }
    }
    const parent = dirname(cur);
    if (parent === cur) return join(cur, ...rest.reverse());
    rest.push(basename(cur));
    cur = parent;
  }
}

export function isUnder(p: string, dir: string): boolean {
  const a = realish(p);
  const b = realish(dir);
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}

export function claimedArtifactDirs(s: State): string[] {
  if (!s.run_dir) return [];
  return s.open_steps.filter((x) => x.claimed).map((x) => join(s.run_dir as string, 'artifacts', 'steps', x.step_id));
}

export function mayStop(s: State, backgroundTasks: unknown): { may: boolean; why: string } {
  if (s.stage === 'DONE' || s.stage === 'ABANDONED') return { may: true, why: 'terminal' };
  const bg = Array.isArray(backgroundTasks) ? backgroundTasks : [];
  for (const st of s.open_steps) {
    if (st.kind === 'ask_human') continue;
    if (st.claimed && st.background) continue; // (spike proxy for a d2t-factory:* entry in background_tasks)
    return { may: false, why: `open step ${st.step_id} (${st.kind}) is not ask_human/background; background_tasks=${bg.length}` };
  }
  return { may: true, why: 'all open steps are ask_human or background' };
}
