// The plugin's running-app reviewer wiring (3-3): .mcp.json declares one Playwright server per
// running-app reviewer, with distinct args (identical servers are deduplicated, spike 08), and each
// reviewer's tools: line names only its own server's tools, never the code- or file-running ones.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { APP_REVIEWERS, appReviewerTools, playwrightServer } from '../src/core/roster.ts';
import { playwrightDir } from '../src/store/paths.ts';

const ROOT = join(import.meta.dirname, '..');
const toolsOf = (role: string): string[] => {
  const line = /^tools:\s*(.*)$/m.exec(readFileSync(join(ROOT, 'agents', `${role}.md`), 'utf8'))?.[1] ?? '';
  return line.split(',').map((x) => x.trim()).filter(Boolean);
};

test('.mcp.json: one server per running-app reviewer, each with its own args', () => {
  const servers = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8')).mcpServers as Record<string, { command: string; args: string[] }>;
  assert.deepEqual(Object.keys(servers).sort(), APP_REVIEWERS.map(playwrightServer).sort());
  const args = Object.values(servers).map((x) => JSON.stringify([x.command, ...x.args]));
  assert.equal(new Set(args).size, args.length, 'distinct args');
  for (const x of Object.values(servers)) assert.ok(x.args.some((a) => /^@playwright\/mcp@\d+\.\d+\.\d+$/.test(a)) && x.args.includes('--isolated'), JSON.stringify(x));
});

test("each running-app reviewer's tools: its own server's tools only, without browser_run_code_unsafe or browser_file_upload; no other agent gets a browser", () => {
  for (const role of APP_REVIEWERS) {
    const mcp = toolsOf(role).filter((t) => t.startsWith('mcp__'));
    assert.deepEqual(mcp, appReviewerTools(role), role);
    assert.ok(mcp.every((t) => t.startsWith(`mcp__plugin_d2t-factory_${playwrightServer(role)}__`) && !t.includes('*')), role);
    assert.ok(!mcp.some((t) => /browser_run_code_unsafe|browser_file_upload/.test(t)), role);
  }
  for (const f of readdirSync(join(ROOT, 'agents'))) {
    const role = f.replace(/\.md$/, '');
    if (!(APP_REVIEWERS as readonly string[]).includes(role)) assert.deepEqual(toolsOf(role).filter((t) => t.startsWith('mcp__')), [], role);
  }
});

test("screenshots (dry run 1): each server's --output-dir is playwrightDir(role) under HOME, file access stays restricted, and each running-app reviewer saves by the brief's absolute path", () => {
  const servers = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8')).mcpServers as Record<string, { args: string[] }>;
  for (const role of APP_REVIEWERS) {
    const args = servers[playwrightServer(role)].args;
    const dir = args[args.indexOf('--output-dir') + 1];
    assert.equal(dir, `\${HOME}/.factory/playwright/${role}`, role);
    assert.equal(playwrightDir(role), join(homedir(), '.factory', 'playwright', role));
    assert.ok(!args.includes('--allow-unrestricted-file-access'), role);
    const md = readFileSync(join(ROOT, 'agents', `${role}.md`), 'utf8');
    assert.match(md, /Always pass that whole absolute path as the screenshot's filename, never a bare name/, role);
  }
});
