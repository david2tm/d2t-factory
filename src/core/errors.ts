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
  'SANDBOX_DENIED',
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

// AD-35 (8-1): a git or filesystem EPERM/EACCES in the CLI. The message names the path (or the
// command, or `sandbox.network.allowLocalBinding` for the bind probe) and ends with SANDBOX_TAIL.
export const SANDBOX_TAIL = 'the sandbox refused this; it is a factory defect, report it (AD-35)';
export const sandboxDenied = (what: string): FactoryError => new FactoryError('SANDBOX_DENIED', `${what}: ${SANDBOX_TAIL}`);

// An fs or net error the OS refused (EPERM/EACCES): what the sandbox's refusals look like.
export const isDenied = (e: unknown): e is NodeJS.ErrnoException => {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EACCES';
};

// What an errno error was refused on: `<syscall> <path>` (or `<address>:<port>` for a socket).
export function deniedWhat(e: NodeJS.ErrnoException): string {
  const x = e as NodeJS.ErrnoException & { address?: string; port?: number };
  const target = e.path ?? (x.address !== undefined ? `${x.address}:${x.port ?? ''}` : undefined);
  return `${e.syscall ?? 'access'}${target ? ` ${target}` : ''} (${e.code})`;
}
