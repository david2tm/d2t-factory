<script lang="ts">
  // The sticky column-header row with board-wide counts. Master d2t is seated over Needs You.
  import { COLUMNS, COLUMN_TITLE } from '../lib/model.ts';
  import type { Column } from '../lib/types.ts';
  import Sprite from './Sprite.svelte';

  let { counts, look }: { counts: Record<Column, number>; look: boolean } = $props();
</script>

<div class="colheads">
  {#each COLUMNS as col (col)}
    {#if col === 'needs_you'}
      <div class="colhead needs">
        <div class="seat" aria-hidden="true"><div class="halo"></div><div class="rays"></div><Sprite name="d2t" scale={4} {look} /></div>
        <div class="seat-name">Master d2t <span>· you</span></div>
        <div class="needs-title">NEEDS YOU <span class="n gold">{counts.needs_you}</span></div>
      </div>
    {:else}
      <div class="colhead">{COLUMN_TITLE[col]} <span class="n">{counts[col]}</span></div>
    {/if}
  {/each}
</div>

<style>
  .colheads {
    position: sticky; top: var(--topbar-height); z-index: 10; display: grid; grid-template-columns: var(--cols); column-gap: var(--column-gap);
    background: var(--space-1);
  }
  .colhead { align-self: end; padding: 12px 4px 10px; display: flex; align-items: baseline; gap: 8px; font: 700 12px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--text-2); border-bottom: 1px solid var(--line); }
  .n { font: 600 11px/1 var(--mono); color: var(--text-3); letter-spacing: .04em; padding: 3px 6px; border-radius: var(--r-full); background: var(--space-2); border: 1px solid var(--line); }
  .colhead.needs {
    flex-direction: column; align-items: center; gap: 0; padding: 14px 0 10px; margin: 0 -5px; border-bottom: 1px solid var(--gold-a3); color: var(--gold); text-transform: none; letter-spacing: 0;
    align-self: stretch; justify-content: flex-end; background: linear-gradient(180deg, var(--needs-wash-top), var(--needs-wash-top)); border-left: 1px solid var(--needs-edge); border-right: 1px solid var(--needs-edge);
    box-shadow: 0 0 60px color-mix(in srgb, var(--gold) 8%, transparent) inset;
  }
  .seat { position: relative; width: 128px; height: 120px; margin-bottom: 6px; display: grid; place-items: end center; }
  .halo { position: absolute; left: 50%; top: 44%; width: 230px; height: 230px; margin: -115px 0 0 -115px; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--gold) 30%, transparent), color-mix(in srgb, var(--gold) 10%, transparent) 55%, transparent 75%); }
  .rays {
    position: absolute; left: 50%; top: 44%; width: 260px; height: 260px; margin: -130px 0 0 -130px; border-radius: 50%;
    background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--gold) 10%, transparent) 0 6deg, transparent 6deg 22deg);
    mask: radial-gradient(closest-side, black 30%, transparent 72%); animation: spin 60s linear infinite;
  }
  .seat :global(.sprite) { position: relative; filter: drop-shadow(0 6px 10px color-mix(in srgb, black 55%, transparent)); }
  @keyframes spin { to { transform: rotate(360deg); } }
  .seat-name { font: 700 15px/1.2 var(--sans); color: var(--gold); text-shadow: 0 0 12px color-mix(in srgb, var(--gold) 40%, transparent); }
  .seat-name span { font-weight: 500; color: var(--needs-chip-ink); }
  .needs-title { margin-top: 10px; display: flex; align-items: center; gap: 8px; font: 800 14px/1 var(--mono); letter-spacing: .18em; }
  .n.gold { color: var(--gold-ink); background: var(--gold); border-color: var(--gold); font-weight: 800; }
</style>
