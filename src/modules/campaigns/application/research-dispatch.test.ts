import { describe, expect, it, vi } from "vitest";

import {
  admissionRefusal,
  refusalMessage,
  refusalToDomainError,
  requestCampaignResearch,
  type ResearchAdmissionPersistence,
  type ResearchWorkerDispatch,
} from "@/modules/campaigns/application/research-dispatch";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const RUN = "20000000-0000-4000-8000-000000000002";
const CORRELATION = "30000000-0000-4000-8000-000000000003";

type Rpc = ResearchAdmissionPersistence["rpc"];

function persistence(result: { data?: unknown; error?: { code?: string; message?: string } }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client: ResearchAdmissionPersistence = {
    rpc: vi.fn<Rpc>(async (name, args) => {
      calls.push({ name, args });
      return { data: result.data ?? null, error: result.error ?? null };
    }),
  };
  return { client, calls };
}

function admitted() {
  return persistence({ data: { run_id: RUN, outcome: "saved" } });
}

function input() {
  return {
    organizationId: ORGANIZATION,
    triggerKind: "manual_request" as const,
    budgetMinor: 5000,
    allowanceCurrency: "AED",
    requestDigest: "a".repeat(64),
    idempotencyKey: "request-key-1",
    sourceFingerprint: null,
    knownPolicyVersion: 3,
    correlationId: CORRELATION,
    evidenceMaxAgeDays: 30,
  };
}

const dispatches: ResearchWorkerDispatch = async () => true;

describe("asking for a piece of research", () => {
  it("admits before it dispatches", async () => {
    const order: string[] = [];
    const { client } = persistence({ data: { run_id: RUN, outcome: "saved" } });
    const rpc = client.rpc as ReturnType<typeof vi.fn>;
    rpc.mockImplementation(async () => {
      order.push("admit");
      return { data: { run_id: RUN, outcome: "saved" }, error: null };
    });

    await requestCampaignResearch(
      client,
      async () => {
        order.push("dispatch");
        return true;
      },
      input(),
    );

    // Dispatching first would mean a worker racing the decision about whether
    // it was allowed to exist.
    expect(order).toEqual(["admit", "dispatch"]);
  });

  it("sends the policy's own figures, never its own", async () => {
    const { client, calls } = admitted();

    await requestCampaignResearch(client, dispatches, input());

    expect(calls[0]?.name).toBe("request_campaign_research_run");
    expect(calls[0]?.args).toMatchObject({
      target_organization_id: ORGANIZATION,
      input_run: {
        trigger_kind: "manual_request",
        budget_minor: 5000,
        allowance_currency: "AED",
        // Sent so a policy that changed since it was read is refused rather
        // than silently applied to a spend nobody authorized under it.
        known_policy_version: 3,
      },
    });
  });

  it("hands the worker the evidence limit the policy set", async () => {
    const { client } = admitted();
    const dispatch = vi.fn<ResearchWorkerDispatch>(async () => true);

    await requestCampaignResearch(client, dispatch, input());

    // The worker refuses to default this; so does everything upstream of it.
    expect(dispatch).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      runId: RUN,
      correlationId: CORRELATION,
      evidenceMaxAgeDays: 30,
    });
  });

  it("reports a dispatch that never landed as not started", async () => {
    const { client } = admitted();

    const outcome = await requestCampaignResearch(client, async () => false, input());

    // The run is admitted either way. Saying "started" would leave a person
    // watching for a proposal that nothing is writing.
    expect(outcome).toEqual({ status: "not_started", runId: RUN, reason: "dispatch_failed" });
  });

  it("still dispatches a replayed admission", async () => {
    const { client } = persistence({ data: { run_id: RUN, outcome: "replayed" } });
    const dispatch = vi.fn<ResearchWorkerDispatch>(async () => true);

    const outcome = await requestCampaignResearch(client, dispatch, input());

    // The claim takes only queued rows, so re-asking cannot double-spend —
    // while not re-asking would strand a run whose first dispatch was lost.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ status: "started", runId: RUN, outcome: "replayed" });
  });

  it("does not dispatch anything the database refused", async () => {
    const { client } = persistence({
      error: { message: 'unhandled exception: campaign_research_cooldown' },
    });
    const dispatch = vi.fn<ResearchWorkerDispatch>(async () => true);

    const outcome = await requestCampaignResearch(client, dispatch, input());

    expect(dispatch).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: "refused", refusal: "cooldown" });
  });

  it("refuses rather than reporting a run id it cannot read", async () => {
    const { client } = persistence({ data: { nonsense: true } });
    const dispatch = vi.fn<ResearchWorkerDispatch>(async () => true);

    const outcome = await requestCampaignResearch(client, dispatch, input());

    // Telling a person research is under way on the strength of a shape
    // nothing validated is worse than saying it could not start.
    expect(dispatch).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: "refused", refusal: "unavailable" });
  });
});

describe("naming the limit that stopped a request", () => {
  it.each([
    ["campaign_research_forbidden", "forbidden"],
    ["campaign_research_needs_setup", "needs_setup"],
    ["campaign_research_stale_policy", "stale_policy"],
    ["campaign_research_currency_mismatch", "currency_mismatch"],
    ["campaign_research_allowance_exceeded", "allowance_exceeded"],
    ["campaign_research_pending_limit", "pending_limit"],
    ["campaign_research_cooldown", "cooldown"],
    ["campaign_research_invalid", "invalid"],
  ] as const)("maps %s by name", (message, expected) => {
    // By exception name, never by message text: a message is for a person and
    // may be reworded, a name is a contract.
    expect(admissionRefusal({ message })).toBe(expected);
  });

  it("treats a bare permission code as forbidden", () => {
    expect(admissionRefusal({ code: "42501" })).toBe("forbidden");
  });

  it("refuses to guess at a refusal it does not recognise", () => {
    // Reporting an unknown refusal as a specific business outcome would be a
    // lie with a confident tone.
    expect(admissionRefusal({ message: "something else entirely" })).toBe("unavailable");
  });

  it("says what stopped the request, not merely that something did", () => {
    expect(refusalMessage("pending_limit")).toMatch(/already as many proposals waiting/i);
    expect(refusalMessage("cooldown")).toMatch(/gap between runs/i);
    expect(refusalMessage("needs_setup")).toMatch(/not switched on/i);
  });

  it("promises nothing was spent where nothing was", () => {
    expect(refusalMessage("allowance_exceeded")).toMatch(/nothing was spent/i);
    expect(refusalMessage("unavailable")).toMatch(/nothing was spent/i);
  });

  it("quotes no figure of its own", () => {
    // The limits are the organization's configuration. A sentence here that
    // named one would risk naming a stale copy of it.
    for (const refusal of [
      "forbidden",
      "needs_setup",
      "stale_policy",
      "currency_mismatch",
      "allowance_exceeded",
      "pending_limit",
      "cooldown",
      "invalid",
      "unavailable",
    ] as const) {
      expect(refusalMessage(refusal)).not.toMatch(/\d/);
    }
  });

  it.each([
    ["forbidden", "AUTHORIZATION_ERROR"],
    ["needs_setup", "FEATURE_NOT_AVAILABLE"],
    ["invalid", "VALIDATION_ERROR"],
    ["currency_mismatch", "VALIDATION_ERROR"],
    ["pending_limit", "WORKFLOW_ERROR"],
    ["cooldown", "WORKFLOW_ERROR"],
    ["allowance_exceeded", "WORKFLOW_ERROR"],
    ["stale_policy", "WORKFLOW_ERROR"],
    ["unavailable", "INTEGRATION_ERROR"],
  ] as const)("answers %s as %s", (refusal, code) => {
    // A budget that is already spent is a business prerequisite, not a fault:
    // the request was well formed and the answer is no.
    expect(refusalToDomainError(refusal).code).toBe(code);
  });
});
