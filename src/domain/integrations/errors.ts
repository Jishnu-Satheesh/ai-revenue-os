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

const safeOperatorCopy: Record<(typeof providerErrorCodes)[number], string> = {
  AUTHENTICATION_FAILED: "Authentication with the provider failed. Reconnect to continue.",
  AUTHORIZATION_SCOPE_MISSING:
    "The provider connection is missing required access. Update permissions and retry.",
  RATE_LIMITED: "The provider rate limit was reached. Retry later.",
  PROVIDER_UNAVAILABLE: "The provider is temporarily unavailable. Retry later.",
  INVALID_PROVIDER_RESPONSE: "The provider returned an invalid response. Try again later.",
  RESOURCE_NOT_FOUND: "The requested provider resource was not found.",
  UNKNOWN_PROVIDER_ERROR: "The provider request failed. Try again later.",
};

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
  const internalCause = { providerMessage: input.message, cause: input.cause };

  return new IntegrationError(code, safeOperatorCopy[code], retryable, metadata, internalCause);
}
