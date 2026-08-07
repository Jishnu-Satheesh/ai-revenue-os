import { ZodError } from "zod";

export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "TENANT_SCOPE_ERROR"
  | "INTEGRATION_ERROR"
  | "WORKFLOW_ERROR"
  | "DOMAIN_ERROR"
  | "UNEXPECTED_ERROR";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function toPublicError(error: unknown): { code: DomainErrorCode; message: string } {
  if (error instanceof DomainError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof ZodError) {
    return { code: "VALIDATION_ERROR", message: "Please check the submitted fields." };
  }

  return { code: "UNEXPECTED_ERROR", message: "Something went wrong. Please try again." };
}
