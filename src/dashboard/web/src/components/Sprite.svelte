<script lang="ts">
  // A placeholder character: base pixels plus two effect frames that alternate (frame 1 only
  // under reduced motion), on a stepped idle bob. `look` holds Master d2t's look-up frame;
  // `lost` dissolves the sprite to rolling static. Always aria-hidden.
  import { SPRITES, runs, type SpriteName } from '../lib/sprites.ts';

  let { name, scale = 3, lost = false, look = false, delay = 0 }: { name: SpriteName; scale?: number; lost?: boolean; look?: boolean; delay?: number } = $props();
  const s = $derived(SPRITES[name] ?? SPRITES.vess);
  const base = $derived(runs(s.base));
  const a = $derived(s.a ? runs(s.a) : []);
  const b = $derived(s.b ? runs(s.b) : []);
</script>

<span class="sprite" class:lost aria-hidden="true">
  <svg class="spr spr-{name} bob" style="animation-delay:{-delay}s" width={s.w * scale} height={s.h * scale} viewBox="0 0 {s.w} {s.h}" focusable="false">
    {#each base as r}<rect class="px-{r.key}" x={r.x} y={r.y} width={r.w} height="1" />{/each}
    {#if a.length}<g class="fx fx-a">{#each a as r}<rect class="px-{r.key}" x={r.x} y={r.y} width={r.w} height="1" />{/each}</g>{/if}
    {#if b.length}<g class="fx fx-b" class:hold={look}>{#each b as r}<rect class="px-{r.key}" x={r.x} y={r.y} width={r.w} height="1" />{/each}</g>{/if}
  </svg>
</span>

<style>
  .sprite { position: relative; display: inline-block; line-height: 0; }
  .bob { animation: bob 1.3s infinite; }
  .spr-d2t.bob { animation: bob4 2.6s infinite; }
  .spr-vess.bob, .spr-kael.bob { animation-duration: 2.2s; }
  @keyframes bob { 0%, 49.9% { transform: translateY(0); } 50%, 100% { transform: translateY(-3px); } }
  @keyframes bob4 { 0%, 59.9% { transform: translateY(0); } 60%, 100% { transform: translateY(-4px); } }

  .fx-b { opacity: 0; }
  .fx-a { animation: fa .5s infinite; }
  .fx-b { animation: fb .5s infinite; }
  .spr-brix .fx { animation-duration: .22s; }
  .spr-sela .fx { animation-duration: 1.1s; }
  .spr-quill .fx { animation-duration: 1.6s; }
  .spr-vess .fx { animation-duration: 2s; }
  .spr-tarvus .fx { animation-duration: .7s; }
  .spr-kael .fx { animation-duration: 1.8s; }
  .spr-d2t .fx-b { animation: look 6s infinite; }
  .spr-pell .fx-b { animation: pblink 3.4s infinite; }
  /* 7-2. Halden's blueprint rolls and unrolls; Ione's tablet lines appear; Tamsin's lamp and Sorel's
     markers blink; Nyra's scanner cone sweeps in 3 frames (near, far, none); a check droid's status
     light blinks holo over its slate idle frame. Reduced motion stops all of them on frame 1. */
  .spr-halden .fx { animation-duration: 1.4s; }
  .spr-ione .fx { animation-duration: 1.2s; }
  .spr-tamsin .fx { animation-duration: .9s; }
  .spr-sorel .fx { animation-duration: 1s; }
  .spr-droid .fx { animation-duration: .8s; }
  .spr-nyra .fx-a { animation: cone1 1.2s infinite; }
  .spr-nyra .fx-b { animation: cone2 1.2s infinite; }
  /* Master d2t looks up while a card enters, and holds the pose (static) under reduced motion. */
  .fx-b.hold { opacity: 1 !important; animation: none !important; }
  @keyframes fa { 0%, 49.9% { opacity: 1; } 50%, 100% { opacity: 0; } }
  @keyframes fb { 0%, 49.9% { opacity: 0; } 50%, 100% { opacity: 1; } }
  @keyframes look { 0%, 72% { opacity: 0; } 73%, 92% { opacity: 1; } 93%, 100% { opacity: 0; } }
  @keyframes cone1 { 0%, 33.2% { opacity: 1; } 33.3%, 100% { opacity: 0; } }
  @keyframes cone2 { 0%, 33.2% { opacity: 0; } 33.3%, 66.5% { opacity: 1; } 66.6%, 100% { opacity: 0; } }
  @keyframes pblink { 0%, 90% { opacity: 0; } 91%, 96% { opacity: 1; } 97%, 100% { opacity: 0; } }

  .spr-brix { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--holo) 35%, transparent)); }
  .spr-sela { filter: drop-shadow(0 0 5px color-mix(in srgb, var(--role-designer) 40%, transparent)); }
  .spr-kael { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--role-reviewer-security) 45%, transparent)); }

  .lost svg { opacity: .35; filter: grayscale(1); }
  .lost::after {
    content: ""; position: absolute; inset: 0;
    background: repeating-linear-gradient(0deg, color-mix(in srgb, var(--sprite-white) 8%, transparent) 0 1px, transparent 1px 2px), linear-gradient(transparent 40%, var(--danger-a) 50%, transparent 60%);
    background-size: 100% 100%, 100% 200%;
    animation: roll 1.6s steps(8) infinite;
  }
  @keyframes roll { from { background-position: 0 0, 0 0; } to { background-position: 0 0, 0 -200%; } }
</style>
