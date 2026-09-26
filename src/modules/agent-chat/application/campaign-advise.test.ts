import { describe, expect, it, vi } from "vitest";

import {
  adviseCampaign,
  buildCampaignMarkerReceipts,
  buildPrefilledBriefUrl,
  campaignBundleLink,
  checkCampaignAdviceEligibility,
  fingerprintAdviceDraft,
  freezeEvidenceSnapshot,
  isMaterialAdviceChange,
  labelCampaignEstimate,
} from "@/modules/agent-chat/application/campaign-advise";

const ORGANIZATION = "00000000-0000-4000-8000-000000000000";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const THREAD = "22222222-2222-4222-8222-222222222222";
const OPPORTUNITY = "33333333-3333-4333-8333-333333333333";
const DRAFT_REQUEST = "44444444-4444-4444-8444-444444444444";

function eligibleInput() {
  return {
    organizationId: ORGANIZATION,
    actorId: ACTOR,
    threadId: THREAD,
    messageDigest: "abc123abc123abc1",
    permissions: ["campaign.create"],
    opportunity: { id: OPPORTUNITY, version: 2 },
    objective: "Lift weekday-evening gross profit",
    audience: "Families within a 15-minute drive",
    assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
    evidenceSnapshot: {
      windowDays: 30 as const,
      observedAt: "2026-09-20T10:00:00.000Z",
      digest: "0123456789abcdef",
      citations: ["ledger:2026-09-01:2026-09-20"],
    },
    evidenceSnapshotFreezable: true,
    marketProfile: { versionId: "mp-v3", digest: "fedcba9876543210" },
    policyPass: true,
    capabilityPass: true,
    schedulePass: true,
    audienceReady: true,
    estimate: {
      valueText: "+AED 4,000 gross profit / week",
      inputs: ["weekday-evening covers, last 30 days"],
      assumptions: ["no menu-price change during the window"],
    },
  };
}

function seams() {
  const requestDraft = vi.fn(
    async (): Promise<{
      outcome: "created" | "replayed";
      requestId: string;
      draftRequestStatus: string;
    }> => ({
      outcome: "created",
      requestId: DRAFT_REQUEST,
      draftRequestStatus: "pending",
    }),
  );
  return {
    drafts: { requestDraft },
    links: { setThreadLinks: vi.fn(async () => ({ threadId: THREAD })) },
  };
}

describe("campaign advice handoff eligibility", () => {
  it("ineligible without campaign.create resolves to a prefilled brief, never a silent upgrade", async () => {
    const seam = seams();
    const out = await adviseCampaign({ ...eligibleInput(), permissions: [] }, seam);

    expect(out.outcome).toBe("brief_prefilled");
    if (out.outcome !== "brief_prefilled") throw new Error("expected brief_prefilled");
    // Prefilled, not empty: the operator's intent travels into the brief.
    expect(out.briefUrl).toContain("/campaigns/new");
    const briefParams = new URL(out.briefUrl, "https://example.test").searchParams;
    expect(briefParams.get("objective")).toBe("Lift weekday-evening gross profit");
    expect(briefParams.get("audience")).toBe("Families within a 15-minute drive");
    // Never a silent upgrade: the draft path stays untouched and the reason travels along.
    expect(out.reasonCodes).toContain("CAMPAIGN_REQUIRES_CREATE");
    expect(seam.drafts.requestDraft).not.toHaveBeenCalled();
    expect(seam.links.setThreadLinks).not.toHaveBeenCalled();
    expect(out.draftRequestId).toBeUndefined();
    // The estimate stays labeled with its inputs and assumptions on the same surface.
    expect(out.estimate.label).toBe("Estimate");
    expect(out.estimate.inputs.length).toBeGreaterThan(0);
    expect(out.estimate.assumptions.length).toBeGreaterThan(0);
  });

  it("names every readiness gap deterministically and still pre-fills the brief", async () => {
    const seam = seams();
    const out = await adviseCampaign(
      {
        ...eligibleInput(),
        evidenceSnapshotFreezable: false,
        marketProfile: null,
        policyPass: false,
        capabilityPass: false,
        schedulePass: false,
        audienceReady: false,
      },
      seam,
    );

    expect(out.outcome).toBe("brief_prefilled");
    if (out.outcome !== "brief_prefilled") throw new Error("expected brief_prefilled");
    expect(out.reasonCodes).toEqual(
      expect.arrayContaining([
        "EVIDENCE_NOT_FREEZABLE",
        "PROFILE_UNBOUND",
        "POLICY_BLOCKED",
        "CAPABILITY_BLOCKED",
        "SCHEDULE_BLOCKED",
        "AUDIENCE_NOT_READY",
      ]),
    );
    expect(seam.drafts.requestDraft).not.toHaveBeenCalled();
    expect(out.prefill).toEqual({
      objective: "Lift weekday-evening gross profit",
      audience: "Families within a 15-minute drive",
    });
  });

  it("missing opportunity resolves to the brief with ADVICE_NO_OPPORTUNITY, never a draft", async () => {
    const seam = seams();
    const out = await adviseCampaign({ ...eligibleInput(), opportunity: null }, seam);

    expect(out.outcome).toBe("brief_prefilled");
    if (out.outcome !== "brief_prefilled") throw new Error("expected brief_prefilled");
    expect(out.reasonCodes).toContain("ADVICE_NO_OPPORTUNITY");
    expect(seam.drafts.requestDraft).not.toHaveBeenCalled();
  });
});

describe("eligible draft-request path", () => {
  it("admits one atomic request with frozen snapshot, idempotency key, and thread link", async () => {
    const seam = seams();
    const out = await adviseCampaign(eligibleInput(), seam);

    expect(out.outcome).toBe("draft_requested");
    if (out.outcome !== "draft_requested") throw new Error("expected draft_requested");
    expect(out.draftRequestId).toBe(DRAFT_REQUEST);
    expect(out.replayed).toBe(false);
    expect(out.reasonCodes).toEqual([]);
    // Thread-linked idempotency: agent_thread:<threadId>:<digest>.
    expect(out.idempotencyKey).toBe(`agent_thread:${THREAD}:abc123abc123abc1`);
    // The draft admission carries the exact opportunity version plus intent.
    expect(seam.drafts.requestDraft).toHaveBeenCalledTimes(1);
    expect(seam.drafts.requestDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        actorId: ACTOR,
        opportunityId: OPPORTUNITY,
        opportunityVersion: 2,
        actionKey: "campaign.governed_draft_v1",
        objective: "Lift weekday-evening gross profit",
        audience: "Families within a 15-minute drive",
        idempotencyKey: `agent_thread:${THREAD}:abc123abc123abc1`,
      }),
    );
    // Frozen evidence snapshot: verbatim digest, stamped freeze time.
    expect(out.frozenEvidence.digest).toBe("0123456789abcdef");
    expect(out.frozenEvidence.snapshot.citations).toEqual(["ledger:2026-09-01:2026-09-20"]);
    expect(out.frozenEvidence.frozenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Thread → request link via the set_thread_links seam.
    expect(seam.links.setThreadLinks).toHaveBeenCalledTimes(1);
    expect(seam.links.setThreadLinks).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      actorId: ACTOR,
      threadId: THREAD,
      draftRequestId: DRAFT_REQUEST,
    });
    // Markers track requested → claimed → draft-ready with the Bundle link.
    expect(out.markers.map((marker) => marker.stage)).toEqual([
      "requested",
      "claimed",
      "draft-ready",
    ]);
    expect(out.bundleLink.href).toContain("/campaigns");
    expect(out.bundleLink.ref.draftRequestId).toBe(DRAFT_REQUEST);
    // Estimate labeled on the draft path too.
    expect(out.estimate.label).toBe("Estimate");
    expect(out.adviceFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("replays the kept request without admitting twice", async () => {
    const seam = seams();
    seam.drafts.requestDraft.mockResolvedValue({
      outcome: "replayed",
      requestId: DRAFT_REQUEST,
      draftRequestStatus: "pending",
    });
    const out = await adviseCampaign(eligibleInput(), seam);

    expect(out.outcome).toBe("draft_requested");
    if (out.outcome !== "draft_requested") throw new Error("expected draft_requested");
    expect(out.replayed).toBe(true);
    expect(out.draftRequestId).toBe(DRAFT_REQUEST);
    expect(seam.drafts.requestDraft).toHaveBeenCalledTimes(1);
  });

  it("forwards sibling link ids and the correlation id through the handoff seams", async () => {
    const seam = seams();
    const input = {
      ...eligibleInput(),
      correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      existingLinks: {
        projectId: "11111111-1111-4111-8111-111111111111",
        requestId: "22222222-2222-4222-8222-222222222222",
      },
    };
    const out = await adviseCampaign(input, seam);

    expect(out.outcome).toBe("draft_requested");
    // The draft admission carries the caller's correlation id so the
    // admission and the thread link share one trail.
    expect(seam.drafts.requestDraft).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
    );
    // Sibling ids ride along: the links RPC overwrites every link column,
    // so dropping them would wipe the thread → research chain.
    expect(seam.links.setThreadLinks).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      actorId: ACTOR,
      threadId: THREAD,
      draftRequestId: DRAFT_REQUEST,
      projectId: "11111111-1111-4111-8111-111111111111",
      requestId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("reports the admitted plan with no seams wired, creating nothing", async () => {
    const out = await adviseCampaign(eligibleInput());

    expect(out.outcome).toBe("draft_requested");
    if (out.outcome !== "draft_requested") throw new Error("expected draft_requested");
    expect(out.draftRequestId).toBe("pending");
    expect(out.idempotencyKey).toBe(`agent_thread:${THREAD}:abc123abc123abc1`);
  });
});

describe("campaign advice helpers", () => {
  it("checks eligibility deterministically from permission plus readiness", () => {
    expect(
      checkCampaignAdviceEligibility({ ...eligibleInput(), permissions: [] }).reasonCodes,
    ).toEqual(["CAMPAIGN_REQUIRES_CREATE"]);
    const full = checkCampaignAdviceEligibility(eligibleInput());
    expect(full).toEqual({ eligible: true, reasonCodes: [] });
  });

  it("labels estimates with inputs and assumptions, never as realized results", () => {
    const labeled = labelCampaignEstimate(eligibleInput().estimate);
    expect(labeled.kind).toBe("estimate");
    expect(labeled.label).toBe("Estimate");
    expect(labeled.inputs).toEqual(["weekday-evening covers, last 30 days"]);
    expect(labeled.assumptions).toEqual(["no menu-price change during the window"]);
  });

  it("freezes a verbatim copy of the evidence snapshot", () => {
    const snapshot = eligibleInput().evidenceSnapshot;
    const frozen = freezeEvidenceSnapshot(snapshot, new Date("2026-09-24T12:00:00.000Z"));
    expect(frozen.digest).toBe(snapshot.digest);
    expect(frozen.frozenAt).toBe("2026-09-24T12:00:00.000Z");
    expect(frozen.snapshot).toEqual(snapshot);
    expect(frozen.snapshot).not.toBe(snapshot);
  });

  it("tracks Marker receipts requested → claimed → draft-ready", () => {
    expect(buildCampaignMarkerReceipts("requested").map((marker) => marker.state)).toEqual([
      "active",
      "pending",
      "pending",
    ]);
    expect(buildCampaignMarkerReceipts("draft-ready").map((marker) => marker.state)).toEqual([
      "done",
      "done",
      "active",
    ]);
    expect(() =>
      buildCampaignMarkerReceipts("published" as never),
    ).toThrowErrorMatchingInlineSnapshot(`[DomainError: Please check the submitted fields.]`);
  });

  it("links the Campaign Bundle review, pointing at the campaign once it exists", () => {
    const pending = campaignBundleLink(ORGANIZATION, { draftRequestId: DRAFT_REQUEST });
    expect(pending.href).toBe(`/organizations/${ORGANIZATION}/campaigns`);
    expect(pending.ref).toEqual({ draftRequestId: DRAFT_REQUEST, campaignId: null });
    const ready = campaignBundleLink(ORGANIZATION, {
      draftRequestId: DRAFT_REQUEST,
      campaignId: "55555555-5555-4555-8555-555555555555",
    });
    expect(ready.href).toBe(
      "/organizations/00000000-0000-4000-8000-000000000000/campaigns/55555555-5555-4555-8555-555555555555",
    );
  });

  it("prefills the brief URL with intent plus reason codes", () => {
    const url = buildPrefilledBriefUrl({
      organizationId: ORGANIZATION,
      objective: "Lift demand",
      audience: "Neighbors",
      reasonCodes: ["CAMPAIGN_REQUIRES_CREATE"],
    });
    expect(url).toContain("/campaigns/new?");
    const params = new URL(url, "https://example.test").searchParams;
    expect(params.get("objective")).toBe("Lift demand");
    expect(params.get("audience")).toBe("Neighbors");
    expect(params.get("reason")).toBe("CAMPAIGN_REQUIRES_CREATE");
  });

  it("invalidates on material edits and only on material edits", () => {
    const advice = {
      objective: "Lift demand",
      audience: "Neighbors",
      assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
      evidenceDigest: "0123456789abcdef",
    };
    expect(fingerprintAdviceDraft(advice)).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintAdviceDraft(advice)).toBe(fingerprintAdviceDraft({ ...advice }));
    expect(isMaterialAdviceChange(advice, { ...advice, audience: "Tourists" })).toBe(true);
    expect(isMaterialAdviceChange(advice, { ...advice, evidenceDigest: "ffffffffffffffff" })).toBe(
      true,
    );
    expect(isMaterialAdviceChange(advice, { ...advice })).toBe(false);
  });
});
