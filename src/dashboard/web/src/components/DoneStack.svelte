<script lang="ts">
  // The Done stack: newest first; beyond 5 cards the 4 newest stay and the rest collapse into a
  // `+N` deck naming them. The deck's seal row carries one focusable gold glyph per seal of a
  // collapsed card, so no seal is ever unreachable.
  import { send, streak } from '../lib/glide.ts';
  import { openDrawer, selection, srcId } from '../lib/drawer.ts';
  import { doneDeck, laneKey, sealLine, sealsOf, shortLabel } from '../lib/model.ts';
  import type { BoardCard, Lane } from '../lib/types.ts';
  import Glyph from './Glyph.svelte';
  import SliceCard from './SliceCard.svelte';
  import StageCard from './StageCard.svelte';

  let { lane, cards, now, lostId = null, lost = null }: { lane: Lane; cards: BoardCard[]; now: number; lostId?: string | null; lost?: string | null } = $props();
  const key = $derived(laneKey(lane));
  const deck = $derived(doneDeck(cards));
  const deckSeals = $derived(deck.rest.flatMap((c) => sealsOf(c, lane).map((d) => ({ card: c, d }))));
  const deckSelected = $derived($selection?.kind === 'decision' && $selection.deck && $selection.lane === key);
</script>

<div class="stack">
  {#each deck.shown as c (c.id)}
    <div class="slot" in:streak out:send={{ key: `${key}/${c.id}` }}>
      {#if c.kind === 'stage'}<StageCard {lane} card={c} {now} lost={c.id === lostId ? lost : null} />{:else}<SliceCard {lane} card={c} {now} lost={c.id === lostId ? lost : null} />{/if}
    </div>
  {/each}
  {#if deck.rest.length}
    <div class="deck" class:selected={deckSelected}>
      {#if deckSelected}<span class="sel-tag">EVIDENCE ▸</span>{/if}
      <div><b>+{deck.rest.length}</b>{deck.rest.map(shortLabel).join(' · ')}</div>
      {#if deckSeals.length}
        <div class="seal-row">
          {#each deckSeals as s (`${s.card.id}/${s.d.id}`)}
            {@const src = srcId(key, s.card.id, s.d.id, true)}
            <button type="button" class="seal-glyph" class:on={$selection?.src === src} class:superseded={s.d.superseded} data-src={src}
              aria-label="{sealLine(s.d)}{s.d.superseded ? ' (superseded)' : ''}" title="{shortLabel(s.card)} · {sealLine(s.d)}"
              onclick={() => openDrawer({ kind: 'decision', lane: key, card: s.card.id, decision: s.d.id, deck: true, src })}>
              <Glyph name="seal" scale={2} />
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: var(--card-gap); }
  .deck {
    position: relative; margin-top: 4px; padding: 8px 10px; border-radius: var(--r); border: 1px solid var(--holo-a2);
    background: color-mix(in srgb, var(--space-2) 85%, transparent); font: 11px/1.4 var(--mono); color: var(--text-3);
    box-shadow: 0 4px 0 -1px var(--space-2), 0 4px 0 0 var(--holo-a2), 0 8px 0 -1px var(--space-2), 0 8px 0 0 color-mix(in srgb, var(--holo) 14%, transparent);
  }
  .deck b { font: 800 13px/1 var(--mono); color: var(--holo-text); margin-right: 6px; }
  .seal-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .seal-glyph { width: 22px; height: 22px; padding: 2px; border: 0; border-radius: var(--r-sm); background: none; cursor: pointer; display: grid; place-items: center; }
  .seal-glyph :global(svg) { filter: drop-shadow(0 0 4px color-mix(in srgb, var(--gold) 55%, transparent)); }
  .seal-glyph:hover { background: var(--space-3); }
  .seal-glyph.on { outline: 2px solid var(--gold); outline-offset: 0; }
  .seal-glyph.on:focus-visible { outline-color: var(--holo); outline-offset: 2px; }
  .seal-glyph.superseded { opacity: .55; }
  .selected { border-color: var(--gold-a3); }
  .sel-tag { position: absolute; right: -2px; top: -11px; font: 700 11px/1 var(--mono); color: var(--gold-ink); background: var(--gold); padding: 3px 5px; border-radius: var(--r-sm); letter-spacing: .06em; }
</style>
