<script lang="ts">
  // The Evidence drawer, docked right (the board narrows; it never overlays cards). Claim variant:
  // the proof table and the CLAIMED → VERIFIED chain. Decision variant: event (the AD-5 kind),
  // reason, decided by, at, terminal response (prompt_text verbatim), run / stage, evidence.
  // Artifact variant (6-3): path with Copy path, sha256, pinned by, and the redacted body its
  // step_verified embedded (never a file read), read-only. `×` or Esc closes it and focus returns to
  // the source.
  import { tick } from 'svelte';
  import { copyText } from '../lib/copy.ts';
  import { closeDrawer, openDrawer, srcId, type Selection } from '../lib/drawer.ts';
  import { artifactFor, CHIP_WORD, chipState, decider, displayName, eventName, laneKey, pinnedLine, proofRow, sealLine, shortLabel, shortSha } from '../lib/model.ts';
  import type { Claim, EvidenceRow, Lane } from '../lib/types.ts';
  import ArtifactButton from './ArtifactButton.svelte';
  import ClaimChip from './ClaimChip.svelte';
  import Glyph from './Glyph.svelte';

  let { sel, lanes, now }: { sel: Selection; lanes: Lane[]; now: number } = $props();

  const lane = $derived(lanes.find((l) => laneKey(l) === sel.lane) ?? null);
  const card = $derived(lane?.cards.find((c) => c.id === sel.card) ?? null);
  const claim = $derived(sel.kind === 'claim' ? (card?.claims.find((c) => c.step_id === sel.step) ?? null) : null);
  const decision = $derived(sel.kind === 'decision' ? (lane?.decisions.find((d) => d.id === sel.decision) ?? null) : null);
  const artifact = $derived(sel.kind === 'artifact' && lane ? artifactFor(lane, sel.artifact) : null);
  const gone = $derived(!lane || (sel.kind === 'artifact' ? !artifact : !card || (sel.kind === 'claim' ? !claim : !decision)));

  // Copy path (6-3): the check glyph for a moment on success; on failure the path is selected.
  let pathEl: HTMLElement | undefined = $state();
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  async function copyPath(path: string): Promise<void> {
    if (!(await copyText(path, pathEl, 'Copy failed — path selected'))) return;
    copied = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { copied = false; }, 1500);
  }
  // The decision that pinned the artifact opens in this drawer, from the card it sealed.
  function openPin(id: string): void {
    const c = lane?.cards.find((x) => x.seals.includes(id));
    if (c) openDrawer({ kind: 'decision', lane: sel.lane, card: c.id, decision: id, deck: false, src: sel.src });
  }

  let heading: HTMLElement | undefined = $state();
  // Focus moves into the drawer when it opens or swaps content.
  $effect(() => {
    void sel.src;
    tick().then(() => heading?.focus());
  });

  const stamp = (ts: string | null): string => {
    const t = ts ? new Date(ts) : null;
    if (!t || !Number.isFinite(t.getTime())) return '—';
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
  };
  const time = (ts: string | null): string => stamp(ts).slice(11) || '—';

  // A decision's evidence id, as the claim whose proof it is (for its chip), or null (shown raw).
  function evidenceOf(id: string): { claim: Claim; cardId: string } | null {
    for (const c of lane?.cards ?? []) for (const cl of c.claims) if (cl.evidence.some((e) => e.id === id) || cl.step_id === id) return { claim: cl, cardId: c.id };
    return null;
  }

  const isCheck = (rows: EvidenceRow[]): boolean => rows.some((r) => r.kind === 'check_ran');
  const splitReason = (r: string): [string, string] => { const i = r.indexOf(': '); return i < 0 ? ['', r] : [r.slice(0, i + 1), r.slice(i + 2)]; };
</script>

<aside class="drawer" aria-label="Evidence drawer">
  <div class="dr-head">
    <div class="dr-kick">EVIDENCE DRAWER</div>
    <button type="button" class="dr-x" aria-label="Close evidence drawer" title="Close (Esc)" onclick={closeDrawer}>×</button>
    {#if gone}
      <h3 tabindex="-1" bind:this={heading}>No longer on the board</h3>
    {:else if claim && card && lane}
      {@const st = chipState(claim, now)}
      <h3 tabindex="-1" bind:this={heading}>Evidence · {shortLabel(card)} {displayName(claim.role)} · <span class="st {st}">{CHIP_WORD[st]}</span></h3>
    {:else if decision && lane}
      <h3 tabindex="-1" bind:this={heading}>Decision · {eventName(decision)} · {lane.run_id}</h3>
    {:else if artifact && lane}
      <h3 tabindex="-1" bind:this={heading}>Artifact · {artifact.name} · {lane.run_id}</h3>
    {/if}
  </div>

  {#if !gone && claim && card && lane}
    {@const st = chipState(claim, now)}
    {@const who = displayName(claim.role)}
    {@const check = isCheck(claim.evidence)}
    <div class="dr-hero {st}">
      <Glyph name={st === 'verified' ? 'check' : 'emblem'} scale={5} />
      <div>
        <b>{CHIP_WORD[st]}</b>
        <span>
          {#if st === 'verified'}{check ? `An evidence check confirmed ${who}'s claim.` : `A hook fact matched ${who}'s claim.`}
          {:else if st === 'unverified'}No hook fact or evidence check confirmed {who}'s claim in time.
          {:else if st === 'superseded'}This claim was voided by a later decision.
          {:else if claim.waiting_on === 'human'}{who} says so. It waits on Master d2t.
          {:else if claim.waiting_on === 'checks'}{who} says so. The CLI's checks are running.
          {:else}{who} says so. No hook fact or evidence check yet.{/if}
        </span>
      </div>
    </div>

    <section class="dr-sec">
      <h4>{check ? 'EVIDENCE CHECK' : 'HOOK FACT'}</h4>
      {#if claim.state === 'verified' && claim.evidence.length}
        {#each claim.evidence as e (e.id)}
          <dl class="fact">
            <dt>event</dt><dd>{e.kind === 'ref' ? 'reference' : e.kind}</dd>
            {#if e.check}<dt>check</dt><dd><code>{e.check}</code></dd>{/if}
            {#if e.path}<dt>path</dt><dd><code>{e.path}</code></dd>{/if}
            {#if e.exit_code !== undefined}<dt>exit code</dt><dd><span class="ok" class:bad={e.exit_code !== 0}>{e.exit_code}</span></dd>{/if}
            <dt>timestamp</dt><dd>{stamp(e.ts)}</dd>
            <dt>id</dt><dd><code>{e.id}</code></dd>
          </dl>
        {/each}
      {:else}
        <dl class="fact"><dt>proof</dt><dd>{proofRow(claim, st)}</dd></dl>
      {/if}
    </section>

    <section class="dr-sec">
      <h4>CLAIM → PROOF</h4>
      <div class="chain">
        <div class="node c" class:end={claim.state !== 'verified'}><i></i></div>
        <p><b class="c">CLAIMED</b> by {who}<small>{time(claim.reported_at)} · {claim.kind}</small></p>
        {#if claim.state === 'verified'}
          {@const e = claim.evidence.at(-1)}
          <div class="node g"><i></i></div>
          <p><b class="g">VERIFIED</b> by {check ? 'evidence check' : 'hook'}<small>{time(e?.ts ?? null)}{e?.exit_code !== undefined ? ` · exit code ${e.exit_code}` : ''}</small></p>
        {/if}
      </div>
      {#if claim.state === 'verified'}
        <div class="dr-line"><span class="c">Claimed by {who} {time(claim.reported_at)}</span> → <span class="g">verified by {check ? 'evidence check' : 'hook'} {time(claim.evidence.at(-1)?.ts ?? null)}</span></div>
      {/if}
    </section>

    <p class="dr-note"><b>Agents can claim. Only a hook fact or an evidence check can verify.</b></p>
    <p class="dr-card"><b>Card</b> {card.label}<br /><b>Run</b> {lane.run_id}{lane.task ? ` · ${lane.task}` : ''}</p>
  {:else if !gone && decision && card && lane}
    <div class="dr-hero verified">
      <Glyph name="seal" scale={5} />
      <div><b>DECISION{decision.superseded ? ' · SUPERSEDED' : ''}</b><span>{sealLine(decision)}</span></div>
    </div>
    <section class="dr-sec">
      <h4>DECISION</h4>
      <dl class="fact">
        <dt>event</dt><dd><code>{decision.kind}</code></dd>
        {#if decision.reason}{@const [lbl, line] = splitReason(decision.reason)}<dt>reason</dt><dd class="prose">{#if lbl}<b>{lbl}</b> {/if}{line}</dd>{/if}
        <dt>decided by</dt><dd class="gold">{decider(decision.decided_by)}</dd>
        <dt>at</dt><dd>{stamp(decision.at)}</dd>
        <dt>terminal response</dt><dd>{#if decision.prompt_text}<span class="said">{decision.prompt_text}</span>{:else}—{/if}</dd>
        <dt>run / stage</dt><dd>{lane.run_id} · {decision.stage.replace('_', ' ')}</dd>
        <dt>evidence checked</dt>
        <dd class="ev">
          {#if decision.evidence.length === 0}none required{/if}
          {#each decision.evidence as id (id)}
            {@const ev = evidenceOf(id)}
            {@const art = artifactFor(lane, id)}
            {#if ev}
              <span class="evrow">{displayName(ev.claim.role)} <ClaimChip lane={sel.lane} card={ev.cardId} claim={ev.claim} {now} mini />{#if art}<ArtifactButton lane={sel.lane} artifact={art} from={`decision:${decision.id}`} tone="drawer" />{/if}</span>
            {:else if art}
              <span class="evrow"><ArtifactButton lane={sel.lane} artifact={art} from={`decision:${decision.id}`} tone="drawer" /></span>
            {:else}
              <span class="evrow"><code>{id}</code></span>
            {/if}
          {/each}
        </dd>
      </dl>
    </section>
    <p class="dr-note"><b>Agents can claim. Only Master d2t decides.</b></p>
    <p class="dr-card"><b>Card</b> {card.label}{sel.kind === 'decision' && sel.deck ? ' · Done deck' : ''}<br /><b>Run</b> {lane.run_id}{lane.task ? ` · ${lane.task}` : ''}</p>
  {:else if !gone && artifact && lane}
    {@const pin = pinnedLine(lane, artifact)}
    <section class="dr-sec">
      <h4>ARTIFACT</h4>
      <dl class="fact">
        <dt>path</dt>
        <dd class="path">
          <code bind:this={pathEl}>{artifact.path}</code>
          <button type="button" class="copy" aria-label="Copy path" title="Copy path" onclick={() => copyPath(artifact.path)}>
            <Glyph name={copied ? 'check' : 'copy'} scale={2} />
          </button>
        </dd>
        <dt>sha256</dt><dd><code aria-hidden="true" title={artifact.sha256}>{shortSha(artifact.sha256)}</code><span class="vh">{artifact.sha256}</span></dd>
        <dt>pinned</dt>
        <dd>
          {#if pin.decision}
            <button type="button" class="pinned" onclick={() => openPin(pin.decision!.id)}>{pin.text}</button>
          {:else}<span class="dim">{pin.text}</span>{/if}
          {#if artifact.superseded}<span class="dim"> · superseded</span>{/if}
        </dd>
      </dl>
    </section>
    <section class="dr-sec">
      <h4>BODY</h4>
      <textarea class="body" readonly spellcheck="false" aria-label="{artifact.name} body" value={artifact.body}></textarea>
      {#if artifact.truncated}<p class="trunc">truncated at 64 KB</p>{/if}
    </section>
    <p class="dr-note"><b>Master d2t approves these bytes.</b></p>
    <p class="dr-card"><b>Stage</b> {artifact.stage.replace('_', ' ')}<br /><b>Run</b> {lane.run_id}{lane.task ? ` · ${lane.task}` : ''}</p>
  {/if}
</aside>

<style>
  .drawer {
    position: sticky; top: var(--topbar-height); align-self: start; z-index: 15; width: var(--drawer-width); height: calc(100vh - var(--topbar-height)); overflow-y: auto;
    border-left: 1px solid color-mix(in srgb, var(--gold) 40%, transparent);
    background: linear-gradient(180deg, var(--space-2), var(--space-1));
    box-shadow: -24px 0 48px color-mix(in srgb, black 50%, transparent); padding: 0 0 24px;
  }
  .drawer::before { content: ""; position: sticky; display: block; top: 0; height: 3px; background: var(--gold); z-index: 1; }
  .dr-head { padding: 15px 18px 14px; border-bottom: 1px solid var(--line); position: relative; }
  .dr-kick { font: 700 11px/1 var(--mono); letter-spacing: .16em; color: var(--text-3); }
  h3 { margin: 7px 0 0; font: 700 16px/1.3 var(--sans); padding-right: 30px; overflow-wrap: anywhere; }
  /* Focus lands on the title when the drawer opens; it is not a control, so no ring. */
  h3:focus, h3:focus-visible { outline: none; }
  .st.verified { color: var(--gold); } .st.claimed { color: var(--holo); } .st.unverified { color: var(--danger-text); } .st.superseded { color: var(--text-3); }
  .dr-x { position: absolute; right: 14px; top: 12px; width: 28px; height: 28px; border-radius: var(--r); border: 1px solid var(--line); background: var(--space-2); color: var(--text-2); font: 16px/1 var(--sans); cursor: pointer; }
  .dr-hero { display: flex; gap: 12px; align-items: center; margin: 16px 18px 4px; padding: 12px; border-radius: var(--r-lg); background: linear-gradient(135deg, color-mix(in srgb, var(--gold) 16%, transparent), var(--gold-a1)); border: 1px solid color-mix(in srgb, var(--gold) 40%, transparent); }
  .dr-hero :global(svg) { filter: drop-shadow(0 0 10px color-mix(in srgb, var(--gold) 60%, transparent)); }
  .dr-hero b { display: block; font: 800 14px/1 var(--mono); letter-spacing: .14em; color: var(--gold); }
  .dr-hero span { display: block; margin-top: 5px; font: 13px/1.35 var(--sans); color: var(--needs-text-2); }
  .dr-hero.claimed { background: var(--holo-a1); border-color: var(--holo-a2); }
  .dr-hero.claimed b { color: var(--holo); }
  .dr-hero.claimed :global(svg), .dr-hero.unverified :global(svg), .dr-hero.superseded :global(svg) { filter: grayscale(1) opacity(.6); }
  .dr-hero.unverified { background: var(--danger-a); border-color: var(--danger); }
  .dr-hero.unverified b { color: var(--danger-text); }
  .dr-hero.superseded { background: var(--space-2); border-color: var(--line-strong); }
  .dr-hero.superseded b { color: var(--text-3); }
  .dr-hero.claimed span, .dr-hero.unverified span, .dr-hero.superseded span { color: var(--text-2); }
  .dr-sec { margin: 16px 18px 0; }
  h4 { margin: 0 0 8px; font: 700 11px/1 var(--mono); letter-spacing: .14em; color: var(--text-3); }
  .fact { margin: 0 0 8px; display: grid; grid-template-columns: 92px 1fr; border: 1px solid var(--line); border-radius: var(--r-inset); overflow: hidden; background: color-mix(in srgb, var(--space-0) 55%, transparent); }
  .fact dt, .fact dd { margin: 0; padding: 8px 10px; border-bottom: 1px solid var(--line); font: 12px/1.3 var(--mono); }
  .fact dt { color: var(--text-3); background: color-mix(in srgb, var(--space-3) 40%, transparent); }
  .fact dd { color: var(--text); overflow-wrap: anywhere; min-width: 0; }
  .fact dt:last-of-type, .fact dd:last-of-type { border-bottom: 0; }
  .fact code { color: var(--holo-text-3); }
  .fact .prose { font: 13px/1.4 var(--sans); }
  .fact .gold { color: var(--gold); font-weight: 700; }
  .said { display: inline-block; padding: 2px 6px; border-radius: var(--r-md); border: 1px solid var(--line-strong); background: var(--space-0); }
  .ok { display: inline-block; padding: 1px 6px; border-radius: var(--r-sm); background: color-mix(in srgb, var(--gold) 18%, transparent); color: var(--gold); font-weight: 800; }
  .ok.bad { background: var(--space-3); color: var(--text); }
  .ev { display: grid; gap: 6px; }
  .evrow { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
  .chain { display: grid; grid-template-columns: auto 1fr; gap: 0 10px; font: 13px/1.35 var(--sans); color: var(--text-2); }
  .node { width: 12px; display: flex; flex-direction: column; align-items: center; }
  .node i { width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; }
  .node.c i { background: var(--holo); box-shadow: 0 0 8px var(--holo); }
  .node.g i { background: var(--gold); box-shadow: 0 0 8px var(--gold); }
  .node.c::after { content: ""; flex: 1; width: 1px; margin: 3px 0 -4px; background: linear-gradient(var(--holo), var(--gold)); }
  .node.c.end::after { display: none; }
  .chain p { margin: 0 0 12px; }
  .chain p b { font: 700 11px/1 var(--mono); letter-spacing: .1em; }
  .chain b.c { color: var(--holo); } .chain b.g { color: var(--gold); }
  .chain small { display: block; font: 12px/1.3 var(--mono); color: var(--text-3); margin-top: 3px; }
  .dr-line { margin: 4px 0 0; padding: 9px 10px; border-radius: var(--r); background: var(--space-1); border: 1px solid var(--line); font: 12px/1.4 var(--mono); color: var(--text); }
  .dr-line .c { color: var(--holo); } .dr-line .g { color: var(--gold); }
  .dr-note { margin: 16px 18px 0; padding: 10px 12px; border-left: 2px solid var(--gold); background: color-mix(in srgb, var(--gold) 6%, transparent); font: 13px/1.45 var(--sans); color: var(--text-2); }
  .dr-note b { color: var(--text); }
  .path { display: flex; align-items: center; gap: 6px; }
  .path code { flex: 1; min-width: 0; user-select: all; }
  .copy { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: var(--r-md); border: 1px solid var(--gold-a3); background: var(--gold-a2); cursor: pointer; padding: 0; }
  .copy:hover { background: color-mix(in srgb, var(--gold) 28%, transparent); }
  .pinned { padding: 0; border: 0; background: none; font: 700 12px/1.3 var(--mono); color: var(--gold); text-align: left; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
  .dim { color: var(--text-3); }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .body {
    display: block; box-sizing: border-box; width: 100%; height: 52vh; margin: 0; overflow: auto; resize: vertical; padding: 10px; border: 1px solid var(--line); border-radius: var(--r-inset); background: var(--space-0);
    font: 12px/1.45 var(--mono); color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .trunc { margin: 6px 0 0; font: 12px/1.3 var(--mono); color: var(--text-3); }
  .dr-card { margin: 16px 18px 0; font: 12px/1.5 var(--mono); color: var(--text-3); overflow-wrap: anywhere; }
  .dr-card b { color: var(--text-2); font-weight: 600; }
</style>
