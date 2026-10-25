<script lang="ts">
  // A Slice card: a datapad with its id chip, title, `round n/2`, its claims (reviewers as the
  // Verdict list) and its Decision seals. Variants: live (an agent works it), findings queued, AT RISK
  // (a cut candidate while the cut card is open), CUT, SIGNAL LOST, evidence-selected. A live slice
  // shows its Time box meter (3-4), amber once over.
  import { selection } from '../lib/drawer.ts';
  import { laneKey, pendingReviewers, reviewersAtWork, sealsOf, sliceParts, timeboxMeter } from '../lib/model.ts';
  import type { BoardCard, Lane } from '../lib/types.ts';
  import ClaimList from './ClaimList.svelte';
  import Seal from './Seal.svelte';

  let { lane, card, now, lost = null, compact = false }: { lane: Lane; card: BoardCard; now: number; lost?: string | null; compact?: boolean } = $props();
  const key = $derived(laneKey(lane));
  const parts = $derived(sliceParts(card));
  const seals = $derived(sealsOf(card, lane));
  const live = $derived(card.state === 'BUILDING' || card.state === 'IN_REVIEW');
  const cut = $derived(card.state === 'CUT');
  const risk = $derived(!!card.at_risk && !lost);
  const selected = $derived(!!$selection && $selection.lane === key && $selection.card === card.id && !($selection.kind === 'decision' && $selection.deck));
  // One pending row per rostered reviewer with no claim yet (3-3).
  const pending = $derived(pendingReviewers(card));
  const box = $derived(timeboxMeter(card, now));
  const reviewing = $derived(reviewersAtWork(card));
</script>

<article class="pad" class:live={live && !lost} class:lost={!!lost} class:risk class:cut class:selected class:compact aria-label="Slice {parts.sid}{risk ? ', at risk, cut candidate' : ''}">
  {#if selected}<span class="sel-tag">EVIDENCE ▸</span>{/if}
  {#if !compact}<span class="sid">{parts.sid}</span>
  <h3>{parts.title || parts.sid}</h3>{/if}
  {#if (card.rounds ?? 0) > 0}<div class="meta">round {card.rounds}/2</div>{/if}
  {#if card.state === 'FINDINGS_QUEUED'}<div class="queued">findings queued</div>{/if}
  {#if box && !lost}<div class="box" class:over={box.over} aria-label="Time box {box.text}{box.over ? ', over' : ''}"><span class="box-label">Time box</span><span class="box-bar"><i style="width: {box.fill * 100}%"></i></span><span class="box-val">{box.text}</span></div>{/if}
  {#if risk}<div class="risk-tag">AT RISK <span>· cut candidate</span></div>{/if}
  {#if lost}<div class="lost-tag"><i></i>SIGNAL LOST <span>· last seen {lost}</span></div>{/if}
  {#if cut}<span class="cut-tag">CUT</span>{:else}<ClaimList lane={key} card={card.id} claims={card.claims} {now} {reviewing} {pending} />{/if}
  {#if seals.length}
    <div class="seals">{#each seals as d (d.id)}<Seal lane={key} card={card.id} decision={d} />{/each}</div>
  {/if}
</article>

<style>
  .pad {
    position: relative; border-radius: var(--r-lg); padding: 10px 11px 11px 13px;
    background: linear-gradient(180deg, var(--card-top), var(--card-bottom)); border: 1px solid var(--card-edge);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 7%, transparent), 0 8px 16px color-mix(in srgb, black 35%, transparent);
  }
  .pad.compact { padding: 6px 8px 8px 11px; box-shadow: none; }
  .pad::before { content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 0 2px 2px 0; background: var(--line-strong); }
  .pad::after { content: ""; position: absolute; right: 8px; top: 8px; width: 4px; height: 4px; border-radius: 1px; background: var(--line-strong); box-shadow: -7px 0 0 var(--line-strong); }
  .live::before { background: var(--holo); box-shadow: 0 0 8px var(--holo); }
  .live::after { background: var(--holo); box-shadow: -7px 0 0 var(--line-strong), 0 0 6px var(--holo); }
  .cut::after { opacity: .3; }
  .risk { border-color: color-mix(in srgb, var(--amber) 55%, transparent); background: linear-gradient(90deg, color-mix(in srgb, var(--amber) 10%, transparent), transparent 50%), linear-gradient(180deg, var(--card-top), var(--card-bottom)); }
  .risk::before { width: 4px; background: repeating-linear-gradient(180deg, var(--amber) 0 5px, transparent 5px 8px); }
  .risk-tag { display: inline-flex; gap: 6px; align-items: center; margin-top: 2px; font: 800 11px/1 var(--mono); letter-spacing: .1em; color: var(--amber); }
  .risk-tag span { font-weight: 500; letter-spacing: .02em; color: var(--amber-text); }
  .sid { display: inline-block; font: 700 11px/1 var(--mono); letter-spacing: .06em; color: var(--text-2); padding: 3px 5px; border-radius: var(--r-sm); background: var(--space-1); border: 1px solid var(--line-strong); margin-bottom: 6px; }
  h3 { margin: 0 0 6px; font: 600 14px/1.3 var(--sans); color: var(--text); overflow-wrap: anywhere; }
  .meta { font: 11px/1.4 var(--mono); color: var(--text-3); }
  .queued { font: 700 11px/1.4 var(--mono); letter-spacing: .08em; color: var(--holo-text); }
  .box { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 6px; margin: 2px 0 4px; font: 11px/1.4 var(--mono); color: var(--text-3); }
  .box-label { letter-spacing: .06em; }
  .box-bar { height: 4px; border-radius: 2px; background: var(--space-1); border: 1px solid var(--line); overflow: hidden; }
  .box-bar i { display: block; height: 100%; background: var(--holo); }
  .box-val { color: var(--text-2); }
  .box.over .box-bar i { background: var(--amber); }
  .box.over .box-val, .box.over .box-label { color: var(--amber-text); }
  .cut-tag { display: inline-block; margin-top: 4px; font: 700 11px/1 var(--mono); letter-spacing: .08em; color: var(--text-3); padding: 4px 6px; border: 1px solid var(--line); border-radius: var(--r-md); }
  .seals { margin-top: 8px; display: grid; gap: 4px; }

  .lost { border-color: var(--danger); }
  .lost::before { background: var(--danger); }
  .lost-tag { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font: 800 11px/1 var(--mono); letter-spacing: .1em; color: var(--danger); animation: flicker 1.8s infinite; }
  .lost-tag i { width: 7px; height: 7px; background: var(--danger); display: block; }
  .lost-tag span { color: var(--danger-text); font-weight: 500; letter-spacing: .02em; }

  .selected { outline: 2px solid var(--gold); outline-offset: 2px; box-shadow: 0 0 0 6px color-mix(in srgb, var(--gold) 12%, transparent), 0 0 22px color-mix(in srgb, var(--gold) 35%, transparent); }
  .sel-tag { position: absolute; right: -2px; top: -11px; z-index: 2; font: 700 11px/1 var(--mono); color: var(--gold-ink); background: var(--gold); padding: 3px 5px; border-radius: var(--r-sm); letter-spacing: .06em; }
</style>
