// Replay's read side (4-1): store/recording.ts reads a recording, core/timeline.ts folds it into the
// served timeline. The committed fixture recordings (test/fixtures/recordings/, written by
// test/fixtures/generate.ts and captured from the 1-5 pipeline acceptance run) are regression
// fixtures: their timeline snapshots must stay byte-identical (AD-32). Refresh deliberately with
//   UPDATE_SNAPSHOTS=1 node --test test/timeline.test.ts
import { strict as assert } from 'node:assert';
import { appendFileSync, chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AnyEvent } from '../src/core/events.ts';
import { projectRun } from '../src/core/projection.ts';
import { redactString } from '../src/core/redact.ts';
import { fold } from '../src/core/reducer.ts';
import { buildTimeline, runOrder, SIGNAL_LOST_MS, type Timeline } from '../src/core/timeline.ts';
import { loadRun } from '../src/store/load-run.ts';
import { loadRecording, type LoadedRecording } from '../src/store/recording.ts';

const FIX = join(import.meta.dirname, 'fixtures');
const RECS = join(FIX, 'recordings');
const FIXTURE_RECORDINGS = ['findings-escalation-rework', 'happy-path', 'illegal-then-abandon', 'pipeline-acceptance'];
// test/fixtures/generate.ts and test/harness.ts write these into the recorded runs; redaction must
// have removed every one of them.
const REDACT_VALUES = ['fixture-dotenv-token-4417', 'hunter2-is-the-secret'];

const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-timeline-')));
const home = join(base, '.factory');
process.env.FACTORY_HOME = home;
mkdirSync(join(home, 'recordings'), { recursive: true });
const install = (name: string, as = name): string => {
  const to = join(home, 'recordings', as);
  rmSync(to, { recursive: true, force: true });
  cpSync(join(RECS, name), to, { recursive: true });
  return to;
};
for (const n of FIXTURE_RECORDINGS) install(n);

const loaded = (name: string): LoadedRecording => {
  const r = loadRecording(name);
  assert.ok(!('missing' in r), `${name}: ${'missing' in r ? r.missing : ''}`);
  return r;
};
const timeline = (name: string): Timeline => { const r = loaded(name); return buildTimeline(r.manifest, r.runs); };

// One line per event and per frame: valid JSON, and a readable diff when a frame changes.
function snapshotText(t: Timeline): string {
  const { events, frames, ...head } = t;
  const lines = Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `{\n${lines.join('\n')}\n"events": [\n${events.map((e) => JSON.stringify(e)).join(',\n')}\n],\n"frames": [\n${frames.map((f) => JSON.stringify(f)).join(',\n')}\n]\n}\n`;
}

test('fixture recordings: every buildTimeline snapshot is byte-identical (UPDATE_SNAPSHOTS=1 rewrites them)', () => {
  assert.deepEqual(readdirSync(RECS).filter((f) => lstatSync(join(RECS, f)).isDirectory()).sort(), FIXTURE_RECORDINGS, 'the fixture recordings, all covered here');
  for (const name of FIXTURE_RECORDINGS) {
    const text = snapshotText(timeline(name));
    assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(timeline(name))), 'the snapshot text is the timeline');
    const file = join(RECS, `${name}.timeline.json`);
    if (process.env.UPDATE_SNAPSHOTS) writeFileSync(file, text);
    assert.ok(existsSync(file), `${file} is missing: run UPDATE_SNAPSHOTS=1 node --test test/timeline.test.ts`);
    assert.equal(text, readFileSync(file, 'utf8'), `${name}: the folded recording changed`);
  }
});

test('the timeline: ordered events with `at` monotone, start/end the first and last at, frames with the clock fields blanked, one frame per distinct lane', () => {
  for (const name of FIXTURE_RECORDINGS) {
    const t = timeline(name);
    const r = loaded(name);
    assert.deepEqual(Object.keys(t), ['name', 'recorded_at', 'start', 'end', 'signal_lost_ms', 'runs', 'events', 'frames']);
    assert.deepEqual([t.name, t.recorded_at, t.signal_lost_ms], [r.manifest.name, r.manifest.recorded_at, SIGNAL_LOST_MS]);
    assert.equal(SIGNAL_LOST_MS, 180_000);
    assert.deepEqual(t.runs.map((x) => [x.repo_hash, x.run_id, x.signal_lost_card.type]), r.manifest.runs.map((x) => [x.repo_hash, x.run_id, 'signal_lost']));
    assert.equal(t.events.length, r.runs.reduce((n, x) => n + x.loaded.commands.length + x.loaded.facts.length, 0), 'every valid event, once');
    for (let i = 1; i < t.events.length; i++) assert.ok(t.events[i - 1].at <= t.events[i].at, `${name}: at is monotone at ${i}`);
    assert.deepEqual([t.start, t.end], [t.events[0].at, t.events.at(-1)!.at]);
    for (const f of t.frames) assert.deepEqual([f.last_event_at, f.deadlines.signal_lost_at], [null, null]);
    assert.equal(new Set(t.frames.map((f) => JSON.stringify(f))).size, t.frames.length, 'identical frames are stored once');
    assert.ok(t.frames.length < t.events.length, `${name}: frames are shared (${t.frames.length} for ${t.events.length} events)`);
  }
});

test('decision flags: exactly the applied human decisions, never a rejected one', () => {
  const kinds = (name: string): string[] => timeline(name).events.filter((e) => e.decision).map((e) => e.kind);
  assert.deepEqual(kinds('happy-path'), ['intake_confirmed', 'gate_1_passed', 'gate_2_passed', 'merge_approved']);
  assert.deepEqual(kinds('findings-escalation-rework'), ['intake_confirmed', 'gate_1_passed', 'gate_2_passed', 'escalation_ruled', 'cut_decided', 'rework_requested']);
  // gate_2_passed in INTAKE is rejected by the reducer: no pip.
  const t = timeline('illegal-then-abandon');
  assert.deepEqual(kinds('illegal-then-abandon'), ['intake_confirmed', 'run_abandoned']);
  assert.ok(t.events.some((e) => e.kind === 'gate_2_passed' && !e.decision));
  assert.deepEqual(kinds('pipeline-acceptance'), ['intake_confirmed', 'gate_1_passed', 'gate_2_passed', 'merge_approved']);
  for (const name of FIXTURE_RECORDINGS) {
    const t2 = timeline(name);
    for (const e of t2.events.filter((x) => x.decision)) assert.ok(t2.frames[e.frame].decisions.some((d) => d.id === e.id && d.decided_by === 'human'), `${e.kind} is in its frame, human-attributed`);
  }
});

// --- ordering and frames on hand-made runs -------------------------------------------------------

const RUN = 'r-1';
let n = 0;
const ev = (kind: string, ts: string, data: object = {}, o: { fact?: boolean; id?: string; actor?: string } = {}): AnyEvent =>
  ({ v: 1, id: o.id ?? `01JQZZZZZZZZZZZZZZZZZZZ${String(++n).padStart(3, '0')}`, ts, run: RUN, kind, actor: o.actor ?? (o.fact ? 'hook' : 'cli'), corr: 'c', ...(o.fact || o.actor === 'human' ? { session: 's' } : {}), data }) as unknown as AnyEvent;
const T = (s: number): string => new Date(Date.UTC(2026, 9, 25, 10, 0, 0) + s * 1000).toISOString();
const started = (ts: string): AnyEvent => ev('run_started', ts, { task: 't', repo_hash: 'h', base_sha: 'b', branch: `factory/${RUN}` });
const input = (commands: AnyEvent[], facts: AnyEvent[] = []) => ({ state: fold(commands), commands, facts, skipped: [] as unknown[] });

test('order: a fact goes before the first command at or after its ts (a tie puts the fact first); at is the running max; leftover facts go last', () => {
  const c1 = started(T(0));
  const c2 = ev('session_bound', T(5), { session: 's' });
  const c3 = ev('stage_completed', T(3), { stage: 'RECON' }); // out of ts order in the file
  const fTie = ev('session_started', T(5), { source: 'startup' }, { fact: true });
  const fEarly = ev('tool_succeeded', T(1), { tool_name: 'Bash' }, { fact: true });
  const fLate = ev('session_ended', T(9), {}, { fact: true });
  const order = runOrder([c1, c2, c3], [fEarly, fTie, fLate]);
  assert.deepEqual(order.map((x) => [x.e.id, x.fact, x.at]), [
    [c1.id, false, T(0)], [fEarly.id, true, T(1)], [fTie.id, true, T(5)], [c2.id, false, T(5)], [c3.id, false, T(5)], [fLate.id, true, T(9)],
  ]);
});

test('runs merge by at with manifest order breaking ties; events, pips and labels carry their run index', () => {
  const a = [started(T(0)), ev('session_bound', T(2), { session: 's' })];
  const b = [{ ...started(T(0)), id: '01JQZZZZZZZZZZZZZZZZZZZB01', run: 'r-2' } as AnyEvent, { ...ev('session_bound', T(1), { session: 's' }), run: 'r-2' } as AnyEvent];
  const t = buildTimeline({ name: 'two', recorded_at: T(10) }, [
    { repo_hash: 'h2', run_id: 'r-2', loaded: input(b) },
    { repo_hash: 'h1', run_id: 'r-1', loaded: input(a) },
  ]);
  assert.deepEqual(t.events.map((e) => [e.run, e.at]), [[0, T(0)], [1, T(0)], [0, T(1)], [1, T(2)]]);
  assert.deepEqual(t.runs.map((r) => r.run_id), ['r-2', 'r-1']);
  assert.deepEqual(t.events.map((e) => t.frames[e.frame].run_id), ['r-2', 'r-1', 'r-2', 'r-1']);
});

test('frames: a fact no command cites reuses the previous frame; a cited fact is projected, so its evidence row resolves from then on', () => {
  const commands = readFileSync(join(FIX, 'happy-path.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as AnyEvent);
  const firstVerified = commands.find((e) => e.kind === 'step_verified')!;
  const fact = (id: string, kind: string, ts: string, data: object): AnyEvent => ({ ...ev(kind, ts, data, { fact: true, id }), run: commands[0].run }) as AnyEvent;
  const stop = fact('fact-stop', 'subagent_stopped', firstVerified.ts, { agent_id: 'a' }); // a tie: replays before the step_verified
  const output = fact('fact-output', 'output_written', new Date(Date.parse(firstVerified.ts) + 500).toISOString(), { path: '/x/out.md' }); // after the command citing it
  const early = fact('01JQZZZZZZZZZZZZZZZZZZE001', 'session_started', '2026-10-24T08:59:59.000Z', { source: 'startup' }); // before the run starts
  const loose = fact('01JQZZZZZZZZZZZZZZZZZZL001', 'session_started', commands[5].ts, { source: 'startup' });
  const facts = [early, output, loose, stop].sort((x, y) => x.ts.localeCompare(y.ts) || x.id.localeCompare(y.id));
  const t = buildTimeline({ name: 'x', recorded_at: T(0) }, [{ repo_hash: 'abc123def456', run_id: commands[0].run, loaded: input(commands, facts) }]);
  const idx = (id: string): number => t.events.findIndex((e) => e.id === id);
  assert.equal(t.events[0].id, early.id, 'a fact before the first command comes first');
  assert.equal(t.frames[t.events[0].frame].started_at, null, 'and has a frame of its own: no run yet');
  assert.equal(t.events[idx(loose.id)].frame, t.events[idx(loose.id) - 1].frame, 'an uncited fact reuses the frame');
  assert.equal(idx(stop.id) + 1, idx(firstVerified.id), 'the tied fact replays first');
  const rows = (i: number) => t.frames[t.events[i].frame].cards.flatMap((c) => c.claims).flatMap((c) => c.evidence).map((e) => `${e.id}:${e.kind}`);
  const claimRows = rows(idx(firstVerified.id));
  assert.ok(claimRows.includes('fact-stop:subagent_stopped'), 'the verified claim shows the fact that came first');
  assert.ok(claimRows.includes('fact-output:ref'), 'and a ref for the one not there yet');
  assert.ok(rows(idx(output.id)).includes('fact-output:output_written'), 'the cited fact, on arrival, is projected into its own frame');
  assert.notEqual(t.events[idx(output.id)].frame, t.events[idx(output.id) - 1].frame);
  // Without the facts, the same claim names refs only.
  const bare = buildTimeline({ name: 'x', recorded_at: T(0) }, [{ repo_hash: 'abc123def456', run_id: commands[0].run, loaded: input(commands) }]);
  const v = bare.events.find((e) => e.id === firstVerified.id)!;
  assert.ok(bare.frames[v.frame].cards.flatMap((c) => c.claims).flatMap((c) => c.evidence).every((e) => e.kind === 'ref'));
});

// --- the reader ---------------------------------------------------------------------------------

test('loadRecording: missing, unsafe, unreadable, invalid or v ≠ 1 manifests, bad runs, a run dir outside the recording, and no valid event are each a reason', () => {
  const reason = (name: string): string => { const r = loadRecording(name); assert.ok('missing' in r, `${name} loads`); return r.missing; };
  const make = (name: string, manifest: string | object): string => {
    const dir = install('happy-path', name);
    writeFileSync(join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    return dir;
  };
  const good = JSON.parse(readFileSync(join(RECS, 'happy-path', 'manifest.json'), 'utf8'));
  assert.match(reason('nope'), /no recording named nope/);
  assert.match(reason('../happy-path'), /bad recording name/);
  assert.match(reason('a..b'), /bad recording name/);
  assert.match(reason(''), /bad recording name/);
  assert.match(reason((make('torn', '{"v":1,'), 'torn')), /not JSON/);
  assert.match(reason((make('empty', '{}'), 'empty')), /manifest v null is not 1/);
  assert.match(reason((make('v2', { ...good, v: 2 }), 'v2')), /manifest v 2 is not 1/);
  assert.match(reason((make('arr', '[]'), 'arr')), /not a JSON object/);
  assert.match(reason((make('noruns', { ...good, runs: [] }), 'noruns')), /lists no runs/);
  assert.match(reason((make('badrun', { ...good, runs: [{ repo_hash: '../x', run_id: 'r' }] }), 'badrun')), /bad run/);
  assert.match(reason((make('twice', { ...good, runs: [good.runs[0], good.runs[0]] }), 'twice')), /twice/);
  assert.match(reason((make('nodate', { ...good, recorded_at: 'soon' }), 'nodate')), /recorded_at/);
  assert.match(reason((make('ghost', { ...good, runs: [{ repo_hash: 'abc123def456', run_id: 'ghost-0000' }] }), 'ghost')), /run ghost-0000 is not in the recording/);
  // Unreadable manifest (skipped as root, who reads anything).
  if (process.getuid?.() !== 0) {
    const dir = make('locked', good);
    chmodSync(join(dir, 'manifest.json'), 0o000);
    assert.match(reason('locked'), /unreadable/);
    chmodSync(join(dir, 'manifest.json'), 0o644);
  }
  // A run dir that is a symlink out of the recording (into a live run) is refused.
  const live = join(home, 'abc123def456', 'runs', 'add-login-page-q7k2');
  mkdirSync(live, { recursive: true });
  cpSync(join(FIX, 'happy-path.jsonl'), join(live, 'commands.jsonl'));
  const dir = make('linked', good);
  const runDir = join(dir, 'runs', 'abc123def456', 'add-login-page-q7k2');
  rmSync(runDir, { recursive: true });
  symlinkSync(live, runDir);
  assert.match(reason('linked'), /points outside the recording/);
  // No valid event: only torn and invalid lines.
  const bad = make('garbage', good);
  writeFileSync(join(bad, 'runs', 'abc123def456', 'add-login-page-q7k2', 'commands.jsonl'), 'not json\n{"v":1}\n');
  rmSync(join(bad, 'runs', 'abc123def456', 'add-login-page-q7k2', 'facts'), { recursive: true });
  assert.match(reason('garbage'), /no valid event/);
  rmSync(live, { recursive: true, force: true });
});

test('torn or bad lines in a recorded run are skipped, counted in lane.skipped on every frame, and never folded', () => {
  const dir = install('happy-path', 'torn-lines');
  const cmds = join(dir, 'runs', 'abc123def456', 'add-login-page-q7k2', 'commands.jsonl');
  const lines = readFileSync(cmds, 'utf8').trim().split('\n');
  writeFileSync(cmds, [lines[0], 'this line is not JSON', '{"v":1,"kind":"run_started"}', ...lines.slice(1)].join('\n') + '\n{"torn":');
  const t = timeline('torn-lines');
  const clean = timeline('happy-path');
  assert.equal(t.events.length, clean.events.length, 'no bad line becomes an event');
  assert.deepEqual(t.events.map((e) => e.kind), clean.events.map((e) => e.kind));
  for (const f of t.frames) assert.equal(f.skipped, 2, 'two complete bad lines; the torn tail is not a line yet');
  assert.deepEqual(t.frames.map((f) => ({ ...f, skipped: 0 })), clean.frames.map((f) => ({ ...f, skipped: 0 })));
});

test('recording isolation: appending to or deleting the live run of the same id leaves the recording\'s timeline unchanged', () => {
  const r = loaded('happy-path');
  const { repo_hash, run_id } = r.manifest.runs[0];
  const live = join(home, repo_hash, 'runs', run_id);
  mkdirSync(join(live, 'facts'), { recursive: true });
  writeFileSync(join(live, 'commands.jsonl'), readFileSync(join(FIX, 'happy-path.jsonl')));
  assert.equal(loadRun(repo_hash, run_id).commands.length, 40, 'the live run is there');
  const before = JSON.stringify(timeline('happy-path'));
  appendFileSync(join(live, 'commands.jsonl'), JSON.stringify(ev('stage_completed', T(99), { stage: 'WRAP' })) + '\n');
  writeFileSync(join(live, 'facts', 's-main.jsonl'), JSON.stringify(ev('session_started', T(99), { source: 'startup' }, { fact: true })) + '\n');
  assert.equal(JSON.stringify(timeline('happy-path')), before, 'appended');
  rmSync(live, { recursive: true });
  assert.equal(JSON.stringify(timeline('happy-path')), before, 'deleted');
});

test('no secrets: no file under any fixture recording (transcripts included) holds a redact.json value or a secret pattern, and no timeline holds transcript text', () => {
  let files = 0;
  for (const name of FIXTURE_RECORDINGS) {
    const root = join(RECS, name);
    for (const rel of readdirSync(root, { recursive: true }) as string[]) {
      const f = join(root, rel);
      if (!lstatSync(f).isFile() || /\.(png|jpe?g|gif|webp)$/i.test(f)) continue;
      const text = readFileSync(f, 'utf8');
      for (const v of REDACT_VALUES) assert.ok(!text.includes(v), `${name}/${rel} holds a redact.json value`);
      assert.equal(redactString(text), text, `${name}/${rel} holds a secret pattern`);
      files++;
    }
    assert.ok(existsSync(join(root, 'transcripts')), `${name} has transcripts`);
    const body = JSON.stringify(timeline(name));
    const transcriptText = (readdirSync(join(root, 'transcripts')) as string[]).map((t) => readFileSync(join(root, 'transcripts', t), 'utf8')).join('\n');
    if (name !== 'pipeline-acceptance') {
      assert.ok(transcriptText.includes(`transcript-only-${name}`), 'the marker is in the transcript');
      assert.ok(!body.includes(`transcript-only-${name}`), `${name}: the timeline holds transcript text`);
    }
    for (const line of transcriptText.split('\n').filter(Boolean)) {
      const content = (JSON.parse(line) as { message?: { content?: unknown } }).message?.content;
      if (typeof content === 'string' && content.length > 12) assert.ok(!body.includes(content), `${name}: the timeline holds a transcript turn`);
    }
  }
  assert.ok(files >= 20, `scanned ${files} files`);
});

test('loadRecording reads recordings/<name>/ only: the recorded run equals a projection of its own files', () => {
  const r = loaded('happy-path');
  assert.deepEqual(r.manifest.runs, [{ repo_hash: 'abc123def456', run_id: 'add-login-page-q7k2' }]);
  const run = r.runs[0].loaded;
  assert.equal(run.commands.length, 40);
  assert.equal(run.facts.length, 3);
  assert.deepEqual(run.skipped, []);
  const lane = projectRun(run, { repo_hash: 'abc123def456', run_id: 'add-login-page-q7k2' });
  assert.equal(lane.phase, 'COMPLETED');
});
