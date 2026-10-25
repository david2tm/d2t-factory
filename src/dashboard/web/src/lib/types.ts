// Browser-side copy of the 2-1 read model (src/core/projection.ts, src/core/events.ts Card). A copy,
// not an import: src/dashboard/web talks to the server only over GET /api/board and the SSE stream.

export type Stage = 'INTAKE' | 'RECON' | 'FRAME' | 'SCAFFOLD' | 'SPEC' | 'DESIGN' | 'SLICE_PLAN' | 'BUILD' | 'WRAP';
export type Phase = 'INTAKE' | 'ORIENT' | 'SCAFFOLD' | 'SPEC_DESIGN' | 'SLICE_PLAN' | 'BUILD' | 'WRAP' | 'MERGED' | 'COMPLETED' | 'ABANDONED';
export type Column = 'backlog' | 'in_progress' | 'in_review' | 'needs_you' | 'done';
export type TrackStatus = 'pending' | 'active' | 'waiting' | 'done';

export interface CardOption { command: string; then: string }

export interface Card {
  type: string;
  title: string;
  reason_label?: string;
  reason?: string;
  details?: string[];
  options?: CardOption[]; // commands = options.map(command); absent on cards recorded before 6-2
  reply?: string;
  commands: string[];
  escalation?: string;
  sha?: string;
  target?: string | null;
}

export interface EvidenceRow { id: string; kind: string; ts: string | null; path?: string; check?: string; exit_code?: number }

export interface Claim {
  step_id: string;
  role: string;
  kind: string;
  state: 'claimed' | 'verified';
  reported_at: string;
  overdue_at: string;
  verdict?: string;
  superseded: boolean;
  evidence: EvidenceRow[];
}

export interface BoardCard {
  id: string;
  kind: 'stage' | 'slice';
  label: string;
  column: Column;
  state: string;
  rounds?: number;
  claims: Claim[];
  seals: string[]; // decision ids, into lane.decisions
  superseded: boolean;
  at_risk?: boolean; // a Backlog slice while the cut card is open
  tags?: string[]; // the slice's tags and reviewer roster (gate 2)
  roster?: string[];
  timebox_ends_at?: string; // a live slice's Time box (3-4): when its net time reaches timebox_min
  timebox_min?: number;
}

export interface NeedsYou { ask_id: string; raised_at: string | null; slice?: string; card: Card }

export interface Decision {
  id: string;
  kind: string;
  at: string;
  decided_by: string;
  prompt_text: string | null;
  reason?: string;
  stage: Stage;
  evidence: string[];
  superseded: boolean;
}

export interface Deadlines { signal_lost_at: string | null; overdue_at: string | null; cut_at: string | null; ends_at: string | null; timebox_ends_at: string | null }

// The Budget clock: absolute times; a terminal run's clock stops at stopped_at. Without a time limit
// only clock_start is set (the elapsed clock).
export interface BudgetView { clock_start: string; limit_min: number | null; cut_at: string | null; ends_at: string | null; stopped_at: string | null }

export interface Lane {
  run_id: string;
  repo_hash: string;
  task: string | null;
  origin: 'brownfield' | 'greenfield';
  phase: Phase;
  stage: Stage;
  holder: string | null;
  started_at: string | null;
  last_event_at: string | null;
  terminal: boolean;
  parked: boolean;
  skipped: number;
  deadlines: Deadlines;
  budget: BudgetView | null;
  stage_track: { stage: Stage; status: TrackStatus }[];
  gates: { n: 1 | 2; status: 'hollow' | 'waiting' | 'passed' }[];
  cards: BoardCard[];
  needs_you: NeedsYou[];
  decisions: Decision[];
  paused?: Paused; // 6-1: the conductor's turn ended through a recorded Stop exit, and nothing has happened since
  live?: { signal_lost: boolean };
}

export interface Paused { reason: 'human_rejected' | 'block_cap'; at: string; blocks?: number }

export interface Board { runs: Lane[] }

// GET /api/board, and the data of an SSE `event: board`.
export interface Snapshot { cursor: number; projection: Board }

// GET /api/recordings/<name> (4-1, a copy of src/core/timeline.ts Timeline): every event in replay
// order with its run's post-event lane (a frame, with last_event_at and signal_lost_at blanked).
export interface RecordingEvent { id: string; kind: string; at: string; run: number; decision: boolean; frame: number }
export interface RecordingRun { repo_hash: string; run_id: string; signal_lost_card: Card }
export interface Recording {
  name: string;
  recorded_at: string;
  start: string;
  end: string;
  signal_lost_ms: number;
  runs: RecordingRun[];
  events: RecordingEvent[];
  frames: Lane[];
}
