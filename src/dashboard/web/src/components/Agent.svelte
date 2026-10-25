<script lang="ts">
  // An agent standing at a card: sprite on a holo-pad, display name and role label (real text).
  import { displayName, roleColor } from '../lib/model.ts';
  import { spriteFor } from '../lib/sprites.ts';
  import Sprite from './Sprite.svelte';

  let { role, lost = false, delay = 0, note = '' }: { role: string; lost?: boolean; delay?: number; note?: string } = $props();
</script>

<div class="agent">
  <span class="pad" aria-hidden="true"></span>
  <Sprite name={spriteFor(role)} scale={3} {lost} {delay} />
  <span class="nm">{displayName(role)}</span>
  <span class="rl" class:sec={role === 'reviewer-security'}><i style="background:{roleColor(role)}"></i>{role}{note ? ` · ${note}` : ''}</span>
</div>

<style>
  .agent { display: flex; flex-direction: column; align-items: center; position: relative; z-index: 3; }
  .pad { position: absolute; top: 40px; left: 50%; width: 54px; height: 12px; margin-left: -27px; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--holo) 55%, transparent), color-mix(in srgb, var(--holo) 12%, transparent) 60%, transparent); z-index: -1; }
  .nm { margin-top: 3px; font: 600 12px/1.15 var(--sans); color: var(--text); white-space: nowrap; text-shadow: 0 1px 2px black; }
  .rl { font: 11px/1.25 var(--mono); color: var(--holo); white-space: nowrap; }
  .rl.sec { color: var(--role-reviewer-security-text); }
  .rl i { display: inline-block; width: 6px; height: 6px; margin-right: 4px; vertical-align: 1px; }
</style>
