import { describe, expect, it } from "vitest";

import {
  admitProposal,
  campaignProposalDocumentSchema,
  hasPinnableProposalEvidence,
  hasSameTenantEvidenceRefs,
  materialTermsChanged,
  preparationAuthority,
  type CampaignProposalDocument,
} from "@/domain/campaigns/proposal";
import { proposalDigest } from "@/domain/campaigns/proposal-digest";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION = "22222222-2222-4222-8222-222222222222";
const MANIFEST = "33333333-3333-4333-8333-333333333333";
const RESEARCH = "44444444-4444-4444-8444-444444444444";

function document(overrides: Partial<CampaignProposalDocument> = {}): CampaignProposalDocument {
  return {
    schemaVersion: 1,
    title: "Weekday lunch footfall",
    businessProblem: "Weekday lunch covers are down against the same weeks last quarter.",
    objective: "acquisition",
    audience: "People working within a short walk who do not currently order lunch here.",
    offer: { kind: "no_offer" },
    channels: [{ channelKey: "instagram", delivery: "organic" }],
    deliverables: [{ format: "feed", language: "en", count: 3 }],
    timing: { startAt: "2026-09-20T00:00:00.000Z", endAt: null, timezone: "Asia/Dubai" },
    proposedMediaBudget: null,
    generationCostCeiling: { amountMinor: 8000, currency: "AED" },
    successPlan: {
      primaryMetricKey: "weekday_lunch_covers",
      baselineSource: "point_of_sale",
      baselineRevision: 4,
      baselineFrom: "2026-06-01T00:00:00.000Z",
      baselineTo: "2026-08-31T00:00:00.000Z",
      observationWindowDays: 28,
      reportingDelayDays: 2,
      settlementDelayDays: 7,
      measurementMethod: "pre_post_with_baseline",
      target: null,
      missingData: [],
    },
    pausePolicyRef: "default_pause_policy",
    evidence: [
      {
        kind: "business_memory_context",
        organizationId: ORGANIZATION,
        contextManifestId: MANIFEST,
        sourceRevision: 4,
        observedFrom: "2026-06-01T00:00:00.000Z",
        observedTo: "2026-08-31T00:00:00.000Z",
        supports: "internal_fact",
      },
    ],
    memoryContextManifestId: MANIFEST,
    assumptions: ["Lunch service capacity is not the binding constraint."],
    limitations: [],
    readiness: { canPrepare: true, canLaunch: false, blockers: ["No connected channel"] },
    ...overrides,
  };
}

describe("the proposal document", () => {
  it("accepts a complete organic proposal with no media budget", () => {
    expect(campaignProposalDocumentSchema.safeParse(document()).success).toBe(true);
  });

  it("keeps 'no media budget' distinct from a budget of zero", () => {
    const organic = document({ proposedMediaBudget: null });
    const zero = document({ proposedMediaBudget: { amountMinor: 0, currency: "AED" } });

    expect(proposalDigest(organic)).not.toBe(proposalDigest(zero));
  });

  it("refuses an unknown field rather than silently dropping it", () => {
    const parsed = campaignProposalDocumentSchema.safeParse({
      ...document(),
      sneakyApprovedFlag: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("requires the no-offer case to be stated, not left absent", () => {
    expect(
      campaignProposalDocumentSchema.safeParse({ ...document(), offer: null }).success,
    ).toBe(false);
    expect(
      campaignProposalDocumentSchema.safeParse({ ...document(), offer: { kind: "no_offer" } })
        .success,
    ).toBe(true);
  });

  it("will not accept a URL as evidence for an internal fact", () => {
    const parsed = campaignProposalDocumentSchema.safeParse({
      ...document(),
      evidence: [{ kind: "business_memory_context", url: "https://example.com/report" }],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("the proposal digest", () => {
  it("is stable across key order, so an equivalent document approves the same", () => {
    const base = document();
    // Same content, keys emitted in the opposite order. A digest that depended
    // on key order would differ here, and an approval would stop matching its
    // own document for no reason a person could see.
    const reordered = Object.fromEntries(
      Object.entries(base).reverse(),
    ) as CampaignProposalDocument;

    expect(Object.keys(reordered)).not.toEqual(Object.keys(base));
    expect(proposalDigest(reordered)).toBe(proposalDigest(base));
  });

  it("changes when any agreed term changes, so an old approval cannot carry over", () => {
    const before = proposalDigest(document());
    const after = proposalDigest(
      document({ generationCostCeiling: { amountMinor: 9000, currency: "AED" } }),
    );

    expect(after).not.toBe(before);
  });
});

describe("what approving a proposal authorizes", () => {
  it("authorizes preparation and nothing else", () => {
    const authority = preparationAuthority(document());

    expect(authority.mayPrepareCreative).toBe(true);
    expect(authority.mayReserveMediaSpend).toBe(false);
    expect(authority.mayPublish).toBe(false);
    expect(authority.mayConfirmCreative).toBe(false);
    expect(authority.mayAuthorizeLaterVariation).toBe(false);
  });

  it("carries the generation ceiling, which is not the media budget", () => {
    const authority = preparationAuthority(
      document({
        proposedMediaBudget: { amountMinor: 350000, currency: "AED" },
        generationCostCeiling: { amountMinor: 8000, currency: "AED" },
      }),
    );

    expect(authority.generationCostCeiling).toEqual({ amountMinor: 8000, currency: "AED" });
  });

  it("will not permit preparation while readiness says it cannot prepare", () => {
    const authority = preparationAuthority(
      document({ readiness: { canPrepare: false, canLaunch: false, blockers: ["No subject"] } }),
    );

    expect(authority.mayPrepareCreative).toBe(false);
  });
});

describe("which changes need a new revision", () => {
  it("treats audience, offer, budgets, success terms, channels and deliverables as material", () => {
    const before = document();

    expect(materialTermsChanged(before, document({ audience: "Someone else entirely." }))).toEqual([
      "audience",
    ]);
    expect(
      materialTermsChanged(before, document({ offer: { kind: "offer", offerRef: "lunch_set" } })),
    ).toEqual(["offer"]);
    expect(
      materialTermsChanged(
        before,
        document({ proposedMediaBudget: { amountMinor: 100, currency: "AED" } }),
      ),
    ).toEqual(["proposedMediaBudget"]);
  });

  it("does not treat a wording change to the problem statement as material", () => {
    const changed = document({ businessProblem: "Weekday lunch covers have fallen." });

    expect(materialTermsChanged(document(), changed)).toEqual([]);
  });
});

describe("D07 — what may be put in front of a person", () => {
  it("admits a proposal built only on internal evidence, with no estimate and no research", () => {
    const admission = admitProposal({
      document: document(),
      organizationId: ORGANIZATION,
      marketClaimKeys: [],
    });

    expect(admission.outcome).toBe("admissible");
  });

  it("says plainly what such a proposal is missing rather than hiding it", () => {
    const admission = admitProposal({
      document: document(),
      organizationId: ORGANIZATION,
      marketClaimKeys: [],
    });

    expect(admission).toMatchObject({ outcome: "admissible" });
    const gaps = admission.outcome === "admissible" ? admission.declaredGaps : [];
    expect(gaps).toContain("No external market research supports this.");
    expect(gaps).toContain("No profit or outcome estimate is attached.");
  });

  it("still admits when both the estimate and the research are absent together", () => {
    const admission = admitProposal({
      document: document({
        successPlan: { ...document().successPlan, target: null, missingData: ["No POS feed yet"] },
      }),
      organizationId: ORGANIZATION,
      marketClaimKeys: [],
    });

    expect(admission.outcome).toBe("admissible");
  });

  it("refuses a market claim that has no market citation behind it", () => {
    const admission = admitProposal({
      document: document(),
      organizationId: ORGANIZATION,
      marketClaimKeys: ["delivery_demand_is_growing"],
    });

    expect(admission).toEqual({
      outcome: "refused",
      reasonCode: "market_claim_without_citation",
    });
  });

  it("admits the same market claim once a citation from this tenant supports it", () => {
    const admission = admitProposal({
      document: document({
        evidence: [
          {
            kind: "market_claim_citation",
            organizationId: ORGANIZATION,
            researchRequestId: RESEARCH,
            sourceRevision: 2,
            observedFrom: "2026-08-01T00:00:00.000Z",
            observedTo: "2026-08-31T00:00:00.000Z",
            supports: "market_claim",
          },
        ],
      }),
      organizationId: ORGANIZATION,
      marketClaimKeys: ["delivery_demand_is_growing"],
    });

    expect(admission.outcome).toBe("admissible");
  });

  it("refuses evidence belonging to another tenant, whatever it would support", () => {
    const admission = admitProposal({
      document: document({
        evidence: [
          {
            kind: "business_memory_context",
            organizationId: OTHER_ORGANIZATION,
            contextManifestId: MANIFEST,
            sourceRevision: 4,
            observedFrom: "2026-06-01T00:00:00.000Z",
            observedTo: "2026-08-31T00:00:00.000Z",
            supports: "internal_fact",
          },
        ],
      }),
      organizationId: ORGANIZATION,
      marketClaimKeys: [],
    });

    expect(admission).toEqual({ outcome: "refused", reasonCode: "foreign_evidence" });
  });

  it("checks the tenant before the citation, so a leak is never merely a missing citation", () => {
    const admission = admitProposal({
      document: document({
        evidence: [
          {
            kind: "market_claim_citation",
            organizationId: OTHER_ORGANIZATION,
            researchRequestId: RESEARCH,
            sourceRevision: 2,
            observedFrom: "2026-08-01T00:00:00.000Z",
            observedTo: "2026-08-31T00:00:00.000Z",
            supports: "market_claim",
          },
        ],
      }),
      organizationId: ORGANIZATION,
      marketClaimKeys: ["delivery_demand_is_growing"],
    });

    expect(admission).toEqual({ outcome: "refused", reasonCode: "foreign_evidence" });
  });

  it("refuses a proposal with nothing to review at all", () => {
    const admission = admitProposal({
      document: document({ evidence: [], assumptions: [] }),
      organizationId: ORGANIZATION,
      marketClaimKeys: [],
    });

    expect(admission).toEqual({ outcome: "refused", reasonCode: "no_reviewable_content" });
  });

  it("admits a proposal resting only on a stated assumption", () => {
    const admission = admitProposal({
      document: document({ evidence: [], assumptions: ["Capacity is not the constraint."] }),
      organizationId: ORGANIZATION,
      marketClaimKeys: [],
    });

    expect(admission.outcome).toBe("admissible");
  });
});

describe("the approval-time evidence pin", () => {
  it("finds pinnable evidence in a same-tenant source ref", () => {
    expect(hasPinnableProposalEvidence(document(), ORGANIZATION)).toBe(true);
  });

  it("finds pinnable evidence in the context manifest alone", () => {
    expect(
      hasPinnableProposalEvidence(
        document({ evidence: [], memoryContextManifestId: MANIFEST }),
        ORGANIZATION,
      ),
    ).toBe(true);
  });

  it("finds nothing pinnable when the version cites nothing at all", () => {
    expect(
      hasPinnableProposalEvidence(
        document({ evidence: [], memoryContextManifestId: null }),
        ORGANIZATION,
      ),
    ).toBe(false);
  });

  it("never treats another tenant's records as pinnable", () => {
    expect(
      hasPinnableProposalEvidence(
        document({
          evidence: [
            {
              kind: "business_memory_context",
              organizationId: OTHER_ORGANIZATION,
              contextManifestId: MANIFEST,
              sourceRevision: 4,
              observedFrom: "2026-06-01T00:00:00.000Z",
              observedTo: "2026-08-31T00:00:00.000Z",
              supports: "internal_fact",
            },
          ],
          memoryContextManifestId: null,
        }),
        ORGANIZATION,
      ),
    ).toBe(false);
  });
});

describe("the same-tenant refs check", () => {
  it("holds when any cited ref belongs to this tenant", () => {
    expect(hasSameTenantEvidenceRefs(document(), ORGANIZATION)).toBe(true);
  });

  it("fails when every cited ref belongs elsewhere, even with a manifest pointer present", () => {
    expect(
      hasSameTenantEvidenceRefs(
        document({
          evidence: [
            {
              kind: "business_memory_context",
              organizationId: OTHER_ORGANIZATION,
              contextManifestId: MANIFEST,
              sourceRevision: 4,
              observedFrom: "2026-06-01T00:00:00.000Z",
              observedTo: "2026-08-31T00:00:00.000Z",
              supports: "internal_fact",
            },
          ],
          memoryContextManifestId: MANIFEST,
        }),
        ORGANIZATION,
      ),
    ).toBe(false);
  });

  it("fails when nothing is cited at all", () => {
    expect(
      hasSameTenantEvidenceRefs(
        document({ evidence: [], memoryContextManifestId: null }),
        ORGANIZATION,
      ),
    ).toBe(false);
  });
});
