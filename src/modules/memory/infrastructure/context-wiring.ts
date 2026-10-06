import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  createSubjectPackPort,
  type SubjectPackPort,
} from "@/modules/memory/application/subject-pack";
import { createContextRepository } from "@/modules/memory/infrastructure/context-repository";
import {
  createSupabaseCurrentStateQuery,
  readCurrentState,
} from "@/modules/memory/infrastructure/current-state-reader";
import { createSupabaseMemoryPersistence } from "@/modules/memory/infrastructure/persistence";

/**
 * Runtime factory for the governed subject-drafting port (Spec 023 §7).
 * The session client carries the actor's own RLS context end to end: current
 * state, memory search, and manifest preparation all run as the caller, never
 * as a privileged worker. Workers use claimed-run bindings instead; they do
 * not enter through this factory.
 */
export function createSessionSubjectPackPort(
  authenticatedSupabase: SupabaseClient<Database>,
): SubjectPackPort {
  // The generated client types rpc() over known function names only; the
  // context repository calls governed RPCs by string name. The cast is
  // confined here so feature wiring never repeats it.
  const rpc = (
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> =>
    (
      authenticatedSupabase.rpc as unknown as (
        fn: string,
        fnArgs: Record<string, unknown>,
      ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
    )(name, args);

  // The reader needs four chainable filters over a structural client; the
  // generated client's deep generics explode inference (TS2589), so the
  // structural shape is asserted once here. Runtime behavior is unchanged:
  // the real filter builder runs underneath.
  const structural = authenticatedSupabase as unknown as {
    from(table: string): {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select(columns: string): any;
    };
  };

  const queryState = createSupabaseCurrentStateQuery(structural);

  return createSubjectPackPort({
    readState: async ({ organizationId }) => {
      const state = await readCurrentState(queryState, { organizationId, branchId: null });
      return { profile: state.profile, facts: state.facts };
    },
    persistence: createSupabaseMemoryPersistence(authenticatedSupabase),
    contexts: createContextRepository({ rpc }),
    nowIso: () => new Date().toISOString(),
  });
}
