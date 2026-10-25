<script lang="ts">
  // The Top bar: brand, Mode badge (LIVE, or OFFLINE · reconnecting; in replay REPLAY · loading,
  // REPLAY · recorded <date>, or a bare REPLAY when the recording is not found), the Truth legend
  // with the board's claim counts, and the Reduce-motion toggle. Sticky; never dimmed.
  import { osReduce, reduceMotion, reduceToggle } from '../lib/motion.ts';
  import type { ReplayStatus } from '../lib/playback.ts';
  import type { Mode } from '../lib/stream.ts';
  import Glyph from './Glyph.svelte';

  let { mode, truth, replay = null }: {
    mode: Mode;
    truth: { claimed: number; verified: number; unverified: number };
    replay?: { status: ReplayStatus; day: string } | null;
  } = $props();
  const detail = $derived(replay ? (replay.status === 'loading' ? 'loading' : replay.status === 'ready' ? `recorded ${replay.day}` : '') : '');
  const label = $derived(replay ? `Mode: REPLAY${detail ? ` · ${detail}` : ''}` : `Mode: ${mode === 'live' ? 'LIVE' : 'OFFLINE · reconnecting'}`);

  function toggle(e: Event): void {
    const el = e.currentTarget as HTMLInputElement;
    reduceToggle.set(el.checked);
    // The OS setting forces it on.
    if ($osReduce) el.checked = true;
  }
</script>

<header class="topbar">
  <div class="brand">
    <Glyph name="emblem" scale={3} />
    <div><h1>d2t-factory</h1><small>dashboard · read-only</small></div>
  </div>
  <div class="mode {replay ? 'replay' : mode}" role="status" aria-label={label}>
    <i class="dot"></i>
    {#if replay}REPLAY{#if detail} <span>· {detail}</span>{/if}{:else if mode === 'live'}LIVE{:else}OFFLINE <span>· reconnecting</span>{/if}
  </div>
  <div class="budget-slot" aria-hidden="true"></div>
  <div class="legend" role="group" aria-label="Truth legend">
    <b>LEGEND</b>
    <div class="li"><span class="chip claimed">CLAIMED</span>agent says so <span class="n" title="claims on the board">{truth.claimed}</span></div>
    <div class="li"><span class="chip verified"><Glyph name="check" scale={2} />VERIFIED</span>hook fact or evidence check confirms <span class="n" title="claims on the board">{truth.verified}</span></div>
    <div class="li"><span class="chip unverified">UNVERIFIED</span>no hook fact <span class="n" title="claims on the board">{truth.unverified}</span></div>
  </div>
  <label class="rmt" title={$osReduce ? 'On: your system asks for reduced motion' : ''}>
    <input type="checkbox" class="switch" checked={$reduceMotion} onchange={toggle} />
    Reduce motion
  </label>
</header>

<style>
  .topbar {
    position: sticky; top: 0; z-index: 20; height: var(--topbar-height); display: flex; align-items: center; gap: 20px; padding: 0 20px;
    border-bottom: 1px solid color-mix(in srgb, var(--holo) 14%, transparent);
    background: linear-gradient(color-mix(in srgb, var(--space-2) 96%, transparent), color-mix(in srgb, var(--space-1) 94%, transparent));
    backdrop-filter: blur(6px);
  }
  .brand { display: flex; align-items: center; gap: 10px; flex: none; white-space: nowrap; }
  h1 { margin: 0; font: 700 19px/1 var(--sans); letter-spacing: -.01em; }
  small { display: block; font: 11px/1.2 var(--mono); color: var(--text-3); letter-spacing: .06em; margin-top: 4px; }
  .mode { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px; border-radius: var(--r); border: 1px solid var(--line-strong); background: var(--space-3); font: 700 11px/1 var(--mono); letter-spacing: .08em; color: var(--text); white-space: nowrap; }
  .mode span { color: var(--text-2); font-weight: 500; letter-spacing: .02em; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .live .dot { background: var(--holo); box-shadow: 0 0 8px color-mix(in srgb, var(--holo) 70%, transparent); }
  .offline .dot { background: var(--text-3); }
  /* A recording is never a red REC dot. */
  .replay .dot { background: var(--text-2); box-shadow: 0 0 0 3px color-mix(in srgb, var(--text-2) 15%, transparent); }
  .budget-slot { flex: 0 0 0; }
  .legend { margin-left: auto; display: flex; align-items: center; gap: 14px; padding: 6px 12px; border-radius: var(--r-lg); border: 1px solid var(--line); background: color-mix(in srgb, var(--space-1) 60%, transparent); }
  .legend > b { font: 600 11px/1 var(--mono); letter-spacing: .12em; color: var(--text-3); }
  .li { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-2); white-space: nowrap; }
  .n { font: 600 11px/1 var(--mono); color: var(--text-3); padding: 2px 5px; border-radius: var(--r-full); border: 1px solid var(--line); }
  .chip { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px; border-radius: var(--r-md); font: 700 11px/1 var(--mono); letter-spacing: .08em; border: 1px solid transparent; }
  .claimed { color: var(--holo); border-color: color-mix(in srgb, var(--holo) 60%, transparent); text-shadow: 0 0 6px color-mix(in srgb, var(--holo) 70%, transparent); background: repeating-linear-gradient(0deg, color-mix(in srgb, var(--holo) 14%, transparent) 0 1px, color-mix(in srgb, var(--holo) 5%, transparent) 1px 3px); animation: flicker 3.2s infinite; }
  .verified { color: var(--gold-ink); background: linear-gradient(180deg, var(--gold-hi), var(--gold)); border-color: var(--gold-hi); padding-left: 4px; box-shadow: 0 0 12px color-mix(in srgb, var(--gold) 35%, transparent); }
  .unverified { color: var(--danger-text); background: var(--danger-a); border-color: var(--danger); animation: flicker 2.2s infinite; }
  .rmt { display: flex; align-items: center; gap: 8px; font: 12px/1 var(--sans); color: var(--text-2); cursor: pointer; user-select: none; white-space: nowrap; }
  .switch { appearance: none; margin: 0; width: 34px; height: 18px; border-radius: 9px; background: var(--space-3); border: 1px solid var(--line-strong); position: relative; cursor: pointer; }
  .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-3); transition: transform .15s; }
  .switch:checked { background: var(--holo-2); border-color: var(--holo-2); }
  .switch:checked::after { background: white; transform: translateX(16px); }
</style>
