import "server-only";

/**
 * Server-only. Never import this module from a Client Component; use
 * `@/domain/memory/permissions` for anything the browser needs.
 */
export type MemoryErrorCode =
  | "AUTHORIZATION_ERROR"
  | "TENANT_SCOPE_ERROR"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "MEMORY_SENSITIVITY_DENIED"
  | "MEMORY_VERIFICATION_FORBIDDEN"
  | "MEMORY_EVIDENCE_REQUIRED"
  | "MEMORY_SUPERSESSION_INVALID"
  | "MEMORY_PROPOSAL_INVALID";

export class MemoryError extends Error {
  readonly name = "MemoryError";

  constructor(
    public readonly code: MemoryErrorCode,
    message: string,
    public readonly retryable: boolean = false,
    public readonly metadata: Readonly<Record<string, string | number | boolean>> = {},
    /** Excluded from `toJSON` so it can never reach a client response. */
    public readonly internalCause?: unknown,
  ) {
    super(message);
  }

  toJSON(): {
    code: MemoryErrorCode;
    message: string;
    retryable: boolean;
    metadata: Readonly<Record<string, string | number | boolean>>;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      metadata: this.metadata,
    };
  }
}

/**
 * Operator-facing copy is owned here so a route never invents its own wording
 * for a denial. None of these sentences reveal whether the withheld memory
 * exists.
 */
export const safeMemoryErrorCopy: Readonly<Record<MemoryErrorCode, string>> = {
  AUTHORIZATION_ERROR: "You do not have permission to perform this action.",
  TENANT_SCOPE_ERROR: "That item does not belong to this organization.",
  VALIDATION_ERROR: "Please check the submitted fields.",
  NOT_FOUND: "That memory item was not found.",
  CONFLICT: "This item changed while you were working on it. Reload and try again.",
  MEMORY_SENSITIVITY_DENIED:
    "This request asks for memory above the sensitivity allowed for its purpose.",
  MEMORY_VERIFICATION_FORBIDDEN:
    "Proposed memory must be confirmed by a person before it can be marked verified.",
  MEMORY_EVIDENCE_REQUIRED: "A proposal must link to the evidence it was derived from.",
  MEMORY_SUPERSESSION_INVALID: "That supersession would create a cycle or exceed the chain limit.",
  MEMORY_PROPOSAL_INVALID: "That fact proposal is missing a key or a value.",
};

export function memoryError(
  code: MemoryErrorCode,
  metadata?: Readonly<Record<string, string | number | boolean>>,
  internalCause?: unknown,
): MemoryError {
  return new MemoryError(code, safeMemoryErrorCopy[code], false, metadata ?? {}, internalCause);
}
