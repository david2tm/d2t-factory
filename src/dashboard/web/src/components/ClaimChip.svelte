<script lang="ts">
  // A Claim chip: CLAIMED (holo), VERIFIED (gold), UNVERIFIED (danger) or SUPERSEDED (dimmed).
  // Its state compares the claim's overdue_at with the browser clock; activating it opens the
  // Evidence drawer (Claim). A CLAIMED chip waiting on Master d2t or on checks (6-3) carries a gloss
  // in holo-text-2: `· awaiting Master d2t`, `· checks running`.
  import { eventAnim } from '../lib/motion.ts';
  import { CHIP_WORD, chipGloss, chipState, displayName } from '../lib/model.ts';
  import { openDrawer, selection, srcId } from '../lib/drawer.ts';
  import type { Claim } from '../lib/types.ts';
  import Glyph from './Glyph.svelte';

  let { lane, card, claim, now, mini = false, inDrawer = false }: { lane: string; card: string; claim: Claim; now: number; mini?: boolean; inDrawer?: boolean } = $props();

  const state = $derived(chipState(claim, now));
  const word = $derived(CHIP_WORD[state]);
  const gloss = $derived(chipGloss(claim, state));
  const src = $derived(srcId(lane, card, claim.step_id));
  const selected = $derived($selection?.kind === 'claim' && $selection.src === src);
  const label = $derived(`${displayName(claim.role)}: ${word}${gloss ? ` ${gloss}` : ''}. Open evidence`);

  function open(): void {
    openDrawer({ kind: 'claim', lane, card, step: claim.step_id, src }, { inDrawer });
  }
</script>

<button type="button" class="chip {state}" class:mini class:selected data-src={src} aria-label={label} title={label} onclick={open} use:eventAnim={{ key: state, cls: 'sweep' }}>
  {#if state === 'verified'}<Glyph name="check" scale={mini ? 1 : 2} />{/if}
  <span class="w">{word}</span>{#if gloss}<em>{gloss}</em>{/if}
</button>

<style>
  .chip {
    display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px; border-radius: var(--r-md);
    font: 700 11px/1 var(--mono); letter-spacing: .08em; white-space: nowrap; position: relative; cursor: pointer;
    border: 1px solid transparent; background: none; overflow: hidden;
  }
  .chip.mini { height: 18px; padding: 0 5px; gap: 3px; letter-spacing: .05em; }
  .chip em { font: 500 12px/1 var(--sans); font-style: normal; letter-spacing: .01em; }
  .chip.mini em { font-size: 11px; }

  .claimed {
    color: var(--holo);
    background: repeating-linear-gradient(0deg, color-mix(in srgb, var(--holo) 14%, transparent) 0 1px, color-mix(in srgb, var(--holo) 5%, transparent) 1px 3px);
    border-color: color-mix(in srgb, var(--holo) 60%, transparent);
    text-shadow: 0 0 6px color-mix(in srgb, var(--holo) 70%, transparent);
    box-shadow: 0 0 10px color-mix(in srgb, var(--holo) 20%, transparent);
    animation: flicker 3.2s infinite;
  }
  .claimed em { color: var(--holo-text-2); }

  .verified {
    color: var(--gold-ink); background: linear-gradient(180deg, var(--gold-hi), var(--gold));
    border-color: var(--gold-hi); padding-left: 4px;
    box-shadow: 0 0 0 1px color-mix(in srgb, black 35%, transparent), 0 0 12px color-mix(in srgb, var(--gold) 35%, transparent);
  }
  .verified.mini { padding-left: 3px; }
  .verified::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, white 55%, transparent) 45%, transparent 60%);
    transform: translateX(-120%); animation: sheen 6s ease-in-out infinite;
  }
  /* Claim verified: a one-time scan-line sweep, then solid gold. */
  :global(.chip.verified.sweep)::before {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: repeating-linear-gradient(0deg, color-mix(in srgb, var(--holo) 45%, transparent) 0 1px, transparent 1px 3px);
    animation: sweep .5s ease-out forwards;
  }
  @keyframes sweep { from { transform: translateX(-100%); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }

  .unverified { color: var(--danger-text); background: var(--danger-a); border-color: var(--danger); animation: flicker 2.2s infinite; }
  .unverified em { color: var(--danger-text); }

  .superseded { color: var(--text-3); border-color: var(--line-strong); border-style: dashed; opacity: .7; }

  .selected { outline: 2px solid var(--gold); outline-offset: 2px; }
</style>
