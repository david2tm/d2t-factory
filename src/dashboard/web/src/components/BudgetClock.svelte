<script lang="ts">
  // The Budget clock (DESIGN Swimlane header): `BUDGET 1:12 left of 2:00`, a draining holo meter with
  // the gold cut marker, and `▲ cut point at 0:40 left`. Past 0:00 the value reads `+m:ss over` in
  // amber and the meter is empty.
  import { budgetClock } from '../lib/model.ts';
  import type { BudgetView } from '../lib/types.ts';
  import Glyph from './Glyph.svelte';

  let { budget, now }: { budget: BudgetView | null; now: number } = $props();
  const v = $derived(budgetClock(budget, now));
</script>

{#if v}
  <div class="clock" role="group" aria-label="Budget: {v.over ? `${v.value} over` : `${v.value} left`} of {v.limit}; cut point at {v.cutLeft} left">
    <div class="top" aria-hidden="true">
      <Glyph name="clock" />
      <span class="lbl">BUDGET</span>
      {#if v.over}<b class="over">{v.value}</b><span class="over">over</span>{:else}<b>{v.value}</b>left of {v.limit}{/if}
    </div>
    <div class="bar" aria-hidden="true">
      <i class="fill" style="width: {(v.fill * 100).toFixed(2)}%"></i>
      <i class="cut" style="left: {(v.cut * 100).toFixed(2)}%"></i>
    </div>
    <div class="cap" aria-hidden="true"><b>▲ cut point</b> at {v.cutLeft} left</div>
  </div>
{/if}

<style>
  .clock { width: 236px; }
  .top { display: flex; align-items: baseline; gap: 6px; font: 12px/1 var(--sans); color: var(--text-2); }
  .top :global(svg) { align-self: center; }
  .lbl { font: 700 11px/1 var(--mono); letter-spacing: .12em; color: var(--text-3); margin-right: 2px; }
  .top b { font: 700 15px/1 var(--mono); color: var(--text); }
  .top .over { color: var(--amber); }
  .bar { position: relative; height: 8px; margin-top: 7px; border-radius: var(--r-xs); background: var(--space-1); border: 1px solid var(--line-strong); }
  .fill {
    position: absolute; left: 0; top: 0; bottom: 0; border-radius: 1px;
    background: linear-gradient(90deg, var(--holo-2), var(--holo)); box-shadow: 0 0 8px color-mix(in srgb, var(--holo) 45%, transparent);
  }
  .fill::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 5px, color-mix(in srgb, var(--space-0) 55%, transparent) 5px 6px); }
  .cut { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: var(--gold); box-shadow: 0 0 6px color-mix(in srgb, var(--gold) 80%, transparent); }
  .cap { margin-top: 5px; font: 11px/1 var(--mono); color: var(--text-3); }
  .cap b { color: var(--gold); font-weight: 600; }
</style>
