import "server-only";

const providerErrorCodes = [
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_SCOPE_MISSING",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "INVALID_PROVIDER_RESPONSE",
  "RESOURCE_NOT_FOUND",
  "UNKNOWN_PROVIDER_ERROR",
] as const;

export type IntegrationErrorCode =
  | (typeof providerErrorCodes)[number]
  | "AUTHORIZATION_ERROR"
  | "TENANT_SCOPE_ERROR"
  | "VALIDATION_ERROR"
  | "FEATURE_NOT_AVAILABLE"
  | "CONFLICT"
  | "NOT_FOUND";

export class IntegrationError extends Error {
  readonly name = "IntegrationError";

  constructor(
    public readonly code: IntegrationErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly metadata: Readonly<Record<string, string | number | boolean>> = {},
    public readonly internalCause?: unknown,
  ) {
    super(message);
  }

  toJSON(): {
    code: IntegrationErrorCode;
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

const credentialShapedKey = /(token|secret|authorization|credential)/i;

export function normalizeProviderError(input: {
  code?: string;
  message?: string;
  retryable?: boolean;
  metadata?: Record<string, string | number | boolean>;
  cause?: unknown;
}): IntegrationError {
  const code = providerErrorCodes.includes(input.code as (typeof providerErrorCodes)[number])
    ? (input.code as (typeof providerErrorCodes)[number])
    : "UNKNOWN_PROVIDER_ERROR";
  const metadata = Object.fromEntries(
    Object.entries(input.metadata ?? {}).filter(([key]) => !credentialShapedKey.test(key)),
  );
  const retryable = input.retryable ?? (code === "RATE_LIMITED" || code === "PROVIDER_UNAVAILABLE");
  const message = input.message?.trim() || "The provider could not complete this request.";

  return new IntegrationError(code, message, retryable, metadata, input.cause);
}
