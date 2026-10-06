import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";
import { isGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";
import { channelAssessmentReads } from "./api";
import {
  assessChannelForAgent,
  type ChannelAssessmentInput,
  type ChannelAssessmentOutcome,
} from "./channel-assessment";

type SessionClient = SupabaseClient<Database>;

const actorSchema = z
  .object({
    turnId: z.uuid(),
    actorId: z.uuid(),
    role: z.enum(["viewer", "operator", "admin", "owner"]),
  })
  .strict();

/**
 * Request path: the caller's role is already resolved by session
 * authorization, so no lease check is needed. Viewers read permitted
 * results; dispatch still requires `report.retry` inside the assessment.
 */
export async function assessChannelForAgentRequest(
  input: ChannelAssessmentInput & { supabase: SessionClient },
): Promise<ChannelAssessmentOutcome> {
  if (!isGovernedChannelAnalysisEnabled(input.organizationId)) {
    return { status: "not_available", reason: "feature_disabled" };
  }
  const { supabase, ...request } = input;
  return assessChannelForAgent(
    request,
    channelAssessmentReads(supabase, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      role: input.role,
      branchId: input.branchId,
    }),
  );
}

/**
 * Worker-only adapter. The service-role client can bypass RLS, so the active
 * lease and effective actor role are rechecked by Postgres before any read or
 * dispatch. Every source query still carries an explicit organization id.
 */
export async function assessChannelForAgentWithSession(
  input: Omit<ChannelAssessmentInput, "role"> & {
    supabase: SessionClient;
    turnId: string;
    leaseToken: string;
  },
): Promise<ChannelAssessmentOutcome> {
  if (!isGovernedChannelAnalysisEnabled(input.organizationId)) {
    return { status: "not_available", reason: "feature_disabled" };
  }

  const rpc = input.supabase.rpc.bind(input.supabase) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string } | null }>;
  const { data, error } = await rpc("get_agent_turn_actor_role", {
    p_organization_id: input.organizationId,
    p_turn_id: input.turnId,
    p_lease_token: input.leaseToken,
  });
  const actor = actorSchema.safeParse(data);
  if (
    error ||
    !actor.success ||
    actor.data.turnId !== input.turnId ||
    actor.data.actorId !== input.actorId
  ) {
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "The agent turn no longer has current authorization.",
      error ?? undefined,
    );
  }

  const { supabase, ...request } = input;
  return assessChannelForAgent(
    { ...request, role: actor.data.role },
    channelAssessmentReads(supabase, {
      organizationId: input.organizationId,
      actorId: actor.data.actorId,
      role: actor.data.role,
      branchId: input.branchId,
    }),
  );
}
