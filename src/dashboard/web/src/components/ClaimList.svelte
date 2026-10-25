<script lang="ts">
  // A card's claims, one row each: role dot · display name · (verdict word) · mini Claim chip.
  // Verdicts are agent claims, never gold. `reviewing` adds a pending row with no chip; `pending`
  // adds one per rostered reviewer that has no claim yet.
  import { displayName, isReviewer, roleColor, verdictText, verdictTone } from '../lib/model.ts';
  import type { Claim } from '../lib/types.ts';
  import ClaimChip from './ClaimChip.svelte';

  let { lane, card, claims, now, reviewing = false, pending = [] }: { lane: string; card: string; claims: Claim[]; now: number; reviewing?: boolean; pending?: string[] } = $props();
  const agents = $derived(claims.filter((c) => !isReviewer(c.role)));
  const reviews = $derived(claims.filter((c) => isReviewer(c.role)));
</script>

{#if agents.length}
  <ul class="rows">
    {#each agents as c (c.step_id)}
      <li class:void={c.superseded}><i class="dot" style="background:{roleColor(c.role)}"></i><span class="nm">{displayName(c.role)}</span><ClaimChip {lane} {card} claim={c} {now} mini /></li>
    {/each}
  </ul>
{/if}
{#if reviews.length || reviewing || pending.length}
  <ul class="rows verdicts">
    {#each reviews as c (c.step_id)}
      <li class:void={c.superseded}>
        <i class="dot" style="background:{roleColor(c.role)}"></i><span class="nm">{displayName(c.role)}</span>
        {#if c.verdict}<span class="v {verdictTone(c.verdict)}" aria-label={c.verdict} title={c.verdict}>{verdictText(c.verdict)}</span>{/if}
        <ClaimChip {lane} {card} claim={c} {now} mini />
      </li>
    {/each}
    {#each pending as role (role)}
      <li class="pending"><i class="dot" style="background:{roleColor(role)}"></i><span class="nm">{displayName(role)}</span><span class="v wait">pending</span></li>
    {/each}
    {#if reviewing}<li><i class="dot" style="background:var(--line-strong)"></i><span class="nm">reviewers</span><span class="v wip">reviewing</span></li>{/if}
  </ul>
{/if}

<style>
  .rows { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 5px; }
  .verdicts { padding-top: 8px; border-top: 1px solid var(--line); }
  li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font: 12px/1.2 var(--sans); color: var(--text-2); min-width: 0; }
  li > :global(.chip) { margin-left: auto; }
  .dot { width: 6px; height: 6px; flex: none; }
  .nm { min-width: 0; overflow-wrap: anywhere; }
  .v { margin-left: auto; font: 700 11px/1 var(--mono); letter-spacing: .06em; }
  .v + :global(.chip) { margin-left: 0; }
  .v.plain { color: var(--text); }
  .v.other { color: var(--holo-text); }
  .v.wip { color: var(--text-3); font-weight: 500; }
  .v.wip::after { content: "…"; animation: blink 1.2s steps(1) infinite; }
  .v.wait { color: var(--text-3); font-weight: 500; }
  .pending .nm { color: var(--text-3); }
  .void { opacity: .6; }
</style>
