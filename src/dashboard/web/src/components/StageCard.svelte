<script lang="ts">
  // A Stage card: a holo-plate for one pipeline phase, its claims and its Decision seals.
  import { selection } from '../lib/drawer.ts';
  import { laneKey, sealArtifact, sealsOf } from '../lib/model.ts';
  import { STAGE_GLYPH } from '../lib/sprites.ts';
  import type { BoardCard, Lane } from '../lib/types.ts';
  import ClaimList from './ClaimList.svelte';
  import Glyph from './Glyph.svelte';
  import Seal from './Seal.svelte';

  let { lane, card, now, lost = null, compact = false }: { lane: Lane; card: BoardCard; now: number; lost?: string | null; compact?: boolean } = $props();
  const key = $derived(laneKey(lane));
  const seals = $derived(sealsOf(card, lane));
  const selected = $derived(!!$selection && $selection.lane === key && $selection.card === card.id && !($selection.kind === 'decision' && $selection.deck));
</script>

<div class="plate" class:done={card.column === 'done'} class:lost={!!lost} class:selected class:compact>
  {#if selected}<span class="sel-tag">EVIDENCE ▸</span>{/if}
  <div class="ph">
    <Glyph name={STAGE_GLYPH[card.label] ?? 'emblem'} scale={2} />
    <span>{card.label}</span>
    {#if card.state === 'abandoned'}<small>abandoned</small>{/if}
  </div>
  {#if lost}<div class="lost-tag"><i></i>SIGNAL LOST <span>· last seen {lost}</span></div>{/if}
  <ClaimList lane={key} card={card.id} claims={card.claims} {now} />
  {#if seals.length}
    <div class="seals">{#each seals as d (d.id)}<Seal lane={key} card={card.id} decision={d} artifact={sealArtifact(lane, d)} />{/each}</div>
  {/if}
</div>

<style>
  .plate {
    position: relative; border-radius: var(--r); padding: 9px 10px;
    background: linear-gradient(135deg, color-mix(in srgb, var(--holo) 11%, transparent), var(--holo-a1) 60%, color-mix(in srgb, var(--holo) 7%, transparent));
    border: 1px solid var(--holo-a3);
    box-shadow: 0 0 16px color-mix(in srgb, var(--holo) 9%, transparent), inset 0 0 18px color-mix(in srgb, var(--holo) 5%, transparent);
  }
  .plate.compact { padding: 7px 8px; }
  .plate::before {
    content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    background: repeating-linear-gradient(0deg, color-mix(in srgb, var(--holo-text) 5%, transparent) 0 1px, transparent 1px 3px);
  }
  .plate::after {
    content: ""; position: absolute; inset: 4px; pointer-events: none; opacity: .7;
    background:
      linear-gradient(var(--holo), var(--holo)) left top / 6px 1px no-repeat, linear-gradient(var(--holo), var(--holo)) left top / 1px 6px no-repeat,
      linear-gradient(var(--holo), var(--holo)) right bottom / 6px 1px no-repeat, linear-gradient(var(--holo), var(--holo)) right bottom / 1px 6px no-repeat;
  }
  .ph { display: flex; align-items: center; gap: 8px; font: 700 12px/1 var(--mono); letter-spacing: .1em; color: var(--holo-text); text-shadow: 0 0 8px color-mix(in srgb, var(--holo) 50%, transparent); }
  .ph small { margin-left: auto; font: 500 11px/1 var(--mono); letter-spacing: .02em; color: var(--text-3); text-shadow: none; }
  .seals { margin-top: 7px; display: grid; gap: 4px; position: relative; z-index: 1; }
  .plate :global(.rows) { position: relative; z-index: 1; }

  .lost { border-color: var(--danger); }
  .lost-tag { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; font: 800 11px/1 var(--mono); letter-spacing: .1em; color: var(--danger); animation: flicker 1.8s infinite; }
  .lost-tag i { width: 7px; height: 7px; background: var(--danger); display: block; }
  .lost-tag span { color: var(--danger-text); font-weight: 500; letter-spacing: .02em; }

  .selected { outline: 2px solid var(--gold); outline-offset: 2px; box-shadow: 0 0 0 6px color-mix(in srgb, var(--gold) 12%, transparent), 0 0 22px color-mix(in srgb, var(--gold) 35%, transparent); }
  .sel-tag { position: absolute; right: -2px; top: -11px; z-index: 2; font: 700 11px/1 var(--mono); color: var(--gold-ink); background: var(--gold); padding: 3px 5px; border-radius: var(--r-sm); letter-spacing: .06em; }
</style>
