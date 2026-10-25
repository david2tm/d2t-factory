// Cards (AD-34): derived here only, embedded in `next` steps and `ask_raised`. Pure: no I/O.
// `commands` lists only the decisions that are legal for the card.
import type { Card, DesignQuestion, Intake, SlicePlanEntry } from './events.ts';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const pad2 = (n: number): string => String(n).padStart(2, '0');
// Minutes as `h:mm` (120 → 2:00).
export const hm = (min: number): string => `${Math.floor(min / 60)}:${pad2(min % 60)}`;

// The INTAKE conversation (3-1): the conductor agrees the four fields with the human in chat and
// writes the intake out.md. No decision answers it, so it has no commands.
export function intakeCard(): Card {
  return {
    type: 'intake',
    title: 'Intake — agree the task with the human',
    reason: 'Ask for the time limit, the slice time box, whether the task is UI-free and any reviewer overrides; then write the intake and run factory done.',
    commands: [],
  };
}

// The intake as recorded, for the human to confirm before RECON (AD-34): the four fields.
export function intakeConfirmCard(i: Intake): Card {
  const { add, remove } = i.reviewer_overrides;
  const reviewers = add.length || remove.length ? [...add.map((r) => `+${r}`), ...remove.map((r) => `-${r}`)].join(' ') : 'default';
  const fields = [`limit ${hm(i.limit_min)}`, `slice time box ${i.slice_timebox_min} min`, `UI-free ${i.ui_free ? 'yes' : 'no'}`, `reviewers: ${reviewers}`];
  return {
    type: 'intake',
    title: 'Intake — confirm the task',
    reason: [...fields, ...(i.started ? [`started ${i.started}`] : [])].join(' · '),
    commands: ['/factory approve intake'],
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
    commands: [`/factory cut ${ids.join(',')}`, '/factory keep'],
  };
}

export interface LintView { ok: boolean; errors: string[] }

function lintNote(lint: LintView, name: string): string {
  return lint.ok ? '' : ` · ${name} failed: ${lint.errors.join('; ')}`;
}

// With a designer (3-2) the card names both files and counts the spec's and the design's assumptions;
// without one it is the spec-only card.
export function gate1Card(o: { spec_path: string; assumptions: number; lint: LintView; design?: { path: string; mode: string; assumptions: number } }): Card {
  const d = o.design;
  return {
    type: 'gate_1',
    title: d ? 'Gate 1 — Spec + Design ready' : 'Gate 1 — approve the spec',
    reason_label: d ? 'Spec + Design' : 'Spec',
    reason: `${o.spec_path} · ${d ? `${d.path} (${d.mode}) · ` : ''}${plural(o.assumptions + (d?.assumptions ?? 0), 'assumption')} to check${lintNote(o.lint, 'spec.lint')}`,
    commands: [...(o.lint.ok ? ['/factory approve gate1'] : []), '/factory rework gate1 <note…>'],
  };
}

// The designer's one question (invent mode, a declared ask): two options; the design is already
// written for the default, so choosing it costs nothing.
export function designChoiceCard(q: DesignQuestion): Card {
  return {
    type: 'design_choice',
    title: `Design question — ${q.question}`,
    reason_label: 'Design',
    reason: `a: ${q.a} · b: ${q.b} · default ${q.default} (the design is written for it)`,
    commands: ['/factory choose a', '/factory choose b'],
  };
}

// A reviewer's short name on a card row: `reviewer-security` → `security`.
const short = (role: string): string => role.replace(/^reviewer-/, '');

// One row per slice (3-3): `S1 Signup form (AC-1, AC-2) [ui, input] · code, security, ux, a11y, ui`,
// with `← S1` for its dependencies. A plan.lint failure lists its errors and offers rework only.
export function gate2Card(o: { slices: readonly SlicePlanEntry[]; lint: LintView }): Card {
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
    commands: [...(o.lint.ok ? ['/factory approve gate2'] : []), '/factory rework gate2 <note…>'],
  };
}

// `accept` is legal only over a parsed DONE run contract (its checks failed); otherwise there is
// no contract to go on with, and the card offers retry and abandon.
export function scaffoldFailureCard(o: { escalation: string; failures: readonly string[]; accept: boolean }): Card {
  return {
    type: 'scaffold_failure',
    title: 'SCAFFOLD failed — the project does not run as the run contract says',
    reason_label: 'Scaffold failed',
    reason: o.failures.join('; '),
    commands: [`/factory rule ${o.escalation} retry <note…>`, ...(o.accept ? [`/factory rule ${o.escalation} accept`] : []), '/factory abandon'],
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
    commands: [`/factory rule ${o.escalation} retry <note…>`, '/factory abandon'],
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
    commands: [`/factory rule ${o.escalation} retry <note…>`, '/factory abandon'],
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
    commands: [`/factory rule ${o.escalation} retry <note…>`, `/factory rule ${o.escalation} cut`, '/factory abandon'],
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
    commands: [`/factory rule ${o.escalation} retry <note…>`, `/factory rule ${o.escalation} accept`, '/factory abandon'],
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
    commands: [`/factory rule ${o.escalation} accept`, `/factory rule ${o.escalation} retry <note…>`, '/factory abandon'],
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
    commands: [`/factory resume ${runId}`],
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
// nothing is in the way; rework and abandon always.
export function mergeCard(o: MergeView): Card {
  const rows = o.slices.map((s) => `${s.id} ${s.title ?? ''} · ${s.verdicts.map((v) => `${v.role} ${v.verdict ?? '—'}`).join(', ')} · ${plural(s.rounds, 'round')}`);
  const test = o.test ? `contract.test ${o.test.exit_code === 0 ? 'passed' : `failed (exit ${o.test.exit_code})`}` : 'contract.test not run';
  const parts = [...rows, `${o.sha.slice(0, 12)} into ${o.branch ?? 'a detached HEAD'}`, o.diffstat || 'no diff', test, ...o.problems, ...(o.notes ?? [])];
  return {
    type: 'merge',
    title: o.problems.length ? 'Merge — blocked' : 'Merge — approve the local merge',
    reason_label: o.problems.length ? 'Blocked' : 'Merge',
    reason: parts.join(' · '),
    commands: [...(o.problems.length ? [] : ['/factory merge']), ...o.slices.map((s) => `/factory rework ${s.id} <note…>`), '/factory abandon'],
    sha: o.sha,
    target: o.target,
  };
}
