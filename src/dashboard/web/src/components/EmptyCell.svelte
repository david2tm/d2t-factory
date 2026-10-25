<script lang="ts">
  // An Empty cell: why it is empty and what fills it, over three ghost datapads.
  import type { Snippet } from 'svelte';

  let { title, body, children }: { title: string; body: string; children?: Snippet } = $props();
</script>

<div class="empty">
  <div class="ghosts" aria-hidden="true"><i></i><i></i><i></i></div>
  <b>{title}</b>
  <span>{body}</span>
  {#if children}<div class="extra">{@render children()}</div>{/if}
</div>

<style>
  .empty { border: 1px dashed var(--holo-a2); border-radius: var(--r-lg); padding: 14px 10px; text-align: center; background: color-mix(in srgb, var(--space-2) 40%, transparent); }
  .ghosts { display: flex; justify-content: center; gap: 4px; margin-bottom: 9px; }
  .ghosts i { width: 26px; height: 34px; border-radius: var(--r-sm); border: 1px solid color-mix(in srgb, var(--holo) 28%, transparent); background: repeating-linear-gradient(0deg, color-mix(in srgb, var(--holo) 7%, transparent) 0 1px, transparent 1px 3px); }
  .ghosts i:nth-child(2) { transform: translateY(-3px); }
  b { display: block; font: 700 12px/1.2 var(--mono); letter-spacing: .08em; color: var(--holo-text-2); }
  span { display: block; margin-top: 4px; font: 13px/1.35 var(--sans); color: var(--text-3); }
  .extra { margin-top: 12px; text-align: left; }
</style>
