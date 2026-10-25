// Tunable constants (AD-21). The only place thresholds are defined.

export const HEARTBEAT_INTERVAL_MS = 60_000;
export const SIGNAL_LOST_MISSED = 3;
export const CLAIM_OVERDUE_MS = 30_000;
export const CUT_LEAD_MS = 40 * 60_000;
export const SLICE_TIMEBOX_DEFAULT_MS = 30 * 60_000;
export const MAX_RETRIGGER_ROUNDS = 2;
// 3-4: a step reissued up to this attempt; the next parse failure or orphan raises Non-convergence.
export const MAX_STEP_ATTEMPTS = 3;
export const PORT_RANGE = { min: 5100, max: 5199 } as const;
export const LOCK_WAIT_MS = 10_000;
export const SPEC_MAX_LINES = 40;
// `factory check`: the longest a test check may run, and how long health is polled before it fails.
export const CHECK_TIMEOUT_MS = 10 * 60_000;
export const HEALTH_TIMEOUT_MS = 60_000;
export const HEALTH_POLL_MS = 500;

// Not in the AD-21 table but shared by several writers.
export const MAX_LINE_BYTES = 32 * 1024; // AD-28
export const DASHBOARD_PORT_DEFAULT = 4870;
// The dashboard server's rescan of ~/.factory, behind its fs.watch (AD-16).
export const DASHBOARD_POLL_MS = 2000;
// `next`: the longest `wait.retry_after_ms` (with no deadline ahead, AD-17), and the unlocked poll
// interval of `next --wait`.
export const WAIT_MAX_MS = 10 * 60_000;
export const WAIT_POLL_MS = 100;
// Stack floor. src/cli/bootstrap.mjs repeats it because it must run before type stripping is known to work.
export const NODE_FLOOR = '22.18.0';
