import { DomainError } from "@/lib/errors";

/**
 * Agent chat domain errors (spec section 7).
 *
 * Lives in the domain layer so application code can dispose without
 * importing the infrastructure adapter (lint-enforced ports rule).
 */

/** Same-key-different-body on either keyed RPC. Maps to HTTP 409. */
export class IdempotencyConflictError extends DomainError {
  constructor(message: string) {
    super("DOMAIN_ERROR", message);
    this.name = "IdempotencyConflictError";
  }
}
