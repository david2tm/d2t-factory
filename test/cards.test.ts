import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as cards from '../src/core/cards.ts';
import { cardLines, cutCard, designChoiceCard, gate1Card, gate2Card, intakeCard, intakeConfirmCard, mergeCard, newDependencyCard, nonConvergenceCard, overTimeboxCard, roundWhy, stepNonConvergenceCard } from '../src/core/cards.ts';
import type { Card } from '../src/core/events.ts';
import { ESCALATION_LABELS } from '../src/core/output.ts';

const VIEW = {
  slices: [{ id: 'S1', title: 'add a footer', rounds: 1, verdicts: [{ role: 'reviewer-code', verdict: 'APPROVE' }] }], sha: '0123456789abcdef0123', target: 'fedcba', branch: 'main',
  diffstat: '2 files changed, 3 insertions(+)', test: { exit_code: 0 }, problems: [],
};

// The card's own fields, without what 6-2 added (options, reply, details): tested on their own below.
const base = (c: Card): Omit<Card, 'options' | 'reply' | 'details'> => {
  const { options: _o, reply: _r, details: _d, ...rest } = c;
  return rest;
};
const thens = (c: Card): Record<string, string> => Object.fromEntries((c.options ?? []).map((o) => [o.command, o.then]));
const ABANDON_THEN = 'the run ends; nothing is merged';
const ESC_REPLY = 'Ask in chat; to decide, type one of the commands.';

test('merge card: the slice, the sha, the diffstat, the test, the verdict and the rounds; merge only when nothing is in the way', () => {
  const ok = mergeCard(VIEW);
  assert.deepEqual(base(ok), {
    type: 'merge', title: 'Merge — approve the local merge', reason_label: 'Merge',
    reason: 'S1 add a footer · reviewer-code APPROVE · 1 round · 0123456789ab into main · 2 files changed, 3 insertions(+) · contract.test passed',
    commands: ['/factory merge', '/factory rework S1 <note…>', '/factory abandon'], sha: VIEW.sha, target: 'fedcba',
  });
  const blocked = mergeCard({ ...VIEW, test: { exit_code: 2 }, problems: ['contract.test failed (exit 2)'] });
  assert.equal(blocked.title, 'Merge — blocked');
  assert.deepEqual(blocked.commands, ['/factory rework S1 <note…>', '/factory abandon']);
  assert.match(blocked.reason!, /contract\.test failed \(exit 2\) · contract\.test failed \(exit 2\)$/);
  const noted = mergeCard({ ...VIEW, notes: ['the last git merge failed (exit 1) and was aborted'] });
  assert.equal(noted.commands[0], '/factory merge', 'a note does not block the merge');
  assert.match(noted.reason!, /contract\.test passed · the last git merge failed \(exit 1\) and was aborted$/);
  const detached = mergeCard({ ...VIEW, branch: null, target: null, test: undefined, diffstat: '', problems: ['detached'] });
  assert.match(detached.reason!, /into a detached HEAD · no diff · contract\.test not run · detached$/);
  // 3-3: one verdict per rostered reviewer, in roster order.
  const two = mergeCard({ ...VIEW, slices: [VIEW.slices[0], { id: 'S2', title: 'mail', rounds: 0, verdicts: [{ role: 'reviewer-code', verdict: 'APPROVE' }, { role: 'reviewer-security' }] }] });
  assert.match(two.reason!, /^S1 add a footer · reviewer-code APPROVE · 1 round · S2 mail · reviewer-code APPROVE, reviewer-security — · 0 rounds · /);
  assert.deepEqual(two.commands, ['/factory merge', '/factory rework S1 <note…>', '/factory rework S2 <note…>', '/factory abandon']);
  // 6-2: what each command does next, and what a chat reply does.
  assert.deepEqual(thens(two), {
    '/factory merge': 'the CLI merges the run branch into main locally and the run ends',
    '/factory rework S1 <note…>': 'S1 goes back to its builder and reviewers; this card comes back',
    '/factory rework S2 <note…>': 'S2 goes back to its builder and reviewers; this card comes back',
    '/factory abandon': ABANDON_THEN,
  });
  assert.equal(two.reply, 'Ask questions in chat; to change a slice, use rework.');
});

test('gate 2 card (3-3): one row per slice with its tags, deps and roster; a plan.lint failure shows its errors and offers rework only', () => {
  const slices = [
    { id: 'S1', title: 'Signup form', acs: ['AC-1', 'AC-2'], tags: ['ui', 'input'], deps: [], roster: ['reviewer-code', 'reviewer-security', 'reviewer-ux', 'reviewer-a11y', 'reviewer-ui'] },
    { id: 'S2', title: 'Welcome mail', acs: ['AC-3'], tags: [], deps: ['S1'], roster: ['reviewer-code'] },
  ];
  const g = gate2Card({ slices, lint: { ok: true, errors: [] }, cut: true });
  assert.deepEqual(base(g), {
    type: 'gate_2', title: 'Gate 2 — approve the slice plan', reason_label: 'Plan',
    reason: '2 slices: S1 Signup form (AC-1, AC-2) [ui, input] · code, security, ux, a11y, ui; S2 Welcome mail (AC-3) ← S1 · code',
    commands: ['/factory approve gate2', '/factory rework gate2 <note…>'],
  });
  assert.deepEqual(thens(g), {
    '/factory approve gate2': 'BUILD starts with the first slice; the next stop is the merge, unless an escalation or the cut point comes first',
    '/factory rework gate2 <note…>': 'the plan is redone with your note; Gate 2 comes back',
  });
  assert.equal(g.reply, 'Ask questions in chat; to change the plan, use rework.');
  // 6-2: a run with no time limit has no cut point.
  assert.equal(thens(gate2Card({ slices, lint: { ok: true, errors: [] }, cut: false }))['/factory approve gate2'], 'BUILD starts with the first slice; the next stop is the merge, unless an escalation comes first');
  const bad = gate2Card({ slices: [{ id: 'S1', title: 'x', acs: ['AC-1'] }], lint: { ok: false, errors: ['AC-2 is in no slice'] }, cut: true });
  assert.deepEqual([bad.reason, bad.commands], ['1 slice: S1 x (AC-1) · plan.lint failed: AC-2 is in no slice', ['/factory rework gate2 <note…>']]);
});

test('roundWhy (3-3): the failing check, and each reviewer still at FINDINGS with its count', () => {
  assert.equal(roundWhy({ check: { name: 'contract.test', exit_code: 1 }, findings: [] }), 'contract.test still fails (exit 1)');
  assert.equal(roundWhy({ findings: [{ role: 'reviewer-code', n: 1 }] }), 'reviewer-code still reports 1 finding');
  assert.equal(roundWhy({ findings: [{ role: 'reviewer-code', n: 1 }, { role: 'reviewer-security', n: 2 }] }), 'reviewer-code still reports 1 finding, reviewer-security still reports 2 findings');
  assert.equal(roundWhy({ check: { name: 'contract.health', exit_code: 1 }, findings: [{ role: 'reviewer-security', n: 1 }] }), 'contract.health still fails (exit 1); reviewer-security still reports 1 finding');
});

test('Non-convergence and New dependency cards: retry, accept and abandon, with the escalation id', () => {
  const nc = nonConvergenceCard({ escalation: 'E3', slice: 'S1', rounds: 2, why: 'reviewer-code still reports 1 finding' });
  assert.deepEqual(base(nc), {
    type: 'escalation', title: 'Non-convergence (S1)', reason_label: 'Non-convergence', reason: 'S1 is not done after 2 builder rounds: reviewer-code still reports 1 finding',
    commands: ['/factory rule E3 retry <note…>', '/factory rule E3 accept', '/factory abandon'], escalation: 'E3', condition: 3,
  });
  const ncd = nonConvergenceCard({ escalation: 'E3', slice: 'S1', rounds: 2, why: 'w', deps: ['package.json'] });
  assert.match(ncd.reason!, /: w · accept also accepts new dependencies: package\.json$/);
  const nd = newDependencyCard({ escalation: 'E1', slice: 'S1', files: ['package.json', 'package-lock.json'], sha: 'abc' });
  assert.deepEqual({ title: nd.title, reason: nd.reason, commands: nd.commands, sha: nd.sha }, {
    title: 'New dependency (S1)', reason: 'package.json, package-lock.json', commands: ['/factory rule E1 accept', '/factory rule E1 retry <note…>', '/factory abandon'], sha: 'abc',
  });
  assert.deepEqual(thens(nc), {
    '/factory rule E3 retry <note…>': 'S1 gets one more builder round, with your note', '/factory rule E3 accept': 'S1 closes as it is', '/factory abandon': ABANDON_THEN,
  });
  assert.equal(thens(ncd)['/factory rule E3 accept'], 'S1 closes as it is, with its new dependencies');
  assert.deepEqual(thens(nd), {
    '/factory rule E1 accept': 'the new dependency stays and S1 may close', '/factory rule E1 retry <note…>': 'S1 goes back to its builder with your note', '/factory abandon': ABANDON_THEN,
  });
  for (const c of [nc, ncd, nd]) assert.equal(c.reply, ESC_REPLY);
});

const INTAKE = {
  task: 'add an optional task giver to each todo', scope: { in: ['a giver field on add and edit', 'shown on the todo card'], out: ['filtering or sorting by giver'] },
  limit_min: 120, slice_timebox_min: 30, ui_free: false, reviewer_overrides: { add: [], remove: [] },
};

test('intake cards: the conversation has no commands and only a reply; the confirm card shows the settings, then the task and scope, and offers only approve', () => {
  const chat = intakeCard();
  assert.deepEqual([chat.type, chat.commands, chat.options], ['intake', [], []]);
  assert.equal(chat.reply, "Answer in chat; you'll then get a card to confirm the intake.");
  assert.match(chat.reason!, /whether there is a time limit \(optional\)/);
  assert.deepEqual(intakeConfirmCard(INTAKE), {
    type: 'intake', title: 'Intake — confirm the task', reason: 'time limit 2:00 · slice time box 30 min · UI-free no · reviewers: default',
    details: ['Task: add an optional task giver to each todo', 'In scope: a giver field on add and edit; shown on the todo card', 'Out of scope: filtering or sorting by giver'],
    options: [{ command: '/factory approve intake', then: 'RECON maps the repo, then SCAFFOLD; the next stop is Gate 1' }],
    reply: "Reply in chat to change any of this; you'll get this card again.",
    commands: ['/factory approve intake'],
  });
  const j = intakeConfirmCard({ ...INTAKE, limit_min: 95, slice_timebox_min: 20, ui_free: true, reviewer_overrides: { add: ['reviewer-security'], remove: ['reviewer-ux', 'reviewer-a11y'] }, started: '2026-10-24T14:05:00.000Z' });
  assert.equal(j.reason, 'time limit 1:35 · slice time box 20 min · UI-free yes · reviewers: +reviewer-security -reviewer-ux -reviewer-a11y · started 2026-10-24T14:05:00.000Z');
  // 6-2: no time limit; empty scope lists show a dash; greenfield orients with FRAME.
  const { limit_min: _l, ...noLimit } = INTAKE;
  const n = intakeConfirmCard({ ...noLimit, scope: { in: ['x'], out: [] } }, { greenfield: true });
  assert.equal(n.reason, 'no time limit · slice time box 30 min · UI-free no · reviewers: default');
  assert.deepEqual(n.details, ['Task: add an optional task giver to each todo', 'In scope: x', 'Out of scope: —']);
  assert.equal(n.options![0].then, 'FRAME picks the stack, then SCAFFOLD; the next stop is Gate 1');
});

test('cardLines (6-2): the AD-34 order, as the conductor prints it; an old card lists its commands with no then and no reply', () => {
  assert.deepEqual(cardLines(intakeConfirmCard(INTAKE)), [
    'Intake — confirm the task',
    'time limit 2:00 · slice time box 30 min · UI-free no · reviewers: default',
    'Task: add an optional task giver to each todo',
    'In scope: a giver field on add and edit; shown on the todo card',
    'Out of scope: filtering or sorting by giver',
    'To continue, type one of:',
    '  /factory approve intake — RECON maps the repo, then SCAFFOLD; the next stop is Gate 1',
    "Reply in chat to change any of this; you'll get this card again.",
  ]);
  // A card recorded before 6-2 keeps the old chat shape: title, reason, each command on its own line.
  const old: Card = { type: 'gate_1', title: 'Gate 1 — approve the spec', reason_label: 'Spec', reason: '/s.md · 1 assumption to check', commands: ['/factory approve gate1', '/factory rework gate1 <note…>'] };
  assert.deepEqual(cardLines(old), ['Gate 1 — approve the spec', '/s.md · 1 assumption to check', '/factory approve gate1', '/factory rework gate1 <note…>']);
  // No commands (the intake conversation): no `To continue` line; the reply closes it.
  assert.deepEqual(cardLines(intakeCard()).slice(-1), ["Answer in chat; you'll then get a card to confirm the intake."]);
  assert.equal(cardLines(intakeCard()).includes('To continue, type one of:'), false);
  assert.deepEqual(cardLines({ type: 'x', title: 't', commands: [] }), ['t']);
});

test('cut card: every candidate in the title and in `cut`, plus keep', () => {
  const c = cutCard([{ id: 'S2', title: 'Styles' }, { id: 'S3', title: 'Links' }]);
  assert.deepEqual(base(c), {
    type: 'cut', title: 'Cut point reached — 2 slices unbuilt. Cut S2, S3?', reason: 'S2 Styles · S3 Links', commands: ['/factory cut S2,S3', '/factory keep'],
  });
  assert.deepEqual(thens(c), { '/factory cut S2,S3': 'S2, S3 are not built; BUILD goes on with the rest', '/factory keep': 'every slice is built; no cut is proposed again' });
  assert.equal(c.reply, ESC_REPLY, 'every card printed in chat has a reply line');
  assert.equal(cutCard([{ id: 'S5' }]).title, 'Cut point reached — 1 slice unbuilt. Cut S5?');
});

test('gate 1 card: spec only as before without a design; with one, `Spec + Design ready`, both paths, the mode and both assumption counts', () => {
  const lint = { ok: true, errors: [] };
  const s1 = gate1Card({ spec_path: '/s.md', assumptions: 1, lint });
  assert.deepEqual(base(s1), {
    type: 'gate_1', title: 'Gate 1 — approve the spec', reason_label: 'Spec', reason: '/s.md · 1 assumption to check', commands: ['/factory approve gate1', '/factory rework gate1 <note…>'],
  });
  const g = gate1Card({ spec_path: '/s.md', assumptions: 1, lint, design: { path: '/d.md', mode: 'inherit', assumptions: 2 } });
  assert.deepEqual([g.type, g.title, g.reason, g.commands], ['gate_1', 'Gate 1 — Spec + Design ready', '/s.md · /d.md (inherit) · 3 assumptions to check', ['/factory approve gate1', '/factory rework gate1 <note…>']]);
  const failing = gate1Card({ spec_path: '/s.md', assumptions: 0, lint: { ok: false, errors: ['no Assumptions section'] }, design: { path: '/d.md', mode: 'invent', assumptions: 0 } });
  assert.deepEqual([failing.reason, failing.commands], ['/s.md · /d.md (invent) · 0 assumptions to check · spec.lint failed: no Assumptions section', ['/factory rework gate1 <note…>']]);
  // 6-2: rework names DESIGN only when there is a design.
  assert.deepEqual(thens(s1), {
    '/factory approve gate1': 'SLICE PLAN splits the spec into slices; the next stop is Gate 2', '/factory rework gate1 <note…>': 'SPEC is redone with your note; Gate 1 comes back',
  });
  assert.equal(thens(g)['/factory rework gate1 <note…>'], 'SPEC and DESIGN are redone with your note; Gate 1 comes back');
  assert.equal(s1.reply, 'Ask questions in chat; to change the spec, use rework.');
  assert.equal(g.reply, 'Ask questions in chat; to change the spec or design, use rework.');
});

test('design_choice card: the question in the title, both options and the default, choose a and choose b', () => {
  const d = designChoiceCard({ question: 'Light or dark?', a: 'Light', b: 'Dark', default: 'a' });
  assert.deepEqual(base(d), {
    type: 'design_choice', title: 'Design question — Light or dark?', reason_label: 'Design',
    reason: 'a: Light · b: Dark · default a (the design is written for it)', commands: ['/factory choose a', '/factory choose b'],
  });
  assert.deepEqual(thens(d), { '/factory choose a': 'design.md stays as written; then Gate 1', '/factory choose b': 'a fresh designer writes design.md for b; then Gate 1' });
  assert.equal(thens(designChoiceCard({ question: 'q', a: 'A', b: 'B', default: 'b' }))['/factory choose b'], 'design.md stays as written; then Gate 1');
  assert.equal(d.reply, ESC_REPLY);
});

// --- 3-4: the closed ask list ---------------------------------------------------------------------

test('Over time box and step Non-convergence cards (3-4): condition 3, the label and one line; retry and cut, or retry', () => {
  const tb = overTimeboxCard({ escalation: 'E4', slice: 'S4', elapsed_min: 34, limit_min: 30 });
  assert.deepEqual(base(tb), {
    type: 'escalation', title: 'Over time box (S4)', reason_label: 'Over time box', reason: 'S4 at 34 / 30 min.',
    commands: ['/factory rule E4 retry <note…>', '/factory rule E4 cut', '/factory abandon'], escalation: 'E4', condition: 3,
  });
  assert.equal(`${tb.reason_label}: ${tb.reason}`, 'Over time box: S4 at 34 / 30 min.');
  const st = stepNonConvergenceCard({ escalation: 'E2', role: 'builder', slice: 'S1', attempt: 3, error: 'line 1 must be `STATUS: DONE|ESCALATE`' });
  assert.deepEqual({ title: st.title, reason: st.reason, commands: st.commands, condition: st.condition }, {
    title: 'Non-convergence (builder on S1)', reason: 'builder on S1 failed 3 attempts: line 1 must be `STATUS: DONE|ESCALATE`',
    commands: ['/factory rule E2 retry <note…>', '/factory abandon'], condition: 3,
  });
  assert.deepEqual(thens(tb), {
    '/factory rule E4 retry <note…>': 'S4 gets another full time box; your note goes to its builder',
    '/factory rule E4 cut': 'S4 is cut; its commits are kept and BUILD goes on with the rest',
    '/factory abandon': ABANDON_THEN,
  });
  assert.deepEqual(thens(st), { '/factory rule E2 retry <note…>': 'builder on S1 gets one more attempt, with your note', '/factory abandon': ABANDON_THEN });
});

test('escalation and SCAFFOLD failure cards (6-2): each command with its then; the escalation reply', () => {
  const e = cards.escalationCard({ escalation: 'E1', label: 'Spec ambiguity', line: 'which footer?', role: 'spec-writer' });
  assert.deepEqual(thens(e), { '/factory rule E1 retry <note…>': 'spec-writer gets your note and tries again', '/factory abandon': ABANDON_THEN });
  const sf = cards.scaffoldFailureCard({ escalation: 'E2', failures: ['contract.test failed (exit 1)'], accept: true });
  assert.deepEqual(thens(sf), {
    '/factory rule E2 retry <note…>': 'the scaffolder runs again with your note, then the checks', '/factory rule E2 accept': 'SCAFFOLD is accepted as is and SPEC starts', '/factory abandon': ABANDON_THEN,
  });
  assert.equal(sf.reason, 'contract.test failed (exit 1)', 'the reason is 6-4\'s');
  for (const c of [e, sf]) assert.equal(c.reply, ESC_REPLY);
  // SIGNAL LOST is board-only: options, no reply.
  const sl = cards.signalLostCard('r-1');
  assert.deepEqual([sl.commands, sl.reply], [['/factory resume r-1'], undefined]);
  assert.ok(sl.options![0].then);
});

// Every card the CLI can raise, one sample each. The dashboard's SIGNAL LOST is not an ask: lost
// liveness is shown on the board only, never in chat.
const SAMPLES: Record<string, Card[]> = {
  intakeCard: [intakeCard()],
  intakeConfirmCard: [intakeConfirmCard(INTAKE), intakeConfirmCard({ ...INTAKE, limit_min: undefined }, { greenfield: true })],
  cutCard: [cutCard([{ id: 'S2' }])],
  gate1Card: [gate1Card({ spec_path: 'p', assumptions: 0, lint: { ok: true, errors: [] } }), gate1Card({ spec_path: 'p', assumptions: 0, lint: { ok: false, errors: ['e'] }, design: { path: 'd', mode: 'invent', assumptions: 0 } })],
  gate2Card: [gate2Card({ slices: [{ id: 'S1' }], lint: { ok: true, errors: [] }, cut: true }), gate2Card({ slices: [{ id: 'S1' }], lint: { ok: false, errors: ['e'] }, cut: false })],
  mergeCard: [mergeCard(VIEW), mergeCard({ ...VIEW, problems: ['p'] })],
  designChoiceCard: [designChoiceCard({ question: 'q', a: 'A', b: 'B', default: 'a' })],
  scaffoldFailureCard: [cards.scaffoldFailureCard({ escalation: 'E1', failures: ['x'], accept: true }), cards.scaffoldFailureCard({ escalation: 'E1', failures: ['x'], accept: false })],
  escalationCard: ESCALATION_LABELS.filter((l) => l !== 'Scaffold failed').map((label) => cards.escalationCard({ escalation: 'E1', label, line: 'why', role: 'builder' })),
  stepNonConvergenceCard: [stepNonConvergenceCard({ escalation: 'E1', role: 'reviewer-code', attempt: 3, error: 'e' })],
  overTimeboxCard: [overTimeboxCard({ escalation: 'E1', slice: 'S1', elapsed_min: 30, limit_min: 30 })],
  nonConvergenceCard: [nonConvergenceCard({ escalation: 'E1', slice: 'S1', rounds: 2, why: 'w' })],
  newDependencyCard: [newDependencyCard({ escalation: 'E1', slice: 'S1', files: ['package.json'], sha: 's' })],
};
const DASHBOARD_ONLY = ['signalLostCard'];
const PLANNED = ['intake', 'gate_1', 'gate_2', 'cut', 'merge'];
const DECLARED = ['scaffold_failure', 'design_choice', 'resume_select'];

// The one closed-list entry a card maps to, or why it maps to none or several.
function entry(c: Card): string {
  const hits = [
    ...(PLANNED.includes(c.type) ? [`planned gate ${c.type}`] : []),
    ...(c.type === 'escalation' && [1, 2, 3, 4].includes(c.condition as number) ? [`escalation condition ${c.condition}`] : []),
    ...(DECLARED.includes(c.type) ? [`declared ask ${c.type}`] : []),
  ];
  return hits.length === 1 ? hits[0] : `${hits.length} entries for ${JSON.stringify(c)}`;
}

test('the closed ask list (3-4): every card the CLI can raise maps to exactly one entry: a planned gate, an escalation with condition 1–4, or a declared ask', () => {
  const builders = Object.keys(cards).filter((k) => k.endsWith('Card')).sort();
  assert.deepEqual(builders, [...Object.keys(SAMPLES), ...DASHBOARD_ONLY].sort(), 'every card builder has a sample here');
  for (const [name, list] of Object.entries(SAMPLES)) {
    for (const c of list) assert.match(entry(c), /^(planned gate \S+|escalation condition [1-4]|declared ask \S+)$/, `${name}: ${entry(c)}`);
  }
  // Each escalation label lands on its condition in the review policy.
  assert.deepEqual(SAMPLES.escalationCard.map((c) => [c.reason_label, c.condition]), [
    ['Scope change', 1], ['Spec ambiguity', 1], ['Irreversible action', 2], ['New dependency', 2], ['Non-convergence', 3], ['Over time box', 3], ['Taste disagreement', 4],
  ]);
  assert.equal(entry(cards.signalLostCard('r')), '0 entries for ' + JSON.stringify(cards.signalLostCard('r')), 'SIGNAL LOST is no ask');
});

test('every card function (6-2): commands deep-equals options.map(command); every option has a non-empty then; every card printed in chat has a reply line', () => {
  const all: [string, Card][] = [...Object.entries(SAMPLES).flatMap(([name, list]) => list.map((c): [string, Card] => [name, c])), ['signalLostCard', cards.signalLostCard('r')]];
  for (const [name, c] of all) {
    assert.ok(Array.isArray(c.options), `${name}: options`);
    assert.deepEqual(c.commands, c.options!.map((o) => o.command), `${name}: commands = options.map(command)`);
    for (const o of c.options!) assert.ok(typeof o.then === 'string' && o.then.trim(), `${name}: ${o.command} has a then`);
    if (name !== 'signalLostCard') assert.ok(c.reply?.trim(), `${name}: a reply line`);
  }
});
