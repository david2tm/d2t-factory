// Copy to the clipboard: the board's only write (a command, or an artifact path, 6-3). On success
// `Copied` is announced; on failure the text in `field` is selected and `failed` announced.
import { announce } from './announce.ts';

export async function copyText(text: string, field: HTMLElement | undefined, failed: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    announce('Copied', { urgent: true });
    return true;
  } catch {
    const sel = window.getSelection();
    if (sel && field) {
      const r = document.createRange();
      r.selectNodeContents(field);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    announce(failed, { urgent: true });
    return false;
  }
}
