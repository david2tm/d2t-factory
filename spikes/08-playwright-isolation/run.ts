// Spike 08 — Playwright MCP isolation (AD-22, story 3-3). Reruns spike 04's criterion against
// the plugin's own `.mcp.json` servers (playwright-ux / -a11y / -ui):
//   three parallel sessions on one dev server, no shared cookie or localStorage, separate
//   snapshot refs — and a plugin subagent can call its own server's tools.
// The three sessions are three plugin subagents spawned in parallel by one `claude -p` session,
// exactly as the conductor spawns running-app reviewers. Each agent's `tools:` names only its
// own server. A spike plugin named `d2t-factory` carries a byte copy of the root `.mcp.json`.
// Usage: node spikes/08-playwright-isolation/run.ts   (needs network + ~/.claude: run unsandboxed)
import { createServer, type Server } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { git, SPIKES, WORK } from '../lib/target-repo.ts';
import { emit, EVIDENCE, type Verdict } from '../lib/spike.ts';

const SPIKE_NAME = '08-playwright-isolation';
const ROOT = join(SPIKES, '..');
const ROLES = ['reviewer-ux', 'reviewer-a11y', 'reviewer-ui'] as const;
const SERVER: Record<string, string> = { 'reviewer-ux': 'playwright-ux', 'reviewer-a11y': 'playwright-a11y', 'reviewer-ui': 'playwright-ui' };
const BUTTONS: Record<string, number> = { 'reviewer-ux': 2, 'reviewer-a11y': 3, 'reviewer-ui': 4 };
const PIN = '@playwright/mcp@0.0.83';
// The exact `tools:` form the production running-app reviewers use (TOOLS_FORM=explicit to test the fallback).
const FORM = process.env.TOOLS_FORM ?? 'wildcard';
const EXPLICIT = ['browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_fill_form', 'browser_press_key', 'browser_hover', 'browser_select_option', 'browser_evaluate', 'browser_wait_for', 'browser_take_screenshot', 'browser_console_messages', 'browser_network_requests', 'browser_resize', 'browser_tabs', 'browser_handle_dialog', 'browser_close'];
const prefix = (role: string): string => `mcp__plugin_d2t-factory_${SERVER[role]}__`;
const toolsLine = (role: string): string => `Read, Grep, Glob, Write, ${FORM === 'explicit' ? EXPLICIT.map((t) => prefix(role) + t).join(', ') : prefix(role) + '*'}`;

interface Req { ts: string; url: string; cookie: string }

function page(role: string): string {
  const n = BUTTONS[role] ?? 1;
  const btns = Array.from({ length: n }, (_, i) => `<button onclick="fetch('/click?role=${role}&i=${i + 1}&ls='+encodeURIComponent(Object.keys(localStorage).sort().join(',')))">btn-${role}-${i + 1}</button>`).join('\n');
  return `<!doctype html><html><head><title>spike ${role}</title></head><body><h1>Dev server page for ${role}</h1>\n${btns}\n</body></html>`;
}

// One dev server. `/barrier?step=k&role=r` holds its response until all three roles reached step k
// (or 240 s), so storage reads, snapshots and clicks happen only after every session acted.
async function devServer(): Promise<{ server: Server; port: number; reqs: Req[]; barriers: Record<string, { role: string; ts: string }[]> }> {
  const reqs: Req[] = [];
  const barriers: Record<string, { role: string; ts: string }[]> = {};
  const waiting: Record<string, (() => void)[]> = {};
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    reqs.push({ ts: new Date().toISOString(), url, cookie: req.headers.cookie ?? '' });
    const m = /^\/r\/([\w-]+)/.exec(url);
    if (m) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(m[1])); return; }
    const b = /^\/barrier\?step=(\d+)&role=([\w-]+)/.exec(url);
    if (b) {
      const [, step, role] = b;
      (barriers[step] ??= []).push({ role, ts: new Date().toISOString() });
      const release = (how: string): void => { if (res.writableEnded) return; res.writeHead(200, { 'content-type': 'text/plain' }); res.end(how); };
      const timer = setTimeout(() => release('timeout'), 240_000);
      (waiting[step] ??= []).push(() => { clearTimeout(timer); release('all'); });
      if (new Set(barriers[step].map((x) => x.role)).size >= ROLES.length) for (const w of waiting[step].splice(0)) w();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
  });
  for (let port = 5150; port < 5200; port++) {
    const ok = await new Promise<boolean>((r) => { server.once('error', () => r(false)); server.listen(port, '127.0.0.1', () => r(true)); });
    if (ok) return { server, port, reqs, barriers };
  }
  throw new Error('no free port in 5150-5199');
}

function agent(role: string): string {
  const n = BUTTONS[role];
  return `---
name: ${role}
description: Spike 08 stand-in for the running-app reviewer ${role}. Spike harness only.
model: sonnet
tools: ${toolsLine(role)}
---
You are a stand-in for an infrastructure isolation test. Your prompt gives PORT. Use only your browser tools (names starting with \`${prefix(role)}\`). Do these steps in order, each exactly once, with no extra navigation and no extra snapshot:

1. Note the exact names of every tool you have whose name starts with \`mcp__\`.
2. Navigate to http://127.0.0.1:PORT/r/${role}
3. Evaluate this JavaScript function on the page and keep its result as STORAGE:
   \`async () => { localStorage.setItem('ls_${role}', '${role}'); document.cookie = 'ck_${role}=${role}; path=/'; await fetch('/barrier?step=1&role=${role}'); return JSON.stringify({ ls: Object.keys(localStorage).sort(), ck: document.cookie.split('; ').filter(Boolean).sort() }); }\`
   (It may take up to a few minutes to return: it waits for the other sessions.)
4. Take one accessibility snapshot of the page. Find the ref of the button labelled \`btn-${role}-${n}\`.
5. Evaluate: \`async () => (await fetch('/barrier?step=2&role=${role}')).text()\` (it also waits for the others).
6. Click the button \`btn-${role}-${n}\` using the ref from YOUR step-4 snapshot. Do not take a new snapshot first.

Then reply with exactly three lines:
TOOLS: <comma-separated mcp__ tool names from step 1>
STORAGE: <STORAGE from step 3>
REF: <the ref you clicked>`;
}

function buildPlugin(): string {
  const dir = join(WORK, 'plugin-08');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'd2t-factory', version: '0.0.0-spike08', description: 'Spike 08 instrument: the real .mcp.json plus stand-in reviewers.' }, null, 2));
  copyFileSync(join(ROOT, '.mcp.json'), join(dir, '.mcp.json'));
  for (const r of ROLES) writeFileSync(join(dir, 'agents', `${r}.md`), agent(r));
  return dir;
}

// Outside this repo: a session whose cwd is under the project would also load the root `.mcp.json`
// as a project server (`mcp__playwright-ux__*`) and shadow the plugin's own servers.
function targetRepo(): string {
  const dir = join(tmpdir(), `d2t-factory-spike-${SPIKE_NAME}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), `# spike target ${SPIKE_NAME}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'spike: init');
  return realpathSync(dir);
}

function runClaude(plugin: string, cwd: string, port: number, outFile: string): Promise<number> {
  const prompt = `This is an infrastructure test. In ONE message, spawn these three subagents in parallel with the Agent tool: d2t-factory:reviewer-ux, d2t-factory:reviewer-a11y and d2t-factory:reviewer-ui. Give each the prompt "PORT=${port}". Do nothing else yourself: no browser tools. When all three have replied, print each reply verbatim under a line naming its agent.`;
  const allowed = ROLES.map((r) => `mcp__plugin_d2t-factory_${SERVER[r]}`).join(',');
  const args = ['-p', prompt, '--plugin-dir', plugin, '--model', 'sonnet', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--allowedTools', `Agent,Task,Read,Grep,Glob,${allowed}`];
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => out.push(Buffer.from(`\n[stderr] ${d}`)));
    const kill = setTimeout(() => child.kill('SIGTERM'), 900_000);
    child.on('close', (code) => { clearTimeout(kill); writeFileSync(outFile, Buffer.concat(out)); resolve(code ?? -1); });
  });
}

interface ToolUse { name: string; parent: string | null; input: unknown }

function parseStream(text: string): { uses: ToolUse[]; result: string; mcpServers: unknown; tools: string[] } {
  const uses: ToolUse[] = [];
  let result = '';
  let mcpServers: unknown = null;
  let tools: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init' && mcpServers === null) { mcpServers = ev.mcp_servers; tools = (ev.tools ?? []).filter((t: string) => t.includes('playwright')); }
    if (ev.type === 'assistant') for (const c of ev.message?.content ?? []) if (c.type === 'tool_use') uses.push({ name: c.name, parent: ev.parent_tool_use_id ?? null, input: c.input });
    if (ev.type === 'result') result = String(ev.result ?? '');
  }
  return { uses, result, mcpServers, tools };
}

async function main(): Promise<void> {
  const dir = join(EVIDENCE, SPIKE_NAME);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try { execFileSync('npx', ['-y', PIN, '--version'], { stdio: 'pipe', timeout: 300_000 }); } catch (e) { /* prewarm only */ void e; }
  const plugin = buildPlugin();
  const repo = targetRepo();
  const { server, port, reqs, barriers } = await devServer();
  const streamFile = join(dir, 'claude.stream.jsonl');
  const code = await runClaude(plugin, repo, port, streamFile);
  server.close();
  const { uses, result, mcpServers, tools } = parseStream(readFileSync(streamFile, 'utf8'));
  const agentUses = uses.filter((u) => u.name === 'Agent' || u.name === 'Task');
  const per: Record<string, any> = {};
  for (const role of ROLES) {
    const clicks = reqs.filter((r) => r.url.startsWith(`/click?role=${role}&`));
    const b2 = reqs.filter((r) => r.url.startsWith(`/barrier?step=2&role=${role}`));
    const n = BUTTONS[role];
    const own = prefix(role);
    const mine = uses.filter((u) => u.parent && u.name.startsWith('mcp__') && u.name.includes(SERVER[role] + '__'));
    const parents = new Set(mine.map((u) => u.parent));
    const foreign = uses.filter((u) => u.parent && parents.has(u.parent) && u.name.startsWith('mcp__') && !u.name.startsWith(own));
    const snapshots = mine.filter((u) => u.name === own + 'browser_snapshot').length;
    const clickOk = clicks.length === 1 && clicks[0].url.includes(`&i=${n}&`) && clicks[0].url.includes(`&ls=ls_${role}`) && !clicks[0].url.includes('%2C') && clicks[0].cookie === `ck_${role}=${role}`;
    const cookieAfterAllSet = b2.length === 1 && b2[0].cookie === `ck_${role}=${role}`;
    per[role] = {
      own_tool_calls: mine.map((u) => u.name.slice(own.length)), subagent_parent: [...parents], foreign_tool_calls: foreign.map((u) => u.name), snapshots,
      clicks, clickOk, barrier2_cookie: b2.map((r) => r.cookie), cookieAfterAllSet,
    };
    per[role].pass = mine.length > 0 && parents.size === 1 && foreign.length === 0 && clickOk && cookieAfterAllSet && snapshots === 1;
  }
  const mainBrowser = uses.filter((u) => !u.parent && u.name.startsWith('mcp__'));
  const v: Verdict = {
    spike: SPIKE_NAME,
    verdict: ROLES.every((r) => per[r].pass) && mainBrowser.length === 0 && tools.length > 0 && tools.every((t) => t.startsWith('mcp__plugin_d2t-factory_playwright-')) ? 'PASS' : 'FAIL',
    evidence: [
      `exit=${code} port=${port} tools_form=${FORM} agent_spawns=${agentUses.length}`,
      `init mcp_servers=${JSON.stringify(mcpServers)}`,
      `init playwright tools (${tools.length}): ${tools.filter((t) => t.includes('playwright-ux')).join(', ')}`,
      `barriers=${JSON.stringify(barriers)}`,
      ...ROLES.map((r) => `${r}: ${JSON.stringify(per[r])}`),
      `main-session browser calls=${mainBrowser.length}`,
    ],
    notes: `Final reply:\n${result}`,
    per_role: per,
    dev_server_requests: reqs,
  };
  emit(v);
}

await main();
process.exit(0);
