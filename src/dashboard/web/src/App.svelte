<script lang="ts">
  // The board: Top bar, sticky column headers with Master d2t's seat, one swimlane per run
  // (newest on top), the docked Evidence drawer, and the polite announcer. Read only: the only
  // interactions are Copy, opening and closing evidence, and the motion toggle; in replay
  // (/replay/<name>, 4-1) also the Replay bar, and the board follows its playback clock, not SSE.
  import { onMount } from 'svelte';
  import ActionSlot from './components/ActionSlot.svelte';
  import ColumnHeaders from './components/ColumnHeaders.svelte';
  import Drawer from './components/Drawer.svelte';
  import EmptyCell from './components/EmptyCell.svelte';
  import LaneView from './components/Lane.svelte';
  import ReplayBar from './components/ReplayBar.svelte';
  import TopBar from './components/TopBar.svelte';
  import { message } from './lib/announce.ts';
  import { boardClock, boardSources, followBoard, needsAnnouncer } from './lib/board.ts';
  import { closeDrawer, selection } from './lib/drawer.ts';
  import { counts, laneKey, truthCounts } from './lib/model.ts';
  import { reduceMotion } from './lib/motion.ts';
  import * as playback from './lib/playback.ts';
  import { recordedDay, replayRoute, replayShortcut } from './lib/replay.ts';
  import * as stream from './lib/stream.ts';

  // Live (/) or replay (/replay/<name>): which store feeds the board is fixed for the page.
  const route = replayRoute(typeof location === 'undefined' ? '/' : location.pathname);
  const replay = route !== null;
  const replayName = route ? ('name' in route ? route.name : route.bad) : '';
  const rstatus = playback.status;
  const rec = playback.recording;
  const fast = playback.fast;
  const { lanes, loaded, mode, now } = boardSources(replay);

  onMount(() => {
    if (!replay) return stream.connect();
    if (route && 'name' in route) void playback.load(route.name);
    else playback.status.set('missing');
    return () => playback.close();
  });

  // New Needs You cards: announced (coalesced within 1 s) and Master d2t looks up; muted at 16×
  // replay with one summary when it stops (lib/board.ts).
  const needs = needsAnnouncer();
  let lookUp = $state(false);
  let lookTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => { needs.fast($fast, $lanes); });
  $effect(() => {
    if (needs.lanes($lanes, $loaded, replay && $fast)) {
      lookUp = true;
      if (lookTimer) clearTimeout(lookTimer);
      lookTimer = setTimeout(() => { lookUp = false; }, 1600);
    }
  });
  // Offline, the board is frozen at its last state: the clock that drives chips and `ago` holds
  // the last live tick, and resumes when the stream is back. In replay it is the playhead.
  let held = $state(Date.now());
  $effect(() => { if ($mode === 'live') held = $now; });
  const clock = $derived(boardClock(replay, $mode, $now, held));

  const waiting = $derived($lanes.some((l) => l.needs_you.length > 0));
  // Under reduced motion the look-up pose is held while anything waits on d2t.
  const look = $derived(lookUp || ($reduceMotion && waiting));

  // A drawer whose lane is gone closes; in replay it follows the playhead (lib/board.ts).
  $effect(() => { followBoard($selection, $lanes, $loaded, replay); });

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && $selection) {
      e.preventDefault();
      closeDrawer();
      return;
    }
    if (!replay || $rstatus !== 'ready') return;
    const k = replayShortcut(e);
    if (!k) return;
    e.preventDefault();
    if (k === 'toggle') playback.toggle();
    else if (k === 'prev') playback.prevDecision();
    else playback.nextDecision();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="app" class:replaying={replay}>
  <div class="sky" aria-hidden="true"><i class="s1"></i><i class="s2"></i><i class="s3"></i></div>
  <TopBar mode={$mode} truth={truthCounts($lanes, clock)} replay={replay ? { status: $rstatus, day: $rec ? recordedDay($rec.recorded_at) : '' } : null} />
  <div class="main" class:open={!!$selection} class:offline={$mode === 'offline'}>
    <main class="board" aria-label="Board">
      <div class="needs-stripe" aria-hidden="true"><i></i></div>
      <ColumnHeaders counts={counts($lanes)} {look} />
      {#if replay && $rstatus === 'missing'}
        <div class="no-runs">
          <EmptyCell title="RECORDING NOT FOUND" body="No recording named {replayName} on this machine.">
            <a class="live-link" href="/">Open the live board</a>
          </EmptyCell>
        </div>
      {:else if !replay && $loaded && $lanes.length === 0}
        <div class="no-runs">
          <EmptyCell title="NO RUNS YET" body="Start one in the terminal:">
            <ActionSlot card={{ commands: ['/factory [task]'] }} />
          </EmptyCell>
        </div>
      {/if}
      {#each $lanes as lane (laneKey(lane))}
        <LaneView {lane} now={clock} />
      {/each}
    </main>
    {#if $selection}
      <Drawer sel={$selection} lanes={$lanes} now={clock} />
    {/if}
  </div>
  {#if replay && $rstatus !== 'missing'}
    <ReplayBar disabled={$rstatus !== 'ready'} />
  {/if}
  <div class="sr-only" aria-live="polite" aria-atomic="true">{$message}</div>
</div>

<style>
  .app {
    position: relative; min-width: var(--viewport-target); min-height: 100vh;
    background:
      radial-gradient(900px 420px at 72% 18%, color-mix(in srgb, var(--gold) 7%, transparent), transparent 60%),
      radial-gradient(700px 500px at 10% 80%, color-mix(in srgb, var(--nebula-violet) 8%, transparent), transparent 60%),
      radial-gradient(800px 500px at 40% 40%, color-mix(in srgb, var(--holo) 5%, transparent), transparent 60%),
      var(--space-1);
    background-attachment: fixed;
  }
  .sky { position: fixed; inset: 0; pointer-events: none; z-index: 0; }
  .sky i { position: absolute; inset: 0; display: block; background-repeat: repeat; }
  .sky .s1 { background-image: radial-gradient(1px 1px at 12px 40px, var(--sprite-white) 50%, transparent 51%), radial-gradient(1px 1px at 90px 130px, var(--text-2) 50%, transparent 51%), radial-gradient(1px 1px at 170px 20px, white 50%, transparent 51%), radial-gradient(1px 1px at 210px 190px, var(--text-3) 50%, transparent 51%), radial-gradient(1px 1px at 60px 220px, var(--sprite-white) 50%, transparent 51%); background-size: 240px 240px; opacity: .55; animation: drift 160s linear infinite; }
  .sky .s2 { background-image: radial-gradient(1.5px 1.5px at 30px 80px, var(--text) 50%, transparent 51%), radial-gradient(1.5px 1.5px at 260px 300px, var(--text-2) 50%, transparent 51%), radial-gradient(1.5px 1.5px at 330px 40px, var(--needs-text) 50%, transparent 51%); background-size: 380px 380px; opacity: .6; animation: drift 90s linear infinite; }
  .sky .s3 { background-image: radial-gradient(2px 2px at 140px 160px, white 50%, transparent 51%), radial-gradient(2px 2px at 480px 420px, var(--holo-text) 50%, transparent 51%); background-size: 620px 560px; opacity: .7; animation: drift 50s linear infinite; }
  @keyframes drift { from { background-position: 0 0; } to { background-position: -1240px 0; } }

  /* Replay: the Replay bar sits at the bottom of the viewport even under a short board. */
  .app.replaying { display: flex; flex-direction: column; }
  .app.replaying .main { flex: 1 0 auto; }
  .main { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; }
  .main.open { grid-template-columns: minmax(0, 1fr) var(--drawer-width); }
  /* Offline: the board freezes at its last state and dims to 90%; not danger-styled. */
  .main.offline { opacity: .9; }
  .board { position: relative; padding: 0 var(--board-gutter) 28px; min-width: 0; }
  .needs-stripe { position: absolute; inset: 0 var(--board-gutter); display: grid; grid-template-columns: var(--cols); column-gap: var(--column-gap); pointer-events: none; }
  .needs-stripe i {
    grid-column: 4; margin: 0 -5px; border-radius: 0 0 var(--r-2xl) var(--r-2xl);
    background: linear-gradient(180deg, var(--needs-wash-top), var(--needs-wash-bottom) 30%, var(--needs-wash-bottom));
    border-left: 1px solid var(--needs-edge); border-right: 1px solid var(--needs-edge);
    box-shadow: 0 0 60px color-mix(in srgb, var(--gold) 8%, transparent) inset;
  }
  .no-runs { position: relative; z-index: 1; width: 420px; margin: 48px auto 0; }
  .live-link { display: inline-block; font: 600 13px/1 var(--sans); color: var(--holo-text); }
</style>
