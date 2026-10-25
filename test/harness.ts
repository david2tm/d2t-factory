// End-to-end harness for the pipeline tests: a temp FACTORY_HOME and projects dir, a brownfield
// git repo with real package.json scripts, the 1-2 prompt writer (`say`), the CLI (`run`), and the
// 1-3 hooks themselves for agent facts (`agentWrites`, `agentStops`). Not a test file.
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid } from '../src/store/ids.ts';
import { appendLine, readLines } from '../src/store/jsonl.ts';

export const ROOT = join(import.meta.dirname, '..');
export const BIN = join(ROOT, 'bin', 'factory');

export interface World { base: string; home: string; projects: string; agents: string; repo: string; env: Record<string, string> }

export const SECRET = 'hunter2-is-the-secret';

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'demo', private: true, scripts: { start: 'node server.js', test: 'node test.js', health: 'node health.js' } }, null, 2) + '\n',
  'server.js': "require('node:http').createServer((q, r) => r.end(q.url === '/health' ? 'ok' : '<main></main>')).listen(Number(process.env.PORT), '127.0.0.1');\n",
  'health.js': 'fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1));\n',
  'test.js': "console.log('1 passing');\n",
  '.gitignore': '.env\nnode_modules/\n',
};

export function git(cwd: string, ...a: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
}

export function world(): World {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-pipe-')));
  const home = join(base, '.factory');
  mkdirSync(home);
  symlinkSync(process.execPath, join(home, 'node'));
  writeFileSync(join(home, 'plugin-env.json'), '{}\n');
  const projects = join(base, 'projects');
  mkdirSync(join(projects, '-repo'), { recursive: true });
  const agents = join(base, 'agents.json');
  writeFileSync(agents, '[]');
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  for (const [f, text] of Object.entries(FILES)) writeFileSync(join(repo, f), text);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  writeFileSync(join(repo, '.env'), `API_TOKEN=${SECRET}\n`); // gitignored, never committed
  writeFileSync(join(repo, 'notes.txt'), 'untracked before the run\n'); // part of the baseline
  // The CLI and hooks see no global or system git config, so a commit needs the factory's fallback identity.
  // FACTORY_DASHBOARD_OFF: start and resume never spawn a dashboard server here.
  const env = { FACTORY_HOME: home, FACTORY_CLAUDE_PROJECTS: projects, FACTORY_CLAUDE_AGENTS_JSON: agents, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', FACTORY_DASHBOARD_OFF: '1' };
  return { base, home, projects, agents, repo, env };
}

function childEnv(w: World): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...w.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  return env;
}

export interface Out { code: number | null; out: any }

export function run(w: World, args: string[], o: { cwd?: string } = {}): Out {
  const r = spawnSync(BIN, args, { cwd: o.cwd ?? w.repo, env: childEnv(w), encoding: 'utf8' });
  let out: any = r.stderr;
  try { out = JSON.parse(r.stdout); } catch { /* keep stderr */ }
  return { code: r.status, out };
}

export const ok = (r: Out): any => { assert.equal(r.code, 0, JSON.stringify(r.out)); return r.out; };
export const fails = (r: Out, code: string, msg?: RegExp): any => {
  assert.equal(r.code, 1, JSON.stringify(r.out));
  assert.equal(r.out.error?.code, code, JSON.stringify(r.out));
  if (msg) assert.match(r.out.error.message, msg);
  return r.out;
};

let seq = 0;
// The two prompt facts the 1-3 hooks write, plus the matching transcript turn (as in driver.test.ts).
export function say(w: World, session: string, args: string): string {
  const prompt_id = `prompt-${++seq}`;
  const inbox = join(w.home, 'inbox', `${session}.jsonl`);
  const fact = (kind: string, data: object): object => ({ v: 1, id: ulid(), ts: new Date().toISOString(), run: 'inbox', session, kind, actor: 'hook', corr: null, data });
  appendLine(inbox, fact('human_prompt', { prompt_id, command_name: 'd2t-factory:factory', command_args: args }));
  appendLine(inbox, fact('prompt_text', { prompt_id, prompt: `/factory ${args}`.trim() }));
  const content = `<command-message>d2t-factory:factory</command-message>\n<command-name>/d2t-factory:factory</command-name>\n<command-args>${args}</command-args>`;
  const file = join(w.projects, '-repo', `${session}.jsonl`);
  appendFileSync(file, JSON.stringify({ type: 'user', promptId: prompt_id, sessionId: session, turnOrigin: 'human', message: { role: 'user', content } }) + '\n');
  return prompt_id;
}

// A typed decision through `factory decide`.
export function decide(w: World, session: string, args: string, o: { cwd?: string } = {}): Out & { pid: string } {
  const pid = say(w, session, args);
  return { ...run(w, ['decide', '--session', session], o), pid };
}

export function hook(w: World, event: string, payload: object): void {
  const r = spawnSync(BIN, ['hook', event], { cwd: w.repo, env: childEnv(w), encoding: 'utf8', input: JSON.stringify(payload) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', `hook ${event} printed ${r.stdout}`);
}

let tu = 0;
// The agent writes its out.md; the async PostToolUse hook records output_written.
export function agentWrites(w: World, session: string, step: { output_path: string; agent: string }, text: string, agentId: string): void {
  mkdirSync(join(step.output_path, '..'), { recursive: true });
  writeFileSync(step.output_path, text);
  hook(w, 'PostToolUse', { session_id: session, cwd: w.repo, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: step.output_path, content: text }, tool_response: { filePath: step.output_path }, tool_use_id: `tu${++tu}`, agent_id: agentId, agent_type: step.agent });
}

export function agentStops(w: World, session: string, agent: string, agentId: string): void {
  hook(w, 'SubagentStop', { session_id: session, cwd: w.repo, hook_event_name: 'SubagentStop', agent_id: agentId, agent_type: agent, agent_transcript_path: `/t/${agentId}.jsonl`, stop_hook_active: false });
}

// Serves the world's home with a real dashboard server (2-1) on a free port, returns GET /api/board,
// then stops the server.
export async function serveBoard(w: World): Promise<any> {
  const port = await new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = (srv.address() as { port: number }).port; srv.close(() => resolve(p)); });
  });
  writeFileSync(join(w.home, 'plugin-env.json'), JSON.stringify({ v: 1, dashboard_port: port }) + '\n');
  const env = childEnv(w);
  delete env.FACTORY_DASHBOARD_OFF;
  try {
    const r = spawnSync(BIN, ['dashboard', '--session', 'board'], { cwd: w.repo, env, encoding: 'utf8' });
    const out = JSON.parse(r.stdout);
    assert.equal(out.dashboard_url, `http://127.0.0.1:${port}/`, r.stdout);
    return await (await fetch(`${out.dashboard_url}api/board`)).json();
  } finally {
    // Whatever failed above, a server that started is stopped.
    let pid: number | undefined;
    try { pid = JSON.parse(readFileSync(join(w.home, 'dashboard.pid'), 'utf8')).pid; } catch { /* none started */ }
    const alive = (): boolean => { try { process.kill(pid!, 0); return true; } catch { return false; } };
    if (pid) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      for (let i = 0; i < 100 && alive(); i++) await new Promise((res) => setTimeout(res, 20));
    }
  }
}

export function runDir(w: World, runId: string): string {
  const hash = readdirSync(w.home).find((h) => existsSync(join(w.home, h, 'runs', runId)));
  assert.ok(hash, `run ${runId} not found`);
  return join(w.home, hash, 'runs', runId);
}
export const commands = (w: World, runId: string): any[] => readLines<any>(join(runDir(w, runId), 'commands.jsonl')).items;
export const consumed = (w: World, pid: string): string | null => {
  try { return readFileSync(join(w.home, 'inbox', 'consumed', pid, 'reason'), 'utf8').trim(); } catch { return null; }
};

// --- agent outputs -----------------------------------------------------------------------------

const fm = (o: Record<string, unknown>): string => Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');

export const reconOut = (): string => 'STATUS: DONE\n---\norigin: brownfield\nui_surface: true\n---\n# Map\nnode app: `npm start`, `npm test`, `npm run health`.\n';

export const contract = (port: number, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  install: 'true', add: 'npm install --save-exact', start: 'npm start --silent', url: `http://127.0.0.1:${port}`, port,
  test: 'npm test --silent', health: 'npm run health --silent', copy_gitignored: ['.env'], services: [], ...o,
});
export const scaffoldOut = (c: Record<string, unknown>): string => `STATUS: DONE\n---\n${fm(c)}\n---\nThe repo runs as is.\n`;

export function specOut(title: string, assumptions: string[] = ['The footer is on every page']): string {
  const front = { acceptance: [{ id: 'AC-1', check: { kind: 'command', command: 'npm test' } }, { id: 'AC-2', check: { kind: 'page', page: '/ shows the footer' } }], assumptions };
  return `STATUS: DONE\n---\n${fm(front)}\n---\n# ${title}\nAdd a footer to the main page.\n- AC-1 tests pass\n- AC-2 the footer shows\n## Assumptions\n${assumptions.map((a) => `- ${a}`).join('\n')}\n`;
}

// The designer's design.md (3-2): token front matter, the three sections, and an optional question.
export function designOut(o: { mode?: string; assumptions?: string[]; question?: string | null; sections?: string[]; front?: Record<string, unknown> } = {}): string {
  const front = { mode: o.mode ?? 'inherit', colors: { primary: '#1f6feb', surface: '#ffffff', text: '#1f2328' }, typography: { body: '14px/1.5 system-ui' }, assumptions: o.assumptions ?? [], ...o.front };
  const sections = (o.sections ?? ['Components to use', 'States', 'Accessibility floor']).map((h) => `## ${h}\n- ${h.toLowerCase()} as the repo does it`).join('\n');
  const marks = (o.assumptions ?? []).map((a) => `- [ASSUMPTION] ${a}\n`).join(''); // one body mark per assumptions[] item
  return `STATUS: DONE\n---\n${fm(front)}\n---\n${sections}\n${marks}${o.question ? `\n${o.question}` : ''}`;
}
// One ```question block (invent mode).
export const questionBlock = (q = 'Light or dark footer?', a = 'Light', b = 'Dark', def = 'a'): string => `\`\`\`question\nquestion: ${q}\na: ${a}\nb: ${b}\ndefault: ${def}\n\`\`\`\n`;

// --- intake (3-1) ------------------------------------------------------------------------------

// The conductor's intake out.md; `undefined` drops a field.
export function intakeOut(o: Record<string, unknown> = {}): string {
  const front = Object.fromEntries(Object.entries({ limit_min: 120, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] }, ...o }).filter(([, v]) => v !== undefined));
  return `STATUS: DONE\n---\n${fm(front)}\n---\nThe task as agreed.\n`;
}
export const isIntakeChat = (st: any): boolean => st.kind === 'ask_human' && st.card?.type === 'intake' && !st.card.commands.length;
export const isIntakeConfirm = (st: any): boolean => st.kind === 'ask_human' && st.card?.type === 'intake' && st.card.commands.length > 0;

// The conductor's INTAKE: next issues the conversation step; claim it, write the intake out.md, done;
// next then issues the confirm card. `cli` runs bin/factory and returns its JSON (failing otherwise).
export function recordIntake(cli: (args: string[]) => any, session: string, front: Record<string, unknown> = {}): { chat: any; confirm: any } {
  const chat = cli(['next', '--session', session]).steps.find(isIntakeChat);
  assert.ok(chat?.output_path && chat.brief_path, 'an intake conversation step with an output_path and a brief');
  cli(['claim', chat.step_id, '--session', session]);
  writeFileSync(chat.output_path, intakeOut(front));
  assert.equal(cli(['done', chat.step_id, '--session', session]).state, 'reported');
  const confirm = cli(['next', '--session', session]).steps.find(isIntakeConfirm);
  assert.ok(confirm, 'the intake confirm card');
  return { chat, confirm };
}

export const builderOut = (summary: string, notes = ''): string => `STATUS: DONE\n---\nsummary: ${JSON.stringify(summary)}\n---\n${notes}`;
export const approveOut = (): string => 'VERDICT: APPROVE\nThe slice does what its criteria say.\n';
export const findingsOut = (...scenarios: string[]): string =>
  `VERDICT: FINDINGS\n${scenarios.map((x, i) => `\n\`\`\`finding\ncategory: Bug\nlocation: footer.js:${i + 1}\nfailure_scenario: ${x}\n\`\`\`\n`).join('')}`;

// --- the slicer (3-3) --------------------------------------------------------------------------

export interface PlanSlice { id: string; title: string; acs: string[]; tags?: string[]; depends_on?: string[] }
// The slicer's out.md: `slices` as one single-line JSON list, then a short rationale. By default one
// slice S1 named after the harness task, with both of specOut's criteria and no tags.
export function slicerOut(slices: PlanSlice[] = [{ id: 'S1', title: 'add a footer', acs: ['AC-1', 'AC-2'] }], why = 'One slice: the footer is one change.'): string {
  const list = slices.map((x) => ({ id: x.id, title: x.title, acs: x.acs, tags: x.tags ?? [], depends_on: x.depends_on ?? [] }));
  return `STATUS: DONE\n---\nslices: ${JSON.stringify(list)}\n---\n${why}\n`;
}
