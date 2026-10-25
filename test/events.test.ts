import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateEvent } from '../src/core/events.ts';

const base = { v: 1, id: '01JQ0000000000000000000001', ts: '2026-10-24T09:00:00.000Z', run: 'r-abcd', actor: 'cli', corr: 'x' };

test('a well-formed command validates', () => {
  assert.ok(validateEvent({ ...base, kind: 'stage_completed', data: { stage: 'RECON' } }).ok);
});

test('envelope errors are all reported', () => {
  const r = validateEvent({ v: 2, id: 'nope', ts: 'yesterday', run: '', actor: '', corr: 'x', kind: 'stage_completed', data: { stage: 'RECON' } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.length, 5);
});

test('unknown kinds and bad data fields are rejected', () => {
  assert.equal(validateEvent({ ...base, kind: 'made_up', data: {} }).ok, false);
  const r = validateEvent({ ...base, kind: 'stage_completed', data: { stage: 'LUNCH' } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors[0], /stage_completed.data.stage/);
});

test('decisions need actor human, a session and a prompt fact id', () => {
  const r = validateEvent({ ...base, kind: 'gate_1_passed', data: {} });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => /session/.test(e)));
    assert.ok(r.errors.some((e) => /actor human/.test(e)));
    assert.ok(r.errors.some((e) => /prompt_fact_id/.test(e)));
  }
  assert.ok(validateEvent({ ...base, actor: 'human', session: 's', kind: 'gate_1_passed', data: { prompt_fact_id: 'f' } }).ok);
});

test('facts carry corr null and a session', () => {
  const fact = { ...base, corr: null, session: 's', actor: 'hook', kind: 'output_written', data: { path: '/a' } };
  assert.ok(validateEvent(fact).ok);
  assert.equal(validateEvent({ ...fact, corr: 'x' }).ok, false);
  assert.equal(validateEvent({ ...fact, session: undefined }).ok, false);
});

test('commands need a known actor; facts need actor hook', () => {
  for (const actor of ['cli', 'conductor', 'human', 'd2t-factory:builder', 'd2t-factory:reviewer-code', 'd2t-factory:reviewer-a11y']) {
    assert.ok(validateEvent({ ...base, actor, kind: 'stage_completed', data: { stage: 'RECON' } }).ok, actor);
  }
  for (const actor of ['hook', 'd2t-factory:', 'd2t-factory:Builder', 'other:builder', 'd2t-factory:builder;rm', 'd2t-factory:a-', 'd2t-factory:a--b']) {
    const r = validateEvent({ ...base, actor, kind: 'stage_completed', data: { stage: 'RECON' } });
    assert.equal(r.ok, false, actor);
    if (!r.ok) assert.match(r.errors.join(), /actor/);
  }
  const fact = { ...base, corr: null, session: 's', actor: 'hook', kind: 'output_written', data: { path: '/a' } };
  assert.ok(validateEvent(fact).ok);
  for (const actor of ['anything', 'cli', 'human']) {
    const r = validateEvent({ ...fact, actor });
    assert.equal(r.ok, false, actor);
    if (!r.ok) assert.match(r.errors.join(), /requires actor hook/);
  }
});

test('additive 1-3 fields validate: session_started.supersedes, session_bound.rebind_fact_id', () => {
  assert.ok(validateEvent({ ...base, corr: null, session: 's', actor: 'hook', kind: 'session_started', data: { source: 'clear', supersedes: 'old' } }).ok);
  assert.ok(validateEvent({ ...base, session: 's', kind: 'session_bound', data: { session: 's', supersedes: 'old', rebind_fact_id: base.id } }).ok);
});

test('Object.prototype keys are not kinds', () => {
  for (const kind of ['constructor', 'toString', '__proto__']) {
    assert.equal(validateEvent({ ...base, kind, data: {} }).ok, false, kind);
  }
});
