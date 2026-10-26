<script lang="ts">
  // A file row (6-3): an artifact's name as a button that opens the Evidence drawer (Artifact). On a
  // Gate card, in a Decision drawer's evidence rows. `from` keeps each source's data-src unique.
  import { openDrawer, selection, srcId } from '../lib/drawer.ts';
  import { artifactCard } from '../lib/model.ts';
  import { STAGE_GLYPH } from '../lib/sprites.ts';
  import type { ArtifactView } from '../lib/types.ts';
  import Glyph from './Glyph.svelte';

  let { lane, artifact, from, tone = 'needs' }: { lane: string; artifact: ArtifactView; from: string; tone?: 'needs' | 'drawer' } = $props();
  const src = $derived(srcId(lane, from, artifact.id));
  const selected = $derived($selection?.kind === 'artifact' && $selection.src === src);
  const label = $derived(`${artifact.name}${artifact.superseded ? ' (superseded)' : ''}. Open artifact`);
</script>

<button type="button" class="file {tone}" class:selected class:superseded={artifact.superseded} data-src={src} aria-label={label} title={artifact.path}
  onclick={() => openDrawer({ kind: 'artifact', lane, card: artifactCard(artifact), artifact: artifact.id, src })}>
  <Glyph name={STAGE_GLYPH[artifact.stage.replace('_', ' ')] ?? 'emblem'} scale={1} />
  <span>{artifact.name}</span>
</button>

<style>
  .file {
    display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 2px 8px; border-radius: var(--r-md); cursor: pointer;
    font: 600 12px/1.2 var(--mono); text-align: left; text-decoration: underline; text-underline-offset: 3px;
  }
  .file.needs { color: var(--needs-text); background: color-mix(in srgb, black 30%, transparent); border: 1px solid var(--gold-a3); }
  .file.needs:hover { background: var(--gold-a2); }
  .file.drawer { color: var(--holo-text-3); background: var(--space-1); border: 1px solid var(--line); }
  .file.drawer:hover { background: var(--space-3); }
  .superseded { opacity: .6; }
  .selected { outline: 2px solid var(--gold); outline-offset: 2px; }
</style>
