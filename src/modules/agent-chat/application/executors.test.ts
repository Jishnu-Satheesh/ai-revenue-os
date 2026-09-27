import { describe, expect, it, vi } from "vitest";

import {
  backfillCoverageUnavailable,
  buildCoverageReport,
  buildDuplicateWatchCard,
  buildMarkerReceipts,
  buildProfileScopeQueries,
  buildThreadIdempotencyKey,
  COVERAGE_STATUSES,
  detectScopeWidening,
  encodeQuestionnaireAnswerBody,
  executeResearchOnce,
  executeWatchCreate,
  executeWatchUpdate,
  giResearchLink,
  isTerminalRequestStatus,
  messageDigestFor,
  resolvePackContextDigest,
  resolveResearchLaneGate,
  submitQuestionnaireAnswers,
  validateQuestionnaireAnswers,
} from "@/modules/agent-chat/application/executors";
import { MONITORING_COVERAGE_STATUSES } from "@/modules/growth-intelligence/application/market-monitoring-update";
import { fingerprintMonitoringScope } from "@/modules/growth-intelligence/application/market-monitoring-update";
import type { QuestionnaireSpec } from "@/domain/agent-router/contracts";

describe("research once gating", () => {
  it("fails closed with zero spend when gate shut", async () => {
    const out = await executeResearchOnce({
      gates: { keyPresent: false, enabled: false, qualified: false },
      budget: { reserved: 0 },
    });
    expect(out.outcome).toBe("blocked");
  });
});

describe("resolveResearchLaneGate", () => {
  it("names the first missing requirement in credential → switch → qualification order", () => {
    expect(
      resolveResearchLaneGate({ keyPresent: false, enabled: false, qualified: false }),
    ).toEqual({
      open: false,
      reasonCode: "CREDENTIAL_MISSING",
      copy: expect.any(String),
    });
    expect(resolveResearchLaneGate({ keyPresent: true, enabled: false, qualified: false })).toEqual(
      {
        open: false,
        reasonCode: "LANE_DISABLED",
        copy: expect.any(String),
      },
    );
    expect(resolveResearchLaneGate({ keyPresent: true, enabled: true, qualified: false })).toEqual({
      open: false,
      reasonCode: "PROVIDER_NOT_QUALIFIED",
      copy: expect.any(String),
    });
    expect(resolveResearchLaneGate({ keyPresent: true, enabled: true, qualified: true })).toEqual({
      open: true,
    });
  });
});

describe("thread-linked idempotency", () => {
  it("keys work as agent_thread:<threadId>:<messageDigest>", () => {
    expect(buildThreadIdempotencyKey("t1", "abc123")).toBe("agent_thread:t1:abc123");
  });

  it("digests stably per message and distinctly per body", () => {
    const first = messageDigestFor({ threadId: "t", messageId: "m", body: "hello" });
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(messageDigestFor({ threadId: "t", messageId: "m", body: "hello" })).toBe(first);
    expect(messageDigestFor({ threadId: "t", messageId: "m", body: "other" })).not.toBe(first);
  });
});

describe("executeResearchOnce blocked lane", () => {
  const base = {
    organizationId: "o",
    threadId: "t",
    messageId: "m",
    messageBody: "research the lunch crowd",
    gates: { keyPresent: false, enabled: false, qualified: false },
  };

  it("touches no seam and reports zero spend with internal-only synthesis", async () => {
    const budget = { reserveRequestBudget: vi.fn(async () => ({ quoteMicrosUsd: 0 })) };
    const requests = {
      findKept: vi.fn(async () => null),
      getStatus: vi.fn(async () => null),
      enqueue: vi.fn(async () => ({ requestId: "r", replayed: false })),
    };
    const dispatch = vi.fn(async () => ({ requestId: "r", replayed: false }));
    const out = await executeResearchOnce({ ...base, budget } as never, {
      budget,
      requests,
      dispatch,
    });
    expect(out.outcome).toBe("blocked");
    if (out.outcome !== "blocked") throw new Error("expected blocked");
    expect(out.spentMicrosUsd).toBe(0);
    expect(out.synthesis.mode).toBe("internal-only");
    expect(out.synthesis.limitations.length).toBeGreaterThan(0);
    expect(out.markers.some((marker) => marker.stage === "blocked")).toBe(true);
    expect(budget.reserveRequestBudget).not.toHaveBeenCalled();
    expect(requests.enqueue).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("blocks without a bound profile pointer even when the lane is open", async () => {
    const dispatch = vi.fn(async () => ({ requestId: "r", replayed: false }));
    const out = await executeResearchOnce(
      {
        organizationId: "o",
        threadId: "t",
        messageId: "m",
        messageBody: "hi",
        gates: { keyPresent: true, enabled: true, qualified: true },
      },
      { dispatch },
    );
    expect(out.outcome).toBe("blocked");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("blocks on a moved profile version even when the lane is open", async () => {
    const out = await executeResearchOnce(
      {
        organizationId: "o",
        threadId: "t",
        messageId: "m",
        messageBody: "hi",
        profileVersion: { versionId: "v1", digest: "d1" },
        gates: { keyPresent: true, enabled: true, qualified: true },
      },
      {
        profiles: {
          readVersion: async () => ({ versionId: "v2", digest: "d2", document: {}, enabled: true }),
        },
      },
    );
    expect(out.outcome).toBe("blocked");
    if (out.outcome !== "blocked") throw new Error("expected blocked");
    expect(out.spentMicrosUsd).toBe(0);
  });
});

describe("executeResearchOnce open lane", () => {
  const open = {
    organizationId: "o",
    threadId: "t",
    messageId: "m",
    messageBody: "research the lunch crowd",
    profileVersion: { versionId: "v1", digest: "d1" },
    gates: { keyPresent: true, enabled: true, qualified: true },
  };

  it("reserves before dispatching and keys dispatch thread-linked", async () => {
    const order: string[] = [];
    const seams = {
      requests: {
        findKept: async () => null,
        getStatus: async () => null,
        enqueue: async () => {
          order.push("enqueue");
          return { requestId: "r1", replayed: false };
        },
      },
      budget: {
        reserveRequestBudget: async () => {
          order.push("reserve");
          return { quoteMicrosUsd: 1_000_000 };
        },
      },
      dispatch: async (args: { idempotencyKey: string }) => {
        order.push("dispatch");
        expect(args.idempotencyKey).toBe(
          `agent_thread:t:${messageDigestFor({ threadId: "t", messageId: "m", body: open.messageBody })}`,
        );
        return { requestId: "r1", replayed: false };
      },
    };
    const out = await executeResearchOnce(open, seams);
    expect(outcomeOf(out)).toBe("dispatched");
    expect(order).toEqual(["enqueue", "reserve", "dispatch"]);
  });

  it("returns kept rows on replay and never reopens terminal rows", async () => {
    const dispatch = vi.fn(async () => ({ requestId: "r1", replayed: false }));
    const terminal = await executeResearchOnce(open, {
      requests: {
        findKept: async () => ({ requestId: "r1", status: "succeeded" }),
        getStatus: async () => "succeeded",
        enqueue: async () => ({ requestId: "r1", replayed: true }),
      },
      dispatch,
    });
    expect(terminal.outcome).toBe("kept");
    expect(dispatch).not.toHaveBeenCalled();

    const running = await executeResearchOnce(open, {
      requests: {
        findKept: async () => ({ requestId: "r2", status: "pending" }),
        getStatus: async () => "pending",
        enqueue: async () => ({ requestId: "r2", replayed: true }),
      },
      dispatch,
    });
    expect(running.outcome).toBe("replayed");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  function outcomeOf(out: { outcome: string }): string {
    return out.outcome;
  }
});

describe("profile-scope queries", () => {
  const document = {
    publicBusinessName: "Cedar Bakery",
    approvedDomains: ["cedar-bakery.example"],
    niches: ["artisan bakery"],
    city: "Springfield",
    countryCode: "US",
    topics: ["sourdough pricing", "morning footfall"],
    competitors: [{ name: "Rival Loaf" }],
  };

  it("builds bounded queries from profile scope only", () => {
    const queries = buildProfileScopeQueries(document);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.length).toBeLessThanOrEqual(8);
    for (const query of queries) {
      expect(query).toContain("Springfield");
    }
  });

  it("never carries tenant or customer data and never guesses on bad scope", () => {
    const queries = buildProfileScopeQueries(document);
    const joined = queries.join(" ");
    expect(joined).not.toContain("organization");
    expect(joined).not.toContain("branch");
    expect(buildProfileScopeQueries({ nope: true })).toEqual([]);
    expect(buildProfileScopeQueries(null)).toEqual([]);
  });
});

describe("coverage honesty", () => {
  it("matches the watch-lane coverage vocabulary exactly", () => {
    expect([...COVERAGE_STATUSES].sort()).toEqual([...MONITORING_COVERAGE_STATUSES].sort());
  });

  it("reports exactly one status per requested dimension", () => {
    const entries = buildCoverageReport(
      [
        { kind: "investigation_area", key: "demand", label: "Demand" },
        { kind: "competitor", key: "rival", label: "Rival Loaf" },
      ],
      { demand: "supported" },
    );
    expect(entries).toEqual([
      { kind: "investigation_area", key: "demand", label: "Demand", status: "supported" },
      { kind: "competitor", key: "rival", label: "Rival Loaf", status: "not-researched" },
    ]);
  });

  it("backfills failure to unavailable, never to supported", () => {
    const entries = backfillCoverageUnavailable(
      buildCoverageReport([{ kind: "investigation_area", key: "demand", label: "Demand" }]),
    );
    expect(entries[0]?.status).toBe("unavailable");
  });
});

describe("markers and links", () => {
  it("walks queued → done with one active stage", () => {
    const receipts = buildMarkerReceipts("searching");
    expect(receipts.map((marker) => marker.stage)).toEqual([
      "queued",
      "claimed",
      "searching",
      "grading",
      "synthesis",
      "done",
    ]);
    expect(receipts.filter((marker) => marker.state === "active")).toHaveLength(1);
  });

  it("links Markers to the GI page with the row id in the receipt", () => {
    const link = giResearchLink("org-1", { requestId: "req-1" });
    expect(link.href).toBe("/organizations/org-1/growth-intelligence");
    expect(link.ref.requestId).toBe("req-1");
  });
});

describe("terminal rows", () => {
  it("treats succeeded/failed/cancelled as terminal only", () => {
    expect(isTerminalRequestStatus("succeeded")).toBe(true);
    expect(isTerminalRequestStatus("failed")).toBe(true);
    expect(isTerminalRequestStatus("cancelled")).toBe(true);
    expect(isTerminalRequestStatus("pending")).toBe(false);
    expect(isTerminalRequestStatus("claimed")).toBe(false);
  });
});

const WATCH = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  actorId: "actor-1",
  branchId: "22222222-2222-4222-8222-222222222222",
  question: "What are nearby competitors offering for National Day?",
  mode: "recurring" as const,
  schedule: {
    cadence: "weekly" as const,
    localTime: "09:00",
    timeZone: "UTC",
  },
  researchArea: "Deira",
  competitors: [],
  investigationAreas: ["demand"] as (
    | "demand"
    | "presence"
    | "offers"
    | "reviews"
    | "observable_performance"
  )[],
  idempotencyKey: "watch-press-key-0000000000000001",
};

describe("executeWatchCreate", () => {
  it("creates when no similar active scope exists", async () => {
    const seams = {
      listActive: async () => [],
      createKeyed: async () => ({ projectId: "p1", replayed: false }),
    };
    const out = await executeWatchCreate(WATCH, seams);
    expect(outcomeIs(out, "created")).toBe(true);
    if (out.outcome !== "created") throw new Error("expected created");
    expect(out.projectId).toBe("p1");
    expect(out.scopeFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(out.link.ref.projectId).toBe("p1");
  });

  it("pauses creation on a similar active scope with the duplicate card", async () => {
    const twin = {
      projectId: "p1",
      title: WATCH.question,
      question: WATCH.question,
      mode: "recurring" as const,
      scopeFingerprint: "0".repeat(64),
    };
    const createKeyed = vi.fn(async () => ({ projectId: "p2", replayed: false }));
    const out = await executeWatchCreate(WATCH, { listActive: async () => [twin], createKeyed });
    expect(out.outcome).toBe("duplicate");
    if (out.outcome !== "duplicate") throw new Error("expected duplicate");
    expect(createKeyed).not.toHaveBeenCalled();
    expect(out.card.kind).toBe("duplicate_watch");
  });

  it("pre-empts a same-fingerprint sibling under another title (finding 2)", async () => {
    const sibling = {
      projectId: "p9",
      title: "A differently worded watch",
      question: "Something else entirely?",
      mode: "recurring" as const,
      scopeFingerprint: null as string | null,
    };
    const createKeyed = vi.fn(async () => ({ projectId: "p2", replayed: false }));
    const created = await executeWatchCreate(
      WATCH,
      { listActive: async () => [sibling], createKeyed },
    );
    // A null fingerprint cannot match: creation proceeds to the keyed
    // fence, which stays authoritative.
    expect(created.outcome).toBe("created");

    const sameScope = fingerprintMonitoringScope({
      organizationId: WATCH.organizationId,
      branchId: WATCH.branchId,
      title: WATCH.question,
      question: WATCH.question,
      mode: WATCH.mode,
      schedule: WATCH.schedule,
      researchArea: WATCH.researchArea,
      competitors: WATCH.competitors,
      investigationAreas: [...WATCH.investigationAreas],
      businessContextSnapshotId: "00000000-0000-0000-0000-000000000000",
      frequency: "weekly",
    });
    const fingerprinted = { ...sibling, scopeFingerprint: sameScope };
    const createKeyedAgain = vi.fn(async () => ({ projectId: "p2", replayed: false }));
    const out = await executeWatchCreate(
      WATCH,
      { listActive: async () => [fingerprinted], createKeyed: createKeyedAgain },
    );
    expect(out.outcome).toBe("duplicate");
    if (out.outcome !== "duplicate") throw new Error("expected duplicate");
    expect(createKeyedAgain).not.toHaveBeenCalled();
    expect(out.card.kind).toBe("duplicate_watch");
  });

  function outcomeIs(out: { outcome: string }, want: string): boolean {
    return out.outcome === want;
  }
});

describe("buildDuplicateWatchCard", () => {
  it("offers View/Update/Start-fresh/Cancel with explicit start-fresh confirm", () => {
    const card = buildDuplicateWatchCard({
      intent: "watch",
      page: "overview",
      contextDigest: "abcdef1234567890",
      projectId: "p1",
    });
    expect(card.kind).toBe("duplicate_watch");
    expect(card.resumeKey).toMatch(/^router:watch:[a-z0-9]+:[a-z0-9]+$/);
    const choice = card.items.find((item) => item.key === "choice");
    expect(choice?.options?.map((option) => option.value)).toEqual([
      "view_existing",
      "update_fields",
      "start_fresh",
      "cancel",
    ]);
    const editable = card.items.map((item) => item.key);
    expect(editable).toEqual(
      expect.arrayContaining([
        "frequency",
        "branch",
        "research_area",
        "competitors",
        "end_date",
        "confirm_start_fresh",
      ]),
    );
    // Research-area and competitor edits never apply in place: their help
    // text says they propose a Market Profile update instead.
    const researchArea = card.items.find((item) => item.key === "research_area");
    const competitors = card.items.find((item) => item.key === "competitors");
    expect(researchArea?.required).toBe(false);
    expect(competitors?.required).toBe(false);
    expect(researchArea?.helpText).toMatch(/Market Profile update/);
    expect(competitors?.helpText).toMatch(/valid public HTTP or HTTPS URL/);
  });
});

const BRIEF = {
  revisionId: "33333333-3333-4333-8333-333333333333",
  projectId: "44444444-4444-4434-8434-444444444444",
  organizationId: "11111111-1111-4111-8111-111111111111",
  revisionNumber: 1,
  question: "What are nearby competitors offering?",
  locationId: "22222222-2222-4222-8222-222222222222",
  researchArea: "Deira",
  competitors: [],
  investigationAreas: ["demand"] as (
    | "demand"
    | "presence"
    | "offers"
    | "reviews"
    | "observable_performance"
  )[],
  evidencePeriods: [],
  businessContextSnapshotId: "00000000-0000-0000-0000-000000000000",
  frequency: "weekly" as const,
  pinnedToUpdateId: null,
  createdAtUtc: "2026-09-25T10:00:00.000Z",
};

describe("executeWatchUpdate scope rule", () => {
  const PROJECT = {
    title: "National Day watch",
    question: "What are nearby competitors offering?",
    mode: "recurring" as const,
    branchId: "22222222-2222-4222-8222-222222222222",
    schedule: {
      cadence: "weekly" as const,
      localTime: "09:00",
      timeZone: "UTC",
    },
  };
  const head = {
    organizationId: BRIEF.organizationId,
    actorId: "actor-1",
    projectId: BRIEF.projectId,
    project: PROJECT,
    brief: BRIEF,
    idempotencyKey: "watch-update-key-00000000000001",
  };

  it("routes a new competitor to profile_scope_change, never silent widening", async () => {
    const out = await executeWatchUpdate({
      ...head,
      edits: { competitors: [{ name: "Rival Loaf", source: "operator_lead" }] },
    });
    expect(out.outcome).toBe("profile_scope_change");
    if (out.outcome !== "profile_scope_change") throw new Error("expected scope change");
    expect(out.proposal.addedCompetitors).toEqual(["rival loaf"]);
  });

  it("routes a new topic to profile_scope_change", async () => {
    const out = await executeWatchUpdate({
      ...head,
      edits: { investigationAreas: ["demand", "offers"] },
    });
    expect(out.outcome).toBe("profile_scope_change");
    if (out.outcome !== "profile_scope_change") throw new Error("expected scope change");
    expect(out.proposal.addedTopics).toEqual(["offers"]);
  });

  it("applies in-place edits through the fenced update seam", async () => {
    const updateWatch = vi.fn(async () => ({
      projectId: BRIEF.projectId,
      revisionNumber: 2,
      replayed: false,
    }));
    const out = await executeWatchUpdate(
      { ...head, edits: { frequency: "daily", endDate: "2026-12-31" } },
      { updateWatch },
    );
    expect(out.outcome).toBe("updated");
    if (out.outcome !== "updated") throw new Error("expected updated");
    expect(out.appliedFields).toEqual(["frequency", "endDate"]);
    expect(out.revisionNumber).toBe(2);
    expect(out.scopeFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(updateWatch).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: expect.objectContaining({ cadence: "daily", endDate: "2026-12-31" }),
        branchId: PROJECT.branchId,
        scopeFingerprint: out.scopeFingerprint,
      }),
    );
  });

  it("short-circuits a no-change update without touching the seam", async () => {
    const updateWatch = vi.fn();
    const out = await executeWatchUpdate({ ...head, edits: {} }, { updateWatch });
    expect(out.outcome).toBe("updated");
    if (out.outcome !== "updated") throw new Error("expected updated");
    expect(out.replayed).toBe(true);
    expect(out.appliedFields).toEqual([]);
    expect(updateWatch).not.toHaveBeenCalled();
  });

  it("fails closed without an update seam", async () => {
    const out = await executeWatchUpdate({ ...head, edits: { frequency: "daily" } });
    expect(out.outcome).toBe("update_blocked");
    if (out.outcome !== "update_blocked") throw new Error("expected blocked");
    expect(out.reasonCode).toBe("WATCH_UPDATE_UNAVAILABLE");
  });

  it("refuses schedule edits on one-time watches", async () => {
    await expect(
      executeWatchUpdate({
        ...head,
        project: { ...PROJECT, mode: "one-time" },
        edits: { frequency: "daily" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("detects research-area moves as widening", () => {
    const widening = detectScopeWidening(BRIEF, { researchArea: "Marina Walk" });
    expect(widening.widened).toBe(true);
    expect(widening.researchAreaChanged).toBe(true);
    expect(detectScopeWidening(BRIEF, { frequency: "daily" }).widened).toBe(false);
  });
});

const SPEC: QuestionnaireSpec = {
  kind: "missing_fields",
  title: "One more detail",
  resumeKey: "router:watch:overview:abcdef1234567890",
  items: [
    {
      key: "frequency",
      label: "How often?",
      kind: "single_select",
      required: true,
      options: [
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
      ],
    },
    { key: "end_date", label: "Stop?", kind: "date", required: false },
  ],
};

describe("questionnaire answers (F2)", () => {
  it("validates required items and live option values", () => {
    expect(validateQuestionnaireAnswers(SPEC, { frequency: "weekly" })).toEqual({
      frequency: "weekly",
    });
    expect(() => validateQuestionnaireAnswers(SPEC, {})).toThrow(/How often/);
    expect(() => validateQuestionnaireAnswers(SPEC, { frequency: "hourly" })).toThrow(/How often/);
    expect(() =>
      validateQuestionnaireAnswers(SPEC, { frequency: "weekly", end_date: "soon" }),
    ).toThrow(/Stop/);
  });

  it("encodes answers deterministically for the appended message", () => {
    const body = encodeQuestionnaireAnswerBody(SPEC, { frequency: "weekly" });
    expect(body).toBe("[answers missing_fields]\nfrequency: weekly");
  });

  it("persists answers server-side and re-triggers routing", async () => {
    const threads = {
      getThread: vi.fn(async () => ({ id: "t1" })),
      appendMessageKeyed: vi.fn(async () => ({ messageId: "m9", threadId: "t1", replayed: false })),
      getMessage: vi.fn(async () => ({})),
    };
    const reroute = vi.fn(async () => ({ intent: "watch", questionnaire: null, routingNote: "n" }));
    const out = await submitQuestionnaireAnswers(
      {
        organizationId: "o",
        actorId: "u",
        role: "operator",
        threadId: "t1",
        spec: SPEC,
        answers: { frequency: "weekly" },
        idempotencyKey: "answers-key-0000000000000001",
        page: "overview",
      },
      { threads: threads as never, reroute },
    );
    expect(threads.appendMessageKeyed).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        body: "[answers missing_fields]\nfrequency: weekly",
        idempotencyKey: "answers-key-0000000000000001",
      }),
    );
    expect(reroute).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "answers-key-0000000000000001:reroute" }),
    );
    expect(out.intent).toBe("watch");
    expect(out.messageId).toBe("m9");
  });

  it("refuses viewers before touching persistence", async () => {
    const threads = {
      getThread: vi.fn(async () => ({ id: "t1" })),
      appendMessageKeyed: vi.fn(async () => ({ messageId: "m9", threadId: "t1", replayed: false })),
      getMessage: vi.fn(async () => ({})),
    };
    const reroute = vi.fn();
    await expect(
      submitQuestionnaireAnswers(
        {
          organizationId: "o",
          actorId: "u",
          role: "viewer",
          threadId: "t1",
          spec: SPEC,
          answers: { frequency: "weekly" },
          idempotencyKey: "answers-key-0000000000000002",
        },
        { threads: threads as never, reroute },
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(threads.appendMessageKeyed).not.toHaveBeenCalled();
  });
});

const IDEAS_SPEC: QuestionnaireSpec = {
  kind: "campaign_ideas",
  title: "Campaign ideas",
  resumeKey: "router:campaign_advice:overview:abc123",
  items: [
    {
      key: "idea",
      label: "Which idea should become a draft?",
      kind: "single_select",
      required: true,
      options: [
        {
          value: "idea-a",
          label: "Lunch rush bundle",
          description: "Noon combo for nearby offices.",
          recommended: false,
        },
        {
          value: "idea-b",
          label: "Weekend family table",
          description: "Saturday set menu for families.",
          recommended: true,
        },
        {
          value: "idea-c",
          label: "Late-night dessert",
          description: "After-9pm dessert counter.",
          recommended: false,
        },
      ],
    },
  ],
};

describe("campaign_ideas answers (Task 5)", () => {
  it("validates the picked idea against the echoed-spec options", () => {
    expect(validateQuestionnaireAnswers(IDEAS_SPEC, { idea: "idea-b" })).toEqual({
      idea: "idea-b",
    });
    expect(() => validateQuestionnaireAnswers(IDEAS_SPEC, {})).toThrow(
      /Which idea should become a draft/,
    );
    expect(() => validateQuestionnaireAnswers(IDEAS_SPEC, { idea: "idea-z" })).toThrow(
      /Which idea should become a draft/,
    );
  });

  it("encodes the pick under the ideas header for the appended message", () => {
    expect(encodeQuestionnaireAnswerBody(IDEAS_SPEC, { idea: "idea-b" })).toBe(
      "[answers campaign_ideas]\nidea: idea-b",
    );
  });
});

describe("resolvePackContextDigest", () => {
  it("returns the real pack digest off the V1 placeholder", async () => {
    const { digest, pack } = await resolvePackContextDigest({
      organizationId: "o",
      userId: "u",
      page: "overview",
      windowDays: 30,
      now: new Date("2026-09-25T10:00:00.000Z"),
    });
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
    expect(pack.digest).toBe(digest);
    expect(pack.refused).toBe(false);
  });
});
