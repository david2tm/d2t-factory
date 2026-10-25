// The only module that resolves paths. Nothing writes under ${CLAUDE_PLUGIN_ROOT}.
// FACTORY_HOME, FACTORY_CLAUDE_SETTINGS, FACTORY_CLAUDE_PROJECTS and FACTORY_DASHBOARD_DIST exist so tests can point at temp dirs.
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

export const factoryHome = (): string => process.env.FACTORY_HOME || join(homedir(), '.factory');
export const claudeSettingsFile = (): string => process.env.FACTORY_CLAUDE_SETTINGS || join(homedir(), '.claude', 'settings.json');
export const claudeProjectsDir = (): string => process.env.FACTORY_CLAUDE_PROJECTS || join(homedir(), '.claude', 'projects');
// Transcript candidate `<projects>/<project>/<session>.jsonl` (AD-6).
export const projectTranscript = (project: string, session: string): string => join(claudeProjectsDir(), project, `${session}.jsonl`);
// Test-only: a JSON file that stands in for `claude agents --json`. Null means run the real command.
export const claudeAgentsFile = (): string | null => process.env.FACTORY_CLAUDE_AGENTS_JSON || null;

export const nodeLink = (): string => join(factoryHome(), 'node');
export const pluginEnvFile = (): string => join(factoryHome(), 'plugin-env.json');
export const hookErrorsLog = (): string => join(factoryHome(), 'hook-errors.log');
export const sessionsDir = (): string => join(factoryHome(), 'sessions');
export const sessionFile = (session: string): string => join(sessionsDir(), `${session}.json`);
export const inboxDir = (): string => join(factoryHome(), 'inbox');
export const inboxFile = (session: string): string => join(inboxDir(), `${session}.jsonl`);
export const consumedDir = (promptId: string): string => join(inboxDir(), 'consumed', promptId);
export const consumedReasonFile = (promptId: string): string => join(consumedDir(promptId), 'reason');
export const recordingsDir = (): string => join(factoryHome(), 'recordings');
// One recording (AD-18): manifest.json, runs/<repo-hash>/<run-id>/… and transcripts/<session>[-<agent>].jsonl.
export const recordingDir = (name: string): string => join(recordingsDir(), name);
export const recordingManifest = (name: string): string => join(recordingDir(name), 'manifest.json');
export const recordingRunDir = (name: string, repoHash: string, runId: string): string => join(recordingDir(name), 'runs', repoHash, runId);
// A recorded run mirrors the live run dir's layout (4-1 replay reads it through loadRunFiles).
export const recordingCommandsFile = (name: string, repoHash: string, runId: string): string => join(recordingRunDir(name, repoHash, runId), 'commands.jsonl');
export const recordingFactsDir = (name: string, repoHash: string, runId: string): string => join(recordingRunDir(name, repoHash, runId), 'facts');
export const recordingTranscript = (name: string, session: string, agentId?: string): string =>
  join(recordingDir(name), 'transcripts', `${session}${agentId ? `-${agentId}` : ''}.jsonl`);
// Read only: the plugin's own manifest, for its version.
export const pluginManifestFile = (): string => join(import.meta.dirname, '..', '..', '.claude-plugin', 'plugin.json');

// The dashboard (AD-16): its pid file and log, and the cache only the server opens, all under the
// factory home; the server entry the CLI spawns by path, and the committed SPA build (read only).
export const dashboardPidFile = (): string => join(factoryHome(), 'dashboard.pid');
export const dashboardLog = (): string => join(factoryHome(), 'dashboard.log');
export const cacheDb = (): string => join(factoryHome(), 'cache.sqlite');
export const dashboardServerEntry = (): string => join(import.meta.dirname, '..', 'dashboard', 'server', 'main.ts');
export const dashboardDistDir = (): string => process.env.FACTORY_DASHBOARD_DIST || join(import.meta.dirname, '..', '..', 'dashboard', 'dist');

export const repoDir = (repoHash: string): string => join(factoryHome(), repoHash);
export const runsDir = (repoHash: string): string => join(repoDir(repoHash), 'runs');
export const runDir = (repoHash: string, runId: string): string => join(runsDir(repoHash), runId);
export const commandsFile = (repoHash: string, runId: string): string => join(runDir(repoHash, runId), 'commands.jsonl');
export const factsDir = (repoHash: string, runId: string): string => join(runDir(repoHash, runId), 'facts');
export const factsFile = (repoHash: string, runId: string, session: string, agentId: string | null): string =>
  join(factsDir(repoHash, runId), `${session}-${agentId ?? 'main'}.jsonl`);
export const artifactsDir = (repoHash: string, runId: string): string => join(runDir(repoHash, runId), 'artifacts');
export const stepDir = (repoHash: string, runId: string, stepId: string): string => join(artifactsDir(repoHash, runId), 'steps', stepId);
// Values the CLI must never let into a fact or recording (AD-14); mode 0600, never recorded.
export const redactFile = (repoHash: string, runId: string): string => join(runDir(repoHash, runId), 'redact.json');
export const lockDir = (repoHash: string, runId: string): string => join(runDir(repoHash, runId), 'lock');
// The one-run-per-repo claim (AD-15): `mkdir <repo-hash>/exclusive`, with the owning run id inside.
export const exclusiveDir = (repoHash: string): string => join(repoDir(repoHash), 'exclusive');
export const exclusiveOwnerFile = (repoHash: string): string => join(exclusiveDir(repoHash), 'run');
export const reconFile = (repoHash: string, baseSha: string): string => join(repoDir(repoHash), 'recon', `${baseSha}.md`);
// One step's files (AD-10): the CLI-written brief and the agent's (or check's) output.
export const briefFile = (repoHash: string, runId: string, stepId: string): string => join(stepDir(repoHash, runId, stepId), 'brief.md');
export const outFile = (repoHash: string, runId: string, stepId: string): string => join(stepDir(repoHash, runId, stepId), 'out.md');
// The run's dev server (AD-20): pid file and log.
export const devserverPid = (repoHash: string, runId: string): string => join(runDir(repoHash, runId), 'devserver.pid');
export const devserverLog = (repoHash: string, runId: string): string => join(runDir(repoHash, runId), 'devserver.log');

// Machine-wide port claims (AD-20): `mkdir ports/<n>`, with the owning run id inside.
export const portsDir = (): string => join(factoryHome(), 'ports');
export const portDir = (n: number): string => join(portsDir(), String(n));
export const portOwnerFile = (n: number): string => join(portDir(n), 'run');

// The git worktree lives in the target repo (AD-15); factory artifacts stay under factoryHome (AD-10).
export const worktreesDir = (repoRoot: string): string => join(repoRoot, '.claude', 'worktrees');
export const worktreePath = (repoRoot: string, runId: string): string => join(worktreesDir(repoRoot), `factory-${runId}`);
// The pattern that keeps worktrees out of the main checkout's status, and the file it goes in.
export const WORKTREES_EXCLUDE = '.claude/worktrees/';
export const gitExcludeFile = (gitCommonDir: string): string => join(gitCommonDir, 'info', 'exclude');
// A run-contract path relative to a checkout root.
export const inCheckout = (root: string, rel: string): string => join(root, rel);

// --- resolving user-supplied paths (AD-31) ---------------------------------------------------

const expandHome = (p: string): string => p.replace(/^~(?=$|\/)/, homedir());

// A path's real location without needing it to exist: the realpath of its deepest existing
// ancestor plus the missing tail. A symlink is followed with readlink even when its target is
// missing, so a dangling link into a protected dir resolves into it. Never purely lexical.
export function realish(p: string, cwd: string = process.cwd()): string {
  let cur = resolve(cwd, expandHome(p));
  for (let hops = 0; hops < 40; hops++) {
    const tail: string[] = [];
    let at = cur;
    for (;;) {
      let link = false;
      let found = true;
      try { link = lstatSync(at).isSymbolicLink(); } catch { found = false; }
      if (found) {
        try { return join(realpathSync(at), ...tail); } catch { /* a dangling or looping link */ }
        if (!link) return join(at, ...tail);
        const target = readlinkSync(at);
        cur = join(isAbsolute(target) ? target : join(dirname(at), target), ...tail);
        break;
      }
      const parent = dirname(at);
      if (parent === at) return join(at, ...tail);
      tail.unshift(basename(at));
      at = parent;
    }
  }
  return cur;
}

// macOS volumes are case-insensitive by default, so both sides are case-folded there.
const fold = (p: string): string => (process.platform === 'darwin' ? p.toLowerCase() : p);

// Is `p` (already resolved) `dir` itself or inside it?
export function isUnder(p: string, dir: string): boolean {
  const a = fold(p);
  const b = fold(dir.endsWith(sep) ? dir.slice(0, -1) : dir);
  return a === b || a.startsWith(b + sep);
}
