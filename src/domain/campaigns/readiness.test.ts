import { describe, expect, it } from "vitest";

import {
  campaignReadinessSchema,
  describeCampaignGenerationFailure,
  evaluateCampaignReadiness,
  evaluateCreativePreparationReadiness,
  evaluateLaunchReadiness,
  evaluateMeasurementReadiness,
  evaluateProposalReadiness,
} from "@/domain/campaigns/readiness";

const NOW = new Date("2026-09-13T00:00:00.000Z");

/** A campaign with nothing wrong with it, so each test spoils one thing. */
function launchInput(overrides: Record<string, unknown> = {}) {
  return {
    providerKey: "meta_campaign",
    providerContractCurrent: true,
    contentLimitsVerified: true,
    proposalApproved: true,
    everyDeliverableReviewed: true,
    rejectedDeliverablePresent: false,
    renderVerificationPending: false,
    contentChangedSinceApproval: false,
    providerAccountMapping: "resolved" as const,
    providerScopesGranted: true,
    providerAdapterRegistered: true,
    mediaBudgetDeclared: true,
    publishConfirmationPending: false,
    ...overrides,
  };
}

function preparationInput(overrides: Record<string, unknown> = {}) {
  return {
    sourceSnapshotAvailable: true,
    subjectDeclared: true,
    syntheticPathPermitted: true,
    ...overrides,
  };
}

describe("the four phases are answered separately", () => {
  it("lets a campaign prepare creative while its publishing contract is out of date", () => {
    // This is the whole point of the contract. The deployed failure treated a
    // lapsed publishing record as a reason to stop internal drafting, and a
    // designer could not start work because the publisher's certificate had
    // expired.
    const readiness = evaluateCampaignReadiness({
      now: NOW,
      creativePreparation: preparationInput(),
      launch: launchInput({ providerContractCurrent: false }),
      measurement: { registeredMethodAvailable: true, baselineAvailable: true },
    });

    expect(readiness.creativePreparation.status).toBe("ready");
    expect(readiness.creativePreparation.blockers).toHaveLength(0);
    expect(readiness.launch.status).toBe("blocked");
    expect(readiness.launch.blockers.map((blocker) => blocker.code)).toContain(
      "provider_contract_expired",
    );
  });

  it("answers the proposal phase as unknown rather than pretending", () => {
    const proposal = evaluateProposalReadiness({ now: NOW });

    expect(proposal.status).toBe("unknown");
    expect(proposal.blockers[0]?.code).toBe("proposal_stage_not_implemented");
    // Not `ready`, which would authorize work on a stage that does not exist,
    // and not `blocked`, which would be a refusal nobody decided.
    expect(proposal.status).not.toBe("ready");
    expect(proposal.status).not.toBe("blocked");
  });

  it("keeps a blocked launch from making a campaign unmeasurable", () => {
    const readiness = evaluateCampaignReadiness({
      now: NOW,
      creativePreparation: preparationInput(),
      launch: launchInput({ providerAdapterRegistered: false }),
      measurement: { registeredMethodAvailable: true, baselineAvailable: true },
    });

    expect(readiness.launch.status).toBe("blocked");
    expect(readiness.measurement.status).toBe("ready");
  });

  it("keeps an unmeasurable campaign from blocking its own preparation", () => {
    const readiness = evaluateCampaignReadiness({
      now: NOW,
      creativePreparation: preparationInput(),
      launch: launchInput(),
      measurement: { registeredMethodAvailable: false, baselineAvailable: false },
    });

    expect(readiness.measurement.status).toBe("blocked");
    expect(readiness.creativePreparation.status).toBe("ready");
    expect(readiness.launch.status).toBe("ready");
  });

  it("produces a shape the API boundary accepts", () => {
    const readiness = evaluateCampaignReadiness({
      now: NOW,
      creativePreparation: preparationInput(),
      launch: launchInput(),
      measurement: { registeredMethodAvailable: true, baselineAvailable: true },
    });

    expect(campaignReadinessSchema.safeParse(readiness).success).toBe(true);
  });
});

describe("preparation refuses only what actually stops drawing", () => {
  it("names missing evidence, an undeclared subject and a forbidden synthetic path", () => {
    const preparation = evaluateCreativePreparationReadiness({
      now: NOW,
      ...preparationInput({
        sourceSnapshotAvailable: false,
        subjectDeclared: false,
        syntheticPathPermitted: false,
      }),
    });

    expect(preparation.blockers.map((blocker) => blocker.code)).toEqual([
      "source_facts_unavailable",
      "no_declared_subject",
      "synthetic_path_not_permitted",
    ]);
    expect(preparation.status).toBe("blocked");
  });

  it("carries a failed run's own blocker without inventing a second reason", () => {
    const preparation = evaluateCreativePreparationReadiness({
      now: NOW,
      ...preparationInput(),
      runBlockers: [describeCampaignGenerationFailure("bootstrap:worker_start_failed").blocker],
    });

    expect(preparation.status).toBe("needs_input");
    expect(preparation.blockers).toHaveLength(1);
    expect(preparation.blockers[0]?.code).toBe("generation_bootstrap_failed");
  });
});

describe("launch treats every proof requirement as independent", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["an unapproved plan", { proposalApproved: false }, "proposal_not_approved"],
    ["unprovable limits", { contentLimitsVerified: false }, "provider_content_limits_unverified"],
    ["an unreviewed output", { everyDeliverableReviewed: false }, "render_verification_pending"],
    ["a rejected output", { rejectedDeliverablePresent: true }, "required_creative_rejected"],
    ["edited content", { contentChangedSinceApproval: true }, "content_changed"],
    ["no chosen account", { providerAccountMapping: "missing" }, "provider_mapping_missing"],
    ["two possible accounts", { providerAccountMapping: "ambiguous" }, "provider_mapping_ambiguous"],
    ["a withdrawn permission", { providerScopesGranted: false }, "provider_scope_revoked"],
    ["no registered adapter", { providerAdapterRegistered: false }, "provider_adapter_absent"],
    ["no budget", { mediaBudgetDeclared: false }, "budget_missing"],
    [
      "an unconfirmed publish",
      { publishConfirmationPending: true },
      "publish_confirmation_pending",
    ],
  ];

  for (const [name, override, code] of cases) {
    it(`blocks on ${name} and names exactly that`, () => {
      const launch = evaluateLaunchReadiness({ now: NOW, ...launchInput(override) });
      expect(launch.blockers.map((blocker) => blocker.code)).toEqual([code]);
    });
  }

  it("is ready only when every one of them is satisfied", () => {
    const launch = evaluateLaunchReadiness({ now: NOW, ...launchInput() });
    expect(launch.status).toBe("ready");
    expect(launch.blockers).toHaveLength(0);
  });

  it("treats an outstanding review as something a person can clear, not a refusal", () => {
    const launch = evaluateLaunchReadiness({
      now: NOW,
      ...launchInput({ everyDeliverableReviewed: false }),
    });
    expect(launch.status).toBe("needs_input");
  });
});

describe("measurement says which half is missing", () => {
  it("distinguishes no agreed method from no baseline", () => {
    expect(
      evaluateMeasurementReadiness({
        now: NOW,
        registeredMethodAvailable: false,
        baselineAvailable: true,
      }).blockers[0]?.explanation,
    ).toMatch(/no agreed way to measure/i);

    expect(
      evaluateMeasurementReadiness({
        now: NOW,
        registeredMethodAvailable: true,
        baselineAvailable: false,
      }).blockers[0]?.explanation,
    ).toMatch(/baseline/i);
  });
});

describe("a stored failure code becomes something a client can act on", () => {
  it("never echoes an internal code it does not recognise", () => {
    const described = describeCampaignGenerationFailure("planner_exploded_horribly");

    expect(described.clientCopy).not.toContain("planner_exploded_horribly");
    expect(described.retryable).toBe(true);
  });

  it("refuses a retry for a prerequisite the client cannot change by retrying", () => {
    expect(describeCampaignGenerationFailure("bootstrap:provider_contract_expired").retryable).toBe(
      false,
    );
    expect(describeCampaignGenerationFailure("source_snapshot_missing").retryable).toBe(false);
  });

  it("permits a retry once a changed prerequisite could make a difference", () => {
    expect(describeCampaignGenerationFailure("needs_data:brand_voice").retryable).toBe(true);
    expect(describeCampaignGenerationFailure("no_declared_subject").retryable).toBe(true);
    expect(describeCampaignGenerationFailure("bootstrap:worker_start_failed").retryable).toBe(true);
  });

  it("names the missing details in words a client can read", () => {
    const described = describeCampaignGenerationFailure(
      "needs_data:brand_voice,primary_metric,baseline_source",
    );

    // The stored codes are written for engineers. Showing `brand_voice` to an
    // operator asks them to translate before they can act.
    expect(described.clientCopy).toContain("Brand voice");
    expect(described.clientCopy).toContain("Primary metric");
    expect(described.clientCopy).toContain("Baseline source");
    expect(described.clientCopy).not.toContain("brand_voice");
    expect(described.clientCopy).not.toContain("primary_metric");
  });

  it("carries the missing keys as data, not only inside a sentence", () => {
    const described = describeCampaignGenerationFailure(
      "needs_data:brand_voice,primary_metric",
    );

    // The repair dialog decides which fields to show from this. Parsing them
    // back out of the prose would be a second, silently diverging account of
    // the same failure.
    expect(described.missingDetails).toEqual(["brand_voice", "primary_metric"]);
  });

  it("humanises a key it has never seen rather than dropping it", () => {
    const described = describeCampaignGenerationFailure("needs_data:some_future_key");

    // A gap this build does not recognise is still a gap the operator has.
    // Dropping it would show them a failure with nothing named in it.
    expect(described.clientCopy).toContain("Some future key");
    expect(described.missingDetails).toEqual(["some_future_key"]);
  });

  it("reports no missing details for a failure that is not about evidence", () => {
    expect(describeCampaignGenerationFailure("generation_run_stalled").missingDetails).toEqual([]);
    expect(describeCampaignGenerationFailure(null).missingDetails).toEqual([]);
  });

  it("says nothing at all rather than guessing when no code was recorded", () => {
    const described = describeCampaignGenerationFailure(null);

    expect(described.clientCopy).toMatch(/without saying why/i);
    expect(described.retryable).toBe(true);
  });
});
