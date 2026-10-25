import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  acIds, checkOutput, isDependencyFile, planLint, slicePlanEntries, specLint, validateContext, validateDesign, validateIntake, validateRunContract, validateSlicePlan, validateSpec,
} from '../src/core/artifacts.ts';

const CONTRACT = { install: 'npm ci', add: 'npm i', start: 'node server.js', url: 'http://localhost:5100', port: 5100, test: 'npm test', health: 'node health.js', copy_gitignored: ['.env'], services: [] };

test('context, run contract and spec schemas (AD-27)', () => {
  assert.ok(validateContext({ origin: 'brownfield', ui_surface: false }).ok);
  assert.deepEqual(validateContext({ origin: 'greenfield', ui_surface: true, ui_reference: 'kit' }), { ok: true, value: { origin: 'greenfield', ui_surface: true, ui_reference: 'kit' } });
  const c = validateContext({ origin: 'nope', ui_surface: 'yes', ui_reference: 3 });
  assert.equal(c.ok, false);
  assert.equal((c as { errors: string[] }).errors.length, 3);
  assert.ok(validateRunContract(CONTRACT).ok);
  assert.ok(validateRunContract({ ...CONTRACT, e2e: 'npx playwright test', services: [{ name: 'pg', shared: true }] }).ok);
  const r = validateRunContract({ ...CONTRACT, port: '5100', test: '', copy_gitignored: '.env', services: [{ name: 'pg' }] });
  assert.deepEqual((r as { errors: string[] }).errors.map((e) => e.split(' ')[0]), ['test', 'port', 'copy_gitignored', 'services']);
  assert.ok(validateSpec({ acceptance: [{ id: 'AC-1', check: { kind: 'command', command: 'x' } }], assumptions: [] }).ok);
  assert.equal(validateSpec({ acceptance: [{ id: 'AC-1' }], assumptions: 'none' }).ok, false);
});

test('checkOutput: protocol + role schema; ESCALATE skips the schema; a wrong port is a SCAFFOLD failure, not a parse error', () => {
  const fm = (o: object) => Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  const good = checkOutput('scaffolder', `STATUS: DONE\n---\n${fm(CONTRACT)}\n---\n`, { port: 5100 });
  assert.ok(good.ok && good.status === 'DONE' && !good.failure);
  const wrong = checkOutput('scaffolder', `STATUS: DONE\n---\n${fm({ ...CONTRACT, port: 5101 })}\n---\n`, { port: 5100 });
  assert.ok(wrong.ok);
  assert.match((wrong as { failure: string }).failure, /5101 is not the claimed port 5100/);
  const esc = checkOutput('scaffolder', 'STATUS: ESCALATE\nScaffold failed: no start script\n');
  assert.ok(esc.ok && esc.status === 'ESCALATE' && esc.escalation!.label === 'Scaffold failed');
  const missing = checkOutput('recon', 'STATUS: DONE\nno front matter');
  assert.deepEqual(missing, { ok: false, error: 'front matter missing: line 2 must be --- and the block must close with ---' });
  assert.match((checkOutput('recon', 'STATUS: DONE\n---\norigin: x\n---\n') as { error: string }).error, /front matter: origin/);
  assert.match((checkOutput('recon', 'VERDICT: APPROVE\n') as { error: string }).error, /STATUS/);
  assert.match((checkOutput('reviewer-code', 'STATUS: DONE\n') as { error: string }).error, /VERDICT/);
});

test('the orientation roles (5-2): framer shares the context schema; framer must say greenfield and recon brownfield; FRAME never escalates; the run\'s origin must match the role', () => {
  const ctx = (origin: string, extra = '') => `STATUS: DONE\n---\norigin: ${origin}\nui_surface: true\n${extra}---\n# Frame\n`;
  const frame = checkOutput('framer', ctx('greenfield', 'ui_reference: "shadcn/ui"\n'), { origin: 'greenfield' });
  assert.ok(frame.ok && frame.front.ui_reference === 'shadcn/ui', JSON.stringify(frame));
  assert.ok(checkOutput('recon', ctx('brownfield'), { origin: 'brownfield' }).ok);
  assert.ok(checkOutput('recon', ctx('brownfield')).ok, 'the role alone decides the origin');
  assert.deepEqual(checkOutput('framer', ctx('brownfield')), { ok: false, error: 'front matter: origin must be greenfield in a framer output' });
  assert.deepEqual(checkOutput('recon', ctx('greenfield')), { ok: false, error: 'front matter: origin must be brownfield in a recon output' });
  assert.match((checkOutput('framer', 'STATUS: DONE\n---\norigin: greenfield\n---\n') as { error: string }).error, /front matter: ui_surface must be true or false/);
  assert.match((checkOutput('framer', 'STATUS: DONE\nno front matter') as { error: string }).error, /front matter missing/);
  assert.match((checkOutput('framer', 'STATUS: ESCALATE\nScope change: which stack?\n') as { error: string }).error, /FRAME asks the human nothing/);
  assert.match((checkOutput('recon', ctx('brownfield'), { origin: 'greenfield' }) as { error: string }).error, /a recon output on a greenfield run: it orients with framer/);
  assert.match((checkOutput('framer', ctx('greenfield'), { origin: 'brownfield' }) as { error: string }).error, /a framer output on a brownfield run: it orients with recon/);
  // Other roles ignore the run's origin.
  assert.ok(checkOutput('scaffolder', `STATUS: DONE\n---\n${Object.entries(CONTRACT).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n`, { origin: 'greenfield' }).ok);
});

const SPEC_FRONT = {
  acceptance: [{ id: 'AC-1', check: { kind: 'command', command: 'npm test' } }, { id: 'AC-2', check: { kind: 'page', page: '/ shows a footer' } }],
  assumptions: ['Footer is on every page', 'Year is the current year'],
};
const SPEC_BODY = '\n# Footer\nAdd a footer.\n\n## Assumptions\n- Footer is on every page\n- Year is the current year\n\n';

test('specLint passes a one-screen spec whose ACs all have checks and whose Assumptions match', () => {
  const l = specLint(SPEC_FRONT, SPEC_BODY);
  assert.deepEqual(l, { ok: true, errors: [], acs: ['AC-1', 'AC-2'], assumptions: 2, lines: 6 });
});

test('specLint names every problem', () => {
  const long = specLint(SPEC_FRONT, SPEC_BODY + 'x\n'.repeat(40));
  assert.match(long.errors[0], /is 47 lines; the limit is 40/);
  assert.match(specLint({ ...SPEC_FRONT, acceptance: [] }, SPEC_BODY).errors.join(), /no acceptance criteria/);
  const dup = specLint({ ...SPEC_FRONT, acceptance: [SPEC_FRONT.acceptance[0], SPEC_FRONT.acceptance[0], { id: 'A3', check: { kind: 'page' } }] }, SPEC_BODY);
  assert.deepEqual(dup.errors, ['AC-1: duplicate id', 'A3: id must be AC-<n>', 'A3: check must be {"kind":"command","command":…} or {"kind":"page","page":…}']);
  assert.deepEqual(specLint(SPEC_FRONT, '# Footer\n').errors, ['no Assumptions section']);
  assert.match(specLint({ ...SPEC_FRONT, assumptions: ['Footer is on every page'] }, SPEC_BODY).errors[0], /2 items\) does not match assumptions\[\] \(1\)/);
  assert.equal(specLint({ ...SPEC_FRONT, assumptions: [] }, '# X\n## Assumptions\n').ok, true, 'an empty section matches no assumptions');
  assert.equal(specLint({ acceptance: 'x' }, '').ok, false);
});

test('planLint: ids, titles, AC coverage, tags and dependency order', () => {
  const acs = acIds(SPEC_FRONT);
  assert.deepEqual(acs, ['AC-1', 'AC-2']);
  const plan = [{ id: 'S1', title: 'Footer markup', acs: ['AC-1'], tags: ['ui'], deps: [] }, { id: 'S2', title: 'Footer links', acs: ['AC-2'], tags: [], deps: ['S1'] }];
  assert.deepEqual(planLint(plan, acs), { ok: true, errors: [] });
  assert.deepEqual(planLint([{ id: 'S1', title: 't', acs: ['AC-1'] }], acs).errors, ['AC-2 is in no slice']);
  assert.deepEqual(planLint([{ id: 'S1', title: 't', acs: [] }], []).errors, ['S1: covers no acceptance criterion']);
  assert.deepEqual(planLint([{ id: 'S1', title: 'a', acs: ['AC-1'], deps: ['S2'] }, { id: 'S2', title: '', acs: ['AC-9'] }], ['AC-1']).errors,
    ['S1: depends on S2, which is not an earlier slice', 'S2: no title', 'S2: AC-9 is not in the spec']);
  assert.deepEqual(planLint([{ id: 'S1', title: 'a', acs: ['AC-1'] }, { id: 'S1', title: 'b', acs: ['AC-1'] }, { id: 'slice3', title: 'c', acs: ['AC-1'], tags: ['db'] }], ['AC-1']).errors,
    ['S1: duplicate id', 'slice3: id must be S<n>', 'slice3: db is not a slice tag (ui, input, auth, secrets, external)']);
  assert.deepEqual(planLint([], []).errors, ['no slices']);
});

test('the slicer plan (3-3): shape and tags are its schema, depends_on becomes deps; a schema error rejects the output', () => {
  const slices = [{ id: 'S1', title: 'Signup form', acs: ['AC-1', 'AC-2'], tags: ['ui', 'input'], depends_on: [] }, { id: 'S2', title: 'Welcome mail', acs: ['AC-3'], tags: [], depends_on: ['S1'] }];
  const entries = [{ id: 'S1', title: 'Signup form', acs: ['AC-1', 'AC-2'], tags: ['ui', 'input'], deps: [] }, { id: 'S2', title: 'Welcome mail', acs: ['AC-3'], tags: [], deps: ['S1'] }];
  assert.deepEqual(validateSlicePlan({ slices }), { ok: true, value: entries });
  assert.deepEqual(slicePlanEntries({ slices }), entries);
  assert.deepEqual(slicePlanEntries(undefined), []);
  // Lint problems (a bad id, an unknown AC, a later dependency) are not schema errors: plan.lint reports them.
  assert.ok(validateSlicePlan({ slices: [{ id: 'X', title: 't', acs: ['AC-9'], tags: [], depends_on: ['S7'] }] }).ok);
  const errs = (f: Record<string, unknown>): string[] => (validateSlicePlan(f) as { errors: string[] }).errors;
  assert.match(errs({ slices: 'S1, S2' })[0], /slices must be a single-line JSON list/);
  assert.match(errs({})[0], /slices must be a single-line JSON list/);
  assert.deepEqual(errs({ slices: [{ id: 'S1', title: 't', acs: ['AC-1'], tags: ['ui', 'db'], depends_on: [] }] }), ['slices[0] (S1): tag "db" is not one of ui, input, auth, secrets, external']);
  assert.deepEqual(errs({ slices: [{ id: 1, title: 2, acs: 'AC-1', tags: [], depends_on: 'S1' }, 'S2'] }), [
    'slices[0]: id must be a string like "S1"', 'slices[0]: title must be a string', 'slices[0]: acs must be a JSON array of strings', 'slices[0]: depends_on must be a JSON array of strings', 'slices[1] must be a JSON object',
  ]);
  // Through the protocol: the slicer's out.md, as in the story's example.
  const text = `STATUS: DONE\n---\nslices: ${JSON.stringify(slices)}\n---\nS2 sends the mail S1's form triggers.\n`;
  const r = checkOutput('slicer', text);
  assert.ok(r.ok && r.status === 'DONE');
  assert.deepEqual(r.ok && r.front.slices, slices);
  assert.match((checkOutput('slicer', text.replace('"input"', '"form"')) as { error: string }).error, /^front matter: slices\[0\] \(S1\): tag "form" is not one of/);
  assert.match((checkOutput('slicer', 'STATUS: DONE\n---\nslices: [{"id": "S1",\n---\n') as { error: string }).error, /not a single-line JSON value/);
  assert.ok(checkOutput('slicer', 'STATUS: ESCALATE\nSpec ambiguity: AC-2 forks\n').ok);
});

test('running-app reviewers (3-3): every finding carries observed; the diff reviewers need none', () => {
  const f = '```finding\ncategory: Bug\nlocation: a.js:1\nfailure_scenario: the form clears on submit\n```\n';
  const seen = f.replace('\n```\n', '\nobserved: http://localhost:5100/signup after submit [/tmp/s.png]\n```\n');
  for (const role of ['reviewer-ux', 'reviewer-a11y', 'reviewer-ui']) {
    assert.match((checkOutput(role, `VERDICT: FINDINGS\n${seen}${f}`) as { error: string }).error, new RegExp(`^finding 2: observed is missing; a ${role} finding ends with`));
    const ok = checkOutput(role, `VERDICT: FINDINGS\n${seen}`);
    assert.ok(ok.ok);
    assert.equal(ok.ok && ok.findings![0].observed, 'http://localhost:5100/signup after submit [/tmp/s.png]');
    assert.ok(checkOutput(role, 'VERDICT: APPROVE\nall states render\n').ok);
  }
  for (const role of ['reviewer-code', 'reviewer-security']) assert.ok(checkOutput(role, `VERDICT: FINDINGS\n${f}`).ok);
});

test('checkOutput: the builder needs a summary; a reviewer verdict and its findings must agree', () => {
  assert.ok(checkOutput('builder', 'STATUS: DONE\n---\nsummary: "Added the footer"\n---\n').ok);
  assert.match((checkOutput('builder', 'STATUS: DONE\nno front\n') as { error: string }).error, /front matter missing/);
  assert.match((checkOutput('builder', 'STATUS: DONE\n---\nsummary: ""\n---\n') as { error: string }).error, /summary must be/);
  assert.ok(checkOutput('builder', 'STATUS: ESCALATE\nScope change: it is two features\n').ok);
  const f = '```finding\ncategory: Security\nlocation: a.js:1\nfailure_scenario: ?q=<script> runs\n```\n';
  const found = checkOutput('reviewer-code', `VERDICT: FINDINGS\n${f}`);
  assert.ok(found.ok && found.status === 'FINDINGS');
  assert.deepEqual(found.findings, [{ category: 'Security', location: 'a.js:1', failure_scenario: '?q=<script> runs' }]);
  assert.deepEqual((checkOutput('reviewer-code', 'VERDICT: APPROVE\nfine\n') as { findings: unknown[] }).findings, []);
  assert.match((checkOutput('reviewer-code', 'VERDICT: FINDINGS\nbad\n') as { error: string }).error, /at least one/);
  assert.match((checkOutput('reviewer-code', `VERDICT: APPROVE\n${f}`) as { error: string }).error, /APPROVE must have no finding, got 1/);
  assert.ok(checkOutput('reviewer-code', 'VERDICT: ESCALATE\nSpec ambiguity: AC-1 contradicts AC-2\n').ok);
});

test('isDependencyFile: manifests and lockfiles by basename, from an explicit list', () => {
  const yes = [
    'package.json', 'web/package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'deno.json', 'deno.lock',
    'requirements.txt', 'requirements-dev.txt', 'Pipfile', 'Pipfile.lock', 'pyproject.toml', 'poetry.lock', 'uv.lock', 'setup.py', 'setup.cfg',
    'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'Gemfile', 'Gemfile.lock', 'pom.xml', 'build.gradle', 'app/build.gradle.kts',
    'composer.json', 'composer.lock', 'src/App.csproj', 'Package.swift', 'Package.resolved', 'mix.exs', 'mix.lock',
  ];
  const no = ['clock.js', 'blocks.json', 'block.json', 'clock.svg', 'src/lockManager.ts', 'package.jsonc', 'my-package.json', 'requirements.md', 'Gemfile.bak', 'gradle.properties', 'go.mod.orig', ''];
  for (const f of yes) assert.equal(isDependencyFile(f), true, f);
  for (const f of no) assert.equal(isDependencyFile(f), false, f);
});

test('intake schema (AD-27): task and scope, an optional limit, an optional time box (default 30), UI-free, run-wide reviewer overrides and an earlier start only with a limit', () => {
  const base = {
    task: 'add a footer', scope: { in: ['footer'], out: [] }, limit_min: 120, ui_free: false, reviewer_overrides: { add: ['reviewer-security'], remove: ['reviewer-ux'] },
  };
  assert.deepEqual(validateIntake(base), { ok: true, value: { ...base, slice_timebox_min: 30 } });
  assert.deepEqual(validateIntake({ ...base, slice_timebox_min: 45, started: '2026-10-24T14:05:00Z', reviewer_overrides: {} }), {
    ok: true, value: { task: 'add a footer', scope: { in: ['footer'], out: [] }, limit_min: 120, slice_timebox_min: 45, ui_free: false, reviewer_overrides: { add: [], remove: [] }, started: '2026-10-24T14:05:00.000Z' },
  });
  assert.equal(validateIntake({ ...base, slice_timebox_min: null }).ok, true, 'null is left out');
  const errs = (f: Record<string, unknown>): string[] => { const r = validateIntake(f); return r.ok ? [] : r.errors; };
  assert.deepEqual(errs({}), [
    'task must be a non-empty one-line string', 'scope must be a JSON object {"in": [...], "out": [...]} of strings (either list may be empty)',
    'ui_free must be true or false', 'reviewer_overrides must be a JSON object {"add": [...], "remove": [...]}',
  ]);
  // 6-2: no time limit (left out or null) is valid; started then is refused.
  const { limit_min: _l, ...noLimit } = base;
  assert.deepEqual(validateIntake(noLimit), { ok: true, value: { ...noLimit, slice_timebox_min: 30 } });
  assert.deepEqual(validateIntake({ ...base, limit_min: null }), { ok: true, value: { ...noLimit, slice_timebox_min: 30 } });
  assert.deepEqual(errs({ ...noLimit, started: '2026-10-24T14:05:00Z' }), ['started needs limit_min: leave started out when there is no time limit']);
  assert.match(errs({ ...base, limit_min: 0 })[0], /limit_min/);
  assert.match(errs({ ...base, limit_min: 90.5 })[0], /limit_min/);
  assert.match(errs({ ...base, limit_min: '120' })[0], /limit_min/);
  // task: one non-empty line; scope: two string lists, either may be empty.
  assert.deepEqual(errs({ ...base, task: '' }), ['task must be a non-empty one-line string']);
  assert.deepEqual(errs({ ...base, task: '  ' }), ['task must be a non-empty one-line string']);
  assert.deepEqual(errs({ ...base, task: 'a\nb' }), ['task must be a non-empty one-line string']);
  assert.deepEqual(errs({ ...base, task: 7 }), ['task must be a non-empty one-line string']);
  for (const scope of [undefined, [], { in: [] }, { out: [] }, { in: 'x', out: [] }, { in: [1], out: [] }]) assert.match(errs({ ...base, scope })[0] ?? '', /^scope must be/, JSON.stringify(scope));
  assert.equal(validateIntake({ ...base, scope: { in: [], out: [] } }).ok, true);
  // Each scope item is one card line: non-empty, one line, trimmed.
  assert.deepEqual(errs({ ...base, scope: { in: [''], out: [] } }), ['scope.in items must be non-empty one-line strings']);
  assert.deepEqual(errs({ ...base, scope: { in: ['ok'], out: ['   '] } }), ['scope.out items must be non-empty one-line strings']);
  assert.deepEqual(errs({ ...base, scope: { in: ['a\nb'], out: ['c\rd'] } }), ['scope.in items must be non-empty one-line strings', 'scope.out items must be non-empty one-line strings']);
  const trimmed = validateIntake({ ...base, task: '  add a footer ', scope: { in: [' footer '], out: ['links  '] } });
  assert.deepEqual(trimmed.ok && [trimmed.value.task, trimmed.value.scope], ['add a footer', { in: ['footer'], out: ['links'] }]);
  assert.match(errs({ ...base, slice_timebox_min: '30' })[0], /slice_timebox_min/);
  assert.deepEqual(errs({ ...base, reviewer_overrides: { remove: ['reviewer-code'] } }), ['reviewer-code always runs and cannot be removed']);
  assert.match(errs({ ...base, reviewer_overrides: { add: ['reviewer-perf'] } })[0], /reviewer-perf is not one of reviewer-security, reviewer-ux, reviewer-a11y, reviewer-ui/);
  assert.match(errs({ ...base, reviewer_overrides: { add: 'reviewer-ux' } })[0], /add must be a JSON array/);
  assert.deepEqual(errs({ ...base, reviewer_overrides: { add: ['reviewer-ui'], remove: ['reviewer-ui'] } }), ['reviewer_overrides: reviewer-ui is both added and removed']);
  assert.match(errs({ ...base, started: 'after lunch' })[0], /started must be an ISO-8601 time with its zone/);
  assert.match(errs({ ...base, started: '2026-10-24T14:05:00' })[0], /with its zone/, 'zoneless: would be read as local time');
  assert.match(errs({ ...base, started: '2026-10-24' })[0], /with its zone/);
  assert.deepEqual(validateIntake({ ...base, started: '2026-10-24T16:05:00+02:00' }), { ok: true, value: { ...base, slice_timebox_min: 30, started: '2026-10-24T14:05:00.000Z' } });
  assert.match(errs({ ...base, started: 1730000000 })[0], /started/);
});

test("checkOutput('intake'): STATUS: DONE with front matter only; ESCALATE is rejected", () => {
  const ok = checkOutput('intake', 'STATUS: DONE\n---\ntask: "add a footer"\nscope: {"in": ["footer"], "out": []}\nlimit_min: 120\nui_free: false\nreviewer_overrides: {"add": [], "remove": []}\nstarted: "2026-10-24T14:05:00.000Z"\n---\nThe task.\n');
  assert.ok(ok.ok && ok.status === 'DONE' && ok.front.limit_min === 120);
  const esc = checkOutput('intake', 'STATUS: ESCALATE\nScope change: the human wants two apps\n');
  assert.equal(esc.ok, false);
  assert.match((esc as { error: string }).error, /line 1 must be `STATUS: DONE`/);
  assert.match((checkOutput('intake', 'STATUS: DONE\nno front matter\n') as { error: string }).error, /front matter missing/);
  assert.match((checkOutput('intake', 'VERDICT: APPROVE\n') as { error: string }).error, /line 1 must use STATUS/);
  assert.match((checkOutput('intake', 'STATUS: DONE\n---\nlimit_min: 120\n---\n') as { error: string }).error, /front matter: task must be a non-empty one-line string; scope must be .*; ui_free must be true or false; reviewer_overrides/);
});

const DESIGN_BODY = '## Components to use\n- Button\n## States\n- empty\n## Accessibility floor\n- 4.5:1\n';
const design = (front: string, body = DESIGN_BODY): string => `STATUS: DONE\n---\n${front}\n---\n${body}`;
const INHERIT = 'mode: inherit\ncolors: {"primary": "#1f6feb", "text": "#1f2328"}\ntypography: {"body": "14px/1.5 system-ui"}\nassumptions: []';
const QBLOCK = '\n```question\nquestion: Light or dark?\na: Light\nb: Dark\ndefault: a\n```\n';

test('design schema (3-2): mode, non-empty colors of strings, optional token maps and assumptions, and the three sections', () => {
  assert.deepEqual(validateDesign({ mode: 'invent', colors: { primary: '#000' } }, DESIGN_BODY), { ok: true, value: { mode: 'invent', colors: { primary: '#000' }, assumptions: [] } });
  const r = validateDesign({ mode: 'copy', colors: {}, typography: 'big', spacing: [], rounded: 4, assumptions: 'none' }, '## States\n');
  assert.deepEqual((r as { errors: string[] }).errors, [
    'mode must be inherit or invent', 'colors must be a non-empty JSON object of strings, like {"primary": "#1f6feb"}', 'typography must be a JSON object, or left out',
    'spacing must be a JSON object, or left out', 'rounded must be a JSON object, or left out', 'assumptions must be a JSON array of strings, or left out',
    'the body has no `## Components to use` section', 'the body has no `## Accessibility floor` section',
  ]);
  assert.equal(validateDesign({ mode: 'inherit', colors: { primary: 1 } }, DESIGN_BODY).ok, false, 'colors are strings');
  // Every [ASSUMPTION] mark in the body is listed in assumptions[], and only those.
  const marked = DESIGN_BODY + '- [ASSUMPTION] system font\n- [ASSUMPTION] 8px grid\n';
  assert.deepEqual((validateDesign({ mode: 'invent', colors: { primary: '#000' }, assumptions: [] }, marked) as { errors: string[] }).errors, ['the body has 2 [ASSUMPTION] marks but assumptions lists 0']);
  assert.deepEqual((validateDesign({ mode: 'invent', colors: { primary: '#000' }, assumptions: ['x'] }, DESIGN_BODY) as { errors: string[] }).errors, ['the body has 0 [ASSUMPTION] marks but assumptions lists 1']);
  assert.ok(validateDesign({ mode: 'invent', colors: { primary: '#000' }, assumptions: ['system font', '8px grid'] }, marked).ok);
});

test("checkOutput('designer'): the run's mode; at most one question, only in invent mode and only before one was answered", () => {
  const v = checkOutput('designer', design(INHERIT), { mode: 'inherit' });
  assert.ok(v.ok && v.status === 'DONE' && !v.question);
  assert.match((checkOutput('designer', design(INHERIT), { mode: 'invent' }) as { error: string }).error, /mode must be invent/);
  assert.match((checkOutput('designer', design(INHERIT, '## States\n')) as { error: string }).error, /no `## Components to use` section/);
  assert.match((checkOutput('designer', 'STATUS: DONE\n' + DESIGN_BODY) as { error: string }).error, /front matter missing/);
  assert.match((checkOutput('designer', design(INHERIT, DESIGN_BODY + QBLOCK), { mode: 'inherit' }) as { error: string }).error, /inherit mode asks no question/);
  const invent = INHERIT.replace('inherit', 'invent');
  const q = checkOutput('designer', design(invent, DESIGN_BODY + QBLOCK), { mode: 'invent' });
  assert.ok(q.ok);
  assert.deepEqual(q.question, { question: 'Light or dark?', a: 'Light', b: 'Dark', default: 'a' });
  assert.match((checkOutput('designer', design(invent, DESIGN_BODY + QBLOCK), { mode: 'invent', no_question: true }) as { error: string }).error, /already answered: ask no question/);
  assert.match((checkOutput('designer', design(invent, DESIGN_BODY + QBLOCK + QBLOCK), { mode: 'invent' }) as { error: string }).error, /at most one/);
  assert.match((checkOutput('designer', design(invent, DESIGN_BODY + QBLOCK.replace('default: a', 'default: both')), { mode: 'invent' }) as { error: string }).error, /default must be a or b/);
  assert.ok(checkOutput('designer', 'STATUS: ESCALATE\nSpec ambiguity: two products\n', { mode: 'inherit' }).ok);
});

test('checkOutput (3-4): Scaffold failed is the scaffolder\'s alone; a builder using it fails to parse', () => {
  const r = checkOutput('builder', 'STATUS: ESCALATE\nScaffold failed: x\n');
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Scaffold failed is the scaffolder's alone/);
});
