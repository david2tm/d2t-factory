// The polite aria-live announcer. Messages within 1 s coalesce into one announcement; `urgent`
// ones (Copy feedback) go out at once.
import { writable } from 'svelte/store';

export const COALESCE_MS = 1000;
export const message = writable('');

let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function say(text: string): void {
  // Clear first so a repeated message is announced again.
  message.set('');
  setTimeout(() => message.set(text), 30);
}

export function announce(text: string, o: { urgent?: boolean } = {}): void {
  if (o.urgent) { say(text); return; }
  queue.push(text);
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    const all = queue;
    queue = [];
    say(all.join('. '));
  }, COALESCE_MS);
}
