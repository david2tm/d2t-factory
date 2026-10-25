// AD-2 import direction: core is pure; store sits on core; adapters never import one another.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';

const SRC = join(import.meta.dirname, '..', 'src');
const ADAPTERS = ['cli', 'hooks', 'replay', 'dashboard/server'];
const LAYERS = ['core', 'store', ...ADAPTERS];

// The layer a path under src/ belongs to, or null. dashboard/web is the browser bundle, outside AD-2.
function layerOf(file: string): string | null {
  const rel = relative(SRC, file).split(sep).join('/');
  return LAYERS.find((l) => rel === l || rel.startsWith(`${l}/`)) ?? null;
}

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3]);
}

// What one import breaks, or null if AD-2 allows it.
function violation(file: string, spec: string): string | null {
  const from = layerOf(file);
  if (spec.startsWith('node:')) return from === 'core' ? 'core must not import node:' : null;
  if (!spec.startsWith('.')) return `bare import ${spec} (AD-19: Node built-ins only)`;
  const to = layerOf(resolve(dirname(file), spec));
  if (from === 'core') return to === 'core' ? null : `core imports ${to ?? spec}`;
  if (from === 'store') return to === 'core' || to === 'store' ? null : `store imports ${to ?? spec}`;
  if (to === from || to === 'core' || to === 'store') return null;
  return `${from} imports ${to ?? spec}`;
}

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((p) => /\.(ts|mjs)$/.test(p) && !p.split(sep).includes('node_modules'))
    .map((p) => join(SRC, p))
    .filter((f) => !relative(SRC, f).split(sep).join('/').startsWith('dashboard/web/'));
}

test('the AD-2 checker catches each forbidden direction', () => {
  const f = (p: string): string => join(SRC, p);
  assert.match(violation(f('core/reducer.ts'), 'node:fs')!, /node:/);
  assert.match(violation(f('core/reducer.ts'), '../store/paths.ts')!, /core imports store/);
  assert.match(violation(f('store/jsonl.ts'), '../cli/args.ts')!, /store imports cli/);
  assert.match(violation(f('cli/main.ts'), '../hooks/run.ts')!, /cli imports hooks/);
  assert.match(violation(f('hooks/run.ts'), '../dashboard/server/app.ts')!, /hooks imports dashboard\/server/);
  assert.match(violation(f('replay/x.ts'), 'left-pad')!, /bare import/);
  assert.equal(violation(f('cli/main.ts'), '../store/paths.ts'), null);
  assert.equal(violation(f('dashboard/server/a.ts'), './b.ts'), null);
  assert.equal(violation(f('store/jsonl.ts'), 'node:fs'), null);
  assert.deepEqual(specifiers("import type { A } from './a.ts';\nimport { b,\n  c } from \"../b.ts\";\n// import x from 'nope';\nawait import('./c.ts');\nexport { d } from './d.ts';"), ['./a.ts', '../b.ts', './c.ts', './d.ts']);
});

test('src/ follows the AD-2 import direction', () => {
  const files = sourceFiles();
  assert.ok(files.some((f) => layerOf(f) === 'core') && files.some((f) => layerOf(f) === 'store'));
  const problems: string[] = [];
  let seen = 0;
  for (const file of files) {
    const rel = relative(SRC, file);
    if (!layerOf(file)) { problems.push(`${rel}: not in a known layer (${LAYERS.join(', ')})`); continue; }
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      seen++;
      const v = violation(file, spec);
      if (v) problems.push(`${rel}: ${v}`);
    }
  }
  assert.ok(seen > 10, `scanner found only ${seen} imports`);
  assert.deepEqual(problems, []);
});

// AD-2/19: src/dashboard/web talks to the server only over HTTP and SSE. Its sources import only
// each other (never the rest of src/) and, as bare imports, only svelte.
const WEB = join(SRC, 'dashboard', 'web');

function webViolation(file: string, spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const rel = relative(WEB, resolve(dirname(file), spec));
    return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? `imports ${spec} from outside src/dashboard/web` : null;
  }
  return spec === 'svelte' || spec.startsWith('svelte/') ? null : `bare import ${spec} (only svelte and svelte/*)`;
}

function webFiles(): string[] {
  const root = join(WEB, 'src');
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((p) => /\.(ts|js|mjs|svelte)$/.test(p))
    .map((p) => join(root, p));
}

test('the web isolation checker catches imports from src/ and foreign packages', () => {
  const f = join(WEB, 'src', 'lib', 'model.ts');
  assert.match(webViolation(f, '../../../../core/projection.ts')!, /outside/);
  assert.match(webViolation(f, '../../../server/http.ts')!, /outside/);
  assert.match(webViolation(f, 'node:fs')!, /bare import/);
  assert.match(webViolation(f, 'svelte-foo')!, /bare import/);
  assert.equal(webViolation(f, './types.ts'), null);
  assert.equal(webViolation(join(WEB, 'src', 'components', 'A.svelte'), '../lib/model.ts'), null);
  assert.equal(webViolation(f, 'svelte'), null);
  assert.equal(webViolation(f, 'svelte/store'), null);
});

test('src/dashboard/web/src imports only itself and svelte', () => {
  const files = webFiles();
  assert.ok(files.some((f) => f.endsWith('.svelte')) && files.some((f) => f.endsWith('model.ts')), 'scanner found the web sources');
  const problems: string[] = [];
  let seen = 0;
  for (const file of files) {
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      seen++;
      const v = webViolation(file, spec);
      if (v) problems.push(`${relative(SRC, file)}: ${v}`);
    }
  }
  assert.ok(seen > 20, `scanner found only ${seen} imports`);
  assert.deepEqual(problems, []);
});
