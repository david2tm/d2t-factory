import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { matchTurn, parseCommandArgs, turnCommand } from '../src/core/decision.ts';
import { REDACTED } from '../src/core/redact.ts';

test('the grammar maps each subcommand with valid arity to its decision', () => {
  const k = (s: string): unknown => { const r = parseCommandArgs(s); return 'decision' in r ? r.decision : r; };
  assert.deepEqual(k('approve intake'), { kind: 'intake_confirmed', data: {} });
  assert.deepEqual(k('approve gate1'), { kind: 'gate_1_passed', data: {} });
  assert.deepEqual(k('approve gate2'), { kind: 'gate_2_passed', data: {} });
  assert.deepEqual(k('rework gate1 tighten  the AC'), { kind: 'rework_requested', data: { target: 'gate1', note: 'tighten  the AC' } });
  assert.deepEqual(k('rework S3 fix it'), { kind: 'rework_requested', data: { target: 'S3', note: 'fix it' } });
  assert.deepEqual(k('cut S1,S4'), { kind: 'cut_decided', data: { cut: ['S1', 'S4'] } });
  assert.deepEqual(k('keep'), { kind: 'cut_decided', data: { cut: [] } });
  assert.deepEqual(k('rule E2 keep going'), { kind: 'escalation_ruled', data: { escalation: 'E2', choice: 'keep going' } });
  assert.deepEqual(k('choose b'), { kind: 'design_choice_made', data: { choice: 'b' } });
  assert.deepEqual(k('merge'), { kind: 'merge_approved', data: {} });
  assert.deepEqual(k('rerun spec'), { kind: 'stage_rerun_requested', data: { stage: 'SPEC' } });
  assert.deepEqual(k('abandon'), { kind: 'run_abandoned', data: {} });
  assert.deepEqual(k('abandon add-x-ab12'), { kind: 'run_abandoned', data: {}, run_id: 'add-x-ab12' });
});

test('non-decisions: bare, resume [id], and task text', () => {
  assert.deepEqual(parseCommandArgs('   '), { intent: 'bare' });
  assert.deepEqual(parseCommandArgs('resume'), { intent: 'resume' });
  assert.deepEqual(parseCommandArgs('resume add-x-ab12'), { intent: 'resume', run_id: 'add-x-ab12' });
  assert.deepEqual(parseCommandArgs(' add login page '), { intent: 'start', task: 'add login page' });
});

test('a subcommand needs an exact match and valid arity, else the text is a task', () => {
  for (const s of ['approve', 'approve intake now', 'approve gate3', 'Approve intake', 'rework gate1', 'rework S1x note', 'cut', 'cut S1 S2', 'cut s1',
    'keep it', 'rule E1', 'rule X1 go', 'choose c', 'merge now', 'rerun', 'rerun lunch', 'abandon a b', 'resume a b', 'merged']) {
    assert.deepEqual(parseCommandArgs(s), { intent: 'start', task: s }, s);
  }
});

const S = 'sess-1';
const human = (args: string, pid = 'P1', session = S): any => ({ id: 'F1', session, data: { prompt_id: pid, command_name: 'd2t-factory:factory', command_args: args } });
const text = (prompt: string, pid = 'P1', session = S): any => ({ id: 'F2', session, data: { prompt_id: pid, prompt } });
const turn = (o: Record<string, unknown> = {}): any => ({
  type: 'user', promptId: 'P1', sessionId: S, turnOrigin: 'human',
  message: { content: '<command-message>x</command-message>\n<command-name>/factory</command-name>\n<command-args>approve intake</command-args>' }, ...o,
});

test('matchTurn accepts only the exact human turn', () => {
  const h = human('approve intake');
  const t = text('/factory approve intake');
  assert.equal(matchTurn([turn()], h, t, S), true);
  assert.equal(matchTurn([turn({ promptId: 'P0' })], h, t, S), false, 'replayed earlier turn');
  assert.equal(matchTurn([turn({ sessionId: 'other' })], h, t, S), false);
  assert.equal(matchTurn([turn({ turnOrigin: 'task-notification' })], h, t, S), false);
  assert.equal(matchTurn([turn({ type: 'assistant' })], h, t, S), false);
  assert.equal(matchTurn([turn({ message: { content: '/factory approve gate1' } })], h, t, S), false);
  assert.equal(matchTurn([], h, t, S), false);
});

test('matchTurn refuses facts that disagree with each other', () => {
  const t = text('/factory approve intake');
  assert.equal(matchTurn([turn()], human('approve gate1'), t, S), false, 'args differ from prompt text');
  assert.equal(matchTurn([turn()], human('approve intake', 'P2'), t, S), false, 'prompt ids differ');
  assert.equal(matchTurn([turn()], human('approve intake', 'P1', 'x'), t, S), false, 'fact from another session');
  assert.equal(matchTurn([turn()], { ...human('approve intake'), data: { ...human('approve intake').data, command_name: 'other' } }, t, S), false);
  assert.equal(matchTurn([turn({ message: { content: '/factory approve intake' } })], human('approve intake'), t, S), true, 'plain text turn');
});

// The format Claude Code 2.1.309 stores for a typed `/factory approve gate2` (spike 02 transcript).
const REAL = (args: string): string => `<command-message>d2t-factory:factory</command-message>\n<command-name>/d2t-factory:factory</command-name>\n<command-args>${args}</command-args>`;

test('turnCommand reads (name, args) from tagged and plain turns', () => {
  assert.deepEqual(turnCommand(REAL('approve gate2')), { name: 'd2t-factory:factory', args: 'approve gate2' });
  assert.deepEqual(turnCommand([{ type: 'text', text: REAL('  merge ') }]), { name: 'd2t-factory:factory', args: 'merge' });
  assert.deepEqual(turnCommand('<command-name>/factory</command-name>'), { name: 'factory', args: '' });
  assert.deepEqual(turnCommand('/factory   approve intake '), { name: 'factory', args: 'approve intake' });
  assert.equal(turnCommand('hello'), null);
  assert.equal(turnCommand(7), null);
});

test('matchTurn accepts the real namespaced turn for a typed /factory or /d2t-factory:factory prompt', () => {
  const h = human('approve intake');
  const real = turn({ message: { role: 'user', content: REAL('approve intake') } });
  assert.equal(matchTurn([real], h, text('/factory approve intake'), S), true);
  assert.equal(matchTurn([real], h, text('/d2t-factory:factory approve intake'), S), true);
  assert.equal(matchTurn([real], h, text('/factory   approve intake  '), S), true, 'extra spaces around the args');
  assert.equal(matchTurn([turn({ message: { content: REAL('approve gate1') } })], h, text('/factory approve intake'), S), false, 'different args');
  assert.equal(matchTurn([turn({ message: { content: REAL('approve intake').replaceAll('d2t-factory:factory', 'other:factory') } })], h, text('/factory approve intake'), S), false, 'another command');
  assert.equal(matchTurn([{ ...real, promptId: 'P0' }], h, text('/factory approve intake'), S), false);
  assert.equal(matchTurn([real], h, text('/factoryx approve intake'), S), false, 'prompt text that is not a factory command');
});

test('matchTurn redacts the turn args like the hook redacted the facts', () => {
  const key = 'AKIAIOSFODNN7EXAMPLE';
  const h = human(`add login with ${REDACTED}`);
  const t = text(`/factory add login with ${REDACTED}`);
  assert.equal(matchTurn([turn({ message: { content: REAL(`add login with ${key}`) } })], h, t, S), true);
  const h2 = human(`add login with ${REDACTED}`);
  const t2 = text(`/factory add login with ${REDACTED}`);
  const secretTurn = turn({ message: { content: REAL('add login with hunter2-pass') } });
  assert.equal(matchTurn([secretTurn], h2, t2, S), false, 'without the run\'s values');
  assert.equal(matchTurn([secretTurn], h2, t2, S, ['hunter2-pass']), true, 'with them');
});
