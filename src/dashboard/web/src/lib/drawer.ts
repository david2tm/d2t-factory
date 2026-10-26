// The Evidence drawer's selection: which claim, decision or artifact (6-3) it shows, and the control
// that opened it. One at a time; opening another swaps the content. Closing returns focus to the
// source. An artifact's card is the stage card it belongs to (evidence-selected while it is open).
import { get, writable } from 'svelte/store';

interface Base { lane: string; card: string; src: string }
export type Selection =
  | (Base & { kind: 'claim'; step: string })
  | (Base & { kind: 'decision'; decision: string; deck: boolean })
  | (Base & { kind: 'artifact'; artifact: string });

export const selection = writable<Selection | null>(null);

// The `data-src` of a control that opens the drawer: stable across live re-renders.
export const srcId = (lane: string, card: string, id: string, deck = false): string => `${lane}|${card}|${id}${deck ? '|deck' : ''}`;

export function openDrawer(sel: Selection): void {
  selection.set(sel);
}

export function closeDrawer(): void {
  const s = get(selection);
  selection.set(null);
  if (!s || typeof document === 'undefined') return;
  const el = [...document.querySelectorAll<HTMLElement>('[data-src]')].find((e) => e.dataset.src === s.src);
  el?.focus();
}
