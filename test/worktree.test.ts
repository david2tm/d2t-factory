import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mergeInProgress, mergeInto, mergeMessage } from '../src/cli/git.ts';
import { copyGitignored, secretValues } from '../src/cli/worktree.ts';

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
