import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { REDACTED, redact, redactString } from '../src/core/redact.ts';

const SECRETS: [string, string][] = [
  ['pem', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----'],
  ['pem openssh', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn\n-----END OPENSSH PRIVATE KEY-----'],
  ['aws', 'AKIAIOSFODNN7EXAMPLE'],
  ['ghp', 'ghp_' + 'a'.repeat(36)],
  ['gho', 'gho_' + 'B1'.repeat(18)],
  ['ghs', 'ghs_' + 'x'.repeat(36)],
  ['github_pat', 'github_pat_11ABCDEFG0_' + 'z'.repeat(40)],
  ['sk', 'sk-ant-api03-' + 'Q'.repeat(30)],
  ['slack', 'xoxb-1234567890-abcdefghij'],
];

test('each secret pattern is replaced whole', () => {
  for (const [name, secret] of SECRETS) {
    assert.equal(redactString(`before ${secret} after`), `before ${REDACTED} after`, name);
  }
});

test('Bearer tokens keep the scheme word; short ones are left alone', () => {
  assert.equal(redactString('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123'), `Authorization: Bearer ${REDACTED}`);
  assert.equal(redactString('Bearer short'), 'Bearer short');
});

test('ordinary text is unchanged', () => {
  for (const s of ['/factory approve intake', 'task-sk-12', 'desk-' + 'a'.repeat(30), 'AKIA123', 'see ghp_short', 'Bearer of bad news']) {
    assert.equal(redactString(s), s, s);
  }
});

test('extra values are redacted wherever they occur; empty extras are ignored', () => {
  assert.equal(redactString('db=hunter2-pass; again hunter2-pass', ['hunter2-pass', '']), `db=${REDACTED}; again ${REDACTED}`);
});

test('redaction is idempotent, even with an extra value that occurs inside the marker', () => {
  const inputs = [...SECRETS.map(([, s]) => `x ${s} y`), 'Bearer ' + 'k'.repeat(40), 'plain'];
  for (const s of inputs) {
    const once = redactString(s, ['RED', 'plain']);
    assert.equal(redactString(once, ['RED', 'plain']), once, s);
  }
  assert.equal(redactString(`a ${REDACTED} b`, ['RED']), `a ${REDACTED} b`);
});

test('redact is deep over arrays and plain objects and keeps keys and non-strings', () => {
  const v = { prompt: '/factory add AKIAIOSFODNN7EXAMPLE', n: 3, ok: true, nil: null, list: ['ok', { k: 'xoxp-1234567890-abc' }], AKIAIOSFODNN7EXAMPLE: 1 };
  const r = redact(v);
  assert.deepEqual(r, { prompt: `/factory add ${REDACTED}`, n: 3, ok: true, nil: null, list: ['ok', { k: REDACTED }], AKIAIOSFODNN7EXAMPLE: 1 });
  assert.equal(v.prompt, '/factory add AKIAIOSFODNN7EXAMPLE', 'the input is not mutated');
  assert.deepEqual(redact(r), r);
});

test('redactCard (6-2): details, each option\'s then and the reply are redacted; commands and option commands stay exact; no options key is added', async () => {
  const { redactCard } = await import('../src/cli/steps.ts');
  const secret = 'hunter2-value-xyz';
  const card = {
    type: 'escalation', title: `t ${secret}`, reason: `r ${secret}`, details: [`Task: ${secret}`, 'plain'],
    options: [{ command: '/factory rule E1 retry <note…>', then: `retry ${secret}` }, { command: '/factory abandon', then: 'the run ends' }],
    reply: `reply ${secret}`, commands: ['/factory rule E1 retry <note…>', '/factory abandon'], escalation: 'E1',
  };
  const r = redactCard(card, [secret]);
  assert.deepEqual([r.title, r.reason, r.details, r.options![0].then, r.options![1].then, r.reply], [
    `t ${REDACTED}`, `r ${REDACTED}`, [`Task: ${REDACTED}`, 'plain'], `retry ${REDACTED}`, 'the run ends', `reply ${REDACTED}`,
  ]);
  assert.deepEqual(r.commands, card.commands);
  assert.deepEqual(r.options!.map((o) => o.command), card.options.map((o) => o.command));
  assert.equal(r.escalation, 'E1');
  const old = redactCard({ type: 'gate_1', title: `t ${secret}`, commands: ['/factory approve gate1'] }, [secret]);
  assert.equal('options' in old, false);
  assert.deepEqual([old.title, old.commands], [`t ${REDACTED}`, ['/factory approve gate1']]);
});
