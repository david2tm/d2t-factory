// CLI error codes (Consistency Conventions: CLI I/O).

export const ERROR_CODES = [
  'ILLEGAL_TRANSITION',
  'MISSING_EVIDENCE',
  'NO_HUMAN_PROMPT',
  'LOCKED',
  'NOT_HOLDER',
  'CLAIM_TAKEN',
  'CHECK_FAILED',
  'BAD_ARGS',
  'NOT_FOUND',
  'SETUP_REQUIRED',
  'SETUP_FAILED',
  'NODE_VERSION',
  'REFUSED_EXCLUSIVE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class FactoryError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'FactoryError';
    this.code = code;
  }
}
