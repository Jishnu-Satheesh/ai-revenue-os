import { describe, expect, it, vi } from "vitest";

import {
  backfillCoverageUnavailable,
  buildCoverageReport,
  buildDuplicateWatchCard,
  buildMarkerReceipts,
  buildProfileScopeQueries,
  buildThreadIdempotencyKey,
  COVERAGE_STATUSES,
  createPreparedWatch,
  detectScopeWidening,
  encodeQuestionnaireAnswerBody,
  executeResearchOnce,
  executeWatchCreate,
  executeWatchUpdate,
  freshWatchTitleFor,
  giResearchLink,
  isTerminalRequestStatus,
  matchWatchCandidate,
  messageDigestFor,
  prepareWatchCreate,
  requestWatchFromChoice,
  resolvePackContextDigest,
  resolveResearchLaneGate,
  resolveWatchBranchId,
  submitQuestionnaireAnswers,
  validateQuestionnaireAnswers,
  WATCH_EVIDENCE_WINDOW_DAYS,
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

// ---------------------------------------------------------------------------
// Task B4: auto-prepared watches behind one tap
// ---------------------------------------------------------------------------

const B4_BRANCH_ROWS = [
  { id: "22222222-2222-4222-8222-222222222222", name: "Deira" },
  { id: "55555555-5555-4555-8555-555555555555", name: "Marina" },
];

const B4_EXPLICIT = {
  question: "What are nearby competitors offering for National Day?",
  researchArea: "Deira",
};

describe("prepareWatchCreate (B4 pre-fill)", () => {
  it("pins the evidence window default at 30 days with the assumption stated inline", () => {
    expect(WATCH_EVIDENCE_WINDOW_DAYS).toBe(30);
    const out = prepareWatchCreate(B4_EXPLICIT, {
      branchRows: [{ id: "22222222-2222-4222-8222-222222222222", name: "Deira" }],
    });
    if (!out.ok) throw new Error("expected prepared payload");
    expect(out.evidenceWindowDays).toBe(30);
    expect(out.assumptions.join("\n")).toMatch(/last 30 days/);
  });

  it("prefers explicit card answers and defaults the rest with assumptions", () => {
    const out = prepareWatchCreate(
      {
        ...B4_EXPLICIT,
        branch: "22222222-2222-4222-8222-222222222222",
        cadence: "daily",
        title: "National Day watch",
        endDate: "2026-12-31",
      },
      { branchRows: B4_BRANCH_ROWS },
    );
    if (!out.ok) throw new Error("expected prepared payload");
    expect(out.payload.branchId).toBe("22222222-2222-4222-8222-222222222222");
    expect(out.payload.title).toBe("National Day watch");
    expect(out.payload.mode).toBe("recurring");
    expect(out.payload.schedule).toMatchObject({ cadence: "daily", endDate: "2026-12-31" });
    expect(out.payload.researchArea).toBe("Deira");
    // Areas default to the full set with the assumption stated — never a silent guess.
    expect(out.payload.investigationAreas).toEqual([
      "demand",
      "presence",
      "offers",
      "reviews",
      "observable_performance",
    ]);
    expect(out.assumptions.join("\n")).toMatch(/all five/);
    // No explicit cadence default was needed (daily came from the card).
    expect(out.assumptions.join("\n")).not.toMatch(/weekly/i);
  });

  it("defaults cadence, schedule, and mode with assumptions when the card is silent", () => {
    const out = prepareWatchCreate(B4_EXPLICIT, {
      branchRows: [{ id: "22222222-2222-4222-8222-222222222222", name: "Deira" }],
    });
    if (!out.ok) throw new Error("expected prepared payload");
    expect(out.payload.schedule).toMatchObject({
      cadence: "weekly",
      localTime: "09:00",
      timeZone: "UTC",
    });
    expect(out.assumptions.join("\n")).toMatch(/weekly/i);
    expect(out.assumptions.join("\n")).toMatch(/09:00/);
    expect(out.assumptions.join("\n")).toMatch(/UTC/);
  });

  it("takes the schedule timezone from the pack when the pack carries one", () => {
    const out = prepareWatchCreate(B4_EXPLICIT, {
      branchRows: [{ id: "22222222-2222-4222-8222-222222222222", name: "Deira" }],
      pack: { branchTimezone: "Asia/Dubai" },
    });
    if (!out.ok) throw new Error("expected prepared payload");
    expect(out.payload.schedule?.timeZone).toBe("Asia/Dubai");
    expect(out.assumptions.join("\n")).not.toMatch(/UTC/);
  });

  it("carries pack competitors and records a card-named competitor as an operator lead", () => {
    const out = prepareWatchCreate(
      { ...B4_EXPLICIT, competitorName: "Nearby Diner" },
      {
        branchRows: [{ id: "22222222-2222-4222-8222-222222222222", name: "Deira" }],
        pack: {
          competitors: [
            { name: "Pack Rival", website: "https://rival.example", source: "suggestion" },
          ],
        },
      },
    );
    if (!out.ok) throw new Error("expected prepared payload");
    expect(out.payload.competitors).toEqual([
      { name: "Pack Rival", website: "https://rival.example/", source: "suggestion" },
      { name: "Nearby Diner", source: "operator_lead" },
    ]);
  });

  it("derives the title from the question and refuses to invent question, branch, or area", () => {
    const titled = prepareWatchCreate(
      { question: `${"word ".repeat(30).trim()}?`, researchArea: "Deira" },
      { branchRows: [{ id: "22222222-2222-4222-8222-222222222222", name: "Deira" }] },
    );
    if (!titled.ok) throw new Error("expected prepared payload");
    expect(titled.payload.title.length).toBeLessThanOrEqual(200);

    // No question anywhere: no payload, the missing field is named.
    const noQuestion = prepareWatchCreate(
      { researchArea: "Deira" },
      { branchRows: [{ id: "22222222-2222-4222-8222-222222222222", name: "Deira" }] },
    );
    expect(noQuestion.ok).toBe(false);
    if (noQuestion.ok) throw new Error("expected needs-input");
    expect(noQuestion.missing).toContain("question");

    // Two branches and no branch answer: ambiguous, never guessed.
    const noBranch = prepareWatchCreate(B4_EXPLICIT, { branchRows: B4_BRANCH_ROWS });
    expect(noBranch.ok).toBe(false);
    if (noBranch.ok) throw new Error("expected needs-input");
    expect(noBranch.missing).toContain("branch");

    // No research area: named, never derived from the question text.
    const noArea = prepareWatchCreate(
      { question: B4_EXPLICIT.question },
      { branchRows: [{ id: "22222222-2222-4222-8222-222222222222", name: "Deira" }] },
    );
    expect(noArea.ok).toBe(false);
    if (noArea.ok) throw new Error("expected needs-input");
    expect(noArea.missing).toContain("researchArea");
  });
});

describe("resolveWatchBranchId (B4)", () => {
  it("binds a uuid answer that names a live branch, and refuses an unknown uuid", () => {
    const hit = resolveWatchBranchId(
      B4_BRANCH_ROWS,
      "22222222-2222-4222-8222-222222222222",
    );
    expect(hit).toEqual({
      ok: true,
      branchId: "22222222-2222-4222-8222-222222222222",
      assumption: null,
    });
    expect(
      resolveWatchBranchId(B4_BRANCH_ROWS, "99999999-9999-4999-8999-999999999999").ok,
    ).toBe(false);
  });

  it("matches a branch name case-insensitively and refuses ambiguous or unknown names", () => {
    expect(resolveWatchBranchId(B4_BRANCH_ROWS, "  deira ")).toEqual({
      ok: true,
      branchId: "22222222-2222-4222-8222-222222222222",
      assumption: null,
    });
    expect(resolveWatchBranchId(B4_BRANCH_ROWS, "nowhere").ok).toBe(false);
    const dupes = [
      { id: "22222222-2222-4222-8222-222222222222", name: "Deira" },
      { id: "55555555-5555-4555-8555-555555555555", name: "deira" },
    ];
    expect(resolveWatchBranchId(dupes, "Deira").ok).toBe(false);
  });

  it("binds the only branch with an assumption, and refuses silence among many", () => {
    const single = resolveWatchBranchId([
      { id: "22222222-2222-4222-8222-222222222222", name: "Deira" },
    ]);
    expect(single.ok).toBe(true);
    if (!single.ok) throw new Error("expected bound branch");
    expect(single.branchId).toBe("22222222-2222-4222-8222-222222222222");
    expect(single.assumption).toMatch(/only one branch/);
    expect(resolveWatchBranchId(B4_BRANCH_ROWS).ok).toBe(false);
    expect(resolveWatchBranchId([]).ok).toBe(false);
    // Malformed rows are skipped, never papered over.
    expect(
      resolveWatchBranchId([{ id: "not-a-uuid", name: "Deira" }, null, "Deira"]).ok,
    ).toBe(false);
  });
});

describe("freshWatchTitleFor (B4)", () => {
  it("mints a deterministic distinct title that stays within the length cap", () => {
    const first = freshWatchTitleFor("National Day watch", "agent_thread:thread:abcdef1234567890");
    const second = freshWatchTitleFor("National Day watch", "agent_thread:thread:abcdef1234567890");
    expect(first).toBe(second);
    expect(first).not.toBe("National Day watch");
    expect(first.length).toBeLessThanOrEqual(200);
    const other = freshWatchTitleFor("National Day watch", "agent_thread:thread:0000000000000001");
    expect(other).not.toBe(first);
    const long = freshWatchTitleFor("w".repeat(200), "agent_thread:thread:abcdef1234567890");
    expect(long.length).toBeLessThanOrEqual(200);
  });
});

const B4_CHOICE_BASE = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  actorId: "actor-1",
  threadId: "thread-1",
  idempotencyKey: "watch-press-key-0000000000000001",
  permissions: ["growth_intelligence.manage"],
  candidateProjectId: null as string | null,
  existingLinks: {},
};

// The missing-fields create takes no candidate: same base minus that key
// (the strict input schema rejects unrecognized keys).
const B4_CREATE_BASE = {
  organizationId: B4_CHOICE_BASE.organizationId,
  actorId: B4_CHOICE_BASE.actorId,
  threadId: B4_CHOICE_BASE.threadId,
  idempotencyKey: B4_CHOICE_BASE.idempotencyKey,
  permissions: B4_CHOICE_BASE.permissions,
  existingLinks: B4_CHOICE_BASE.existingLinks,
};

function b4Prepared() {
  const out = prepareWatchCreate(
    { ...B4_EXPLICIT, branch: "22222222-2222-4222-8222-222222222222" },
    { branchRows: B4_BRANCH_ROWS },
  );
  if (!out.ok) throw new Error("expected prepared payload");
  return out;
}

describe("requestWatchFromChoice (B4 one-tap)", () => {
  it("refuses without the manage grant before touching any seam", async () => {
    const prepared = b4Prepared();
    const watchProjects = {
      listActive: vi.fn(async () => []),
      createKeyed: vi.fn(async () => ({ projectId: "p1", replayed: false })),
    };
    const links = { setThreadLinks: vi.fn(async () => ({})) };
    const out = await requestWatchFromChoice(
      {
        ...B4_CHOICE_BASE,
        permissions: [],
        choice: "start_fresh",
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
      },
      { watchProjects, links },
    );
    expect(out.outcome).toBe("blocked");
    if (out.outcome !== "blocked") throw new Error("expected blocked");
    expect(out.reasonCode).toBe("WATCH_REQUIRES_MANAGE");
    expect(out.copy).toMatch(/growth_intelligence\.manage/);
    expect(watchProjects.listActive).not.toHaveBeenCalled();
    expect(watchProjects.createKeyed).not.toHaveBeenCalled();
    expect(links.setThreadLinks).not.toHaveBeenCalled();
  });

  it("cancels and views without writing anything", async () => {
    const prepared = b4Prepared();
    const watchProjects = {
      listActive: vi.fn(async () => []),
      createKeyed: vi.fn(async () => ({ projectId: "p1", replayed: false })),
    };
    const cancelled = await requestWatchFromChoice(
      {
        ...B4_CHOICE_BASE,
        choice: "cancel",
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
      },
      { watchProjects },
    );
    expect(cancelled).toEqual({ outcome: "cancelled" });
    expect(watchProjects.listActive).not.toHaveBeenCalled();
    expect(watchProjects.createKeyed).not.toHaveBeenCalled();

    const viewed = await requestWatchFromChoice(
      {
        ...B4_CHOICE_BASE,
        choice: "view_existing",
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
        candidateProjectId: "44444444-4444-4434-8434-444444444444",
      },
      { watchProjects },
    );
    expect(viewed.outcome).toBe("view_existing");
    if (viewed.outcome !== "view_existing") throw new Error("expected view");
    expect(viewed.projectId).toBe("44444444-4444-4434-8434-444444444444");
    expect(viewed.link.href).toContain("/growth-intelligence");
    expect(watchProjects.createKeyed).not.toHaveBeenCalled();
  });

  it("creates a second watch with a distinct fingerprint behind start_fresh and links the thread", async () => {
    const prepared = b4Prepared();
    const createKeyed = vi.fn(async () => ({ projectId: "p2", replayed: false }));
    const setThreadLinks = vi.fn(async () => ({}));
    const out = await requestWatchFromChoice(
      {
        ...B4_CHOICE_BASE,
        choice: "start_fresh",
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
        candidateProjectId: "44444444-4444-4434-8434-444444444444",
      },
      { watchProjects: { listActive: async () => [], createKeyed }, links: { setThreadLinks } },
    );
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") throw new Error(`expected created, got ${out.outcome}`);
    expect(out.projectId).toBe("p2");
    expect(out.scopeFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(out.evidenceWindowDays).toBe(30);
    expect(out.assumptions.length).toBeGreaterThan(0);
    // The fresh title — and therefore the fingerprint — differs from the twin's.
    const createCalls = createKeyed.mock.calls as unknown as Array<[{ title?: string }]>;
    expect(createCalls[0]?.[0]?.title).not.toBe(prepared.payload.title);
    expect(setThreadLinks).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", projectId: "p2" }),
    );
  });

  it("converges honestly when a twin appears between the card and the tap", async () => {
    const prepared = b4Prepared();
    const twinTitle = freshWatchTitleFor(
      prepared.payload.title,
      B4_CHOICE_BASE.idempotencyKey,
    );
    const twin = {
      projectId: "p9",
      title: twinTitle,
      question: prepared.payload.question,
      mode: "recurring" as const,
      scopeFingerprint: "0".repeat(64),
    };
    const createKeyed = vi.fn(async () => ({ projectId: "p2", replayed: false }));
    const out = await requestWatchFromChoice(
      {
        ...B4_CHOICE_BASE,
        choice: "start_fresh",
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
        candidateProjectId: "44444444-4444-4434-8434-444444444444",
      },
      { watchProjects: { listActive: async () => [twin], createKeyed } },
    );
    expect(out.outcome).toBe("duplicate");
    expect(createKeyed).not.toHaveBeenCalled();
  });

  it("applies in-place edits behind update_fields and links the watched project", async () => {
    const prepared = b4Prepared();
    const project = {
      title: prepared.payload.title,
      question: prepared.payload.question,
      mode: "recurring" as const,
      branchId: prepared.payload.branchId,
      schedule: { cadence: "weekly" as const, localTime: "09:00", timeZone: "UTC" },
    };
    const updateWatch = vi.fn(async () => ({
      projectId: "44444444-4444-4434-8434-444444444444",
      revisionNumber: 2,
      replayed: false,
    }));
    const setThreadLinks = vi.fn(async () => ({}));
    const out = await requestWatchFromChoice(
      {
        ...B4_CHOICE_BASE,
        choice: "update_fields",
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
        candidateProjectId: "44444444-4444-4434-8434-444444444444",
        cardEdits: { frequency: "daily", endDate: "2026-12-31" },
      },
      {
        watchProjects: {
          listActive: async () => [],
          createKeyed: async () => ({ projectId: "p2", replayed: false }),
          readProject: async () => project,
          readBrief: async () => BRIEF,
          updateWatch,
        },
        links: { setThreadLinks },
      },
    );
    expect(out.outcome).toBe("updated");
    if (out.outcome !== "updated") throw new Error(`expected updated, got ${out.outcome}`);
    expect(out.appliedFields).toEqual(expect.arrayContaining(["frequency", "endDate"]));
    expect(setThreadLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        projectId: "44444444-4444-4434-8434-444444444444",
      }),
    );
  });

  it("routes widening edits to a profile proposal instead of applying them", async () => {
    const prepared = b4Prepared();
    const project = {
      title: prepared.payload.title,
      question: prepared.payload.question,
      mode: "recurring" as const,
      branchId: prepared.payload.branchId,
      schedule: { cadence: "weekly" as const, localTime: "09:00", timeZone: "UTC" },
    };
    const updateWatch = vi.fn(async () => ({
      projectId: "44444444-4444-4434-8434-444444444444",
      revisionNumber: 2,
      replayed: false,
    }));
    const out = await requestWatchFromChoice(
      {
        ...B4_CHOICE_BASE,
        choice: "update_fields",
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
        candidateProjectId: "44444444-4444-4434-8434-444444444444",
        cardEdits: { competitorName: "Brand-new Rival" },
      },
      {
        watchProjects: {
          listActive: async () => [],
          createKeyed: async () => ({ projectId: "p2", replayed: false }),
          readProject: async () => project,
          readBrief: async () => BRIEF,
          updateWatch,
        },
      },
    );
    expect(out.outcome).toBe("profile_scope_change");
    expect(updateWatch).not.toHaveBeenCalled();
  });

  it("blocks the update honestly when the watch cannot be loaded", async () => {
    const prepared = b4Prepared();
    const updateWatch = vi.fn(async () => ({
      projectId: "p",
      revisionNumber: 1,
      replayed: false,
    }));
    const unreadable = await requestWatchFromChoice(
      {
        ...B4_CHOICE_BASE,
        choice: "update_fields",
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
        candidateProjectId: "44444444-4444-4434-8434-444444444444",
        cardEdits: { frequency: "daily" },
      },
      {
        watchProjects: {
          listActive: async () => [],
          createKeyed: async () => ({ projectId: "p2", replayed: false }),
          readProject: async () => null,
          readBrief: async () => null,
          updateWatch,
        },
      },
    );
    expect(unreadable.outcome).toBe("update_blocked");
    expect(updateWatch).not.toHaveBeenCalled();

    const noCandidate = await requestWatchFromChoice(
      {
        ...B4_CHOICE_BASE,
        choice: "update_fields",
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
        candidateProjectId: null,
        cardEdits: { frequency: "daily" },
      },
      { watchProjects: { listActive: async () => [], createKeyed: async () => ({ projectId: "p2", replayed: false }) } },
    );
    expect(noCandidate.outcome).toBe("update_blocked");
  });
});

describe("matchWatchCandidate (B4 server-side candidate)", () => {
  const SIBLINGS = [
    {
      projectId: "44444444-4444-4434-8434-444444444444",
      branchId: "22222222-2222-4222-8222-222222222222",
      title: "Lunch watch",
      question: "Keep watching lunch prices downtown",
      mode: "recurring",
    },
    {
      projectId: "55555555-5555-4555-8555-555555555555",
      branchId: "55555555-5555-4555-8555-555555555555",
      title: "Dinner watch",
      question: "Keep watching dinner prices downtown",
      mode: "recurring",
    },
  ];

  it("binds the unique question match, and nothing else", () => {
    expect(matchWatchCandidate(SIBLINGS, { question: "Keep watching lunch prices downtown" })).toBe(
      "44444444-4444-4434-8434-444444444444",
    );
    expect(matchWatchCandidate(SIBLINGS, { question: "  Keep watching lunch prices downtown " })).toBe(
      "44444444-4444-4434-8434-444444444444",
    );
    expect(matchWatchCandidate(SIBLINGS, { question: "another question" })).toBeNull();
  });

  it("uses the branch filter to disambiguate, and refuses ambiguity", () => {
    const dupes = [
      ...SIBLINGS,
      {
        projectId: "66666666-6666-4666-8666-666666666666",
        branchId: "66666666-6666-4666-8666-666666666666",
        title: "Lunch watch (second branch)",
        question: "Keep watching lunch prices downtown",
        mode: "recurring",
      },
    ];
    // Two branches ask the same question: no branch filter, no binding.
    expect(matchWatchCandidate(dupes, { question: "Keep watching lunch prices downtown" })).toBeNull();
    expect(
      matchWatchCandidate(dupes, {
        question: "Keep watching lunch prices downtown",
        branchId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toBe("44444444-4444-4434-8434-444444444444");
    // Malformed rows are skipped, never matched.
    expect(
      matchWatchCandidate(
        [...SIBLINGS, null, { projectId: "x" }, "lunch"],
        { question: "Keep watching lunch prices downtown" },
      ),
    ).toBe("44444444-4444-4434-8434-444444444444");
  });
});

describe("requestWatchFromChoice prepared payload (B4)", () => {
  it("updates without a prepared payload but never fresh-creates without one", async () => {
    const project = {
      title: "Lunch watch",
      question: "Keep watching lunch prices downtown",
      mode: "recurring" as const,
      branchId: "22222222-2222-4222-8222-222222222222",
      schedule: { cadence: "weekly" as const, localTime: "09:00", timeZone: "UTC" },
    };
    const updated = await requestWatchFromChoice(
      {
        ...B4_CHOICE_BASE,
        choice: "update_fields",
        candidateProjectId: "44444444-4444-4434-8434-444444444444",
        cardEdits: { frequency: "daily" },
      },
      {
        watchProjects: {
          readProject: async () => project,
          readBrief: async () => BRIEF,
          updateWatch: async () => ({
            projectId: "44444444-4444-4434-8434-444444444444",
            revisionNumber: 2,
            replayed: false,
          }),
        },
      },
    );
    expect(updated.outcome).toBe("updated");

    await expect(
      requestWatchFromChoice(
        {
          ...B4_CHOICE_BASE,
          choice: "start_fresh",
          candidateProjectId: "44444444-4444-4434-8434-444444444444",
        },
        { watchProjects: { listActive: async () => [] } },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("createPreparedWatch (B4 missing-fields one-tap)", () => {
  it("creates behind a single submit and links thread to project", async () => {
    const prepared = b4Prepared();
    const createKeyed = vi.fn(async () => ({ projectId: "p1", replayed: false }));
    const setThreadLinks = vi.fn(async () => ({}));
    const out = await createPreparedWatch(
      {
        ...B4_CREATE_BASE,
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
      },
      { watchProjects: { listActive: async () => [], createKeyed }, links: { setThreadLinks } },
    );
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") throw new Error("expected created");
    expect(out.evidenceWindowDays).toBe(30);
    expect(setThreadLinks).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", projectId: "p1" }),
    );
  });

  it("returns the duplicate card instead of forking when a twin exists", async () => {
    const prepared = b4Prepared();
    const twin = {
      projectId: "p1",
      title: prepared.payload.title,
      question: prepared.payload.question,
      mode: "recurring" as const,
      scopeFingerprint: "0".repeat(64),
    };
    const createKeyed = vi.fn(async () => ({ projectId: "p2", replayed: false }));
    const out = await createPreparedWatch(
      {
        ...B4_CREATE_BASE,
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
      },
      { watchProjects: { listActive: async () => [twin], createKeyed } },
    );
    expect(out.outcome).toBe("duplicate");
    if (out.outcome !== "duplicate") throw new Error("expected duplicate");
    expect(out.card.kind).toBe("duplicate_watch");
    expect(createKeyed).not.toHaveBeenCalled();
  });

  it("refuses without the manage grant before touching any seam", async () => {
    const prepared = b4Prepared();
    const listActive = vi.fn(async () => []);
    const out = await createPreparedWatch(
      {
        ...B4_CREATE_BASE,
        permissions: [],
        prepared: prepared.payload,
        assumptions: prepared.assumptions,
      },
      {
        watchProjects: {
          listActive,
          createKeyed: async () => ({ projectId: "p2", replayed: false }),
        },
      },
    );
    expect(out.outcome).toBe("blocked");
    expect(listActive).not.toHaveBeenCalled();
  });
});
