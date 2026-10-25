import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseFindings, parseOutput, parseQuestion, parseScalar } from '../src/core/output.ts';

const ok = (text: string) => { const r = parseOutput(text); assert.ok(r.ok, r.ok ? '' : r.error); return r.value; };
const bad = (text: string, re: RegExp) => { const r = parseOutput(text); assert.equal(r.ok, false); assert.match((r as { error: string }).error, re); };

test('line 1 STATUS, then front matter from line 2, then the body', () => {
  const v = ok('STATUS: DONE\n---\norigin: brownfield\nui_surface: true\n---\n# Map\nline\n');
  assert.deepEqual({ form: v.form, value: v.value, front: v.front, has: v.has_front }, { form: 'STATUS', value: 'DONE', front: { origin: 'brownfield', ui_surface: true }, has: true });
  assert.equal(v.body, '# Map\nline\n');
});

test('scalars: booleans, null, numbers, JSON flow values, quoted strings; CRLF and a BOM are tolerated', () => {
  const v = ok('﻿STATUS: DONE\r\n---\r\nport: 5100\r\nratio: -1.5\r\nnone:\r\ntilde: ~\r\nlist: [".env", "a b"]\r\nobj: {"a": [1, {"b": null}]}\r\ns: "x: y #z"\r\nq: \'it\'\'s\'\r\nurl: http://localhost:5100/health\r\n# a comment\r\n\r\n---\r\n');
  assert.deepEqual(v.front, { port: 5100, ratio: -1.5, none: null, tilde: null, list: ['.env', 'a b'], obj: { a: [1, { b: null }] }, s: 'x: y #z', q: "it's", url: 'http://localhost:5100/health' });
  assert.deepEqual(parseScalar('007'), { ok: true, value: '007' }, 'leading zeros stay strings');
});

test('VERDICT forms and ESCALATE with its label line', () => {
  assert.equal(ok('VERDICT: FINDINGS\nbody').form, 'VERDICT');
  const e = ok('STATUS: ESCALATE\nScaffold failed: npm install needs network\n---\nport: 5100\n---\n');
  assert.deepEqual(e.escalation, { label: 'Scaffold failed', line: 'npm install needs network' });
  assert.deepEqual(e.front, { port: 5100 });
  assert.equal(ok('STATUS: ESCALATE\nSpec ambiguity: two readings\nrest').body, 'rest');
});

test('parse failures name what is wrong', () => {
  bad('', /line 1/);
  bad('Status: DONE', /line 1/);
  bad('STATUS: OK', /DONE\|ESCALATE/);
  bad('VERDICT: DONE', /APPROVE\|FINDINGS\|ESCALATE/);
  bad('STATUS: ESCALATE\nBecause: reasons', /line 2/);
  bad('STATUS: ESCALATE\n', /line 2/);
  bad('STATUS: DONE\n---\nport: 1\n', /never closed/);
  bad('STATUS: DONE\n---\njust text\n---\n', /not `key: value`/);
  bad('STATUS: DONE\n---\na: 1\na: 2\n---\n', /appears twice/);
  bad('STATUS: DONE\n---\nlist: [1, 2\n---\n', /list: not a single-line JSON value/);
  bad('STATUS: DONE\n---\ncmd: a: b\n---\n', /needs quoting/);
  bad('STATUS: DONE\n---\ncmd: - item\n---\n', /needs quoting/);
});

test('no front matter is allowed by the protocol; the schema decides whether it is required', () => {
  const v = ok('STATUS: DONE\nsome text');
  assert.equal(v.has_front, false);
  assert.deepEqual(v.front, {});
  assert.equal(v.body, 'some text');
});

test('finding blocks: category, location, failure_scenario in that order, an optional observed, charter categories only', () => {
  const block = (...rows: string[]) => ['```finding', ...rows, '```'].join('\n');
  const good = parseFindings(`Intro.\n\n${block('category: Bug', 'location: src/a.js:3', 'failure_scenario: an empty list throws')}\ntext\n${block('category: Spec miss', 'location: /#home', 'failure_scenario: AC-2 is not met', 'observed: / home screenshot.png')}\n`);
  assert.deepEqual(good, { ok: true, findings: [
    { category: 'Bug', location: 'src/a.js:3', failure_scenario: 'an empty list throws' },
    { category: 'Spec miss', location: '/#home', failure_scenario: 'AC-2 is not met', observed: '/ home screenshot.png' },
  ] });
  assert.deepEqual(parseFindings('no blocks here\n```js\ncode\n```\n'), { ok: true, findings: [] });
  const bad = (text: string, re: RegExp) => { const r = parseFindings(text); assert.equal(r.ok, false); assert.match((r as { error: string }).error, re); };
  bad(block('category: Nit', 'location: a:1', 'failure_scenario: x'), /category must be one of Bug \| Spec miss \| Security \| Breakage, got Nit/);
  bad(block('location: a:1', 'category: Bug', 'failure_scenario: x'), /line 1 must be `category: …`/);
  bad(block('category: Bug', 'location: a:1'), /failure_scenario is missing/);
  bad(block('category: Bug', 'location: ', 'failure_scenario: x'), /location is empty/);
  bad(block('category: Bug', 'location: a:1', 'failure_scenario: x', 'observed: y', 'extra: z'), /line 5/);
  bad('```finding\ncategory: Bug\n', /never closed/);
});

test('question block (3-2): question, a, b and default a|b in that order; none is fine; two, malformed or another default are errors', () => {
  const block = (rows: string) => `## States\n\n\`\`\`question\n${rows}\n\`\`\`\n`;
  assert.deepEqual(parseQuestion('## States\nnone\n'), { ok: true });
  assert.deepEqual(parseQuestion(block('question: Light or dark?\na: Light\n\nb: Dark\ndefault: b')), { ok: true, question: { question: 'Light or dark?', a: 'Light', b: 'Dark', default: 'b' } });
  const bad = (body: string, re: RegExp) => { const r = parseQuestion(body); assert.equal(r.ok, false, body); assert.match((r as { error: string }).error, re); };
  bad(block('question: q\na: x\nb: y\ndefault: a') + block('question: q\na: x\nb: y\ndefault: a'), /at most one ```question block, got 2/);
  bad(block('question: q\nb: y\na: x\ndefault: a'), /line 2 must be `a: …`/);
  bad(block('question: q\na: x\nb: y\ndefault: c'), /default must be a or b, got c/);
  bad(block('question: q\na: x\nb: y'), /default is missing/);
  bad(block('question: q\na:\nb: y\ndefault: a'), /a is empty/);
  bad(block('question: q\na: x\nb: y\ndefault: a\nextra: z'), /line 5 must be/);
  bad('```question\nquestion: q\n', /never closed/);
});

test('Scaffold failed (3-4) is the scaffolder\'s declared ask alone: a parse error for any other role, or with no role named', () => {
  const text = 'STATUS: ESCALATE\nScaffold failed: npm install fails\n';
  const as = (role?: string) => parseOutput(text, { role });
  assert.equal(as('scaffolder').ok, true);
  for (const role of ['builder', 'recon', undefined]) {
    const r = as(role);
    assert.equal(r.ok, false, String(role));
    assert.match((r as { error: string }).error, /Scaffold failed is the scaffolder's alone/);
  }
  assert.equal(parseOutput(text).ok, true, 'a structural read (no role named) is not checked');
  assert.equal(parseOutput('STATUS: ESCALATE\nOver time box: x\n', { role: 'builder' }).ok, true);
});
