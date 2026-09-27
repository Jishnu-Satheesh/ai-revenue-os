import { describe, expect, it, vi } from "vitest";

import {
  createThreadService,
  permissionsForRole,
  routingContextDigest,
} from "@/modules/agent-chat/application/thread-service";
import type { ThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { DomainError } from "@/lib/errors";

const THREAD = {
  id: "t1",
  organizationId: "o",
  title: "Hi",
  mode: "quick",
  status: "open",
  linkedResearchProjectId: null,
  linkedRequestId: null,
  linkedDraftRequestId: null,
  linkedCampaignId: null,
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:00:00.000Z",
} as const;

const MESSAGE = {
  id: "m1",
  threadId: "t1",
  role: "user",
  body: "research the downtown lunch crowd",
  questionnaireAnswers: null,
  markerReceipts: null,
  citations: null,
  createdAt: "2026-09-25T10:01:00.000Z",
} as const;

function mockThreads(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    createThreadKeyed: vi.fn(async () => ({ threadId: "t1", status: "open", replayed: false })),
    appendMessageKeyed: vi.fn(async () => ({ messageId: "m1", threadId: "t1", replayed: false })),
    getThread: vi.fn(async () => ({ ...THREAD })),
    getMessage: vi.fn(async () => ({ ...MESSAGE })),
    latestUserMessage: vi.fn(async () => ({ ...MESSAGE })),
    listThreads: vi.fn(async () => ({ threads: [{ ...THREAD }], nextCursor: null })),
    listMessages: vi.fn(async () => ({ messages: [{ ...MESSAGE }], nextCursor: null })),
    ...overrides,
  } as unknown as ThreadRepository;
}

describe("thread service", () => {
  it("refuses thread creation for viewers before touching persistence", async () => {
    const threads = mockThreads();
    const service = createThreadService({ threads });
    await expect(
      service.createThread({
        organizationId: "o",
        actorId: "u",
        role: "viewer",
        idempotencyKey: "k-1234567890123456",
        mode: "quick",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(threads.createThreadKeyed).not.toHaveBeenCalled();
  });

  it("publishes agent_thread.opened only for fresh threads", async () => {
    const publish = vi.fn(async () => {});
    const threads = mockThreads();
    const fresh = createThreadService({ threads, events: { publish }, correlationId: "c" });
    const out = await fresh.createThread({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      idempotencyKey: "k-1234567890123456",
      mode: "quick",
    });
    expect(out.replayed).toBe(false);
    expect(out.thread.id).toBe("t1");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "agent_thread.opened" }),
    );

    const replayedThreads = mockThreads({
      createThreadKeyed: vi.fn(async () => ({ threadId: "t1", status: "open", replayed: true })),
    });
    const replayed = createThreadService({ threads: replayedThreads, events: { publish } });
    await replayed.createThread({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      idempotencyKey: "k-1234567890123456",
      mode: "quick",
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("appends as the user role and reads back the kept row", async () => {
    const publish = vi.fn(async () => {});
    const threads = mockThreads();
    const service = createThreadService({ threads, events: { publish } });
    const out = await service.appendUserMessage({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      idempotencyKey: "k-1234567890123456",
      body: "Hello",
    });
    expect(threads.appendMessageKeyed).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", body: "Hello" }),
    );
    expect(out.message.id).toBe("m1");
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "agent_message.appended" }),
    );
  });

  it("reads nothing for a foreign thread", async () => {
    const threads = mockThreads({ getThread: vi.fn(async () => null) });
    const service = createThreadService({ threads });
    await expect(
      service.appendUserMessage({
        organizationId: "o",
        actorId: "u",
        role: "operator",
        threadId: "foreign",
        idempotencyKey: "k-1234567890123456",
        body: "Hello",
      }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
  });

  it("routes the newest user message with the thread mode attached", async () => {
    const publish = vi.fn(async () => {});
    const threads = mockThreads();
    const service = createThreadService({
      threads,
      events: { publish },
      proposeRouter: async () => ({ intent: "research_once", confidence: "high", missing: [] }),
    });
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      page: "overview",
    });
    // Quick thread + research judgment: silent server-owned escalation,
    // not the retired upgrade nudge and not execution.
    expect(out.intent).toBe("research_once");
    expect(out.questionnaire).toBeNull();
    expect(out.thread.id).toBe("t1");
    expect(out.thread.mode).toBe("deepthink");
    // The routed result carries confidence + reason codes for the drawer
    // steps and the enriched route log line.
    expect(out.confidence).toBe("high");
    expect(out.reasonCodes).toEqual(expect.arrayContaining(["DEEPTHINK_AUTO_ESCALATED"]));
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "agent_thread.routed",
        payload: expect.objectContaining({ intent: "research_once" }),
      }),
    );
  });

  it("routes with no watch candidates, so no duplicate card can over-trigger", async () => {
    const threads = mockThreads();
    const service = createThreadService({
      threads,
      proposeRouter: async () => ({ intent: "answer_memory", confidence: "high", missing: [] }),
    });
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "viewer",
      threadId: "t1",
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.routingNote).toContain("active_watches=none");
  });

  it("fails closed when the proposer throws", async () => {
    const threads = mockThreads();
    const service = createThreadService({
      threads,
      proposeRouter: async () => {
        throw new Error("provider down");
      },
    });
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire?.kind).toBe("clarify");
  });

  it("refuses to route a thread with no readable message", async () => {
    const threads = mockThreads({ latestUserMessage: vi.fn(async () => null) });
    const service = createThreadService({ threads });
    await expect(
      service.routeLatest({ organizationId: "o", actorId: "u", role: "operator", threadId: "t1" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("derives permissions from the role, never from client claims", () => {
    expect(permissionsForRole("viewer")).toEqual([]);
    expect(permissionsForRole("operator")).toEqual([
      "growth_intelligence.manage",
      "campaign.create",
    ]);
    expect(permissionsForRole("owner")).toEqual(["growth_intelligence.manage", "campaign.create"]);
  });

  it("mints a stable opaque digest per message", () => {
    const first = routingContextDigest({ organizationId: "o", threadId: "t1", messageId: "m1" });
    const second = routingContextDigest({ organizationId: "o", threadId: "t1", messageId: "m1" });
    const other = routingContextDigest({ organizationId: "o", threadId: "t1", messageId: "m2" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(other).not.toBe(first);
  });

  it("digests the real pack when readers are bound (shape stable, values shift)", async () => {
    const threads = mockThreads();
    const service = createThreadService({
      threads,
      proposeRouter: async () => ({ intent: "answer_memory", confidence: "high", missing: [] }),
      contextReaders: {
        getIdentityFacts: async () => [
          { id: "f1", statement: "Confirmed trading name.", verified: true, source: "profile" },
        ],
      },
    });
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "viewer",
      threadId: "t1",
    });
    expect(out.replayed).toBe(false);
    expect(out.routingNote).toMatch(/context_digest=[0-9a-f]{16}/);
    // The pack digest means something now: it differs from the V1
    // per-message placeholder for the same thread + message.
    expect(out.routingNote).not.toContain(
      `context_digest=${routingContextDigest({ organizationId: "o", threadId: "t1", messageId: "m1" })}`,
    );
  });

  it("dedups route redispatch on the carried idempotency token (L4)", async () => {
    const publish = vi.fn(async () => {});
    const threads = mockThreads();
    const service = createThreadService({
      threads,
      events: { publish },
      proposeRouter: async () => ({ intent: "answer_memory", confidence: "high", missing: [] }),
    });
    const first = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "viewer",
      threadId: "t1",
      idempotencyKey: "route-token-000000000000001",
    });
    const second = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "viewer",
      threadId: "t1",
      idempotencyKey: "route-token-000000000000001",
    });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.intent).toBe(first.intent);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("persists questionnaire answers server-side and re-routes (F2)", async () => {
    const publish = vi.fn(async () => {});
    const threads = mockThreads();
    const service = createThreadService({
      threads,
      events: { publish },
      proposeRouter: async () => ({ intent: "answer_memory", confidence: "high", missing: [] }),
    });
    const spec = {
      kind: "missing_fields" as const,
      title: "One more detail",
      resumeKey: "router:watch:overview:abcdef1234567890",
      items: [
        {
          key: "frequency",
          label: "How often?",
          kind: "single_select" as const,
          required: true,
          options: [
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
          ],
        },
      ],
    };
    const out = await service.submitAnswers({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      spec,
      answers: { frequency: "weekly" },
      idempotencyKey: "answers-key-0000000000000001",
      page: "overview",
    });
    expect(threads.appendMessageKeyed).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        body: "[answers missing_fields]\nfrequency: weekly",
        idempotencyKey: "answers-key-0000000000000001",
      }),
    );
    expect(out.answers).toEqual({ frequency: "weekly" });
    expect(out.intent).toBe("answer_memory");
    // Slice C F2/M6: the re-route's fresh codes travel with the answers
    // result — never the previous turn's carried forward.
    expect(out.confidence).toBe("high");
    expect(out.reasonCodes).toEqual(["MODEL_PROPOSAL_ACCEPTED"]);
    // The answers append and the reroute each publish once.
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("reads one thread for the checkpoint poll, foreign as not-found (M9)", async () => {
    const threads = mockThreads();
    const service = createThreadService({ threads });
    const out = await service.getThread({ organizationId: "o", threadId: "t1" });
    expect(out.thread.id).toBe("t1");
    expect(threads.listThreads).not.toHaveBeenCalled();

    const foreign = createThreadService({
      threads: mockThreads({ getThread: vi.fn(async () => null) }),
    });
    await expect(
      foreign.getThread({ organizationId: "o", threadId: "nope" }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
  });

  it("refuses answer submission for viewers before touching persistence", async () => {
    const threads = mockThreads();
    const service = createThreadService({ threads });
    await expect(
      service.submitAnswers({
        organizationId: "o",
        actorId: "u",
        role: "viewer",
        threadId: "t1",
        spec: {
          kind: "missing_fields" as const,
          title: "One more detail",
          resumeKey: "router:watch:overview:abcdef1234567890",
          items: [{ key: "frequency", label: "How often?", kind: "text" as const, required: true }],
        },
        answers: { frequency: "weekly" },
        idempotencyKey: "answers-key-0000000000000002",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(threads.appendMessageKeyed).not.toHaveBeenCalled();
  });

  it("links thread to draft request for operators, reading as not-found when foreign", async () => {
    const setThreadLinks = vi.fn(async () => ({
      threadId: "t1",
      projectId: null,
      requestId: null,
      draftRequestId: "d1",
      campaignId: null,
    }));
    const threads = mockThreads({ setThreadLinks });
    const service = createThreadService({ threads });
    const out = await service.setThreadLinks({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      draftRequestId: "d1",
    });
    expect(out).toMatchObject({ threadId: "t1", draftRequestId: "d1" });
    expect(setThreadLinks).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "o", actorId: "u", threadId: "t1" }),
    );

    const foreign = mockThreads({ getThread: vi.fn(async () => null), setThreadLinks });
    await expect(
      createThreadService({ threads: foreign }).setThreadLinks({
        organizationId: "o",
        actorId: "u",
        role: "operator",
        threadId: "foreign",
      }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
  });

  it("refuses thread link updates for viewers before touching persistence", async () => {
    const setThreadLinks = vi.fn();
    const threads = mockThreads({ setThreadLinks });
    const service = createThreadService({ threads });
    await expect(
      service.setThreadLinks({
        organizationId: "o",
        actorId: "u",
        role: "viewer",
        threadId: "t1",
        draftRequestId: "d1",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(setThreadLinks).not.toHaveBeenCalled();
  });
});

describe("campaign ideas-first routing (Task 6)", () => {
  const readers = {
    getIdentityFacts: async () => [
      { id: "f1", statement: "Confirmed trading name.", verified: true, source: "profile" },
    ],
  };

  function ideasSynthesizer(recommendedIndex = 1) {
    return vi.fn(async () => ({
      ideas: [
        { title: "Lunch rush bundle", description: "Noon combo.", sourceIds: ["f1"] },
        { title: "Weekend family table", description: "Saturday set menu.", sourceIds: ["f1"] },
        { title: "Late-night dessert", description: "Dessert counter.", sourceIds: ["f1"] },
      ],
      recommendedIndex,
    }));
  }

  function campaignService(synthesizeIdeas: unknown) {
    return createThreadService({
      threads: mockThreads(),
      proposeRouter: async () => ({ intent: "campaign_advice", confidence: "high", missing: [] }),
      contextReaders: readers,
      ...(synthesizeIdeas !== undefined ? { synthesizeIdeas: synthesizeIdeas as never } : {}),
    });
  }

  it("attaches the 3-option ideas card on a direct campaign_advice route", async () => {
    const synthesizeIdeas = ideasSynthesizer();
    const out = await campaignService(synthesizeIdeas).routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      page: "overview",
    });

    expect(out.intent).toBe("campaign_advice");
    expect(synthesizeIdeas).toHaveBeenCalledTimes(1);
    expect(synthesizeIdeas).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "deepthink" }),
    );
    // Binding producer constraint: exactly ONE item, THREE options, one recommended.
    expect(out.questionnaire?.kind).toBe("campaign_ideas");
    expect(out.questionnaire?.items).toHaveLength(1);
    const options = out.questionnaire?.items[0]?.options ?? [];
    expect(options.map((option) => option.value)).toEqual(["idea-a", "idea-b", "idea-c"]);
    expect(options.filter((option) => option.recommended)).toHaveLength(1);
    expect(out.questionnaire?.resumeKey).toMatch(/^router:campaign_advice:overview:/);
  });

  it("keeps the direct route without a card when ideas are unavailable", async () => {
    const out = await campaignService(null).routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      page: "overview",
    });

    expect(out.intent).toBe("campaign_advice");
    expect(out.questionnaire).toBeNull();
  });

  it("keeps missing-fields cards ahead of ideas (evidence first)", async () => {
    const service = createThreadService({
      threads: mockThreads(),
      proposeRouter: async () => ({
        intent: "campaign_advice",
        confidence: "high",
        missing: ["evidence_window"],
      }),
      contextReaders: readers,
      synthesizeIdeas: ideasSynthesizer(),
    });
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      page: "overview",
    });

    expect(out.intent).toBe("campaign_advice");
    expect(out.questionnaire?.kind).toBe("evidence_window");
  });

  it("never attaches ideas off the campaign lane", async () => {
    const synthesizeIdeas = ideasSynthesizer();
    const service = createThreadService({
      threads: mockThreads(),
      proposeRouter: async () => ({ intent: "answer_memory", confidence: "high", missing: [] }),
      contextReaders: readers,
      synthesizeIdeas,
    });
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      page: "overview",
    });

    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire).toBeNull();
    expect(synthesizeIdeas).not.toHaveBeenCalled();
  });

  it("skips regeneration when the latest message is the just-answered ideas card", async () => {
    const synthesizeIdeas = ideasSynthesizer();
    const service = createThreadService({
      threads: mockThreads({
        latestUserMessage: vi.fn(async () => ({
          ...MESSAGE,
          body: "[answers campaign_ideas]\nidea: idea-b",
        })),
      }),
      proposeRouter: async () => ({ intent: "campaign_advice", confidence: "high", missing: [] }),
      contextReaders: readers,
      synthesizeIdeas,
    });
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      page: "overview",
    });

    // The pick's draft receipt (not a fresh card) is the UI now: one pick
    // costs one strong-tier call, not two.
    expect(out.intent).toBe("campaign_advice");
    expect(out.questionnaire).toBeNull();
    expect(synthesizeIdeas).not.toHaveBeenCalled();
  });
});

describe("zero-click auto-escalation (B2)", () => {
  it("flips a holder's Quick thread to DeepThink silently on a research read", async () => {
    const publish = vi.fn(async () => {});
    const threads = mockThreads();
    const service = createThreadService({
      threads,
      events: { publish },
      proposeRouter: async () => ({ intent: "research_once", confidence: "high", missing: [] }),
    });
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      page: "overview",
      idempotencyKey: "k-escalate-00000001",
    });
    expect(out.intent).toBe("research_once");
    expect(out.questionnaire).toBeNull();
    expect(out.reasonCodes).toContain("DEEPTHINK_AUTO_ESCALATED");
    expect(out.thread.mode).toBe("deepthink");
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "agent_thread.routed",
        payload: expect.objectContaining({ intent: "research_once" }),
      }),
    );
    // Replays keep the flipped mode without a duplicate event.
    const replayed = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      page: "overview",
      idempotencyKey: "k-escalate-00000001",
    });
    expect(replayed.replayed).toBe(true);
    expect(replayed.thread.mode).toBe("deepthink");
  });

  it("keeps viewers read-only: no flip, memory answer with honest codes", async () => {
    const threads = mockThreads();
    const service = createThreadService({
      threads,
      proposeRouter: async () => ({ intent: "research_once", confidence: "high", missing: [] }),
    });
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "viewer",
      threadId: "t1",
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.thread.mode).toBe("quick");
    expect(out.reasonCodes).toContain("VIEWER_RESTRICTED");
    expect(out.reasonCodes).not.toContain("DEEPTHINK_AUTO_ESCALATED");
  });

  it("never flips an already-DeepThink thread again", async () => {
    const threads = mockThreads({
      getThread: vi.fn(async () => ({ ...THREAD, mode: "deepthink" })),
    });
    const service = createThreadService({
      threads,
      proposeRouter: async () => ({ intent: "research_once", confidence: "high", missing: [] }),
    });
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
    });
    expect(out.thread.mode).toBe("deepthink");
    expect(out.reasonCodes).not.toContain("DEEPTHINK_AUTO_ESCALATED");
  });
});
