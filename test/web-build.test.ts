// The committed dashboard/dist is what the web sources build to: a fresh Vite build into a temp
// directory has the same files, byte for byte. Needs src/dashboard/web/node_modules.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const WEB = join(ROOT, 'src', 'dashboard', 'web');
const DIST = join(ROOT, 'dashboard', 'dist');
const VITE = join(WEB, 'node_modules', 'vite', 'bin', 'vite.js');
const SKIP = { skip: existsSync(VITE) ? false : 'vite is not installed in src/dashboard/web (run npm ci there)' };

const files = (dir: string): string[] => (readdirSync(dir, { recursive: true }) as string[]).filter((f) => statSync(join(dir, f)).isFile()).sort();

test('dashboard/dist matches a fresh build of src/dashboard/web', SKIP, (t) => {
  const out = mkdtempSync(join(tmpdir(), 'factory-dist-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [VITE, 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: WEB, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(files(DIST), files(out), 'the same files (rebuild with `npm run build` in src/dashboard/web)');
  for (const f of files(out)) assert.ok(readFileSync(join(DIST, f)).equals(readFileSync(join(out, f))), `${f} differs from a fresh build`);
});
