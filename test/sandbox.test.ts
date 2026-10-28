// Sandbox conformance (AD-35, 8-1): the CLI's real git under whatever sandbox this test runs in.
// Run it once from a sandboxed Claude Code session after every Claude Code upgrade, before the next
// dry run; its first line says which mode ran.
//
// The fixture repo is built with plumbing only (hash-object, update-index --cacheinfo, commit-tree),
// so creating it writes no file the sandbox refuses. It lives in the gitignored test/.sandbox-tmp/,
// under the session cwd, where the sandbox's path rules apply (they don't under $TMPDIR). Its git
// dir is `repo.git`, not `repo/.git`: the sandbox refuses writes to `.git/config` under the cwd, so
// `git init` can't create one there. GIT_CEILING_DIRECTORIES keeps every git command inside the
// fixture: no command may fall back to this repo.
//
// Sandboxed, the four refused tracked files are the worktree's read-only paths; unsandboxed, there
// are none, and everything else passes the same way.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { commitAll, commonDir, isAncestor, mergeInProgress, mergeInto, mergeMessage, repoHash, trackedClean } from '../src/cli/git.ts';
import { integrateTarget, readonlyRefusal } from '../src/cli/next.ts';
import { prepareWorktree, sandboxPreflight } from '../src/cli/worktree.ts';
import { repoDir, worktreePath, worktreesDir } from '../src/store/paths.ts';

const TMP = join(realpathSync(join(import.meta.dirname)), '.sandbox-tmp');
mkdirSync(TMP, { recursive: true });
const dir = mkdtempSync(join(TMP, 'run-'));
process.env.GIT_CEILING_DIRECTORIES = TMP;
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.FACTORY_HOME = join(dir, 'home');

// The mode: can this process write a `.mcp.json` under the session cwd?
function sandboxed(): boolean {
  const probe = join(dir, 'probe');
  mkdirSync(probe);
  try {
    writeFileSync(join(probe, '.mcp.json'), '{}\n');
    return false;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') return true;
    throw e;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
const SANDBOXED = sandboxed();
console.log(`sandbox conformance: ${SANDBOXED ? 'sandboxed' : 'unsandboxed'}`);

const RO = ['.claude/commands/c.md', '.gitmodules', '.mcp.json', '.vscode/settings.json'];
const FILES: Record<string, string> = {
  '.vscode/settings.json': '{ "editor.tabSize": 2 }\n',
  '.mcp.json': '{ "mcpServers": {} }\n',
  '.gitmodules': '',
  '.claude/commands/c.md': '# c\n',
  'src/a.ts': 'export const a = 1;\n',
};

const repo = join(dir, 'repo');
const gitDir = join(dir, 'repo.git');
const index = join(dir, 'plumbing.index');
const g = (cwd: string, args: string[], env: Record<string, string> = {}): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();

// A commit of `parent`'s tree plus `files`, built in a scratch index: no file is written.
function commitFiles(files: Record<string, string>, message: string, parent?: string): string {
  const env = { GIT_INDEX_FILE: index };
  g(repo, parent ? ['read-tree', parent] : ['read-tree', '--empty'], env);
  for (const [p, text] of Object.entries(files)) {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: text, encoding: 'utf8' }).trim();
    g(repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${p}`], env);
  }
  const tree = g(repo, ['write-tree'], env);
  return g(repo, ['commit-tree', tree, '-m', message, ...(parent ? ['-p', parent] : [])]);
}

test('sandbox conformance: the worktree checks out what the sandbox allows, commits and merges back; a refused integration leaves it as it was; the start preflight passes', async (t) => {
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  mkdirSync(repo);
  g(dir, ['init', '-q', '--template=', '-b', 'main', `--separate-git-dir=${gitDir}`, repo]);
  assert.equal(commonDir(repo), realpathSync(gitDir), 'git resolves to the fixture, never to this repo');
  const base = commitFiles(FILES, 'base');
  g(repo, ['update-ref', 'refs/heads/main', base]);
  // The main checkout: the index from HEAD, and each file the sandbox lets this process write.
  g(repo, ['read-tree', 'HEAD']);
  for (const [p, text] of Object.entries(FILES)) {
    try {
      mkdirSync(dirname(join(repo, p)), { recursive: true });
      writeFileSync(join(repo, p), text);
    } catch {
      g(repo, ['update-index', '--skip-worktree', '--', p]);
    }
  }
  assert.ok(trackedClean(repo), 'the main checkout starts clean');
  const expected = SANDBOXED ? RO : [];

  // SCAFFOLD: the real prepareWorktree. Sandboxed, the refused files are its read-only paths.
  const run = 'conform-0001';
  const branch = `factory/${run}`;
  const { path: wt, readonly } = prepareWorktree(repo, run, base, branch);
  assert.equal(wt, worktreePath(repo, run));
  assert.deepEqual(readonly, expected);
  assert.deepEqual(g(wt, ['ls-files', '-v']).split('\n').filter((l) => l.startsWith('S ')).map((l) => l.slice(2)), expected, 'skip-worktree on exactly those');
  for (const p of expected) assert.equal(existsSync(join(wt, p)), false, `${p} is not in the worktree`);
  assert.equal(readFileSync(join(wt, 'src/a.ts'), 'utf8'), FILES['src/a.ts']);
  assert.ok(trackedClean(wt), 'git.worktree_clean passes with the read-only paths present');
  assert.deepEqual(prepareWorktree(repo, run, base, branch), { path: wt, readonly: expected }, 'reuse recomputes them');
  assert.equal(g(repo, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter((l) => l.includes('.claude/worktrees')).length, 0, 'the worktree is not in the main checkout\'s status');

  // BUILD: a source edit and a new file commit; the read-only files stay in the tree, unchanged.
  writeFileSync(join(wt, 'src/a.ts'), 'export const a = 2;\n');
  writeFileSync(join(wt, 'src/b.ts'), 'export const b = 1;\n');
  const built = commitAll(wt, 'factory: build');
  assert.deepEqual(g(wt, ['diff', '--name-only', base, built]).split('\n'), ['src/a.ts', 'src/b.ts']);
  for (const p of RO) assert.equal(g(wt, ['rev-parse', `${built}:${p}`]), g(wt, ['rev-parse', `${base}:${p}`]), `${p} unchanged in the commit's tree`);
  assert.ok(trackedClean(wt));

  // WRAP: a target that changed a read-only path is refused before any merge (sandboxed); otherwise
  // it integrates.
  const status = (): string => g(wt, ['status', '--porcelain=v2', '--untracked-files=all']);
  const target = commitFiles({ '.vscode/settings.json': '{ "editor.tabSize": 4 }\n', 'src/c.ts': 'export const c = 1;\n' }, 'target', base);
  g(repo, ['update-ref', 'refs/heads/target', target]);
  const before = { head: g(wt, ['rev-parse', 'HEAD']), status: status() };
  const opts = { base, target, branch: 'target', runBranch: branch, readonly, integrate: true };
  const problem = integrateTarget(wt, opts);
  if (SANDBOXED) {
    assert.equal(problem, readonlyRefusal(['.vscode/settings.json']));
    assert.equal(problem, "The target changed .vscode/settings.json since the run started, and the sandbox won't let the factory check them out. Merge by hand in your own terminal, or abandon.");
    assert.deepEqual({ head: g(wt, ['rev-parse', 'HEAD']), status: status() }, before, 'no merge attempted: the worktree is unchanged');
    assert.equal(existsSync(join(wt, 'src/c.ts')), false);
  } else {
    assert.equal(problem, null);
    assert.ok(isAncestor(wt, target, 'HEAD'), 'integrated');
  }
  assert.equal(mergeInProgress(wt), false);

  // A target adding a new file in a refused dir: not a read-only path, so the merge is tried.
  // Sandboxed, git writes src/d.ts, fails on the refused file without MERGE_HEAD (spike 09), and
  // the worktree is restored.
  const target2 = commitFiles({ '.vscode/extensions.json': '{}\n', 'src/d.ts': 'export const d = 1;\n' }, 'target 2', base);
  const before2 = { head: g(wt, ['rev-parse', 'HEAD']), status: status() };
  const problem2 = integrateTarget(wt, { ...opts, target: target2, branch: 'target2' });
  if (SANDBOXED && readonly.includes('.vscode/settings.json')) {
    assert.match(problem2 ?? '', /^cannot integrate target2: /);
    assert.deepEqual({ head: g(wt, ['rev-parse', 'HEAD']), status: status() }, before2, 'the failed merge left the worktree as it was');
    assert.equal(existsSync(join(wt, 'src/d.ts')), false, 'the stray file is removed');
    assert.ok(trackedClean(wt));
  } else {
    assert.equal(problem2, null);
  }
  assert.equal(mergeInProgress(wt), false);

  // The final merge, unchanged: --no-ff of the run branch into the main checkout.
  const runHead = g(wt, ['rev-parse', 'HEAD']);
  const m = mergeInto(repo, runHead, mergeMessage(branch, 'conformance'), { noFf: true });
  assert.ok(m.ok, JSON.stringify(m));
  assert.equal(g(repo, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').length, 3, 'a --no-ff merge commit');
  assert.equal(readFileSync(join(repo, 'src/a.ts'), 'utf8'), 'export const a = 2;\n');
  if (SANDBOXED) for (const p of RO) assert.equal(g(repo, ['rev-parse', `HEAD:${p}`]), g(repo, ['rev-parse', `${base}:${p}`]), `${p} unchanged by the merge`);
  assert.ok(trackedClean(repo));

  // The start preflight, under the same sandbox, leaves nothing behind.
  const hash = repoHash(repo);
  await sandboxPreflight(repo, hash);
  assert.deepEqual(readdirSync(worktreesDir(repo)), [`factory-${run}`]);
  assert.equal(existsSync(repoDir(hash)), false, 'the probe removed the dir it created');
});
