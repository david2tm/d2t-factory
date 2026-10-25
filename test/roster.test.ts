// core/roster.ts (3-3): the roster from tags, a UI reference, UI-free and the intake overrides.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { APP_REVIEWERS, DIFF_REVIEWERS, REVIEWERS, rosterOf, SLICE_TAGS, sliceRoster } from '../src/core/roster.ts';

const intake = (o: { ui_free?: boolean; add?: string[]; remove?: string[] } = {}) => ({ ui_free: o.ui_free ?? false, reviewer_overrides: { add: o.add ?? [], remove: o.remove ?? [] } });
const ALL = ['reviewer-code', 'reviewer-security', 'reviewer-ux', 'reviewer-a11y', 'reviewer-ui'];

test('the constants: five tags, two diff reviewers, three running-app reviewers, in roster order', () => {
  assert.deepEqual([...SLICE_TAGS], ['ui', 'input', 'auth', 'secrets', 'external']);
  assert.deepEqual([...DIFF_REVIEWERS], ['reviewer-code', 'reviewer-security']);
  assert.deepEqual([...APP_REVIEWERS], ['reviewer-ux', 'reviewer-a11y', 'reviewer-ui']);
  assert.deepEqual(REVIEWERS, ALL);
});

test('reviewer-code always; security on input|auth|secrets|external; ux and a11y on ui; ui only with a reference', () => {
  const ref = { intake: intake(), hasReference: true };
  assert.deepEqual(rosterOf([], ref), ['reviewer-code']);
  for (const t of ['input', 'auth', 'secrets', 'external']) assert.deepEqual(rosterOf([t], ref), ['reviewer-code', 'reviewer-security']);
  assert.deepEqual(rosterOf(['ui'], ref), ['reviewer-code', 'reviewer-ux', 'reviewer-a11y', 'reviewer-ui']);
  assert.deepEqual(rosterOf(['input', 'ui'], ref), ALL, 'roster order, whatever the tag order');
  // No reference (no design, no ui_reference): reviewer-ui folds into reviewer-ux.
  assert.deepEqual(rosterOf(['ui'], { intake: intake(), hasReference: false }), ['reviewer-code', 'reviewer-ux', 'reviewer-a11y']);
  // A run from before 3-1 has no intake: no UI-free, no overrides.
  assert.deepEqual(rosterOf(['ui', 'auth'], { hasReference: true }), ALL);
});

test('UI-free drops the tag-derived UI reviewers, unless an override adds them', () => {
  assert.deepEqual(rosterOf(['ui', 'input'], { intake: intake({ ui_free: true }), hasReference: true }), ['reviewer-code', 'reviewer-security']);
  assert.deepEqual(rosterOf(['ui'], { intake: intake({ ui_free: true, add: ['reviewer-a11y'] }), hasReference: true }), ['reviewer-code', 'reviewer-a11y']);
});

test('overrides apply last, to every slice: remove drops, add adds; reviewer-ui with no reference adds reviewer-ux', () => {
  const o = { intake: intake({ remove: ['reviewer-security'], add: ['reviewer-a11y'] }), hasReference: false };
  for (const tags of [[], ['input'], ['ui', 'auth'], ['external', 'secrets']]) {
    const r = rosterOf(tags, o);
    assert.ok(!r.includes('reviewer-security') && r.includes('reviewer-a11y') && r[0] === 'reviewer-code', JSON.stringify([tags, r]));
  }
  assert.deepEqual(rosterOf([], { intake: intake({ add: ['reviewer-ui'] }), hasReference: false }), ['reviewer-code', 'reviewer-ux']);
  assert.deepEqual(rosterOf([], { intake: intake({ add: ['reviewer-ui'] }), hasReference: true }), ['reviewer-code', 'reviewer-ui']);
  assert.deepEqual(rosterOf(['ui'], { intake: intake({ remove: ['reviewer-ux', 'reviewer-ui'] }), hasReference: true }), ['reviewer-code', 'reviewer-a11y']);
  // reviewer-code can't be removed (validateIntake refuses it too), and unknown roles are ignored.
  assert.deepEqual(rosterOf([], { intake: intake({ remove: ['reviewer-code'], add: ['reviewer-perf'] }), hasReference: true }), ['reviewer-code']);
});

test('sliceRoster: the recorded roster, or reviewer-code for a slice from before 3-3', () => {
  assert.deepEqual(sliceRoster({ roster: ['reviewer-code', 'reviewer-ux'] }), ['reviewer-code', 'reviewer-ux']);
  assert.deepEqual(sliceRoster({}), ['reviewer-code']);
  assert.deepEqual(sliceRoster(undefined), ['reviewer-code']);
});
