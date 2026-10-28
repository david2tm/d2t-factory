// Cards (AD-34): derived here only, embedded in `next` steps and `ask_raised`. Pure: no I/O.
// `commands` lists only the decisions that are legal for the card. 6-2: each command comes as an
// option with its `then` (what happens after it is typed), and `commands` is derived from the
// options; `reply` says, truthfully, what a chat reply does at the card (AD-6: only at the intake
// does it change anything).
import type { Card, CardOption, DesignQuestion, Intake, SlicePlanEntry } from './events.ts';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const pad2 = (n: number): string => String(n).padStart(2, '0');
// Minutes as `h:mm` (120 → 2:00).
export const hm = (min: number): string => `${Math.floor(min / 60)}:${pad2(min % 60)}`;

// The options and the commands derived from them, so the two can never disagree.
const withOptions = (options: CardOption[]): { options: CardOption[]; commands: string[] } => ({ options, commands: options.map((o) => o.command) });
const opt = (command: string, then: string): CardOption => ({ command, then });

// The reply lines (a chat reply changes nothing outside the intake: decisions are typed only).
const ESCALATION_REPLY = 'Ask in chat; to decide, type one of the commands.';
const gateReply = (what: string): string => `Ask questions in chat; to change ${what}, use rework.`;
const ABANDON = opt('/factory abandon', 'the run ends; nothing is merged');

// A card in the AD-34 order, one string per line: the title, the reason, the details, `To continue,
// type one of:`, one `command — then` per option, the reply. The conductor prints these lines
// verbatim (next's card_text) and the Needs You card renders the same order. A card recorded before
// 6-2 has only `commands`: it keeps the old chat shape (title, reason, then each command on its own
// line, with no header and no reply).
export function cardLines(card: Card): string[] {
  const head = [card.title, ...(card.reason ? [card.reason] : []), ...(card.details ?? [])];
  if (!card.options) return [...head, ...(card.commands ?? [])];
  return [
    ...head,
    ...(card.options.length ? ['To continue, type one of:', ...card.options.map((o) => `  ${o.command} — ${o.then}`)] : []),
    ...(card.reply ? [card.reply] : []),
  ];
}

// The INTAKE conversation (3-1): the conductor agrees the task, its scope and the settings with
// the human in chat and writes the intake out.md. No decision answers it, so it has no commands.
export function intakeCard(): Card {
  return {
    type: 'intake',
    title: 'Intake — agree the task with the human',
    reason: 'Ask for the task and its scope, whether there is a time limit (optional), the slice time box, whether the task is UI-free and any reviewer overrides; then write the intake and run factory done.',
    ...withOptions([]),
    reply: "Answer in chat; you'll then get a card to confirm the intake.",
  };
}

const list = (xs: readonly string[] | undefined): string => (xs?.length ? xs.join('; ') : '—');

// The intake as recorded, for the human to confirm before RECON (AD-34): the settings as the
// reason, the task and scope as details. Greenfield orients with FRAME instead of RECON.
export function intakeConfirmCard(i: Intake, o: { greenfield?: boolean } = {}): Card {
  const { add, remove } = i.reviewer_overrides;
  const reviewers = add.length || remove.length ? [...add.map((r) => `+${r}`), ...remove.map((r) => `-${r}`)].join(' ') : 'default';
  const limit = typeof i.limit_min === 'number' ? `time limit ${hm(i.limit_min)}` : 'no time limit';
  const fields = [limit, `slice time box ${i.slice_timebox_min} min`, `UI-free ${i.ui_free ? 'yes' : 'no'}`, `reviewers: ${reviewers}`];
  const orient = o.greenfield ? 'FRAME picks the stack' : 'RECON maps the repo';
  return {
    type: 'intake',
    title: 'Intake — confirm the task',
    reason: [...fields, ...(i.started ? [`started ${i.started}`] : [])].join(' · '),
    details: [`Task: ${i.task || '—'}`, `In scope: ${list(i.scope?.in)}`, `Out of scope: ${list(i.scope?.out)}`],
    ...withOptions([opt('/factory approve intake', `${orient}, then SCAFFOLD; the next stop is Gate 1`)]),
    reply: "Reply in chat to change any of this; you'll get this card again.",
  };
}

// The live cut gate (AD-17): raised by the CLI once the budget clock passes the cut point with
// slices still in Backlog. It lists every candidate; `cut` may name any subset of them.
export function cutCard(slices: readonly Pick<SlicePlanEntry, 'id' | 'title'>[]): Card {
  const ids = slices.map((s) => s.id);
  return {
    type: 'cut',
    title: `Cut point reached — ${plural(ids.length, 'slice')} unbuilt. Cut ${ids.join(', ')}?`,
    reason: slices.map((s) => `${s.id}${s.title ? ` ${s.title}` : ''}`).join(' · '),
    ...withOptions([
      opt(`/factory cut ${ids.join(',')}`, `${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} not built; BUILD goes on with the rest`),
      opt('/factory keep', 'every slice is built; no cut is proposed again'),
    ]),
    reply: ESCALATION_REPLY,
  };
}

export interface LintView { ok: boolean; errors: string[] }

function lintNote(lint: LintView, name: string): string {
  return lint.ok ? '' : ` · ${name} failed: ${lint.errors.join('; ')}`;
}

// The tracked files the sandbox refused to check out into the worktree (AD-15, 8-1), as the detail
// line on the SCAFFOLD and Gate 1 cards. Nothing when there are none (old runs replay unchanged).
export const readonlyDetail = (paths: readonly string[]): string => `Read-only in this run (the sandbox refuses them): ${paths.join(', ')}`;
const readonlyDetails = (paths: readonly string[] | undefined): { details?: string[] } => (paths?.length ? { details: [readonlyDetail(paths)] } : {});

// With a designer (3-2) the card names both files and counts the spec's and the design's assumptions;
// without one it is the spec-only card. `readonly`: the run's read-only paths (8-1).
export function gate1Card(o: { spec_path: string; assumptions: number; lint: LintView; design?: { path: string; mode: string; assumptions: number }; readonly?: readonly string[] }): Card {
  const d = o.design;
  return {
    type: 'gate_1',
    title: d ? 'Gate 1 — Spec + Design ready' : 'Gate 1 — approve the spec',
    reason_label: d ? 'Spec + Design' : 'Spec',
    reason: `${o.spec_path} · ${d ? `${d.path} (${d.mode}) · ` : ''}${plural(o.assumptions + (d?.assumptions ?? 0), 'assumption')} to check${lintNote(o.lint, 'spec.lint')}`,
    ...readonlyDetails(o.readonly),
    ...withOptions([
      ...(o.lint.ok ? [opt('/factory approve gate1', 'SLICE PLAN splits the spec into slices; the next stop is Gate 2')] : []),
      opt('/factory rework gate1 <note…>', `${d ? 'SPEC and DESIGN are' : 'SPEC is'} redone with your note; Gate 1 comes back`),
    ]),
    reply: gateReply(d ? 'the spec or design' : 'the spec'),
  };
}

// The designer's one question (invent mode, a declared ask): two options; the design is already
// written for the default, so choosing it costs nothing. The other voids it, and a fresh designer
// writes design.md for that option.
export function designChoiceCard(q: DesignQuestion): Card {
  const then = (c: 'a' | 'b'): string => (c === q.default ? 'design.md stays as written; then Gate 1' : `a fresh designer writes design.md for ${c}; then Gate 1`);
  return {
    type: 'design_choice',
    title: `Design question — ${q.question}`,
    reason_label: 'Design',
    reason: `a: ${q.a} · b: ${q.b} · default ${q.default} (the design is written for it)`,
    ...withOptions([opt('/factory choose a', then('a')), opt('/factory choose b', then('b'))]),
    reply: ESCALATION_REPLY,
  };
}

// A reviewer's short name on a card row: `reviewer-security` → `security`.
const short = (role: string): string => role.replace(/^reviewer-/, '');

// One row per slice (3-3): `S1 Signup form (AC-1, AC-2) [ui, input] · code, security, ux, a11y, ui`,
// with `← S1` for its dependencies. A plan.lint failure lists its errors and offers rework only.
// `cut`: the run has a time limit, so the cut point may come before the merge.
export function gate2Card(o: { slices: readonly SlicePlanEntry[]; lint: LintView; cut: boolean }): Card {
  const rows = o.slices.map((s) => [
    `${s.id} ${s.title ?? ''} (${(s.acs ?? []).join(', ')})`,
    s.tags?.length ? ` [${s.tags.join(', ')}]` : '',
    s.deps?.length ? ` ← ${s.deps.join(', ')}` : '',
    s.roster?.length ? ` · ${s.roster.map(short).join(', ')}` : '',
    s.notes?.length ? ` · ${plural(s.notes.length, 'note')}` : '',
  ].join(''));
  return {
    type: 'gate_2',
    title: 'Gate 2 — approve the slice plan',
    reason_label: 'Plan',
    reason: `${plural(o.slices.length, 'slice')}: ${rows.join('; ')}${lintNote(o.lint, 'plan.lint')}`,
    ...withOptions([
      ...(o.lint.ok ? [opt('/factory approve gate2', `BUILD starts with the first slice; the next stop is the merge, unless an escalation${o.cut ? ' or the cut point' : ''} comes first`)] : []),
      opt('/factory rework gate2 <note…>', 'the plan is redone with your note; Gate 2 comes back'),
    ]),
    reply: gateReply('the plan'),
  };
}

// `accept` is legal only over a parsed DONE run contract (its checks failed); otherwise there is
// no contract to go on with, and the card offers retry and abandon. After a repair round (6-4) the
// reason names both rounds: `round 1: <r1> · repair: <contract diff> · round 2: <failures>` (no
// `repair:` part when the repair escalated). `readonly`: the run's read-only paths (8-1).
export function scaffoldFailureCard(o: { escalation: string; failures: readonly string[]; accept: boolean; rounds?: { r1: readonly string[]; repair?: string }; readonly?: readonly string[] }): Card {
  const reason = o.failures.join('; ');
  return {
    type: 'scaffold_failure',
    title: 'SCAFFOLD failed — the project does not run as the run contract says',
    reason_label: 'Scaffold failed',
    reason: o.rounds ? `round 1: ${o.rounds.r1.join('; ')}${o.rounds.repair !== undefined ? ` · repair: ${o.rounds.repair}` : ''} · round 2: ${reason}` : reason,
    ...readonlyDetails(o.readonly),
    ...withOptions([
      opt(`/factory rule ${o.escalation} retry <note…>`, 'the scaffolder runs again with your note, then the checks'),
      ...(o.accept ? [opt(`/factory rule ${o.escalation} accept`, 'SCAFFOLD is accepted as is and SPEC starts')] : []),
      ABANDON,
    ]),
    reply: ESCALATION_REPLY,
    escalation: o.escalation,
  };
}

// The closed ask list (review policy): each escalation label's condition. `Scaffold failed` is not
// an escalation but a declared ask (its own scaffold_failure card).
export const CONDITION: Readonly<Record<string, 1 | 2 | 3 | 4>> = {
  'Scope change': 1, 'Spec ambiguity': 1, 'Irreversible action': 2, 'New dependency': 2, 'Non-convergence': 3, 'Over time box': 3, 'Taste disagreement': 4,
};
const conditionOf = (label: string): { condition?: 1 | 2 | 3 | 4 } => (Object.hasOwn(CONDITION, label) ? { condition: CONDITION[label] } : {});

// An agent's `STATUS: ESCALATE` outside SCAFFOLD. 1-4 offers a retry with a note, or abandon.
export function escalationCard(o: { escalation: string; label: string; line: string; role?: string }): Card {
  return {
    type: 'escalation',
    title: `${o.label}${o.role ? ` (${o.role})` : ''}`,
    reason_label: o.label,
    reason: o.line,
    ...withOptions([opt(`/factory rule ${o.escalation} retry <note…>`, `${o.role ?? 'the agent'} gets your note and tries again`), ABANDON]),
    reply: ESCALATION_REPLY,
    escalation: o.escalation,
    ...conditionOf(o.label),
  };
}

// 3-4: a step whose output still fails to parse (or whose agent stopped without one) at
// MAX_STEP_ATTEMPTS (condition 3). retry buys one more attempt.
export function stepNonConvergenceCard(o: { escalation: string; role: string; slice?: string; attempt: number; error: string }): Card {
  const who = `${o.role}${o.slice ? ` on ${o.slice}` : ''}`;
  return {
    type: 'escalation',
    title: `Non-convergence (${who})`,
    reason_label: 'Non-convergence',
    reason: `${who} failed ${plural(o.attempt, 'attempt')}: ${o.error}`,
    ...withOptions([opt(`/factory rule ${o.escalation} retry <note…>`, `${who} gets one more attempt, with your note`), ABANDON]),
    reply: ESCALATION_REPLY,
    escalation: o.escalation,
    condition: 3,
  };
}

// 3-4: a slice past its time box (condition 3), `S4 at 34 / 30 min.` after the label. retry grants
// another full box (the note goes to its builder); cut moves it to CUT, its commits kept.
export function overTimeboxCard(o: { escalation: string; slice: string; elapsed_min: number; limit_min: number }): Card {
  return {
    type: 'escalation',
    title: `Over time box (${o.slice})`,
    reason_label: 'Over time box',
    reason: `${o.slice} at ${o.elapsed_min} / ${o.limit_min} min.`,
    ...withOptions([
      opt(`/factory rule ${o.escalation} retry <note…>`, `${o.slice} gets another full time box; your note goes to its builder`),
      opt(`/factory rule ${o.escalation} cut`, `${o.slice} is cut; its commits are kept and BUILD goes on with the rest`),
      ABANDON,
    ]),
    reply: ESCALATION_REPLY,
    escalation: o.escalation,
    condition: 3,
  };
}

// Why a round failed, for the Non-convergence card: the failing check, and each reviewer still at
// FINDINGS with its count (`reviewer-code still reports 1 finding, reviewer-security still reports 2
// findings`).
export function roundWhy(o: { check?: { name: string; exit_code: unknown }; findings: readonly { role: string; n: number }[] }): string {
  const parts = [
    ...(o.check ? [`${o.check.name} still fails (exit ${String(o.check.exit_code)})`] : []),
    ...(o.findings.length ? [o.findings.map((f) => `${f.role} still reports ${plural(f.n, 'finding')}`).join(', ')] : []),
  ];
  return parts.join('; ');
}

// The slice still has findings (or a failing test or health check) after MAX_RETRIGGER_ROUNDS builder
// rounds (AD-11 condition 3). retry buys one more round; accept closes the slice as it is.
// accept closes the slice without the git.deps gate, so the card names any dependency change.
export function nonConvergenceCard(o: { escalation: string; slice: string; rounds: number; why: string; deps?: readonly string[] }): Card {
  return {
    type: 'escalation',
    title: `Non-convergence (${o.slice})`,
    reason_label: 'Non-convergence',
    reason: `${o.slice} is not done after ${plural(o.rounds, 'builder round')}: ${o.why}${o.deps?.length ? ` · accept also accepts new dependencies: ${o.deps.join(', ')}` : ''}`,
    ...withOptions([
      opt(`/factory rule ${o.escalation} retry <note…>`, `${o.slice} gets one more builder round, with your note`),
      opt(`/factory rule ${o.escalation} accept`, `${o.slice} closes as it is${o.deps?.length ? ', with its new dependencies' : ''}`),
      ABANDON,
    ]),
    reply: ESCALATION_REPLY,
    escalation: o.escalation,
    condition: 3,
  };
}

// The slice changed a manifest or lockfile (brownfield new dependency, condition 2). accept lets the
// slice close; retry sends it back to the builder with the note.
export function newDependencyCard(o: { escalation: string; slice: string; files: readonly string[]; sha: string }): Card {
  return {
    type: 'escalation',
    title: `New dependency (${o.slice})`,
    reason_label: 'New dependency',
    reason: o.files.join(', '),
    ...withOptions([
      opt(`/factory rule ${o.escalation} accept`, `the new dependency stays and ${o.slice} may close`),
      opt(`/factory rule ${o.escalation} retry <note…>`, `${o.slice} goes back to its builder with your note`),
      ABANDON,
    ]),
    reply: ESCALATION_REPLY,
    escalation: o.escalation,
    condition: 2,
    sha: o.sha,
  };
}

// SIGNAL LOST (AD-16): the dashboard's live-only card, never printed in chat. Resume is the only way
// back for a run whose session is gone.
export function signalLostCard(runId: string): Card {
  return {
    type: 'signal_lost',
    title: `SIGNAL LOST — ${runId}`,
    reason_label: 'Signal lost',
    reason: 'No command or fact for several heartbeats, and no live Claude Code session holds the run.',
    // Board-only: options, but no reply line (it is never printed in chat).
    ...withOptions([opt(`/factory resume ${runId}`, 'the session you type it in takes over the run, which goes on where it stopped')]),
  };
}

export interface MergeView {
  // verdicts: the latest verified verdict of each rostered reviewer, in roster order (3-3).
  slices: readonly { id: string; title?: string; rounds: number; verdicts: readonly { role: string; verdict?: string }[] }[];
  sha: string; // the run branch head the evidence is pinned to
  target: string | null; // the main checkout branch's head
  branch: string | null; // the main checkout's current branch
  diffstat: string;
  test?: { exit_code: number }; // WRAP contract.test at sha
  problems: readonly string[]; // conflicts, failing checks, a dirty main checkout: no merge offered
  notes?: readonly string[]; // shown, but the merge is still offered (a failed git merge to retry)
}

// The planned merge gate (AD-34). `/factory merge` only when every WRAP check passed at `sha` and
// nothing is in the way; rework and abandon always. A reworked slice goes back to its builder and
// reviewers, and the card comes back.
export function mergeCard(o: MergeView): Card {
  const rows = o.slices.map((s) => `${s.id} ${s.title ?? ''} · ${s.verdicts.map((v) => `${v.role} ${v.verdict ?? '—'}`).join(', ')} · ${plural(s.rounds, 'round')}`);
  const test = o.test ? `contract.test ${o.test.exit_code === 0 ? 'passed' : `failed (exit ${o.test.exit_code})`}` : 'contract.test not run';
  const parts = [...rows, `${o.sha.slice(0, 12)} into ${o.branch ?? 'a detached HEAD'}`, o.diffstat || 'no diff', test, ...o.problems, ...(o.notes ?? [])];
  return {
    type: 'merge',
    title: o.problems.length ? 'Merge — blocked' : 'Merge — approve the local merge',
    reason_label: o.problems.length ? 'Blocked' : 'Merge',
    reason: parts.join(' · '),
    ...withOptions([
      ...(o.problems.length ? [] : [opt('/factory merge', `the CLI merges the run branch into ${o.branch ?? 'the current branch'} locally and the run ends`)]),
      ...o.slices.map((s) => opt(`/factory rework ${s.id} <note…>`, `${s.id} goes back to its builder and reviewers; this card comes back`)),
      ABANDON,
    ]),
    reply: gateReply('a slice'),
    sha: o.sha,
    target: o.target,
  };
}
