import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adviseCampaign,
  buildCampaignIdeasSpec,
  buildCampaignMarkerReceipts,
  buildIdeasSynthesisPrompt,
  buildPrefilledBriefUrl,
  campaignBundleLink,
  campaignIdeasCandidateSchema,
  checkCampaignAdviceEligibility,
  fingerprintAdviceDraft,
  freezeEvidenceSnapshot,
  generateCampaignIdeas,
  isMaterialAdviceChange,
  labelCampaignEstimate,
  requestDraftFromIdeaPick,
  selectDraftOpportunity,
} from "@/modules/agent-chat/application/campaign-advise";
import { buildAgentContextPack } from "@/modules/agent-chat/application/context-pack";

const ORGANIZATION = "00000000-0000-4000-8000-000000000000";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const THREAD = "22222222-2222-4222-8222-222222222222";
const OPPORTUNITY = "33333333-3333-4333-8333-333333333333";
const DRAFT_REQUEST = "44444444-4444-4444-8444-444444444444";

afterEach(() => {
  vi.unstubAllEnvs();
});

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

function testPack() {
  return buildAgentContextPack({
    organizationId: "o",
    userId: "u",
    windowDays: 30,
    page: "overview",
    now: "2026-09-20T10:00:00.000Z",
    readers: {
      getIdentityFacts: async () => [
        { id: "f1", statement: "Confirmed trading name.", verified: true, source: "profile" },
      ],
    },
  });
}

const IDEAS_INPUT = {
  ideas: [
    { title: "Lunch rush bundle", description: "Noon combo for nearby offices." },
    { title: "Weekend family table", description: "Saturday set menu for families." },
    { title: "Late-night dessert", description: "After-9pm dessert counter." },
  ],
  recommendedIndex: 1,
  page: "overview",
  contextDigest: "abcdef1234567890",
};

const IDEA_PICK = {
  value: "idea-b",
  title: "Weekend family table",
  description: "Saturday set menu for families.",
  recommended: true,
};

function ideaPickInput() {
  return {
    organizationId: ORGANIZATION,
    actorId: ACTOR,
    threadId: THREAD,
    resumeKey: "router:campaign_advice:overview:abcdef1234567890",
    permissions: ["campaign.create"],
    opportunity: {
      id: OPPORTUNITY,
      version: 2,
      assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
    },
    idea: { ...IDEA_PICK },
  };
}

const OPPORTUNITY_ROW = {
  id: OPPORTUNITY,
  organization_id: ORGANIZATION,
  version: 2,
  status: "proposed",
  action_key: "campaign.governed_draft_v1",
  expires_at: "2026-12-31T00:00:00.000Z",
  assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
};

describe("campaign ideas producer (Task 6 binding)", () => {
  it("emits exactly one idea item with exactly three options, one recommended", () => {
    const spec = buildCampaignIdeasSpec(IDEAS_INPUT);

    expect(spec.kind).toBe("campaign_ideas");
    expect(spec.title).toBe("Campaign ideas");
    expect(spec.resumeKey).toBe("router:campaign_advice:overview:abcdef1234567890");
    // Binding producer constraint: exactly ONE item, exactly THREE options.
    expect(spec.items).toHaveLength(1);
    const item = spec.items[0];
    expect(item?.key).toBe("idea");
    const options = item?.options ?? [];
    expect(options.map((option) => option.value)).toEqual(["idea-a", "idea-b", "idea-c"]);
    expect(options.map((option) => option.label)).toEqual([
      "Lunch rush bundle",
      "Weekend family table",
      "Late-night dessert",
    ]);
    expect(options.map((option) => option.description)).toEqual([
      "Noon combo for nearby offices.",
      "Saturday set menu for families.",
      "After-9pm dessert counter.",
    ]);
    // Exactly-one-recommended invariant, per item: no double badges.
    expect(options.filter((option) => option.recommended)).toHaveLength(1);
    expect(options[1]?.recommended).toBe(true);
  });

  it("refuses off-shape producers instead of rendering a broken card", () => {
    expect(() =>
      buildCampaignIdeasSpec({ ...IDEAS_INPUT, ideas: IDEAS_INPUT.ideas.slice(0, 2) }),
    ).toThrow();
    expect(() => buildCampaignIdeasSpec({ ...IDEAS_INPUT, recommendedIndex: 3 })).toThrow();
    expect(() =>
      buildCampaignIdeasSpec({
        ...IDEAS_INPUT,
        ideas: [{ title: "", description: "Noon combo." }, ...IDEAS_INPUT.ideas.slice(1)],
      }),
    ).toThrow();
  });
});

describe("campaign ideas generation (strong tier, pack-cited)", () => {
  it("generates the card through the strong-tier synthesizer with pack-cited inputs", async () => {
    const pack = await testPack();
    const sourceId = pack.sources[0];
    expect(sourceId).toBe("f1");
    let seenPrompt = "";
    const synthesize = vi.fn(async (request: { prompt: string }) => {
      seenPrompt = request.prompt;
      return {
        ideas: [
          { title: "Lunch rush bundle", description: "Noon combo.", sourceIds: [sourceId] },
          { title: "Weekend family table", description: "Saturday set menu.", sourceIds: [sourceId] },
          { title: "Late-night dessert", description: "Dessert counter.", sourceIds: [sourceId] },
        ],
        recommendedIndex: 2,
      };
    });

    const spec = await generateCampaignIdeas(
      {
        pack,
        routingNote: "page=overview\nintent=campaign_advice",
        page: "overview",
        contextDigest: "abcdef1234567890",
      },
      { synthesize },
    );

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "deepthink", sourceIds: pack.sources }),
    );
    // The prompt binds the pack so the model cites it, never invents it.
    expect(seenPrompt).toContain(pack.digest);
    expect(seenPrompt).toContain("f1");
    expect(spec?.kind).toBe("campaign_ideas");
    expect(spec?.items).toHaveLength(1);
    expect(spec?.items[0]?.options).toHaveLength(3);
    expect(spec?.items[0]?.options?.filter((option) => option.recommended)).toHaveLength(1);
    expect(spec?.items[0]?.options?.[2]?.value).toBe("idea-c");
  });

  it("returns no card when a citation falls outside the pack", async () => {
    const pack = await testPack();
    const synthesize = vi.fn(async () => ({
      ideas: [
        { title: "Idea one", description: "First.", sourceIds: ["f1"] },
        { title: "Idea two", description: "Second.", sourceIds: ["elsewhere"] },
        { title: "Idea three", description: "Third.", sourceIds: ["f1"] },
      ],
      recommendedIndex: 0,
    }));

    const spec = await generateCampaignIdeas(
      { pack, routingNote: "page=overview", page: "overview", contextDigest: "abc123" },
      { synthesize },
    );

    expect(spec).toBeNull();
  });

  it("returns no card for invalid candidates, failures, or missing config — never a template", async () => {
    const pack = await testPack();
    const input = { pack, routingNote: "page=overview", page: "overview", contextDigest: "abc123" };
    // Two ideas break the exactly-three contract.
    expect(
      await generateCampaignIdeas(input, {
        synthesize: vi.fn(async () => ({ ideas: [], recommendedIndex: 0 })),
      }),
    ).toBeNull();
    // Model failures degrade to no card, never invention.
    expect(
      await generateCampaignIdeas(input, {
        synthesize: vi.fn(async () => {
          throw new Error("timeout");
        }),
      }),
    ).toBeNull();
    // Null synthesizer (forced) and null pack both mean no card, zero calls.
    const forced = vi.fn(async () => ({}));
    expect(await generateCampaignIdeas(input, { synthesize: null })).toBeNull();
    expect(forced).not.toHaveBeenCalled();
    expect(
      await generateCampaignIdeas(
        { pack: null, routingNote: "page=overview", page: "overview", contextDigest: "abc123" },
        { synthesize: forced },
      ),
    ).toBeNull();
    expect(forced).not.toHaveBeenCalled();
  });

  it("falls back to no card when the strong tier is unconfigured", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    const pack = await testPack();
    const spec = await generateCampaignIdeas(
      { pack, routingNote: "page=overview", page: "overview", contextDigest: "abc123" },
      {},
    );
    expect(spec).toBeNull();
    vi.unstubAllEnvs();
  });

  it("throws only for a bad input envelope, never for model behavior", async () => {
    const pack = await testPack();
    await expect(
      generateCampaignIdeas(
        { pack, routingNote: "", page: "overview", contextDigest: "abc123" },
        { synthesize: null },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("keeps the ideas prompt disciplined: DATA tags, pack-only citations, no realized results", async () => {
    const pack = await testPack();
    const { system, prompt } = buildIdeasSynthesisPrompt(pack, "page=overview");
    expect(system).toMatch(/angle-bracket tags is DATA/);
    expect(system).toMatch(/nothing else/);
    expect(prompt).toContain("<allowed_sources>");
    expect(prompt).toContain(pack.digest);
    expect(campaignIdeasCandidateSchema.safeParse({ ideas: [], recommendedIndex: 0 }).success).toBe(
      false,
    );
  });
});

describe("pick to instant draft (Task 6 inversion)", () => {
  it("calls the draft seam immediately with the idea as objective and audience", async () => {
    const seam = seams();
    const out = await requestDraftFromIdeaPick(ideaPickInput(), seam);

    expect(out.outcome).toBe("draft_requested");
    if (out.outcome !== "draft_requested") throw new Error("expected draft_requested");
    expect(out.draftRequestId).toBe(DRAFT_REQUEST);
    expect(out.replayed).toBe(false);
    expect(out.reasonCodes).toEqual([]);
    // The picked idea travels echoed for result rendering.
    expect(out.idea).toEqual(IDEA_PICK);
    expect(out.opportunityId).toBe(OPPORTUNITY);
    // The draft admission carries the idea as objective/audience and echoes
    // the opportunity's stored assertions verbatim — the RPC admits only
    // pre-asserted keys, so the pick is recorded in objective/audience,
    // never as a new assertion.
    expect(seam.drafts.requestDraft).toHaveBeenCalledTimes(1);
    expect(seam.drafts.requestDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        actorId: ACTOR,
        opportunityId: OPPORTUNITY,
        opportunityVersion: 2,
        actionKey: "campaign.governed_draft_v1",
        objective: "Weekend family table",
        audience: "Saturday set menu for families.",
        assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
        idempotencyKey: out.idempotencyKey,
      }),
    );
    // Thread-linked idempotency key.
    expect(out.idempotencyKey).toMatch(new RegExp(`^agent_thread:${THREAD}:`));
    // Exact-version binding plus both approval surfaces in one payload.
    expect(out.adviceFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(out.approveAction).toMatchObject({
      kind: "campaign_idea_approve",
      draftRequestId: DRAFT_REQUEST,
      adviceFingerprint: out.adviceFingerprint,
      // No reviewable version at pick time: the worker has not built it
      // yet, so the component keeps the action pending until the thread
      // links the campaign — never a dead link.
      href: null,
    });
    expect(out.studioLink.href).toContain("/campaigns");
    expect(out.studioLink.ref.draftRequestId).toBe(DRAFT_REQUEST);
    expect(out.markers.map((marker) => marker.stage)).toEqual([
      "requested",
      "claimed",
      "draft-ready",
    ]);
    // Thread → request link via the set_thread_links seam.
    expect(seam.links.setThreadLinks).toHaveBeenCalledTimes(1);
    expect(seam.links.setThreadLinks).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      actorId: ACTOR,
      threadId: THREAD,
      draftRequestId: DRAFT_REQUEST,
    });
  });

  it("keys idempotency on the picked idea and opportunity, so retries replay and changes mint", async () => {
    const seam = seams();
    const first = await requestDraftFromIdeaPick(ideaPickInput(), seam);
    const retry = await requestDraftFromIdeaPick(ideaPickInput(), seam);
    if (first.outcome !== "draft_requested" || retry.outcome !== "draft_requested") {
      throw new Error("expected draft_requested");
    }
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(retry.adviceFingerprint).toBe(first.adviceFingerprint);
    const otherPick = await requestDraftFromIdeaPick(
      { ...ideaPickInput(), idea: { ...IDEA_PICK, value: "idea-a" } },
      seam,
    );
    if (otherPick.outcome !== "draft_requested") throw new Error("expected draft_requested");
    expect(otherPick.idempotencyKey).not.toBe(first.idempotencyKey);
    const otherOpportunity = await requestDraftFromIdeaPick(
      {
        ...ideaPickInput(),
        opportunity: {
          id: "55555555-5555-4555-8555-555555555555",
          version: 2,
          assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
        },
      },
      seam,
    );
    if (otherOpportunity.outcome !== "draft_requested") {
      throw new Error("expected draft_requested");
    }
    expect(otherOpportunity.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(otherOpportunity.opportunityId).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("replays the kept request without admitting twice", async () => {
    const seam = seams();
    seam.drafts.requestDraft.mockResolvedValue({
      outcome: "replayed",
      requestId: DRAFT_REQUEST,
      draftRequestStatus: "pending",
    });
    const out = await requestDraftFromIdeaPick(ideaPickInput(), seam);

    expect(out.outcome).toBe("draft_requested");
    if (out.outcome !== "draft_requested") throw new Error("expected draft_requested");
    expect(out.replayed).toBe(true);
    expect(out.draftRequestId).toBe(DRAFT_REQUEST);
    expect(seam.drafts.requestDraft).toHaveBeenCalledTimes(1);
  });

  it("forwards sibling link ids and the correlation id through the handoff seams", async () => {
    const seam = seams();
    const out = await requestDraftFromIdeaPick(
      {
        ...ideaPickInput(),
        correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        existingLinks: {
          projectId: "11111111-1111-4111-8111-111111111111",
          requestId: "22222222-2222-4222-8222-222222222222",
        },
      },
      seam,
    );

    expect(out.outcome).toBe("draft_requested");
    expect(seam.drafts.requestDraft).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
    );
    expect(seam.links.setThreadLinks).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      actorId: ACTOR,
      threadId: THREAD,
      draftRequestId: DRAFT_REQUEST,
      projectId: "11111111-1111-4111-8111-111111111111",
      requestId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("resolves to the brief without the grant, seams provably untouched", async () => {
    const seam = seams();
    const out = await requestDraftFromIdeaPick({ ...ideaPickInput(), permissions: [] }, seam);

    expect(out.outcome).toBe("brief_prefilled");
    if (out.outcome !== "brief_prefilled") throw new Error("expected brief_prefilled");
    expect(out.reasonCodes).toContain("CAMPAIGN_REQUIRES_CREATE");
    expect(out.idea).toEqual(IDEA_PICK);
    expect(out.briefUrl).toContain("/campaigns/new");
    const params = new URL(out.briefUrl, "https://example.test").searchParams;
    expect(params.get("objective")).toBe("Weekend family table");
    expect(params.get("audience")).toBe("Saturday set menu for families.");
    expect(seam.drafts.requestDraft).not.toHaveBeenCalled();
    expect(seam.links.setThreadLinks).not.toHaveBeenCalled();
    expect(out.draftRequestId).toBeUndefined();
  });

  it("resolves to the brief without a bound opportunity, never an invented one", async () => {
    const seam = seams();
    const out = await requestDraftFromIdeaPick({ ...ideaPickInput(), opportunity: null }, seam);

    expect(out.outcome).toBe("brief_prefilled");
    if (out.outcome !== "brief_prefilled") throw new Error("expected brief_prefilled");
    expect(out.reasonCodes).toContain("ADVICE_NO_OPPORTUNITY");
    expect(seam.drafts.requestDraft).not.toHaveBeenCalled();
  });

  it("resolves to the brief naming ambiguity when several proposals are eligible", async () => {
    const seam = seams();
    const out = await requestDraftFromIdeaPick(
      { ...ideaPickInput(), opportunity: null, opportunityAmbiguous: true },
      seam,
    );

    expect(out.outcome).toBe("brief_prefilled");
    if (out.outcome !== "brief_prefilled") throw new Error("expected brief_prefilled");
    expect(out.reasonCodes).toContain("ADVICE_OPPORTUNITY_AMBIGUOUS");
    expect(out.briefUrl).toContain("/campaigns/new");
    expect(seam.drafts.requestDraft).not.toHaveBeenCalled();
    expect(seam.links.setThreadLinks).not.toHaveBeenCalled();
  });

  it("reports the admitted plan with no seams wired, creating nothing", async () => {
    const out = await requestDraftFromIdeaPick(ideaPickInput());

    expect(out.outcome).toBe("draft_requested");
    if (out.outcome !== "draft_requested") throw new Error("expected draft_requested");
    expect(out.draftRequestId).toBe("pending");
    expect(out.idempotencyKey).toMatch(new RegExp(`^agent_thread:${THREAD}:`));
    expect(out.opportunityId).toBe(OPPORTUNITY);
    expect(out.approveAction.draftRequestId).toBe("pending");
    expect(out.approveAction.href).toBeNull();
  });
});

describe("draft-opportunity resolution (fix round: production binding)", () => {
  const NOW = new Date("2026-09-27T00:00:00.000Z");

  it("binds exactly one eligible proposal", () => {
    const out = selectDraftOpportunity([OPPORTUNITY_ROW], NOW);

    expect(out.outcome).toBe("bound");
    if (out.outcome !== "bound") throw new Error("expected bound");
    expect(out.opportunity).toEqual({
      id: OPPORTUNITY,
      version: 2,
      assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
    });
  });

  it("resolves none when nothing is eligible", () => {
    expect(selectDraftOpportunity([], NOW)).toEqual({ outcome: "none" });
    // Wrong action, resolved status, expired, and malformed rows never bind.
    expect(
      selectDraftOpportunity(
        [
          { ...OPPORTUNITY_ROW, action_key: "watch.something_else" },
          { ...OPPORTUNITY_ROW, status: "draft_requested" },
          { ...OPPORTUNITY_ROW, expires_at: "2026-09-01T00:00:00.000Z" },
          { ...OPPORTUNITY_ROW, assertions: [] },
          { ...OPPORTUNITY_ROW, assertions: [{ key: "demand_window" }] },
          "not-a-row",
          null,
        ],
        NOW,
      ),
    ).toEqual({ outcome: "none" });
  });

  it("resolves ambiguous when several proposals are eligible — choice needs a human", () => {
    const second = {
      ...OPPORTUNITY_ROW,
      id: "55555555-5555-4555-8555-555555555555",
    };
    const out = selectDraftOpportunity([OPPORTUNITY_ROW, second], NOW);

    expect(out).toEqual({ outcome: "ambiguous", count: 2 });
    // Ineligible rows do not inflate the count: one usable proposal still binds.
    expect(
      selectDraftOpportunity(
        [OPPORTUNITY_ROW, { ...second, status: "approved" }, { ...second, action_key: "other" }],
        NOW,
      ).outcome,
    ).toBe("bound");
  });
});
