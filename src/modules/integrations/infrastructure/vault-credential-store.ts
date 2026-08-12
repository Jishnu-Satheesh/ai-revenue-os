import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  CreateCredentialInput,
  CredentialStore,
  ReplaceCredentialInput,
  ResolveCredentialInput,
  RevokeCredentialInput,
  SensitiveCredential,
} from "@/domain/integrations/credential-store.server";
import { IntegrationError } from "@/domain/integrations/errors";
import type { CredentialHandle } from "@/domain/integrations/types";
import type { Database } from "@/lib/supabase/database.types";

const uuidSchema = z.string().uuid();
const providerKeySchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const secretSchema = z.string().trim().min(1);
const referenceSchema = z.string().uuid();

/**
 * Database messages are never forwarded. A Vault or RPC failure can quote the
 * offending value, the vault name, or the credential reference, and any of
 * those in an operator-visible error is a leak. Callers get a stable code and
 * fixed copy; the original stays on `internalCause` for server-side logging
 * that already redacts credential-shaped fields.
 */
function fail(code: "VALIDATION_ERROR" | "NOT_FOUND" | "AUTHORIZATION_ERROR", cause?: unknown) {
  const copy = {
    VALIDATION_ERROR: "The credential request was not valid.",
    NOT_FOUND: "No credential is available for this organization and provider.",
    AUTHORIZATION_ERROR: "The credential operation was not permitted.",
  } as const;

  return new IntegrationError(code, copy[code], false, {}, cause);
}

function isMissing(message: string): boolean {
  return /not found|no rows|does not exist|missing/i.test(message);
}

function isDenied(message: string): boolean {
  return /permission denied|not authorized|insufficient/i.test(message);
}

function toIntegrationError(error: { message: string }): IntegrationError {
  if (isMissing(error.message)) return fail("NOT_FOUND", error);
  if (isDenied(error.message)) return fail("AUTHORIZATION_ERROR", error);
  return fail("VALIDATION_ERROR", error);
}

function sensitive(value: string): SensitiveCredential {
  const credential = {};

  // Everything is non-enumerable. A spread or `Object.keys` therefore yields an
  // empty object rather than the secret, while `JSON.stringify` still finds
  // `toJSON` by lookup and throws instead of quietly emitting the value.
  Object.defineProperties(credential, {
    value: { value, enumerable: false, writable: false, configurable: false },
    toJSON: {
      value: (): never => {
        throw new IntegrationError(
          "VALIDATION_ERROR",
          "A credential value cannot be serialised.",
          false,
        );
      },
      enumerable: false,
    },
    toString: { value: () => "[redacted credential]", enumerable: false },
  });

  return credential as SensitiveCredential;
}

type Rpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export function createVaultCredentialStore(
  serviceSupabase: SupabaseClient<Database>,
): CredentialStore {
  const client = serviceSupabase as unknown as Rpc;

  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw toIntegrationError(error as { message: string });
    return data;
  }

  function scope(input: { organizationId: string; providerKey: string; correlationId: string }) {
    const parsed = z
      .object({
        organizationId: uuidSchema,
        providerKey: providerKeySchema,
        correlationId: uuidSchema,
      })
      .safeParse(input);

    if (!parsed.success) throw fail("VALIDATION_ERROR", parsed.error);

    return {
      p_organization_id: parsed.data.organizationId,
      p_provider_key: parsed.data.providerKey,
      p_correlation_id: parsed.data.correlationId,
    };
  }

  function handleArg(handle: CredentialHandle): { p_credential_reference: string } {
    const parsed = referenceSchema.safeParse(handle.reference);
    if (!parsed.success) throw fail("VALIDATION_ERROR", parsed.error);
    return { p_credential_reference: parsed.data };
  }

  function secretArg(secret: string): { p_secret: string } {
    const parsed = secretSchema.safeParse(secret);
    if (!parsed.success) throw fail("VALIDATION_ERROR", parsed.error);
    return { p_secret: parsed.data };
  }

  function idempotencyArg(key: string): { p_idempotency_key: string } {
    const parsed = z.string().trim().min(1).max(200).safeParse(key);
    if (!parsed.success) throw fail("VALIDATION_ERROR", parsed.error);
    return { p_idempotency_key: parsed.data };
  }

  return {
    async create(input: CreateCredentialInput): Promise<CredentialHandle> {
      const data = await call("create_integration_credential", {
        ...scope(input),
        ...secretArg(input.secret),
        ...idempotencyArg(input.idempotencyKey),
      });

      const reference = referenceSchema.safeParse(data);
      if (!reference.success) throw fail("VALIDATION_ERROR");
      return { reference: reference.data };
    },

    async resolve(input: ResolveCredentialInput): Promise<SensitiveCredential> {
      const data = await call("resolve_integration_credential", {
        ...scope(input),
        ...handleArg(input.handle),
      });

      const value = z.string().min(1).safeParse(data);
      if (!value.success) throw fail("NOT_FOUND");
      return sensitive(value.data);
    },

    async replace(input: ReplaceCredentialInput): Promise<void> {
      await call("replace_integration_credential", {
        ...scope(input),
        ...handleArg(input.handle),
        ...secretArg(input.secret),
        ...idempotencyArg(input.idempotencyKey),
      });
    },

    async revoke(input: RevokeCredentialInput): Promise<void> {
      // Revoke is deliberately repeat-safe: the database treats an already
      // revoked or absent credential as success, so a retried disconnect never
      // strands a connection in a half-revoked state.
      await call("revoke_integration_credential", {
        ...scope(input),
        ...handleArg(input.handle),
      });
    },
  };
}
