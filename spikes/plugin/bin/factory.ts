// Fake `factory` CLI for the spikes. It stands in for the reducer with scripted responses
// keyed by state.script. Every call is logged to ~/.factory/spike/cli.jsonl (argv, cwd, ts).
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, realpathSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { FACTORY, INBOX, CLI_LOG, appendLine, now, ulid, readState, writeState } from './common.ts';

const argv = process.argv.slice(2);
const verb = argv[0] ?? '';
const flag = (n: string): string | undefined => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

function print(o: unknown, code = 0): never {
  appendLine(CLI_LOG, { ts: now(), argv, cwd: process.cwd(), realcwd: safeReal(process.cwd()), exit: code, out: o });
  process.stdout.write(JSON.stringify(o, null, 2) + '\n');
  process.exit(code);
}
function safeReal(p: string): string { try { return realpathSync(p); } catch { return p; } }

function repoHash(cwd: string): string {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  return createHash('sha256').update(realpathSync(join(cwd, common))).digest('hex').slice(0, 12);
}

const GATE2_CARD = { type: 'gate_2', title: 'Gate 2 — approve the slice plan', commands: ['/factory approve gate2', '/factory rework gate2 <note>'] };
const CUT_CARD = { type: 'cut', title: 'CUT — budget deadline reached', reason: 'Cut deadline passed with S2 still building', commands: ['/factory cut S2', '/factory keep'] };

async function main(): Promise<void> {
  appendLine(CLI_LOG, { ts: now(), argv, cwd: process.cwd(), realcwd: safeReal(process.cwd()), phase: 'enter' });
  const s = readState();

  if (verb === 'start') {
    const task = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ') || 'task';
    const hash = repoHash(process.cwd());
    const runId = `${task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20).replace(/-$/, '')}-${Math.random().toString(32).slice(2, 6)}`;
    const dir = join(FACTORY, hash, 'runs', runId);
    mkdirSync(dir, { recursive: true });
    const cmds = join(dir, 'commands.jsonl');
    appendLine(cmds, { v: 1, id: ulid(), ts: now(), run: runId, kind: 'run_started', actor: 'cli', corr: null, data: { task, cwd: process.cwd() } });
    print({ run_id: runId, commands_path: cmds, dashboard_url: 'http://127.0.0.1:4870 (spike: not started)' });
  }

  if (verb === 'next') {
    if (!s) print({ error: { code: 'NOT_FOUND', message: 'no spike state' } }, 1);
    const st = s!;
    const waitMs = flag('--wait') ? Number(flag('--wait')) : 0;
    if (st.script === 'stop-nudge') {
      if (st.stage === 'BUILD') {
        st.stage = 'SLICE_PLAN';
        st.open_steps = [{ step_id: 'gate2-ask', kind: 'ask_human', card: GATE2_CARD }];
        writeState(st);
      }
      print({ steps: st.open_steps.map((x) => ({ step_id: x.step_id, kind: x.kind, card: x.card })), in_flight: [], note: 'Print the card verbatim and end your turn; a human decides.' });
    }
    if (st.script === 'wakeup') {
      const deadline = st.deadline_ms ?? 0;
      if (waitMs > 0) {
        const until = Math.min(Date.now() + waitMs, deadline);
        while (Date.now() < until) await sleep(Math.min(250, until - Date.now()));
      }
      if (Date.now() >= deadline) {
        const fresh = readState()!;
        if (!fresh.open_steps.some((x) => x.step_id === 'cut-ask')) {
          fresh.open_steps.push({ step_id: 'cut-ask', kind: 'ask_human', card: CUT_CARD });
          fresh.cut_raised_at = Date.now();
          writeState(fresh);
        }
        print({ steps: [{ step_id: 'cut-ask', kind: 'ask_human', card: CUT_CARD }], in_flight: ['builder-S2'], note: 'Print the card verbatim as the last lines of your turn.' });
      }
      print({ steps: [], in_flight: ['builder-S2'], wait: { retry_after_ms: deadline - Date.now() } });
    }
    print({ steps: [], in_flight: [], done: true });
  }

  if (verb === 'decide') {
    // AD-6: newest unconsumed human_prompt of the calling session + transcript cross-check.
    const session = flag('--session') ?? '';
    const files = existsSync(INBOX) ? readdirSync(INBOX).filter((f) => f.endsWith('.jsonl')) : [];
    const lines = files.flatMap((f) => readFileSync(join(INBOX, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { _bad: l }; } }));
    const hp = lines.filter((l) => l.kind === 'human_prompt' && l.session === session);
    if (!hp.length) print({ error: { code: 'NO_HUMAN_PROMPT', message: `no human_prompt for session ${session}` }, inbox_lines: lines.length }, 1);
    const fact = hp[hp.length - 1];
    const pt = lines.filter((l) => l.kind === 'prompt_text' && l.session === session && l.data?.prompt_id === fact.data?.prompt_id).pop();
    const transcript = fact.data?.transcript_path ?? pt?.data?.transcript_path;
    let match = false;
    if (pt && transcript && existsSync(transcript)) {
      for (const l of readFileSync(transcript, 'utf8').split('\n')) {
        if (!l) continue;
        try {
          const e = JSON.parse(l);
          if (e.type !== 'user' || e.message?.role !== 'user') continue;
          const c = e.message.content;
          const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') : '';
          if (text === pt.data.prompt || text.includes(`<command-args>${fact.data.command_args}</command-args>`) && text.includes(`/${fact.data.command_name}`)) { match = true; break; }
        } catch { /* skip */ }
      }
    }
    const verdict = match ? 'VERIFIED' : 'UNVERIFIED · transcript mismatch';
    print({ consumed: fact.id, command_args: fact.data?.command_args, prompt_text: pt?.data?.prompt ?? null, transcript, verdict });
  }

  print({ error: { code: 'BAD_ARGS', message: `unknown verb ${verb}` } }, 2);
}

main().catch((e) => print({ error: { code: 'BAD_ARGS', message: String(e) } }, 2));
