import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { IntegrationError } from "@/domain/integrations/errors";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Rejects a key that is not a service-role credential.
 *
 * A non-empty check is not enough. `.env.example` ships the placeholder
 * `server-only-service-role-key`, and a worker started with it authenticates as
 * `anon`: RLS then hides every tenant row and the run's own RPCs return
 * "permission denied for function", three layers below the cause. A whole
 * afternoon went into tracing that back from an opaque lease error. Pasting the
 * publishable key by mistake fails exactly the same way, which is why the JWT
 * branch reads the role claim rather than stopping at the shape.
 *
 * This inspects the key, it does not verify it. A forged token still fails at
 * the database, where it should.
 */
export function assertServiceRoleKey(key: string | undefined, workerName: string): string {
  const fail = (reason: string): never => {
    throw new IntegrationError(
      "FEATURE_NOT_AVAILABLE",
      `${workerName} are not configured: SUPABASE_SERVICE_ROLE_KEY ${reason}.`,
      false,
    );
  };

  if (!key) return fail("is not set");

  // Current-generation secret keys carry no readable claims; the prefix is the
  // only signal, and it is unambiguous.
  if (key.startsWith("sb_secret_")) return key;
  if (key.startsWith("sb_publishable_")) return fail("is a publishable key, not a secret key");

  const segments = key.split(".");
  if (segments.length !== 3 || !key.startsWith("eyJ"))
    return fail("is not a Supabase key. It looks like a placeholder from .env.example");

  let role: unknown;
  try {
    role = (
      JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as { role?: unknown }
    ).role;
  } catch {
    return fail("could not be read as a Supabase key");
  }

  if (role !== "service_role") return fail(`carries the "${String(role)}" role, not service_role`);

  return key;
}

/**
 * Trigger worker-only client. This is intentionally not a general server
 * client: browser, route, and component code must use the RLS session client.
 */
export function createIntegrationWorkerServiceClient(): SupabaseClient<Database> {
  const key = assertServiceRoleKey(env.SUPABASE_SERVICE_ROLE_KEY, "Integration workers");
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

/**
 * Trigger worker-only client for Business Memory. This must only be created
 * after the task payload has passed its strict UUID validation.
 */
export function createMemoryWorkerServiceClient(): SupabaseClient<Database> {
  const key = assertServiceRoleKey(env.SUPABASE_SERVICE_ROLE_KEY, "Memory workers");
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
