import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { initialState, type RunState, type Step } from '../src/core/reducer.ts';
import { mayStop } from '../src/core/stop.ts';

function state(steps: Partial<Step>[], phase: RunState['phase'] = 'BUILD'): RunState {
  const s = initialState();
  s.run_id = 'r-abcd';
  s.phase = phase;
  steps.forEach((x, i) => {
    const id = `S${i}`;
    s.steps[id] = { id, kind: 'spawn', stage: 'BUILD', attempt: 1, state: 'issued', issued_seq: i, ...x } as Step;
    s.step_order.push(id);
  });
  return s;
}

const sub = (agent_type: string, status = 'running') => ({ id: 'a1', type: 'subagent', status, agent_type });
const shell = (status = 'running') => ({ id: 'b1', type: 'shell', status, command: 'factory next --wait 1000' });
const BUILDER = 'd2t-factory:builder';

test('no open steps: stopping is allowed (vacuous)', () => {
  assert.equal(mayStop(state([]), []).may, true);
  assert.equal(mayStop(state([{ state: 'verified' }, { state: 'reissued' }]), undefined).may, true);
});

test('terminal runs always allow stopping', () => {
  assert.equal(mayStop(state([{ state: 'issued' }], 'ABANDONED'), []).may, true);
  assert.equal(mayStop(state([{ state: 'issued' }], 'COMPLETED'), []).may, true);
});

test('every open step ask_human (issued, claimed or reported) allows stopping', () => {
  const s = state([{ kind: 'ask_human', state: 'issued' }, { kind: 'ask_human', state: 'claimed' }, { kind: 'ask_human', state: 'reported' }]);
  assert.equal(mayStop(s, []).may, true);
});

test('a claimed agent step needs a running subagent of the same agent type', () => {
  const s = state([{ agent: BUILDER, state: 'claimed' }]);
  assert.equal(mayStop(s, [sub(BUILDER)]).may, true);
  assert.equal(mayStop(s, [sub('d2t-factory:reviewer-code')]).may, false);
  assert.equal(mayStop(s, [sub(BUILDER, 'completed')]).may, false);
  assert.equal(mayStop(s, [shell()]).may, false);
  assert.equal(mayStop(s, []).may, false);
  assert.equal(mayStop(s, 'garbage').may, false);
  assert.equal(mayStop(state([{ kind: 'resume', agent: BUILDER, state: 'claimed' }]), [sub(BUILDER)]).may, true);
});

test('an issued or reported agent step blocks even with a matching subagent running', () => {
  assert.equal(mayStop(state([{ agent: BUILDER, state: 'issued' }]), [sub(BUILDER)]).may, false);
  assert.equal(mayStop(state([{ agent: BUILDER, state: 'reported' }]), [sub(BUILDER)]).may, false);
});

test('a claimed run_check needs a running background shell', () => {
  const s = state([{ kind: 'run_check', state: 'claimed' }]);
  assert.equal(mayStop(s, [shell()]).may, true);
  assert.equal(mayStop(s, [sub(BUILDER)]).may, false);
  assert.equal(mayStop(s, [shell('completed')]).may, false);
});

test('enter_worktree and exit_worktree never run in the background', () => {
  assert.equal(mayStop(state([{ kind: 'enter_worktree', state: 'claimed' }]), [shell(), sub(BUILDER)]).may, false);
  assert.equal(mayStop(state([{ kind: 'exit_worktree', state: 'issued' }], 'MERGED'), [shell(), sub(BUILDER)]).may, false);
  assert.equal(mayStop(state([{ kind: 'exit_worktree', state: 'claimed' }], 'MERGED'), [shell(), sub(BUILDER)]).may, false);
});

test('one background task carries one step; mixed sets need all of them covered', () => {
  const two = state([{ agent: BUILDER, state: 'claimed' }, { agent: BUILDER, role: 'other', state: 'claimed' }]);
  assert.equal(mayStop(two, [sub(BUILDER)]).may, false);
  assert.equal(mayStop(two, [sub(BUILDER), sub(BUILDER)]).may, true);
  const mixed = state([{ kind: 'ask_human', state: 'issued' }, { agent: BUILDER, state: 'claimed' }, { kind: 'run_check', state: 'claimed' }]);
  assert.equal(mayStop(mixed, [shell(), sub(BUILDER)]).may, true);
  const v = mayStop(mixed, [sub(BUILDER)]);
  assert.equal(v.may, false);
  assert.match(v.reason, /S2 \(run_check\) is claimed/);
});

test('the reported subject of an open escalation is parked: the card alone may end the turn', () => {
  const s = state([{ kind: 'spawn', role: 'scaffolder', state: 'reported' }, { kind: 'ask_human', state: 'claimed' }], 'SCAFFOLD');
  assert.equal(mayStop(s, []).may, false);
  s.asks.A = { id: 'A', card: { type: 'scaffold_failure', title: 't', commands: [] }, step_id: 'S0', escalation: 'E1', open: true };
  assert.equal(mayStop(s, []).may, true);
  s.asks.A.open = false;
  assert.equal(mayStop(s, []).may, false);
});
