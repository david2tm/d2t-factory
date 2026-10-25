// Reduce motion (EXPERIENCE Motion rule 6): the top bar toggle, remembered per browser, or the OS
// `prefers-reduced-motion`, which forces it on. While on, <html data-motion="reduce"> stops every
// non-essential animation. Event animations (≤ 600 ms) coalesce per card within 250 ms.
import { derived, readable, writable, type Readable } from 'svelte/store';

const KEY = 'd2t-factory.reduce-motion';
export const COALESCE_MS = 250;
export const EVENT_MS = 600;

function stored(): boolean {
  try { return globalThis.localStorage?.getItem(KEY) === '1'; } catch { return false; }
}

export const reduceToggle = writable<boolean>(stored());
reduceToggle.subscribe((on) => {
  try { globalThis.localStorage?.setItem(KEY, on ? '1' : '0'); } catch { /* private mode: not remembered */ }
});

export const osReduce: Readable<boolean> = readable(false, (set) => {
  const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (!mq) return;
  set(mq.matches);
  const on = (e: MediaQueryListEvent): void => set(e.matches);
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
});

export const reduceMotion: Readable<boolean> = derived([reduceToggle, osReduce], ([t, os]) => t || os);

let reduced = false;
reduceMotion.subscribe((r) => {
  reduced = r;
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = r ? 'reduce' : 'full';
});
export const isReduced = (): boolean => reduced;

// Svelte action: replays the CSS class `cls` (an event animation, ≤ EVENT_MS) whenever `key`
// changes. Changes within COALESCE_MS of the last start animate once, to the final state; the
// state itself is already rendered.
export function eventAnim(node: HTMLElement, p: { key: string; cls: string }) {
  let key = p.key;
  let lastStart = 0;
  let clear: ReturnType<typeof setTimeout> | null = null;
  return {
    update(n: { key: string; cls: string }) {
      if (n.key === key) return;
      key = n.key;
      if (reduced) return;
      const t = Date.now();
      if (t - lastStart < COALESCE_MS) return;
      lastStart = t;
      node.classList.remove(n.cls);
      void node.offsetWidth; // restart the animation
      node.classList.add(n.cls);
      if (clear) clearTimeout(clear);
      clear = setTimeout(() => node.classList.remove(n.cls), EVENT_MS);
    },
    destroy() { if (clear) clearTimeout(clear); },
  };
}
