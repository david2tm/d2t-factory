<script lang="ts">
  // The Action slot: `> RESPOND IN TERMINAL` and each command verbatim with a Copy button, its `then`
  // line below it (6-2), and the card's reply line, then (8-2) the clear line when the card carries
  // clear_safe (its backticked `/clear` as inline code). A card recorded before 6-2 has no options:
  // its commands are listed with no then lines. Copy is the board's only write, and it writes to the
  // clipboard. On failure the command text is selected and announced.
  import { copyText } from '../lib/copy.ts';
  import { actionRows } from '../lib/model.ts';
  import type { Card } from '../lib/types.ts';
  import Glyph from './Glyph.svelte';

  let { card }: { card: Pick<Card, 'commands' | 'options' | 'reply' | 'clear_safe'> } = $props();
  const slot = $derived(actionRows(card));
  const rows = $derived(slot.rows);
  const reply = $derived(slot.reply);
  const clear = $derived(slot.clear);
  let copied = $state(-1);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fields: HTMLElement[] = $state([]);

  async function copy(i: number): Promise<void> {
    if (!(await copyText(rows[i].command, fields[i], 'Copy failed — command selected'))) return;
    copied = i;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { copied = -1; }, 1500);
  }
</script>

<div class="action">
  <div class="al">RESPOND IN TERMINAL</div>
  {#each rows as row, i (i)}
    <div class="row">
      <div class="cmd">
        <code bind:this={fields[i]}>{row.command}</code>
        <button type="button" class="copy" aria-label="Copy command" title="Copy command" onclick={() => copy(i)}>
          <Glyph name={copied === i ? 'check' : 'copy'} scale={2} />
        </button>
      </div>
      {#if row.then}<p class="then">{row.then}</p>{/if}
    </div>
  {/each}
  {#if reply}<p class="reply">{reply}</p>{/if}
  {#if clear}<p class="reply clear">{#each clear.split('`') as part, i (i)}{#if i % 2}<code>{part}</code>{:else}{part}{/if}{/each}</p>{/if}
</div>

<style>
  .action { position: relative; border: 1px dashed var(--gold-a3); border-radius: var(--r-inset); padding: 8px 9px; background: color-mix(in srgb, var(--space-0) 55%, transparent); display: grid; gap: 6px; }
  .al { font: 700 11px/1 var(--mono); letter-spacing: .1em; color: var(--gold); display: flex; align-items: center; gap: 6px; }
  .al::before { content: ">"; }
  .row { display: grid; gap: 4px; }
  .cmd { display: flex; align-items: center; gap: 6px; }
  .then { margin: 0; font: 13px/1.4 var(--sans); color: var(--needs-text-3); overflow-wrap: anywhere; }
  .reply { margin: 2px 0 0; font: 13px/1.4 var(--sans); color: var(--text-3); overflow-wrap: anywhere; }
  code {
    flex: 1; min-width: 0; font: 600 13px/1.35 var(--mono); color: var(--text); background: var(--space-0);
    border: 1px solid var(--line-strong); border-radius: var(--r-md); padding: 6px 8px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: all;
  }
  code::before { content: "$ "; color: var(--text-3); user-select: none; }
  /* 8-2: the backticked `/clear` in the clear line, inline */
  .clear code { display: inline; flex: none; font: 600 12px/1.4 var(--mono); padding: 0 4px; border-radius: var(--r-md); white-space: nowrap; user-select: text; }
  .clear code::before { content: none; }
  .copy { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: var(--r-md); border: 1px solid var(--gold-a3); background: var(--gold-a2); cursor: pointer; padding: 0; }
  .copy:hover { background: color-mix(in srgb, var(--gold) 28%, transparent); }
</style>
