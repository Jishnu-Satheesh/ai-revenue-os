import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { IntegrationError } from "@/domain/integrations/errors";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Trigger worker-only client. This is intentionally not a general server
 * client: browser, route, and component code must use the RLS session client.
 */
export function createIntegrationWorkerServiceClient(): SupabaseClient<Database> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new IntegrationError(
      "FEATURE_NOT_AVAILABLE",
      "Integration workers are not configured.",
      false,
    );
  }
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
