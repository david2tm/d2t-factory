<script lang="ts">
  // The Replay bar (4-1): sticky footer, a labeled landmark `Replay controls`. prev decision /
  // play-pause / next decision, the SPEED radio group (1× 4× 16×), the timeline (played portion,
  // a gold diamond pip per human decision, future ones in gold-2, the playhead), and REPLAY TIME.
  // Click or drag on the timeline seeks. While the recording loads, every control is aria-disabled.
  import { decisionPips, nextDecision, playing, prevDecision, recording, seek, setSpeed, speed, SPEEDS, t, toggle, type Speed } from '../lib/playback.ts';
  import { endMs, hms, pipLayout, startMs } from '../lib/replay.ts';
  import Glyph from './Glyph.svelte';

  let { disabled }: { disabled: boolean } = $props();

  const start = $derived($recording ? startMs($recording) : 0);
  const end = $derived($recording ? endMs($recording) : 0);
  const span = $derived(Math.max(1, end - start));
  const pos = $derived($recording ? Math.min(end, Math.max(start, $t)) - start : 0);
  const pct = (ms: number): number => Math.min(100, Math.max(0, ((ms - start) / span) * 100));

  let track: HTMLElement | undefined = $state();
  let width = $state(0);
  const places = $derived(pipLayout($decisionPips, start, end, width));
  let dragging = false;

  function seekAt(clientX: number): void {
    if (!track) return;
    const r = track.getBoundingClientRect();
    if (r.width <= 0) return;
    seek(start + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (end - start));
  }
  function down(e: PointerEvent): void {
    if (disabled || e.button !== 0) return;
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    seekAt(e.clientX);
  }
  const move = (e: PointerEvent): void => { if (dragging) seekAt(e.clientX); };
  const up = (): void => { dragging = false; };
  function key(e: KeyboardEvent): void {
    if (disabled) return;
    if (e.key === 'Home') { e.preventDefault(); seek(start); }
    if (e.key === 'End') { e.preventDefault(); seek(end); }
  }

  const act = (fn: () => void) => (): void => { if (!disabled) fn(); };
  function pick(e: Event, s: Speed): void {
    // While loading the radios hold their state.
    if (disabled) { (e.currentTarget as HTMLInputElement).checked = s === $speed; return; }
    setSpeed(s);
  }
</script>

<footer class="replay" class:dis={disabled} aria-label="Replay controls">
  <div class="ctrl">
    <button type="button" class="btn" title="Previous human decision" aria-disabled={disabled} onclick={act(prevDecision)}>
      <Glyph name="prev" scale={2} /><small>prev decision</small>
    </button>
    <button type="button" class="btn play" title={$playing ? 'Pause' : 'Play'} aria-label={$playing ? 'Pause' : 'Play'} aria-disabled={disabled} onclick={act(toggle)}>
      <Glyph name={$playing ? 'pause' : 'play'} scale={3} />
    </button>
    <button type="button" class="btn" title="Next human decision" aria-disabled={disabled} onclick={act(nextDecision)}>
      <small>next decision</small><Glyph name="next" scale={2} />
    </button>
  </div>

  <div class="speed-wrap">
    <span class="lbl" id="replay-speed-label">SPEED</span>
    <div class="speed" role="radiogroup" aria-labelledby="replay-speed-label" aria-disabled={disabled}>
      {#each SPEEDS as s (s)}
        <label class:on={$speed === s}>
          <input type="radio" name="replay-speed" value={s} checked={$speed === s} aria-disabled={disabled} onchange={(e) => pick(e, s)} />{s}×
        </label>
      {/each}
    </div>
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="timeline" bind:this={track} bind:clientWidth={width} data-replay-timeline tabindex="0" role="slider" aria-label="Timeline"
    aria-valuemin={0} aria-valuemax={Math.round(span / 1000)} aria-valuenow={Math.round(pos / 1000)} aria-valuetext="{hms(pos)} of {hms(end - start)}"
    aria-disabled={disabled} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}>
    <div class="track"><div class="played" style:width="{pct(start + pos)}%"></div></div>
    {#each $decisionPips as p, i (`${p.run}/${p.id}`)}
      {@const at = places[i]}
      {@const future = p.at > start + pos}
      {#if at}
        <i class="pip" class:future style:left="{at.x}%" aria-hidden="true"></i>
        {#if at.row}<span class="pipl {at.row} {at.anchor}" class:future style:left="{at.x}%">{p.label}</span>{/if}
      {/if}
    {/each}
    {#if $recording}<i class="head" style:left="{pct(start + pos)}%" aria-hidden="true"></i>{/if}
  </div>

  <div class="time">
    <span class="lbl">REPLAY TIME</span>
    <b>{hms(pos)} <span>/ {hms(end - start)}</span></b>
  </div>
</footer>

<style>
  .replay {
    position: sticky; bottom: 0; z-index: 25; display: flex; align-items: center; gap: 18px; height: var(--replay-height); padding: 0 20px;
    border-top: 1px solid color-mix(in srgb, var(--holo) 25%, transparent);
    background: linear-gradient(color-mix(in srgb, var(--space-2) 96%, transparent), color-mix(in srgb, var(--space-1) 98%, transparent));
    box-shadow: 0 -12px 30px color-mix(in srgb, black 45%, transparent);
  }
  .ctrl { display: flex; align-items: center; gap: 6px; flex: none; }
  .btn { height: 34px; display: inline-flex; align-items: center; gap: 7px; padding: 0 10px; border-radius: var(--r); border: 1px solid var(--line-strong); background: var(--space-3); color: var(--text); font: 600 12px/1 var(--sans); cursor: pointer; }
  .btn small { font: 500 11px/1 var(--mono); color: var(--text-3); }
  .btn.play { width: 44px; height: 44px; justify-content: center; padding: 0; border-radius: 50%; border-color: var(--holo-text); background: radial-gradient(circle at 35% 30%, var(--holo-2), var(--space-3)); box-shadow: 0 0 14px color-mix(in srgb, var(--holo) 35%, transparent); }
  .btn[aria-disabled="true"] { cursor: default; }

  .speed-wrap, .time { display: flex; flex-direction: column; gap: 5px; flex: none; }
  .lbl { font: 600 11px/1 var(--mono); color: var(--text-3); letter-spacing: .1em; }
  .speed { display: flex; border: 1px solid var(--line-strong); border-radius: var(--r); overflow: hidden; }
  .speed label { position: relative; padding: 9px 11px; font: 700 12px/1 var(--mono); color: var(--text-3); border-right: 1px solid var(--line-strong); cursor: pointer; }
  .speed label:last-child { border-right: 0; }
  .speed label.on { color: var(--on-holo); background: var(--holo); }
  .speed input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: inherit; }
  .speed label:has(input:focus-visible) { outline: 2px solid var(--holo); outline-offset: -2px; }

  .timeline { flex: 1; position: relative; height: 62px; min-width: 0; cursor: pointer; touch-action: none; border-radius: var(--r); }
  .track { position: absolute; left: 0; right: 0; top: 30px; height: 6px; border-radius: 3px; background: var(--space-1); border: 1px solid var(--line-strong); }
  .played { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: linear-gradient(90deg, color-mix(in srgb, var(--holo) 25%, transparent), color-mix(in srgb, var(--holo) 70%, transparent)); }
  /* Diamond = human decision. Future pips and labels in gold-2. */
  .pip { position: absolute; top: 28px; width: 12px; height: 12px; margin-left: -6px; transform: rotate(45deg); background: var(--gold); border: 1px solid var(--gold-hi); box-shadow: 0 0 8px color-mix(in srgb, var(--gold) 80%, transparent); pointer-events: none; }
  .pip.future { background: var(--gold-2); border-color: var(--gold-2); box-shadow: none; }
  .pipl { position: absolute; font: 600 11px/1 var(--mono); color: var(--gold); white-space: nowrap; letter-spacing: .02em; pointer-events: none; }
  .pipl.up { top: 6px; }
  .pipl.dn { top: 48px; }
  .pipl.l { transform: translateX(-4px); }
  .pipl.r { transform: translateX(calc(-100% + 4px)); }
  .pipl.future { color: var(--gold-2); }
  .head { position: absolute; top: 18px; width: 2px; height: 30px; margin-left: -1px; background: var(--sprite-white); box-shadow: 0 0 10px var(--holo), 0 0 2px var(--sprite-white); pointer-events: none; }
  .head::before { content: ""; position: absolute; left: -6px; top: -7px; width: 14px; height: 14px; border-radius: 50%; background: var(--holo); border: 2px solid var(--sprite-white); box-shadow: 0 0 12px var(--holo); }

  .time { text-align: right; }
  .time b { font: 700 17px/1 var(--mono); color: var(--text); white-space: nowrap; }
  .time b span { color: var(--text-3); font-weight: 500; }

  /* Loading: controls aria-disabled, labels in text-3. */
  .dis .btn, .dis .btn small, .dis .speed label, .dis .time b { color: var(--text-3); }
  .dis .speed label.on { background: var(--space-3); }
  .dis .timeline { cursor: default; }
</style>
