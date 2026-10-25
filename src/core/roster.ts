// The reviewer roster (AD-27): derived here alone, from a slice's tags, the intake and whether a UI
// reference exists. The slicer only tags. Pure: no I/O.
import type { Intake } from './events.ts';

// The tags a slicer may put on a slice.
export const SLICE_TAGS = ['ui', 'input', 'auth', 'secrets', 'external'] as const;
export type SliceTag = (typeof SLICE_TAGS)[number];

// Reviewers that judge the slice's diff, and those that judge the running app (AD-20, AD-22).
export const DIFF_REVIEWERS = ['reviewer-code', 'reviewer-security'] as const;
export const APP_REVIEWERS = ['reviewer-ux', 'reviewer-a11y', 'reviewer-ui'] as const;
// Roster order: every roster, card row and merge pin lists reviewers in this order.
export const REVIEWERS: readonly string[] = [...DIFF_REVIEWERS, ...APP_REVIEWERS];

export const isAppReviewer = (role: string | undefined): boolean => (APP_REVIEWERS as readonly (string | undefined)[]).includes(role);
export const isDiffReviewer = (role: string | undefined): boolean => (DIFF_REVIEWERS as readonly (string | undefined)[]).includes(role);

// A running-app reviewer's own Playwright MCP server (`.mcp.json`), and the tools its agent may
// call: the server's tools (spike 08) minus browser_run_code_unsafe and browser_file_upload, which run
// code or read files in the unsandboxed server process.
export const playwrightServer = (role: string): string => `playwright-${role.replace(/^reviewer-/, '')}`;
export const BROWSER_TOOLS = [
  'browser_click', 'browser_close', 'browser_console_messages', 'browser_drag', 'browser_drop', 'browser_emulate_media', 'browser_evaluate', 'browser_fill_form',
  'browser_find', 'browser_handle_dialog', 'browser_hover', 'browser_navigate', 'browser_navigate_back', 'browser_network_request', 'browser_network_requests',
  'browser_press_key', 'browser_resize', 'browser_select_option', 'browser_snapshot', 'browser_tabs', 'browser_take_screenshot', 'browser_type', 'browser_wait_for',
] as const;
export const appReviewerTools = (role: string): string[] => BROWSER_TOOLS.map((t) => `mcp__plugin_d2t-factory_${playwrightServer(role)}__${t}`);

const SECURITY_TAGS: readonly string[] = ['input', 'auth', 'secrets', 'external'];

export interface RosterOpts {
  intake?: Pick<Intake, 'ui_free' | 'reviewer_overrides'>; // absent before 3-1: no UI-free, no overrides
  hasReference: boolean; // the current design, or RECON's ui_reference
}

// In this order: reviewer-code always; reviewer-security on input|auth|secrets|external; reviewer-ux
// and reviewer-a11y on ui; reviewer-ui on ui only with a reference (without one its checks fold into
// reviewer-ux). A UI-free intake drops the tag-derived UI reviewers. The intake overrides apply
// last: remove drops a role, add adds it, except that reviewer-ui with no reference adds reviewer-ux.
export function rosterOf(tags: readonly string[], o: RosterOpts): string[] {
  const on = new Set<string>(['reviewer-code']);
  if (tags.some((t) => SECURITY_TAGS.includes(t))) on.add('reviewer-security');
  if (tags.includes('ui') && o.intake?.ui_free !== true) {
    on.add('reviewer-ux');
    on.add('reviewer-a11y');
    if (o.hasReference) on.add('reviewer-ui');
  }
  const ov = o.intake?.reviewer_overrides;
  for (const r of ov?.remove ?? []) if (r !== 'reviewer-code') on.delete(r);
  for (const r of ov?.add ?? []) {
    if (!REVIEWERS.includes(r)) continue;
    on.add(r === 'reviewer-ui' && !o.hasReference ? 'reviewer-ux' : r);
  }
  return REVIEWERS.filter((r) => on.has(r));
}

// A slice's roster as recorded at gate 2. A slice from before 3-3 carries none: reviewer-code only.
export const sliceRoster = (sl: { roster?: readonly string[] } | undefined): string[] => (sl?.roster?.length ? [...sl.roster] : ['reviewer-code']);
