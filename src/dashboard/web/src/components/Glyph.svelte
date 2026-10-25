<script lang="ts">
  // A 9×9 pixel glyph at a whole-number scale. Always decorative.
  import { GLYPHS, runs, type GlyphName } from '../lib/sprites.ts';

  let { name, scale = 2, cls = '' }: { name: GlyphName; scale?: number; cls?: string } = $props();
  const rows = $derived(GLYPHS[name] ?? GLYPHS.emblem);
  const px = $derived(runs(rows));
</script>

<svg class="glyph {cls}" width={9 * scale} height={9 * scale} viewBox="0 0 9 9" aria-hidden="true" focusable="false">
  {#each px as r}<rect class="px-{r.key}" x={r.x} y={r.y} width={r.w} height="1" />{/each}
</svg>
