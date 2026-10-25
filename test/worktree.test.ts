import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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
