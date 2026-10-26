<script lang="ts">
  // A Needs You card: Type tag, `raised HH:MM`, the title, the REASON block, the details lines
  // (6-2), the cards it stands for, and the Action slot with each option (command and then) and the
  // reply line, verbatim (AD-34: chat and board match). Old cards fall back to card.commands. A
  // Gate card lists the artifacts it asks d2t to approve as file rows (6-3), each opening the
  // Artifact drawer.
  import { clockTime, gateFiles, laneKey, typeTag } from '../lib/model.ts';
  import type { BoardCard, Lane, NeedsYou } from '../lib/types.ts';
  import ActionSlot from './ActionSlot.svelte';
  import ArtifactButton from './ArtifactButton.svelte';
  import SliceCard from './SliceCard.svelte';
  import StageCard from './StageCard.svelte';

  let { lane, needs, cards, now }: { lane: Lane; needs: NeedsYou; cards: BoardCard[]; now: number } = $props();
  const tag = $derived(typeTag(needs.card));
  const label = $derived(needs.card.reason_label ? (needs.card.reason_label.endsWith(':') ? needs.card.reason_label : `${needs.card.reason_label}:`) : '');
  const stages = $derived(cards.filter((c) => c.kind === 'stage'));
  const slices = $derived(cards.filter((c) => c.kind === 'slice'));
  const files = $derived(gateFiles(lane, needs));
</script>

<article class="needs-card" aria-label="{tag}: {needs.card.title}">
  <div class="nc-top">
    <span class="ttag" class:danger={needs.card.type === 'signal_lost'}><i class="lamp"></i>{tag}</span>
    <span class="when">raised {clockTime(needs.raised_at)}</span>
  </div>
  <h3>{#if needs.slice}<span class="sid">{needs.slice}</span>{/if}{needs.card.title}</h3>
  {#if label}
    <p class="reason"><span class="lbl">REASON</span><b>{label}</b> {needs.card.reason ?? ''}</p>
  {:else if needs.card.reason}
    <p class="reason">{needs.card.reason}</p>
  {/if}
  {#if needs.card.details?.length}
    <div class="details">{#each needs.card.details as line, i (i)}<p>{line}</p>{/each}</div>
  {/if}
  {#if files.length}
    <div class="files"><span class="lbl">FILES</span>{#each files as a (a.id)}<ArtifactButton lane={laneKey(lane)} artifact={a} from={`needs:${needs.ask_id}`} />{/each}</div>
  {/if}
  {#if stages.length}<div class="plates">{#each stages as c (c.id)}<StageCard {lane} card={c} {now} compact />{/each}</div>{/if}
  {#each slices as c (c.id)}<div class="plates"><SliceCard {lane} card={c} {now} compact /></div>{/each}
  <ActionSlot card={needs.card} />
</article>

<style>
  .needs-card {
    position: relative; border-radius: var(--r-xl); padding: 12px 10px;
    background: linear-gradient(180deg, var(--needs-surface-top), var(--needs-surface-bottom));
    border: 1px solid var(--needs-card-edge);
    box-shadow: 0 0 0 1px color-mix(in srgb, black 40%, transparent) inset, 0 10px 26px color-mix(in srgb, black 45%, transparent);
    animation: beacon 2.6s ease-out infinite;
  }
  .needs-card::before {
    content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    background: repeating-linear-gradient(0deg, color-mix(in srgb, var(--gold) 4%, transparent) 0 1px, transparent 1px 3px);
  }
  @keyframes beacon {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--gold) 60%, transparent), 0 0 24px color-mix(in srgb, var(--gold) 25%, transparent), 0 10px 26px color-mix(in srgb, black 45%, transparent); }
    65%, 100% { box-shadow: 0 0 0 14px transparent, 0 0 24px color-mix(in srgb, var(--gold) 25%, transparent), 0 10px 26px color-mix(in srgb, black 45%, transparent); }
  }
  /* Reduced motion: no pulse, a solid 2px gold border keeps the card distinct. */
  :global([data-motion="reduce"]) .needs-card { border: 2px solid var(--gold); }

  .nc-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .ttag {
    display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px; border-radius: var(--r-sm);
    font: 800 11px/1 var(--mono); letter-spacing: .14em; color: var(--gold-ink); background: var(--gold);
    box-shadow: 0 0 12px color-mix(in srgb, var(--gold) 45%, transparent);
  }
  .lamp { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: blink 1s steps(1) infinite; }
  .ttag.danger { background: var(--danger); color: var(--on-danger); box-shadow: 0 0 12px color-mix(in srgb, var(--danger) 50%, transparent); }
  .when { margin-left: auto; font: 11px/1 var(--mono); color: var(--needs-text-3); white-space: nowrap; }
  h3 { margin: 0 0 6px; font: 700 15px/1.3 var(--sans); color: var(--needs-text); overflow-wrap: anywhere; position: relative; }
  .sid { display: inline-block; vertical-align: 2px; margin-right: 6px; font: 700 11px/1 var(--mono); letter-spacing: .06em; color: var(--needs-chip-ink); padding: 3px 5px; border-radius: var(--r-sm); border: 1px solid var(--gold-a3); background: color-mix(in srgb, black 30%, transparent); }
  .reason { margin: 0 0 10px; font: 13px/1.45 var(--sans); color: var(--needs-text-2); overflow-wrap: anywhere; position: relative; }
  .reason b { color: var(--needs-text); font-weight: 600; }
  .details { margin: -4px 0 10px; display: grid; gap: 2px; position: relative; }
  .details p { margin: 0; font: 13px/1.45 var(--sans); color: var(--needs-text-2); overflow-wrap: anywhere; }
  .lbl { display: block; font: 700 11px/1 var(--mono); letter-spacing: .1em; color: var(--needs-text-3); margin-bottom: 4px; }
  .files { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 10px; position: relative; }
  .files .lbl { flex-basis: 100%; margin-bottom: 0; }
  .plates { display: grid; gap: 6px; margin: 0 0 10px; position: relative; }
</style>
