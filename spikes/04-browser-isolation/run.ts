// Spike 04 — Browser isolation (AD-22).
// Passes when: three parallel reviewer sessions run on one dev server. A cookie or
// localStorage value set in one isn't visible in the others, and simultaneous snapshots
// keep separate refs.
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pane, killServer, hasPermissionPrompt, excerptPrompt } from '../lib/tmux.ts';
import { createTargetRepo, SPIKES } from '../lib/target-repo.ts';
import { claudeArgs, resetSpike, baseState, readFacts, archive, emit, factRef, type Verdict } from '../lib/spike.ts';

const SPIKE_NAME = '04-browser-isolation';
const ROLES = ['reviewer-ux', 'reviewer-a11y', 'reviewer-ui'];
const BUTTONS: Record<string, number> = { 'reviewer-ux': 2, 'reviewer-a11y': 3, 'reviewer-ui': 4 };
const CONFIGURED = JSON.stringify({ sandbox: { filesystem: { allowWrite: ['~/.factory', '~/.npm', '~/.agent-browser'] } } });
const SCRIPT = join(SPIKES, '04-browser-isolation', 'reviewer.sh');

interface Req { ts: string; method: string; url: string; cookie: string }

function page(role: string): string {
  const n = BUTTONS[role] ?? 1;
  const btns = Array.from({ length: n }, (_, i) => `<button onclick="fetch('/click?role=${role}&i=${i + 1}&ls='+encodeURIComponent(Object.keys(localStorage).sort().join(',')))">btn-${role}-${i + 1}</button>`).join('\n');
  return `<!doctype html><html><head><title>spike ${role}</title></head><body><h1>Dev server page for ${role}</h1>\n${btns}\n</body></html>`;
}

async function devServer(): Promise<{ server: Server; port: number; reqs: Req[] }> {
  const reqs: Req[] = [];
  const server = createServer((req, res) => {
    reqs.push({ ts: new Date().toISOString(), method: req.method ?? '', url: req.url ?? '', cookie: req.headers.cookie ?? '' });
    const m = /^\/r\/([\w-]+)/.exec(req.url ?? '');
    if (m) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(m[1])); return; }
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
  });
  for (let port = 5150; port < 5200; port++) {
    const ok = await new Promise<boolean>((r) => { server.once('error', () => r(false)); server.listen(port, '127.0.0.1', () => r(true)); });
    if (ok) return { server, port, reqs };
  }
  throw new Error('no free port in 5150-5199');
}

// extraSettings: diagnostic only — a per-session --settings layer (never written to ~/.claude/settings.json).
async function runOnce(sandbox: boolean, extraSettings?: string): Promise<any> {
  const label = extraSettings ? 'sandbox-on-configured' : sandbox ? 'sandbox-on' : 'sandbox-off';
  resetSpike(baseState({ bound_all: true }));
  const { server, port, reqs } = await devServer();
  const repo = createTargetRepo(`${SPIKE_NAME}-${label}`);
  const outdir = join(repo, 'out');
  mkdirSync(outdir, { recursive: true });
  const panes: Pane[] = [];
  const result: any = { label, sandbox, port, extraSettings };
  try {
    for (const role of ROLES) {
      panes.push(await Pane.start({ name: `s04-${label}-${role}`, cwd: repo, claudeArgs: claudeArgs('haiku', { sandbox, extra: [...(extraSettings ? ['--settings', extraSettings] : []), '--allowedTools', `Bash(bash ${SCRIPT}:*)`, `Bash(bash ${SCRIPT} *)`] }) }));
    }
    const barrier = Math.floor(Date.now() / 1000) + 90;
    result.barrier_epoch = barrier;
    for (const [i, role] of ROLES.entries()) {
      await panes[i].type(`Run exactly this Bash command once, in the foreground, with timeout 300000 ms, then reply DONE. Do not retry it, do not modify it, and do not disable the sandbox: bash ${SCRIPT} ${role} ${port} ${barrier} ${outdir}`);
    }
    // Wait for all reviewers to finish; approve (and record) any permission prompt so the run completes.
    const deadline = Date.now() + (barrier * 1000 - Date.now()) + 240_000;
    const approved: string[] = [];
    while (Date.now() < deadline) {
      const done = ROLES.map((r) => existsSync(join(outdir, `${r}.log`)) && /\bdone$/m.test(readFileSync(join(outdir, `${r}.log`), 'utf8')));
      if (done.every(Boolean)) break;
      for (const p of panes) {
        const cap = p.capture();
        if (hasPermissionPrompt(cap)) { p.snap('permission-prompt'); approved.push(`${p.name}: ${excerptPrompt(cap).slice(0, 220)}`); p.keys('Enter'); await sleep(1500); }
      }
      await sleep(1000);
    }
    await sleep(5000);
    for (const p of panes) p.snap('end');
    result.approved_prompts = approved;

    const per: any = {};
    for (const role of ROLES) {
      const log = existsSync(join(outdir, `${role}.log`)) ? readFileSync(join(outdir, `${role}.log`), 'utf8') : '';
      const snap = existsSync(join(outdir, `${role}.snapshot.txt`)) ? readFileSync(join(outdir, `${role}.snapshot.txt`), 'utf8') : '';
      const storRaw = existsSync(join(outdir, `${role}.storage.json`)) ? readFileSync(join(outdir, `${role}.storage.json`), 'utf8').trim() : '';
      let stor: any = null;
      try { stor = JSON.parse(JSON.parse(storRaw)); } catch { try { stor = JSON.parse(storRaw); } catch { stor = null; } }
      const clicks = reqs.filter((r) => r.url.startsWith(`/click?role=${role}&`));
      const pageReqs = reqs.filter((r) => r.url === `/r/${role}`);
      const barrierLine = /^(\S+) barrier reached/m.exec(log)?.[1] ?? null;
      const n = BUTTONS[role];
      const isolatedStorage = Boolean(stor && JSON.stringify(stor.ls) === JSON.stringify([`ls_${role}`]) && JSON.stringify(stor.ck) === JSON.stringify([`ck_${role}=${role}`]));
      const clickOk = clicks.length === 1 && clicks[0].url.includes(`&i=${n}&`) && clicks[0].cookie === `ck_${role}=${role}`;
      per[role] = {
        completed: /\bdone$/m.test(log), barrier_at: barrierLine, storage: stor, storage_raw: storRaw.slice(0, 300), isolatedStorage,
        snapshot_refs: (snap.match(/btn-[\w-]+".*?(ref=e\d+|@e\d+)/g) ?? []).slice(0, 6), clicks, clickOk, page_cookie_headers: pageReqs.map((r) => r.cookie),
        log_tail: log.split('\n').filter((l) => /rc=[1-9]|error|Error|denied|not permitted|EPERM/i.test(l)).slice(0, 6),
      };
    }
    result.per_role = per;
    const facts = readFacts();
    result.bash_facts = facts.filter((f) => f.event === 'PreToolUse' && f.tool_name === 'Bash').map((f) => factRef(f, `dangerouslyDisableSandbox=${f.payload?.tool_input?.dangerouslyDisableSandbox ?? false}`));
    result.dev_server_requests = reqs.length;
    result.pass = ROLES.every((r) => per[r].completed && per[r].isolatedStorage && per[r].clickOk);
  } catch (e) {
    result.error = String((e as Error).stack ?? e);
    result.pass = false;
  } finally {
    for (const p of panes) p.kill();
    server.close();
    await sleep(1500);
    result.archive = archive(SPIKE_NAME, label, panes, { 'dev-server-requests.json': reqs, 'reviewer-out': '' });
  }
  return result;
}

function evidenceOf(r: any): string[] {
  const ev: string[] = [];
  for (const role of ROLES) {
    const p = r.per_role?.[role];
    if (!p) continue;
    ev.push(`[${r.label}] ${role}: completed=${p.completed} barrier_at=${p.barrier_at} storage=${p.storage ? JSON.stringify(p.storage) : JSON.stringify(p.storage_raw)} click=${p.clicks.map((c: Req) => `${c.url} cookie="${c.cookie}"`).join(';') || 'none'} refs=${p.snapshot_refs.join(' | ')}${p.log_tail.length ? ' errors=' + JSON.stringify(p.log_tail) : ''}`);
  }
  for (const b of (r.bash_facts ?? []).slice(0, 3)) ev.push(`[${r.label}] ${b}`);
  for (const a of r.approved_prompts ?? []) ev.push(`[${r.label}] permission prompt (approved by harness): ${a}`);
  if (r.error) ev.push(`[${r.label}] error: ${r.error.split('\n')[0]}`);
  return ev;
}

async function main(): Promise<void> {
  const runs: any[] = [await runOnce(true)];
  if (!runs[0].pass) runs.push(await runOnce(false));
  // Diagnostic: sandbox on, plus the paths npx/agent-browser write to, to show whether setup could fix it.
  if (!runs[0].pass) runs.push(await runOnce(true, CONFIGURED));
  killServer();
  const on = runs[0];
  const off = runs[1];
  let verdict: Verdict['verdict'] = on.pass ? 'PASS' : 'FALLBACK';
  const notes: string[] = [];
  if (!on.pass && off?.pass) notes.push('Isolation holds with the sandbox off; the sandbox-on failure is caused by the sandbox (see errors). Under the sandbox the build-on default does not run, so the Playwright MCP fallback is adopted. Its own check was not run: Playwright MCP is not installed.');
  if (!on.pass && !off?.pass) notes.push('Isolation criterion missed with the sandbox both on and off; Playwright MCP (one isolated context per reviewer) is the fallback. The fallback check was not run here: Playwright MCP is not installed.');
  if (on.pass) notes.push('All three reviewer sessions isolated; clicks used each session\'s own snapshot ref after all snapshots were taken.');
  const diag = runs[2];
  if (diag) notes.push(`Diagnostic (sandbox on + per-session allowWrite ~/.npm, ~/.agent-browser): pass=${diag.pass}; prompts approved=${JSON.stringify(diag.approved_prompts)}.`);
  const v: Verdict = { spike: SPIKE_NAME, verdict, evidence: [...evidenceOf(on), ...(off ? evidenceOf(off) : []), ...(diag ? evidenceOf(diag) : [])], notes: notes.join(' '), runs };
  emit(v);
}

await main();
process.exit(0);
