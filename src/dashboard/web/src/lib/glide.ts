// Card motion between cells (EXPERIENCE Motion): a card glides from its old cell to its new one,
// and streaks into Done. ≤ 600 ms, decorative only (the card is already in its new cell), and
// instant under reduced motion, and skipped at 16× replay (4-1: travel jumps; the agents at a card
// travel with it). Svelte transitions are local, so a whole lane arriving (cold load, a new run)
// never animates.
import { cubicOut } from 'svelte/easing';
import { crossfade, type TransitionConfig } from 'svelte/transition';
import { isReduced } from './motion.ts';
import { isFast } from './playback.ts';

const skip = (): boolean => isReduced() || isFast();

const GLIDE_MS = 420;
const STREAK_MS = 480;

export const [send, receive] = crossfade({
  duration: () => (skip() ? 0 : GLIDE_MS),
  easing: cubicOut,
  fallback: () => ({ duration: 0 }),
});

// Done entry: a hyperspace streak in from the left, then settle.
export function streak(_node: Element): TransitionConfig {
  if (skip()) return { duration: 0 };
  return {
    duration: STREAK_MS,
    easing: cubicOut,
    css: (t) => `transform: translateX(${(1 - t) * -48}px) scaleX(${1 + (1 - t) * 0.25}); filter: blur(${(1 - t) * 3}px); opacity: ${Math.min(1, t * 1.6)}`,
  };
}
