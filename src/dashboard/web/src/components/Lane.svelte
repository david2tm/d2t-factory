<script lang="ts">
  // One run's swimlane: the Swimlane header (conductor, run id, task, origin, stage, the Budget
  // clock, the Stage track) and one row of five cells. A labeled region: `Run <run-id>`.
  import { receive, send } from '../lib/glide.ts';
  import { activeCardId, agentsAt, ago, cells, emptyCellCopy, laneKey, needsCell, pausedNotice, stageTrack, stageWord } from '../lib/model.ts';
  import type { Lane } from '../lib/types.ts';
  import Agent from './Agent.svelte';
  import BudgetClock from './BudgetClock.svelte';
  import DoneStack from './DoneStack.svelte';
  import EmptyCell from './EmptyCell.svelte';
  import NeedsCard from './NeedsCard.svelte';
  import SliceCard from './SliceCard.svelte';
  import Sprite from './Sprite.svelte';
  import StageCard from './StageCard.svelte';

  let { lane, now }: { lane: Lane; now: number } = $props();
  const key = $derived(laneKey(lane));
  const c = $derived(cells(lane));
  const needs = $derived(needsCell(lane));
  const empty = $derived(emptyCellCopy(lane, 'backlog'));
  const track = $derived(stageTrack(lane));
  const word = $derived(stageWord(lane));
  const paused = $derived(pausedNotice(lane));
  const lostId = $derived(lane.live?.signal_lost ? activeCardId(lane) : null);
  const lost = $derived(lostId ? ago(lane.last_event_at, now) : null);

  const lit = (i: number): boolean => {
    const next = track[i + 1];
    return !!next && (next.look === 'done' || next.look === 'now' || next.look === 'passed' || next.look === 'waiting');
  };
  const STEP_SR: Record<string, string> = { done: 'done', now: 'current', future: 'not started', passed: 'approved', waiting: 'waiting on you', hollow: 'not reached' };

  // Who stands at a card (agentsAt, model.ts): its stage's character or the builder, the reviewers
  // who reported on a slice in review, and the check droids of its running checks. The conductor
  // stands only in the Swimlane header.
</script>

<section class="lane" aria-label="Run {lane.run_id}">
  <header class="lanehead">
    <div class="conductor">
      <Sprite name="vess" scale={2} />
      <div><b>Adm. Vess Korrin</b><span>conductor</span></div>
    </div>
    <div class="run">
      <span class="runid">{lane.run_id}</span>
      <h2>{lane.task ?? 'Untitled run'}</h2>
      <span class="tag-soft">{lane.origin}</span>
      <span class="stage-now">STAGE <b class:g={word.gold}>{word.text}</b></span>
      {#if paused}<span class="paused">{paused}</span>{/if}
    </div>
    <!-- The Budget clock once intake is confirmed with a time limit, or the elapsed clock
         (`ELAPSED h:mm · no limit`) without one; the slot keeps its width before that. -->
    <div class="budget"><BudgetClock budget={lane.budget} {now} /></div>
    <ol class="track" aria-label="Stage track">
      {#each track as t, i (t.label)}
        {#if t.kind === 'step'}
          <li class="st {t.look}">{t.label}<span class="sr-only">, {STEP_SR[t.look]}</span></li>
        {:else}
          <li class="gate {t.look}"><i aria-hidden="true"></i>{t.look === 'waiting' ? `${t.label} · NEEDS YOU` : t.label}{#if t.look !== 'waiting'}<span class="sr-only">, {STEP_SR[t.look]}</span>{/if}</li>
        {/if}
        {#if i < track.length - 1}<li class="wire" class:off={!lit(i)} aria-hidden="true"></li>{/if}
      {/each}
    </ol>
  </header>

  <div class="cells">
    <div class="cell" data-col="backlog">
      {#each c.backlog as card (card.id)}
        <div class="slot" in:receive={{ key: `${key}/${card.id}` }} out:send={{ key: `${key}/${card.id}` }}>
          {#if card.kind === 'stage'}<StageCard {lane} {card} {now} />{:else}<SliceCard {lane} {card} {now} />{/if}
        </div>
      {/each}
      {#if empty}<EmptyCell title={empty.title} body={empty.body} />{/if}
    </div>

    {#each [c.in_progress, c.in_review] as list, col}
      <div class="cell" data-col={col === 0 ? 'in_progress' : 'in_review'}>
        {#each list as card (card.id)}
          {@const who = agentsAt(card)}
          <div class="slot" in:receive={{ key: `${key}/${card.id}` }} out:send={{ key: `${key}/${card.id}` }}>
            {#if who.length}
              <div class="crew" class:cluster={who.length > 1}>
                {#each who as role, j (role)}<Agent {role} lost={card.id === lostId} delay={j * 0.3} />{/each}
              </div>
            {/if}
            {#if card.kind === 'stage'}<StageCard {lane} {card} {now} lost={card.id === lostId ? lost : null} />{:else}<SliceCard {lane} {card} {now} lost={card.id === lostId ? lost : null} />{/if}
          </div>
        {/each}
      </div>
    {/each}

    <div class="cell needs" data-col="needs_you">
      {#each needs.groups as g (g.needs.ask_id)}
        <NeedsCard {lane} needs={g.needs} cards={g.cards} {now} />
      {/each}
      {#each needs.loose as card (card.id)}
        {#if card.kind === 'stage'}<StageCard {lane} {card} {now} lost={card.id === lostId ? lost : null} />{:else}<SliceCard {lane} {card} {now} lost={card.id === lostId ? lost : null} />{/if}
      {/each}
    </div>

    <div class="cell" data-col="done">
      <DoneStack {lane} cards={c.done} {now} {lostId} {lost} />
    </div>
  </div>
</section>

<style>
  .lane { position: relative; margin-top: var(--lane-gap); }
  .lanehead {
    position: relative; z-index: 2; padding: 10px 14px; border-radius: var(--r-xl); border: 1px solid var(--holo-a2);
    background: linear-gradient(90deg, color-mix(in srgb, var(--space-3) 92%, transparent), color-mix(in srgb, var(--space-2) 82%, transparent));
    box-shadow: 0 0 0 1px color-mix(in srgb, black 30%, transparent) inset, 0 8px 20px color-mix(in srgb, black 25%, transparent);
    display: grid; grid-template-columns: auto 1fr auto; column-gap: 18px; row-gap: 9px; align-items: center;
  }
  .conductor { display: flex; align-items: center; gap: 8px; padding-right: 16px; border-right: 1px solid var(--line); }
  .conductor b { display: block; font: 600 12px/1.2 var(--sans); }
  .conductor span { display: block; font: 11px/1.3 var(--mono); color: var(--holo); }
  .run { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .runid { font: 700 12px/1 var(--mono); color: var(--text); padding: 5px 7px; border-radius: var(--r-md); background: var(--space-1); border: 1px solid var(--line-strong); letter-spacing: .04em; white-space: nowrap; }
  h2 { margin: 0; font: 700 16px/1.2 var(--sans); letter-spacing: -.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .tag-soft { font: 600 11px/1 var(--mono); color: var(--text-3); padding: 4px 6px; border-radius: var(--r-md); border: 1px solid var(--line); letter-spacing: .04em; }
  .stage-now { font: 600 11px/1 var(--mono); color: var(--text-3); letter-spacing: .08em; margin-left: 4px; white-space: nowrap; }
  .stage-now b { color: var(--holo); font-weight: 700; }
  .stage-now b.g { color: var(--gold); }
  .paused { font: 600 11px/1 var(--mono); color: var(--text-2); letter-spacing: .04em; white-space: nowrap; }
  .budget { width: 236px; min-height: 1px; }

  .track { grid-column: 1 / -1; display: flex; align-items: center; margin: 0; padding: 0; list-style: none; }
  .track li { display: flex; align-items: center; gap: 6px; font: 600 11px/1 var(--mono); letter-spacing: .07em; color: var(--text-3); white-space: nowrap; }
  .st { padding: 5px 9px; border-radius: var(--r-sm); border: 1px solid var(--line); background: var(--space-1); }
  .st.done { color: var(--holo-text-2); border-color: color-mix(in srgb, var(--holo) 28%, transparent); background: color-mix(in srgb, var(--holo) 6%, transparent); }
  .st.done::before { content: ""; width: 6px; height: 6px; background: var(--holo-2); display: inline-block; }
  .st.now { color: var(--on-holo); background: var(--holo); border-color: var(--holo-text); box-shadow: 0 0 14px color-mix(in srgb, var(--holo) 55%, transparent); animation: nowpulse 2.4s ease-in-out infinite; }
  .st.now::before { content: ""; width: 6px; height: 6px; background: var(--on-holo); display: inline-block; animation: blink 1s steps(1) infinite; }
  .wire { flex: 1; min-width: 8px; height: 1px; background: linear-gradient(90deg, color-mix(in srgb, var(--holo) 35%, transparent), color-mix(in srgb, var(--holo) 15%, transparent)); }
  .wire.off { background: var(--line); }
  .gate { color: var(--gold) !important; gap: 5px; padding: 0 2px; }
  .gate i { width: 11px; height: 11px; transform: rotate(45deg); display: block; border: 2px solid var(--gold); background: var(--gold); box-shadow: 0 0 8px color-mix(in srgb, var(--gold) 60%, transparent); }
  .gate.hollow { color: var(--gold-2) !important; }
  .gate.hollow i { background: transparent; box-shadow: none; border-color: var(--gold-2); }
  .gate.waiting { color: var(--gold-ink) !important; background: var(--gold); padding: 4px 8px 4px 6px; border-radius: var(--r-sm); box-shadow: 0 0 16px color-mix(in srgb, var(--gold) 50%, transparent); }
  .gate.waiting i { background: transparent; border-color: var(--gold-ink); box-shadow: none; animation: gatewait 1.4s ease-in-out infinite; }
  @keyframes nowpulse { 50% { box-shadow: 0 0 22px color-mix(in srgb, var(--holo) 85%, transparent); } }
  @keyframes gatewait { 50% { background: var(--gold-ink); } }

  .cells { display: grid; grid-template-columns: var(--cols); column-gap: var(--column-gap); align-items: start; }
  .cell { padding: 14px 0 6px; position: relative; z-index: 1; display: flex; flex-direction: column; gap: var(--card-gap); min-width: 0; }
  .cell.needs { padding: 14px 6px 6px; }
  .slot { display: flex; flex-direction: column; align-items: stretch; min-width: 0; }
  .crew { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 6px; margin-bottom: 10px; position: relative; z-index: 3; }
  .crew.cluster { justify-content: space-around; }
</style>
