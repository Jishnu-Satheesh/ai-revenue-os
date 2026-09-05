import { describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";
import { recordFeedback, triageRecommendation, type TriageAnswer } from "@/modules/analysis/application/triage";

vi.mock("server-only", () => ({}));

/**
 * The application layer's own contract, exercised through a stubbed PostgREST
 * client: the exact argument names the two member RPCs bind, what is refused
 * here so it never reaches the database, and how a refusal from inside the
 * definer function maps back to a stable domain error.
 */

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";
const RECOMMENDATION = "55555555-5555-4555-8555-555555555555";
const ACTOR = "66666666-6666-4666-8666-666666666666";

function fakeRpcClient(error: { code: string; message: string } | null = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const supabase = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: undefined, error });
    },
  } as unknown as SupabaseClient<Database>;
  return { supabase, calls };
}

describe("triageRecommendation", () => {
  it("sends the exact argument names the definer functions bind", async () => {
    const { supabase, calls } = fakeRpcClient();

    await triageRecommendation(
      {
        organizationId: ORGANIZATION,
        recommendationId: RECOMMENDATION,
        decision: "dismissed",
        reason: "Already handled offline.",
      },
      { supabase, actorId: ACTOR },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("triage_channel_recommendation");
    expect(calls[0].args).toEqual({
      p_organization_id: ORGANIZATION,
      p_recommendation_id: RECOMMENDATION,
      p_decision: "dismissed",
      p_dismissal_reason: "Already handled offline.",
      p_actor_id: ACTOR,
      p_snoozed_until: null,
    });
  });

  it("sends the horizon beside a snoozed answer", async () => {
    const { supabase, calls } = fakeRpcClient();
    const snoozedUntil = "2026-09-11T10:00:00.000Z";

    await triageRecommendation(
      {
        organizationId: ORGANIZATION,
        recommendationId: RECOMMENDATION,
        decision: "snoozed",
        snoozedUntil,
      },
      { supabase, actorId: ACTOR },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({
      p_decision: "snoozed",
      p_dismissal_reason: null,
      p_snoozed_until: snoozedUntil,
    });
  });

  it("blocks a snooze without a horizon before the database is reached", async () => {
    const { supabase, calls } = fakeRpcClient();

    await expect(
      triageRecommendation(
        { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, decision: "snoozed" },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a horizon riding along on an answer that is not a snooze", async () => {
    const { supabase, calls } = fakeRpcClient();

    await expect(
      triageRecommendation(
        {
          organizationId: ORGANIZATION,
          recommendationId: RECOMMENDATION,
          decision: "acknowledged",
          snoozedUntil: "2026-09-11T10:00:00.000Z",
        },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("stores no dismissal reason for an answer that is not a dismissal", async () => {
    const { supabase, calls } = fakeRpcClient();

    for (const decision of ["acknowledged", "planned"] as const) {
      calls.length = 0;
      await triageRecommendation(
        { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, decision },
        { supabase, actorId: ACTOR },
      );
      expect(calls[0].args.p_dismissal_reason).toBeNull();
    }
  });

  it("blocks a dismissal without a reason before the database is reached", async () => {
    const { supabase, calls } = fakeRpcClient();

    await expect(
      triageRecommendation(
        { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, decision: "dismissed" },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("blocks a dismissal whose reason is shorter than the storage contract asks", async () => {
    const { supabase, calls } = fakeRpcClient();

    await expect(
      triageRecommendation(
        {
          organizationId: ORGANIZATION,
          recommendationId: RECOMMENDATION,
          decision: "dismissed",
          reason: "no",
        },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toBeInstanceOf(DomainError);
    expect(calls).toHaveLength(0);
  });

  it("refuses a reason riding along on an answer that cannot carry one", async () => {
    const { supabase, calls } = fakeRpcClient();

    await expect(
      triageRecommendation(
        {
          organizationId: ORGANIZATION,
          recommendationId: RECOMMENDATION,
          decision: "acknowledged",
          reason: "Not a dismissal.",
        },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a vocabulary the storage table does not know", async () => {
    const { supabase, calls } = fakeRpcClient();

    await expect(
      triageRecommendation(
        {
          organizationId: ORGANIZATION,
          recommendationId: RECOMMENDATION,
          decision: "maybe" as TriageAnswer["decision"],
        },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("maps the database's authorization refusal to a stable authorization error", async () => {
    const { supabase } = fakeRpcClient({
      code: "42501",
      message: "channel recommendation triage is not authorized",
    });

    await expect(
      triageRecommendation(
        { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, decision: "planned" },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "AUTHORIZATION_ERROR" });
  });

  it("maps a recommendation that does not resolve in the tenant to a scope error", async () => {
    const { supabase } = fakeRpcClient({
      code: "P0002",
      message: "channel recommendation was not found",
    });

    await expect(
      triageRecommendation(
        { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, decision: "planned" },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "TENANT_SCOPE_ERROR" });
  });

  it("reports any other database refusal as an integration failure", async () => {
    const { supabase } = fakeRpcClient({ code: "XX000", message: "unexpected" });

    await expect(
      triageRecommendation(
        { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, decision: "planned" },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "INTEGRATION_ERROR" });
  });

  it("returns only the id of what was answered", async () => {
    const { supabase } = fakeRpcClient();

    const result = await triageRecommendation(
      { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, decision: "planned" },
      { supabase, actorId: ACTOR },
    );

    expect(result).toEqual({ recommendationId: RECOMMENDATION });
  });
});

describe("recordFeedback", () => {
  it("sends the exact argument names the vote upsert binds", async () => {
    const { supabase, calls } = fakeRpcClient();

    await recordFeedback(
      { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, helpful: true },
      { supabase, actorId: ACTOR },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("record_channel_recommendation_feedback");
    expect(calls[0].args).toEqual({
      p_organization_id: ORGANIZATION,
      p_recommendation_id: RECOMMENDATION,
      p_helpful: true,
      p_actor_id: ACTOR,
    });
  });

  it("refuses a vote that is not a plain boolean", async () => {
    const { supabase, calls } = fakeRpcClient();

    await expect(
      recordFeedback(
        {
          organizationId: ORGANIZATION,
          recommendationId: RECOMMENDATION,
          helpful: "yes" as unknown as boolean,
        },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("maps the database's authorization refusal to a stable authorization error", async () => {
    const { supabase } = fakeRpcClient({
      code: "42501",
      message: "channel recommendation feedback is not authorized",
    });

    await expect(
      recordFeedback(
        { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, helpful: false },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "AUTHORIZATION_ERROR" });
  });

  it("maps a recommendation that does not resolve in the tenant to a scope error", async () => {
    const { supabase } = fakeRpcClient({
      code: "P0002",
      message: "channel recommendation was not found",
    });

    await expect(
      recordFeedback(
        { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, helpful: false },
        { supabase, actorId: ACTOR },
      ),
    ).rejects.toMatchObject({ name: "DomainError", code: "TENANT_SCOPE_ERROR" });
  });

  it("returns only the id that was voted on", async () => {
    const { supabase } = fakeRpcClient();

    const result = await recordFeedback(
      { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, helpful: false },
      { supabase, actorId: ACTOR },
    );

    expect(result).toEqual({ recommendationId: RECOMMENDATION });
  });
});
