// Shared by next, done, decide and check: reading a step's out.md, the projection a report embeds
// (AD-23), the events a report implies (AD-7, AD-11), reissues (AD-24) and the SCAFFOLD copy.
import { readFileSync } from 'node:fs';
import { checkOutput, originOf, type AgentOutput, type OutputOpts } from '../core/artifacts.ts';
import { escalationCard, scaffoldFailureCard, stepNonConvergenceCard } from '../core/cards.ts';
import { ARTIFACT_EMBED_MAX, MAX_STEP_ATTEMPTS } from '../core/config.ts';
import type { AnyEvent, ArtifactEmbed, Card, Envelope } from '../core/events.ts';
import { redact, redactString } from '../core/redact.ts';
import type { RunState, Step } from '../core/reducer.ts';
import type { AgentEvidence } from '../core/verify.ts';
import { agentEvidence, designMode, designQuestionAnswered } from '../core/verify.ts';
import { ulid } from '../store/ids.ts';
import { readRedactValues, type LoadedRun } from '../store/load-run.ts';
import { outFile, realish } from '../store/paths.ts';
import { writeBrief, type BriefExtra } from './brief.ts';
import { makeEvent } from './commit.ts';
import { checkIgnored, commitAll, sha256 } from './git.ts';
import { addRedactValues, copyGitignored } from './worktree.ts';

export interface Ctx { hash: string; runId: string; session: string; root: string }

export interface ReadOutput { path: string; real: string; text: string | null; sha256?: string; result: AgentOutput }

export const isAgent = (st: Step): boolean => st.kind === 'spawn' || st.kind === 'resume';

// What the role's output is checked against beyond its text: the claimed port, for the designer
// (3-2) the mode its context implies and whether the run's one question was already answered, and
// for recon and framer (5-2) the run's origin.
export function outputOpts(state: RunState, role: string | undefined): OutputOpts {
  if (originOf(role)) return { port: state.port, origin: state.greenfield ? 'greenfield' : 'brownfield' };
  if (role !== 'designer') return { port: state.port };
  return { port: state.port, mode: designMode(state), no_question: designQuestionAnswered(state) };
}

// Unlocked: the step's out.md, checked against the protocol and its role's schema (the INTAKE
// conversation step has no role: its caller names the `intake` schema).
export function readOutput(state: RunState, st: Step, role: string | undefined = st.role): ReadOutput {
  const path = st.output_path ?? '';
  const real = path ? realish(path) : '';
  let text: string | null = null;
  try { text = readFileSync(path, 'utf8'); } catch { /* missing */ }
  if (text === null) return { path, real, text, result: { ok: false, error: `no output file at ${path || '(no output_path)'}` } };
  return { path, real, text, sha256: sha256(text), result: checkOutput(role, text, outputOpts(state, role)) };
}

// What step_reported.output embeds, redacted.
export function projection(c: Ctx, out: ReadOutput, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const r = out.result;
  if (!r.ok) return redact({ ok: false, error: r.error, path: out.path }, readRedactValues(c.hash, c.runId));
  const lines = r.body.split('\n').filter((l) => l.trim()).length;
  return redact({
    status: r.status, ...(r.escalation ? { escalation: r.escalation } : {}), front: r.front, sha256: out.sha256, path: out.path, lines,
    ...(r.failure ? { failure: r.failure } : {}), ...(r.findings ? { findings: r.findings } : {}), ...(r.question ? { question: r.question } : {}), ...extra,
  }, readRedactValues(c.hash, c.runId));
}

export const claimedTs = (commands: readonly AnyEvent[], stepId: string): string | undefined =>
  [...commands].reverse().find((e) => e.kind === 'step_claimed' && (e as Envelope<'step_claimed'>).data.step_id === stepId)?.ts;

export function evidenceFor(run: LoadedRun, st: Step, out: ReadOutput): AgentEvidence {
  return agentEvidence(st, run.facts, { output: out.real, claimed_ts: claimedTs(run.commands, st.id) });
}

export const nextEscalation = (state: RunState): string => `E${Object.values(state.asks).filter((a) => a.escalation).length + 1}`;

// A card as embedded in an event (AD-14): its prose (title, reason, details, each option's then, the
// reply) is redacted; its commands, escalation id and the shas it is pinned to are structure, and
// must stay exact for the human to type and the CLI to compare.
export function redactCard(card: Card, values: readonly string[]): Card {
  const prose = redact({
    title: card.title,
    ...(card.reason_label !== undefined ? { reason_label: card.reason_label } : {}),
    ...(card.reason !== undefined ? { reason: card.reason } : {}),
    ...(card.details !== undefined ? { details: card.details } : {}),
    ...(card.reply !== undefined ? { reply: card.reply } : {}),
  }, values);
  const options = card.options?.map((o) => ({ command: o.command, then: redact(o.then, values) }));
  return { ...card, ...prose, ...(options ? { options } : {}) };
}

// An escalation about `st` (or, with no step, about the slice: an Over time box). With a slice, the
// slice goes ESCALATED until the human rules; a slice already ESCALATED (or no longer live) is not
// moved again, and the ask then carries no slice.
export function raise(c: Ctx, state: RunState, st: Step | undefined, card: (e: string) => Card, slice?: string): AnyEvent {
  const escalation = nextEscalation(state);
  const live = slice !== undefined && ['BUILDING', 'IN_REVIEW', 'FINDINGS_QUEUED'].includes(state.slices[slice]?.state ?? '');
  return makeEvent(c.runId, 'ask_raised', {
    card: redactCard(card(escalation), readRedactValues(c.hash, c.runId)), ...(st ? { step_id: st.id } : {}), ...(live ? { slice } : {}), escalation,
  }, { corr: st?.id ?? state.run_id! });
}

export const isReviewer = (st: Step): boolean => Boolean(st.role?.startsWith('reviewer-'));

// AD-30: at a builder `done` whose output parses, the CLI commits the worktree on the run branch as
// `factory: <slice> <title> (<step_id>)`, unlocked. Returns the sha for step_reported.
export function commitBuilder(state: RunState, st: Step, out: ReadOutput): string | undefined {
  if (st.role !== 'builder' || !out.result.ok || !state.worktree) return undefined;
  const sl = st.slice ? state.slices[st.slice] : undefined;
  return commitAll(state.worktree, `factory: ${st.slice ?? ''} ${sl?.title ?? state.task ?? ''} (${st.id})`.replace(/\s+/g, ' '));
}

// Unlocked, for a scaffolder whose contract parsed: copy the gitignored files it names into the
// worktree and record their values for redaction. A failure is a SCAFFOLD failure.
export function scaffoldCopy(c: Ctx, state: RunState, out: ReadOutput): string | undefined {
  const r = out.result;
  if (!r.ok || r.status !== 'DONE' || r.failure || !state.worktree) return undefined;
  const files = Array.isArray(r.front.copy_gitignored) ? (r.front.copy_gitignored as string[]) : [];
  const copy = copyGitignored(c.root, state.worktree, files, checkIgnored);
  if (!copy.ok) return copy.error;
  addRedactValues(c.hash, c.runId, copy.values);
  return undefined;
}

// The events a parsed report implies: step_reported{output}, then an escalation ask, or
// step_verified when the agent evidence is in. The scaffolder verifies only on its checks.
export function reportEvents(c: Ctx, state: RunState, st: Step, out: ReadOutput, o: { evidence: AgentEvidence; note?: string; actor: string; copyError?: string; sha?: string }): AnyEvent[] {
  const r = out.result;
  if (!r.ok) throw new Error('reportEvents needs a parsed output');
  const failure = r.failure ?? o.copyError;
  const events: AnyEvent[] = [makeEvent(c.runId, 'step_reported', {
    step_id: st.id, ...(o.note !== undefined ? { note: o.note } : {}), ...(o.sha ? { sha: o.sha } : {}), output: projection(c, out, o.copyError ? { failure } : {}),
  }, { session: c.session, actor: o.actor, corr: st.id })];
  // 3-4: a step of a slice cut (or cleared) while it ran is reported (a builder's work is committed)
  // but neither verified nor escalated: `next` cancels it.
  const sl = st.slice !== undefined ? state.slices[st.slice] : undefined;
  if (st.slice !== undefined && (!sl || sl.state === 'CUT')) return events;
  if (st.role === 'scaffolder' && (r.status === 'ESCALATE' || failure)) {
    const why = r.escalation ? `${r.escalation.label}: ${r.escalation.line}` : failure!;
    events.push(raise(c, state, st, (e) => scaffoldFailureCard({ escalation: e, failures: [why], accept: false })));
  } else if (r.status === 'ESCALATE') {
    // A builder's or reviewer's escalation parks its slice (ESCALATED) until the ruling.
    events.push(raise(c, state, st, (e) => escalationCard({ escalation: e, label: r.escalation!.label, line: r.escalation!.line, role: st.role }), st.slice));
  } else if (st.role !== 'scaffolder' && o.evidence.ok) {
    // The sha256 this batch's step_reported carries (projection(): out.sha256) is the reported one.
    events.push(verifiedEvent(c, st, o.evidence.evidence, r.status, out, out.sha256));
  }
  return events;
}

// The roles whose output a gate pins (AD-23); the INTAKE conversation's out.md is the fourth, embedded
// at intake_confirmed (decide.ts).
const ARTIFACT_ROLES: readonly string[] = ['spec-writer', 'designer', 'slicer'];

// `text` cut to at most `max` UTF-8 bytes, never inside a character.
export function capUtf8(text: string, max: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= max) return { text, truncated: false };
  let end = max;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return { text: buf.subarray(0, end).toString('utf8'), truncated: true };
}

// What step_verified embeds for a gate-pinned artifact (6-3, AD-23): the bytes read now, only while
// they still hash to the sha256 the step reported (what the gates pin); the body redacted with the
// run's values (AD-14), then cut to ARTIFACT_EMBED_MAX bytes.
export function artifactData(c: Ctx, path: string, text: string | null, reportedSha: unknown): ArtifactEmbed | undefined {
  if (text === null || typeof reportedSha !== 'string' || sha256(text) !== reportedSha) return undefined;
  const body = capUtf8(redactString(text, readRedactValues(c.hash, c.runId)), ARTIFACT_EMBED_MAX);
  return { path, sha256: reportedSha, body: body.text, truncated: body.truncated };
}

// step_verified for an agent step; a reviewer's carries its VERDICT (the reducer's FINDINGS edge). A
// spec-writer's, designer's or slicer's embeds its output (`out`, read for this verify) as an artifact,
// only while those bytes hash to the sha256 the step reported (`reportedSha`: the step's recorded
// output, or the one its step_reported in the same batch carries).
export function verifiedEvent(c: Ctx, st: Step, evidence: string[], status: unknown, out?: ReadOutput, reportedSha: unknown = st.output?.sha256): AnyEvent {
  const artifact = out && st.role && ARTIFACT_ROLES.includes(st.role) ? artifactData(c, out.path, out.text, reportedSha) : undefined;
  return makeEvent(c.runId, 'step_verified', {
    step_id: st.id, evidence, ...(isReviewer(st) && typeof status === 'string' ? { verdict: status } : {}), ...(artifact ? { artifact } : {}),
  }, { corr: st.id });
}

// step_reissued with a fresh step id, output path and (for agents) brief. The reducer copies the old
// step (AD-24), except that a resume is reissued as a spawn (3-4): the agent it continued may be gone
// (a SendMessage that could not reach a finished builder ends in a done with no output). The INTAKE
// conversation keeps its output_path.
export function reissueEvent(c: Ctx, run: Pick<LoadedRun, 'state' | 'commands'>, st: Step, extra: BriefExtra = {}, o: { output_path?: string } = {}): AnyEvent {
  const id = ulid();
  const output_path = o.output_path ?? outFile(c.hash, c.runId, id);
  const brief_path = isAgent(st) && st.role
    ? writeBrief(c.hash, c.runId, run.state, run.commands, { id, role: st.role, stage: st.stage, attempt: st.attempt + 1, output_path, slice: st.slice }, c.root, extra)
    : undefined;
  return makeEvent(c.runId, 'step_reissued', { old: st.id, new: id, output_path, ...(brief_path ? { brief_path } : {}), ...(st.kind === 'resume' ? { kind: 'spawn' as const } : {}) }, { corr: st.id });
}

// How many attempts the step's reissue chain holds: the step, and every step it was reissued from
// (a parse failure, an orphan or a ruling's retry). A fresh step (a new round, a rework's respawn)
// starts a chain of its own.
export function attemptsInChain(commands: readonly AnyEvent[], stepId: string): number {
  const from = new Map<string, string>();
  for (const e of commands) if (e.kind === 'step_reissued') from.set((e as Envelope<'step_reissued'>).data.new, (e as Envelope<'step_reissued'>).data.old);
  let n = 1;
  for (let id = from.get(stepId); id !== undefined && n <= from.size; id = from.get(id)) n += 1;
  return n;
}

// The reissue cap (3-4): a parse failure or an orphan of a step whose chain reached
// MAX_STEP_ATTEMPTS raises a Non-convergence escalation (condition 3) about it instead of another
// reissue; `rule E<n> retry` then reissues it once more. Its slice, if live, goes ESCALATED.
export function reissueOrEscalate(c: Ctx, run: Pick<LoadedRun, 'state' | 'commands'>, st: Step, extra: BriefExtra = {}): { event: AnyEvent; escalation?: string; attempts: number } {
  const attempts = attemptsInChain(run.commands, st.id);
  if (attempts < MAX_STEP_ATTEMPTS) return { event: reissueEvent(c, run, st, extra), attempts };
  const role = st.role ?? st.check ?? st.kind;
  const event = raise(c, run.state, st, (e) => stepNonConvergenceCard({ escalation: e, role, slice: st.slice, attempt: attempts, error: extra.error ?? 'no attributable output' }), st.slice);
  return { event, escalation: (event.data as { escalation: string }).escalation, attempts };
}
