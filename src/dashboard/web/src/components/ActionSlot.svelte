<script lang="ts">
  // The Action slot: `> RESPOND IN TERMINAL` and each command verbatim with a Copy button. Copy is
  // the board's only write, and it writes to the clipboard. On failure the command text is
  // selected and announced.
  import { announce } from '../lib/announce.ts';
  import Glyph from './Glyph.svelte';

  let { commands }: { commands: string[] } = $props();
  let copied = $state(-1);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fields: HTMLElement[] = $state([]);

  async function copy(i: number): Promise<void> {
    const text = commands[i];
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      copied = i;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { copied = -1; }, 1500);
      announce('Copied', { urgent: true });
    } catch {
      const sel = window.getSelection();
      const el = fields[i];
      if (sel && el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      announce('Copy failed — command selected', { urgent: true });
    }
  }
</script>

<div class="action">
  <div class="al">RESPOND IN TERMINAL</div>
  {#each commands as cmd, i (i)}
    <div class="cmd">
      <code bind:this={fields[i]}>{cmd}</code>
      <button type="button" class="copy" aria-label="Copy command" title="Copy command" onclick={() => copy(i)}>
        <Glyph name={copied === i ? 'check' : 'copy'} scale={2} />
      </button>
    </div>
  {/each}
</div>

<style>
  .action { position: relative; border: 1px dashed var(--gold-a3); border-radius: var(--r-inset); padding: 8px 9px; background: color-mix(in srgb, var(--space-0) 55%, transparent); display: grid; gap: 6px; }
  .al { font: 700 11px/1 var(--mono); letter-spacing: .1em; color: var(--gold); display: flex; align-items: center; gap: 6px; }
  .al::before { content: ">"; }
  .cmd { display: flex; align-items: center; gap: 6px; }
  code {
    flex: 1; min-width: 0; font: 600 13px/1.35 var(--mono); color: var(--text); background: var(--space-0);
    border: 1px solid var(--line-strong); border-radius: var(--r-md); padding: 6px 8px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: all;
  }
  code::before { content: "$ "; color: var(--text-3); user-select: none; }
  .copy { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: var(--r-md); border: 1px solid var(--gold-a3); background: var(--gold-a2); cursor: pointer; padding: 0; }
  .copy:hover { background: color-mix(in srgb, var(--gold) 28%, transparent); }
</style>
