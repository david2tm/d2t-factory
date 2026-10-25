<script lang="ts">
  // A Decision seal: gold glyph + the decision line, naming the human. Activating it opens the
  // Evidence drawer (Decision). Superseded (voided) seals stay, dimmed and labeled.
  import { openDrawer, selection, srcId } from '../lib/drawer.ts';
  import { sealLine } from '../lib/model.ts';
  import type { Decision } from '../lib/types.ts';
  import Glyph from './Glyph.svelte';

  let { lane, card, decision }: { lane: string; card: string; decision: Decision } = $props();
  const src = $derived(srcId(lane, card, decision.id));
  const line = $derived(sealLine(decision));
  const selected = $derived($selection?.kind === 'decision' && $selection.src === src);
</script>

<button type="button" class="seal" class:superseded={decision.superseded} class:selected data-src={src}
  aria-label="{line}{decision.superseded ? ' (superseded)' : ''}. Open decision" title={line}
  onclick={() => openDrawer({ kind: 'decision', lane, card, decision: decision.id, deck: false, src })}>
  <Glyph name="seal" scale={2} cls="seal-glyph" />
  <span>{line}{#if decision.superseded}<small> SUPERSEDED</small>{/if}</span>
</button>

<style>
  .seal {
    display: flex; align-items: flex-start; gap: 6px; padding: 2px; margin: 0 -2px; border: 0; border-radius: var(--r-sm); background: none;
    font: 600 11px/1.3 var(--mono); color: var(--gold); letter-spacing: .02em; text-align: left; cursor: pointer;
  }
  .seal :global(.seal-glyph) { filter: drop-shadow(0 0 4px color-mix(in srgb, var(--gold) 55%, transparent)); margin-top: -1px; }
  .seal:hover { background: var(--space-3); }
  .seal small { font: 700 11px/1 var(--mono); color: var(--text-3); letter-spacing: .08em; }
  .superseded { opacity: .6; }
  .selected { outline: 2px solid var(--gold); outline-offset: 2px; }
</style>
