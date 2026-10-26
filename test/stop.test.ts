import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { initialState, type RunState, type Step } from '../src/core/reducer.ts';
import { humanRejection, lastHumanTurn, mayStop } from '../src/core/stop.ts';

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

test('a reissued exit_worktree (ExitWorktree did not move the session) may end the turn: the human goes on from the main checkout', () => {
  assert.equal(mayStop(state([{ kind: 'exit_worktree', state: 'issued', attempt: 2 }], 'WRAP'), []).may, true);
  assert.equal(mayStop(state([{ kind: 'exit_worktree', state: 'issued', attempt: 2 }, { state: 'issued' }], 'WRAP'), []).may, false, 'other open steps still block');
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

// --- 6-1 transcript readers, over the pinned real records (test/fixtures/transcripts) -------------

const FIX = join(import.meta.dirname, 'fixtures', 'transcripts');
const pinned = (name: string): Record<string, any> => JSON.parse(readFileSync(join(FIX, `${name}.jsonl`), 'utf8'));
const SESSION = '11111111-1111-4111-8111-111111111111';
const REJECTED = pinned('user-rejected');
const GUARD = pinned('permission-rule');
const REJECTED_ID = 'toolu_011hXwq9VmqYWL6RKppEQ6GA';
const humanTurn = (uuid: string): object => ({ type: 'user', uuid, sessionId: SESSION, turnOrigin: 'human', message: { role: 'user', content: '/factory go' } });
// What a Stop block's feedback looks like in the transcript: isMeta, no turnOrigin.
const stopFeedback = { type: 'user', uuid: 'meta-1', sessionId: SESSION, isMeta: true, message: { role: 'user', content: 'Stop hook feedback: ...' } };
const REJECT_TEXT = "The user doesn't want to proceed with this tool use. The tool use was rejected";

test('the pinned records keep the structured denial fields the readers match on', () => {
  assert.deepEqual([REJECTED.toolDenialKind, REJECTED.permissionDecision.source, REJECTED.version], ['user-rejected', 'user_reject', '2.1.310']);
  assert.deepEqual([GUARD.toolDenialKind, GUARD.permissionDecision.source, GUARD.permissionDecision.reasonCode], ['permission-rule', 'hook', 'hook:PreToolUse']);
});

test('humanRejection: a human-rejected tool use after the last human turn matches, across Stop feedback', () => {
  assert.equal(humanRejection([humanTurn('h1'), REJECTED], SESSION), REJECTED_ID);
  assert.equal(humanRejection([humanTurn('h1'), REJECTED, stopFeedback], SESSION), REJECTED_ID);
  assert.equal(humanRejection([REJECTED], SESSION), REJECTED_ID, 'no human turn at all: the whole transcript is the turn');
});

test('humanRejection: echoed text, guard and deny-rule records, earlier turns, sidechains and other sessions never match', () => {
  const echoedAssistant = { type: 'assistant', sessionId: SESSION, message: { role: 'assistant', content: [{ type: 'text', text: REJECT_TEXT }] } };
  const echoedResult = { type: 'user', sessionId: SESSION, message: { role: 'user', content: [{ type: 'tool_result', content: `${REJECT_TEXT} user_reject user-rejected`, is_error: true, tool_use_id: 'toolu_x' }] } };
  const { toolDenialKind: _k, permissionDecision: _p, ...blob } = REJECTED; // an api-request-blob style repeat
  assert.equal(humanRejection([humanTurn('h1'), echoedAssistant, echoedResult, blob], SESSION), null);
  assert.equal(humanRejection([humanTurn('h1'), GUARD], SESSION), null);
  assert.equal(humanRejection([humanTurn('h1'), { ...GUARD, permissionDecision: { decision: 'reject', source: 'config' } }], SESSION), null);
  assert.equal(humanRejection([humanTurn('h1'), REJECTED, humanTurn('h2')], SESSION), null, 'rejected before the last human turn');
  assert.equal(humanRejection([humanTurn('h1'), { ...REJECTED, isSidechain: true }], SESSION), null);
  assert.equal(humanRejection([humanTurn('h1'), { ...REJECTED, sessionId: 'other' }], SESSION), null);
  assert.equal(humanRejection([humanTurn('h1'), { ...REJECTED, permissionDecision: { ...REJECTED.permissionDecision, decision: 'allow' } }], SESSION), null);
  const noError = { ...REJECTED, message: { ...REJECTED.message, content: [{ ...REJECTED.message.content[0], is_error: false }] } };
  assert.equal(humanRejection([humanTurn('h1'), noError], SESSION), null);
  assert.equal(humanRejection([humanTurn('h1'), null, 'x', [], { type: 'user' }], SESSION), null);
});

test('lastHumanTurn: the uuid of the last human prompt; Stop feedback (isMeta) and other entries are not turns', () => {
  assert.equal(lastHumanTurn([]), null);
  assert.equal(lastHumanTurn([humanTurn('h1'), REJECTED, stopFeedback]), 'h1');
  assert.equal(lastHumanTurn([humanTurn('h1'), humanTurn('h2'), GUARD]), 'h2');
  assert.equal(lastHumanTurn([humanTurn('h1'), { ...stopFeedback, turnOrigin: 'human' }]), 'h1');
});

// A non-human turn (a task notification) and the conductor's own entries after a rejection.
const notificationTurn = { type: 'user', uuid: 'n1', sessionId: SESSION, message: { role: 'user', content: '<task-notification>done</task-notification>' } };
const assistantText = { type: 'assistant', sessionId: SESSION, message: { role: 'assistant', content: [{ type: 'text', text: 'Waiting on you.' }] } };
const assistantToolUse = { type: 'assistant', sessionId: SESSION, message: { role: 'assistant', content: [{ type: 'text', text: 'Retrying.' }, { type: 'tool_use', id: 'toolu_next', name: 'Bash', input: {} }] } };

test('humanRejection (review 2026-10-25): a main-thread tool use after the rejection spends it, and any older one', () => {
  assert.equal(humanRejection([humanTurn('h1'), REJECTED, assistantToolUse], SESSION), null, 'the conductor works on with the feedback');
  assert.equal(humanRejection([humanTurn('h1'), REJECTED, notificationTurn, assistantToolUse, stopFeedback], SESSION), null, 'a notification turn, then a tool use');
  assert.equal(humanRejection([humanTurn('h1'), { ...REJECTED, uuid: 'old' }, assistantToolUse, GUARD], SESSION), null, 'an older rejection before that tool use never matches');
  // A sidechain tool use (a subagent's) doesn't spend it.
  assert.equal(humanRejection([humanTurn('h1'), REJECTED, { ...assistantToolUse, isSidechain: true }], SESSION), REJECTED_ID);
  // Nor does another session's (the same scope the rejection match uses).
  assert.equal(humanRejection([humanTurn('h1'), REJECTED, { ...assistantToolUse, sessionId: 'other' }], SESSION), REJECTED_ID);
});

test('humanRejection (review 2026-10-25): a non-human turn with text only keeps the rejection', () => {
  assert.equal(humanRejection([humanTurn('h1'), REJECTED, notificationTurn, assistantText], SESSION), REJECTED_ID);
  assert.equal(lastHumanTurn([humanTurn('h1'), REJECTED, notificationTurn, assistantText]), 'h1');
});
