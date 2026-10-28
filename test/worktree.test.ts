import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { FactoryError, sandboxDenied } from '../src/core/errors.ts';
import { changedReadonly, gitOrThrow, mergeInProgress, mergeInto, mergeMessage, restoreAfterFailedMerge, skippedPaths, trackedClean, worktreeAdd, type GitRun } from '../src/cli/git.ts';
import { integrateTarget, readonlyRefusal } from '../src/cli/next.ts';
import { copyGitignored, prepareWorktree, sandboxPreflight, secretValues } from '../src/cli/worktree.ts';

test('copyGitignored refuses absolute, escaping, missing and not-ignored paths, and copies nothing then', () => {
  const root = mkdtempSync(join(tmpdir(), 'factory-copy-'));
  const wt = join(root, 'wt');
  mkdirSync(wt);
  writeFileSync(join(root, '.env'), 'A=secret-value\n');
  writeFileSync(join(root, 'app.js'), 'x\n');
  const ignored = (_root: string, rel: string): boolean => rel === '.env';
  const err = (files: string[]): string => { const r = copyGitignored(root, wt, files, ignored); assert.equal(r.ok, false); return (r as { error: string }).error; };
  assert.match(err(['/etc/passwd']), /is not a path inside the repo/);
  assert.match(err(['../outside']), /is not a path inside the repo/);
  assert.match(err(['a/../../x']), /is not a path inside the repo/);
  assert.match(err(['.env.local']), /is not a file in the main checkout/);
  assert.match(err(['.env', 'app.js']), /app\.js is not ignored by git/);
  assert.deepEqual(copyGitignored(root, wt, ['.env'], ignored), { ok: true, copied: ['.env'], values: ['secret-value'] });
});

test('secretValues skips short values, numbers and booleans', () => {
  assert.deepEqual(secretValues('# c\nA=abc\nB=1234\nC=3.14\nD=true\nE=FALSE\nexport F="quoted-secret"\nG: localhost\nloose line\n'), ['quoted-secret', 'localhost', 'loose line']);
});

// --- the human-approved merge's message (deferred 1-5) -------------------------------------------

function hookedRepo(hook: string): { repo: string; sha: string } {
  const repo = mkdtempSync(join(tmpdir(), 'factory-merge-'));
  const g = (...a: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'core.hooksPath', join(repo, '.git', 'hooks'));
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  g('add', '.');
  g('commit', '-q', '-m', 'chore: init');
  g('checkout', '-q', '-b', 'factory/run-1');
  writeFileSync(join(repo, 'b.txt'), 'b\n');
  g('add', '.');
  g('commit', '-q', '-m', 'feat: b');
  const sha = g('rev-parse', 'HEAD').trim();
  g('checkout', '-q', 'main');
  mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(repo, '.git', 'hooks', 'commit-msg'), hook);
  chmodSync(join(repo, '.git', 'hooks', 'commit-msg'), 0o755);
  return { repo, sha };
}

// commitlint's config-conventional, roughly: a conventional subject, or its default merge ignore.
const COMMITLINT = `#!/bin/sh
subject=$(head -n1 "$1")
echo "$subject" | grep -Eq '^Merge branch .*' && exit 0
echo "$subject" | grep -Eq '^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\\(.+\\))?!?: .+' && exit 0
echo "commitlint: subject may not be empty, type may not be empty: $subject" >&2
exit 1
`;

test('merge message: git\'s default "Merge branch \'factory/<run>\'" with the task in the body passes a commitlint commit-msg hook, hooks on', () => {
  const { repo, sha } = hookedRepo(COMMITLINT);
  assert.equal(mergeMessage('factory/run-1', 'add a footer'), "Merge branch 'factory/run-1'\n\nadd a footer");
  assert.equal(mergeMessage('factory/run-1', null), "Merge branch 'factory/run-1'");
  // The hook does run: the old subject is rejected.
  const old = mergeInto(repo, sha, 'factory: merge factory/run-1 (add a footer)', { noFf: true });
  assert.equal(old.ok, false);
  const m = mergeInto(repo, sha, mergeMessage('factory/run-1', 'add a footer'), { noFf: true });
  assert.ok(m.ok, JSON.stringify(m));
  const log = execFileSync('git', ['log', '-1', '--format=%s%n%n%b%n%P'], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(log.slice(0, 3), ["Merge branch 'factory/run-1'", '', 'add a footer']);
  assert.equal(log.at(-1)!.split(' ').length, 2, 'a --no-ff merge commit');
});

test('merge message: a commit-msg hook that rejects everything fails the merge with its stderr, and the merge is aborted', () => {
  const { repo, sha } = hookedRepo('#!/bin/sh\necho "husky - commit-msg hook exited with code 1 (rejects all)" >&2\nexit 1\n');
  const m = mergeInto(repo, sha, mergeMessage('factory/run-1', 'add a footer'), { noFf: true });
  assert.equal(m.ok, false);
  assert.match((m as { error: string }).error, /husky - commit-msg hook exited with code 1 \(rejects all\)/);
  assert.equal(mergeInProgress(repo), false);
  assert.equal(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf8' }).trim(), 'chore: init');
});

// --- the worktree checks out what the sandbox allows (8-1) ----------------------------------------

const asRoot = process.getuid?.() === 0;
const NOT_ROOT = { skip: asRoot && 'root ignores file modes' };

// A plain repo in $TMPDIR (outside the sandbox's path rules) with one commit of `files`.
function plainRepo(files: Record<string, string>): { repo: string; base: string; g: (...a: string[]) => string } {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'factory-wt-')));
  const g = (...a: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: repo, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  writeFileSync(join(repo, '.git', 'info', 'exclude'), '.claude/worktrees/\n'); // as ensureExclude does
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), text);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  return { repo, base: g('rev-parse', 'HEAD'), g };
}
const branches = (g: (...a: string[]) => string): string[] => g('branch', '--format=%(refname:short)').split('\n').filter(Boolean);
const worktrees = (g: (...a: string[]) => string): number => g('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;

test('worktreeAdd: with nothing refused, every file is checked out and no path is read only', () => {
  const { repo, base, g } = plainRepo({ 'a.txt': 'a\n', '.vscode/settings.json': '{}\n' });
  const path = join(repo, '.claude', 'worktrees', 'factory-r1');
  assert.deepEqual(worktreeAdd(repo, path, 'factory/r1', base), []);
  assert.equal(readFileSync(join(path, '.vscode/settings.json'), 'utf8'), '{}\n');
  assert.equal(trackedClean(path), true);
  assert.deepEqual(skippedPaths(path), []);
  assert.deepEqual(branches(g), ['factory/r1', 'main']);
});

test('worktreeAdd: a step failing after the add removes the partial worktree and deletes the branch it created, then rethrows; a branch that existed before stays', () => {
  const { repo, base, g } = plainRepo({ 'a.txt': 'a\n' });
  const path = join(repo, '.claude', 'worktrees', 'factory-r2');
  const failOn = (verb: string): GitRun => (cwd, args) => {
    if (args[0] === verb) throw new FactoryError('BAD_ARGS', `forced ${verb} failure`);
    return gitOrThrow(cwd, args);
  };
  for (const verb of ['reset', 'ls-files']) {
    assert.throws(() => worktreeAdd(repo, path, 'factory/r2', base, failOn(verb)), new RegExp(`forced ${verb} failure`));
    assert.deepEqual(branches(g), ['main'], `no factory/r2 branch after a failed ${verb}`);
    assert.equal(worktrees(g), 1, 'the partial worktree is unregistered');
    assert.equal(existsSync(path), false, 'and removed');
  }
  // The add itself created the branch, then failed.
  const addThenFail: GitRun = (cwd, args) => { const out = gitOrThrow(cwd, args); if (args[0] === 'worktree') throw new FactoryError('BAD_ARGS', 'forced add failure'); return out; };
  assert.throws(() => worktreeAdd(repo, path, 'factory/r2', base, addThenFail), /forced add failure/);
  assert.deepEqual(branches(g), ['main']);
  // A retry onto an existing branch: the failure keeps that branch.
  g('branch', 'factory/r3', base);
  assert.throws(() => worktreeAdd(repo, join(repo, '.claude', 'worktrees', 'factory-r3'), 'factory/r3', base, failOn('ls-files')), /forced ls-files failure/);
  assert.deepEqual(branches(g), ['factory/r3', 'main']);
  assert.equal(worktrees(g), 1);
});

test('integrateTarget: a target that changed a read-only path is refused before any merge, with the exact text; the worktree is unchanged', () => {
  const { repo, base, g } = plainRepo({ 'a.txt': 'a\n', 'cfg.json': '{}\n' });
  const wt = join(repo, '.claude', 'worktrees', 'factory-r4');
  worktreeAdd(repo, wt, 'factory/r4', base);
  writeFileSync(join(repo, 'cfg.json'), '{"x":1}\n');
  writeFileSync(join(repo, 'b.txt'), 'b\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'target');
  const target = g('rev-parse', 'HEAD');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
  const o = { base, target, branch: 'main', runBranch: 'factory/r4', readonly: ['cfg.json'], integrate: true };
  assert.equal(integrateTarget(wt, o), "The target changed cfg.json since the run started, and the sandbox won't let the factory check them out. Merge by hand in your own terminal, or abandon.");
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim(), head);
  assert.equal(existsSync(join(wt, 'b.txt')), false);
  assert.equal(integrateTarget(wt, { ...o, integrate: false }), readonlyRefusal(['cfg.json']), 'the refusal comes first for a non-holder too');
  assert.equal(integrateTarget(wt, { ...o, readonly: undefined, integrate: false }), 'main is not integrated into factory/r4 yet');
  assert.equal(integrateTarget(wt, { ...o, readonly: ['other.json'] }), null, 'no overlap: integrated');
  assert.equal(readFileSync(join(wt, 'b.txt'), 'utf8'), 'b\n');
});

test('integrateTarget: a merge that fails without MERGE_HEAD is reset and its new untracked files removed; the status equals the pre-merge status and the problem stays', NOT_ROOT, (t) => {
  const { repo, base, g } = plainRepo({ 'a.txt': 'a\n', 'ro/keep': 'k\n' });
  const wt = join(repo, '.claude', 'worktrees', 'factory-r5');
  worktreeAdd(repo, wt, 'factory/r5', base);
  writeFileSync(join(wt, 'mine.txt'), 'untracked before the merge\n');
  writeFileSync(join(repo, 'ro', 'x.txt'), 'x\n');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'c.ts'), 'c\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'target');
  const target = g('rev-parse', 'HEAD');
  // The OS refuses ro/x.txt (as the sandbox refuses a path): git writes src/c.ts, then fails.
  chmodSync(join(wt, 'ro'), 0o555);
  t.after(() => chmodSync(join(wt, 'ro'), 0o755));
  const status = (): string => execFileSync('git', ['status', '--porcelain=v2', '--untracked-files=all'], { cwd: wt, encoding: 'utf8' });
  const before = status();
  const problem = integrateTarget(wt, { base, target, branch: 'main', runBranch: 'factory/r5', integrate: true });
  assert.match(problem ?? '', /^cannot integrate main: /);
  assert.equal(mergeInProgress(wt), false, 'no MERGE_HEAD');
  assert.equal(status(), before, 'the worktree is as it was');
  assert.equal(existsSync(join(wt, 'src', 'c.ts')), false, 'the stray file is removed');
  assert.equal(readFileSync(join(wt, 'mine.txt'), 'utf8'), 'untracked before the merge\n', 'an untracked file from before stays');
});

test('restoreAfterFailedMerge keeps skip-worktree bits: the read-only paths stay read only and the status clean', () => {
  const { repo, base } = plainRepo({ 'a.txt': 'a\n', 'ro.json': '{}\n' });
  const wt = join(repo, '.claude', 'worktrees', 'factory-r6');
  worktreeAdd(repo, wt, 'factory/r6', base);
  rmSync(join(wt, 'ro.json'));
  execFileSync('git', ['update-index', '--skip-worktree', '--', 'ro.json'], { cwd: wt });
  writeFileSync(join(wt, 'a.txt'), 'changed\n');
  writeFileSync(join(wt, 'stray.txt'), 's\n');
  restoreAfterFailedMerge(wt, []);
  assert.deepEqual(skippedPaths(wt), ['ro.json']);
  assert.equal(existsSync(join(wt, 'ro.json')), false);
  assert.equal(existsSync(join(wt, 'stray.txt')), false);
  assert.equal(trackedClean(wt), true);
  assert.deepEqual(prepareWorktree(repo, 'r6', base, 'factory/r6'), { path: wt, readonly: ['ro.json'] }, 'reuse reads them back from ls-files -v');
});

test('gitOrThrow: a git failure the OS refused (Permission denied) is SANDBOX_DENIED naming the command and path; any other failure stays BAD_ARGS', NOT_ROOT, (t) => {
  const { repo } = plainRepo({ 'a.txt': 'a\n' });
  writeFileSync(join(repo, 'secret.txt'), 's\n');
  chmodSync(join(repo, 'secret.txt'), 0o000);
  t.after(() => chmodSync(join(repo, 'secret.txt'), 0o644));
  assert.throws(() => gitOrThrow(repo, ['add', 'secret.txt']), (e: FactoryError) => {
    assert.equal(e.code, 'SANDBOX_DENIED');
    assert.match(e.message, /^git add secret\.txt in .*: .*secret\.txt.*Permission denied.*: the sandbox refused this; it is a factory defect, report it \(AD-35\)$/);
    return true;
  });
  assert.throws(() => gitOrThrow(repo, ['rev-parse', '--verify', 'nope']), (e: FactoryError) => e.code === 'BAD_ARGS');
});

test('sandboxPreflight: passes and leaves nothing behind; a refused probe is SANDBOX_DENIED naming its path', NOT_ROOT, async (t) => {
  const { repo, g } = plainRepo({ 'a.txt': 'a\n' });
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-home-')));
  const prev = process.env.FACTORY_HOME;
  process.env.FACTORY_HOME = home;
  t.after(() => { if (prev === undefined) delete process.env.FACTORY_HOME; else process.env.FACTORY_HOME = prev; });
  await sandboxPreflight(repo, 'abc123def456');
  assert.equal(existsSync(join(repo, '.claude')), false, 'the dirs it created are removed');
  assert.deepEqual(readdirSync(home), []);
  assert.equal(g('status', '--porcelain', '--untracked-files=all'), '');
  // .claude/worktrees exists but is not writable: refused, naming the path.
  mkdirSync(join(repo, '.claude', 'worktrees'), { recursive: true });
  chmodSync(join(repo, '.claude', 'worktrees'), 0o555);
  t.after(() => chmodSync(join(repo, '.claude', 'worktrees'), 0o755));
  await assert.rejects(sandboxPreflight(repo, 'abc123def456'), (e: FactoryError) => {
    assert.equal(e.code, 'SANDBOX_DENIED');
    assert.equal(e.message, `create ${join(repo, '.claude', 'worktrees')}/.factory-preflight-${process.pid} (EACCES): the sandbox refused this; it is a factory defect, report it (AD-35)`);
    return true;
  });
  chmodSync(join(repo, '.claude', 'worktrees'), 0o755);
  // The bind probe (test seam): refused, naming sandbox.network.allowLocalBinding.
  process.env.FACTORY_TEST_BIND_DENIED = '1';
  t.after(() => { delete process.env.FACTORY_TEST_BIND_DENIED; });
  await assert.rejects(sandboxPreflight(repo, 'abc123def456'), (e: FactoryError) => {
    assert.equal(e.code, 'SANDBOX_DENIED');
    assert.equal(e.message, 'listen on 127.0.0.1:0 (EPERM; sandbox.network.allowLocalBinding): the sandbox refused this; it is a factory defect, report it (AD-35)');
    return true;
  });
});

test('worktreeAdd: a tracked file checkout-index could not write (SANDBOX_DENIED) is skip-worktree and returned; the worktree and branch stay; any other checkout-index failure is rethrown', () => {
  const { repo, base, g } = plainRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  const path = join(repo, '.claude', 'worktrees', 'factory-r7');
  const refuseB: GitRun = (cwd, args, input) => {
    const out = gitOrThrow(cwd, args, input);
    if (args[0] !== 'checkout-index') return out;
    rmSync(join(cwd, 'b.txt'));
    throw sandboxDenied(`git checkout-index -a in ${cwd}: error: unable to create file b.txt: Operation not permitted`);
  };
  assert.deepEqual(worktreeAdd(repo, path, 'factory/r7', base, refuseB), ['b.txt']);
  assert.deepEqual(skippedPaths(path), ['b.txt']);
  assert.equal(trackedClean(path), true);
  assert.equal(existsSync(join(path, 'a.txt')), true);
  assert.deepEqual(branches(g), ['factory/r7', 'main']);
  assert.equal(worktrees(g), 2);
  const diskFull: GitRun = (cwd, args, input) => {
    if (args[0] === 'checkout-index') throw new FactoryError('BAD_ARGS', 'git checkout-index -a failed: No space left on device');
    return gitOrThrow(cwd, args, input);
  };
  assert.throws(() => worktreeAdd(repo, join(repo, '.claude', 'worktrees', 'factory-r8'), 'factory/r8', base, diskFull), /No space left on device/);
  assert.deepEqual(branches(g), ['factory/r7', 'main'], 'not reported as read only: the add is undone');
});

test('prepareWorktree reuse completes an add killed before its reset: the checkout runs again and trackedClean holds', () => {
  const { repo, base, g } = plainRepo({ 'a.txt': 'a\n', 'src/b.txt': 'b\n' });
  const path = join(repo, '.claude', 'worktrees', 'factory-r9');
  g('worktree', 'add', '-q', '--no-checkout', path, '-b', 'factory/r9', base);
  assert.equal(trackedClean(path), false, 'no index yet: every file reads as deleted');
  assert.deepEqual(prepareWorktree(repo, 'r9', base, 'factory/r9'), { path, readonly: [] });
  assert.equal(readFileSync(join(path, 'src/b.txt'), 'utf8'), 'b\n');
  assert.equal(trackedClean(path), true);
});

test('integrateTarget: uncommitted tracked edits survive a failed integration (git refuses without MERGE_HEAD; no reset runs)', () => {
  const { repo, base, g } = plainRepo({ 'a.txt': 'a\n' });
  const wt = join(repo, '.claude', 'worktrees', 'factory-r10');
  worktreeAdd(repo, wt, 'factory/r10', base);
  writeFileSync(join(repo, 'a.txt'), 'target\n');
  g('commit', '-q', '-am', 'target');
  writeFileSync(join(wt, 'a.txt'), 'my uncommitted edit\n');
  const problem = integrateTarget(wt, { base, target: g('rev-parse', 'HEAD'), branch: 'main', runBranch: 'factory/r10', integrate: true });
  assert.match(problem ?? '', /^cannot integrate main: /);
  assert.equal(mergeInProgress(wt), false);
  assert.equal(readFileSync(join(wt, 'a.txt'), 'utf8'), 'my uncommitted edit\n');
});

test('changedReadonly: a target that renamed a read-only path still overlaps (--no-renames)', () => {
  const { repo, base, g } = plainRepo({ 'a.txt': 'a\n', 'cfg.json': '{"a":1,"b":2,"c":3}\n' });
  g('mv', 'cfg.json', 'conf.json');
  g('commit', '-q', '-m', 'rename');
  assert.deepEqual(changedReadonly(repo, base, g('rev-parse', 'HEAD'), ['cfg.json']), ['cfg.json']);
});
