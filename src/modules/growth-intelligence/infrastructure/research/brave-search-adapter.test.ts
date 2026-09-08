import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import { RESEARCH_BUDGET_LIMITS } from "@/domain/growth-intelligence/research-pipeline";
import {
  BRAVE_WEB_SEARCH_ENDPOINT,
  buildBraveSearchRequestUrl,
  createBraveSearchAdapter,
  requirePlannedSlot,
  runBraveSearchResearch,
  type BraveSearchDurableState,
  type BraveSearchSpender,
  type BraveSearchTransport,
} from "@/modules/growth-intelligence/infrastructure/research/brave-search-adapter";
import {
  buildResearchQuerySlots,
  type ResearchQuerySlot,
} from "@/modules/growth-intelligence/infrastructure/research/query-plan";
import { approvedResearchScopeSchema } from "@/modules/growth-intelligence/infrastructure/research/ports";
import type { ResearchAttemptUsage } from "@/domain/growth-intelligence/research-pipeline";

const FIXED_NOW = new Date("2026-09-08T10:00:00.000Z");

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "brave-search-bounded.json"),
    "utf8",
  ),
) as {
  endpoint: string;
  scope: unknown;
  searchResponses: Array<{ status: number; results?: unknown[] }>;
};

function deterministicUuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

type SpenderEvents = Array<
  | { type: "reserve"; slotKey: string; attemptIndex: number }
  | { type: "settle"; attemptId: string; usage: ResearchAttemptUsage }
>;

function createFakeSpender(overrides?: {
  reserve?: (call: { slotKey: string; attemptIndex: number; call: number }) => {
    attemptId: string;
  };
  settle?: (call: { attemptId: string; usage: unknown }) => void | Promise<void>;
}): { events: SpenderEvents; spender: BraveSearchSpender } {
  const events: SpenderEvents = [];
  let calls = 0;
  return {
    events,
    spender: {
      async reserve(input) {
        const call = calls;
        calls += 1;
        events.push({ type: "reserve", slotKey: input.slotKey, attemptIndex: input.attemptIndex });
        if (overrides?.reserve) return overrides.reserve({ ...input, call });
        return { attemptId: deterministicUuid(call + 1) };
      },
      async settle(input) {
        events.push({ type: "settle", attemptId: input.attemptId, usage: input.usage });
        await overrides?.settle?.(input);
      },
    },
  };
}

function createProgrammedTransport(
  handler: (
    call: number,
    input: { url: string; timeoutMs: number; maxResponseBytes: number; abortSignal: AbortSignal },
  ) => { status: number; body: Uint8Array } | Promise<{ status: number; body: Uint8Array }>,
): BraveSearchTransport & { calls: number; urls: string[] } {
  const seen: string[] = [];
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    urls: seen,
    async search(input) {
      const call = calls;
      calls += 1;
      seen.push(input.url);
      const response = await handler(call, input);
      return { status: response.status, headers: {}, body: response.body };
    },
  };
}

function jsonResponse(results: unknown[], status = 200): { status: number; body: Uint8Array } {
  return { status, body: encodeJson({ results }) };
}

function validResult(url: string, description = "A bounded synthetic snippet.") {
  return { url, title: "Synthetic example", description };
}

function slot(slotKey: string, kind: ResearchQuerySlot["kind"] = "topic"): ResearchQuerySlot {
  return { slotKey, kind, text: `synthetic query ${slotKey}`, maxResults: 5 };
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    scope: {
      publicBusinessName: "Harbor Lane Kitchen",
      approvedDomains: [],
      niches: ["Seafood grill"],
      city: "Dubai",
      countryCode: "AE",
      topics: ["weekend brunch"],
      competitors: [],
    },
    maxQueries: 3,
    maxResultsPerQuery: 5,
    maxResponseBytes: 8192,
    maxRedirects: 0,
    timeoutMs: 1000,
    maxCostMicrosUsd: 100_000,
    ...overrides,
  };
}

function gate(open = true, onCheck?: () => void) {
  return {
    isAvailable() {
      onCheck?.();
      return open;
    },
  };
}

describe("buildBraveSearchRequestUrl", () => {
  it("targets the fixed endpoint with only the encoded public query and count", () => {
    const url = buildBraveSearchRequestUrl({ text: "weekend brunch seafood" }, 5);
    const parsed = new URL(url);

    expect(`${parsed.origin}${parsed.pathname}`).toBe(BRAVE_WEB_SEARCH_ENDPOINT);
    expect([...parsed.searchParams.keys()].sort()).toEqual(["count", "q"]);
    expect(parsed.searchParams.get("q")).toBe("weekend brunch seafood");
    expect(parsed.searchParams.get("count")).toBe("5");
  });

  it("rejects unbounded query text and counts at the boundary", () => {
    expect(() => buildBraveSearchRequestUrl({ text: "" }, 5)).toThrow();
    expect(() => buildBraveSearchRequestUrl({ text: "x".repeat(161) }, 5)).toThrow();
    expect(() => buildBraveSearchRequestUrl({ text: "valid" }, 0)).toThrow();
    expect(() => buildBraveSearchRequestUrl({ text: "valid" }, 6)).toThrow();
  });
});

describe("maximum-input fixture run", () => {
  it("covers all 26 inputs with a manifest entry each, bounded and deduplicated", async () => {
    expect(fixture.endpoint).toBe(BRAVE_WEB_SEARCH_ENDPOINT);
    const scope = approvedResearchScopeSchema.parse(fixture.scope);
    expect(scope.topics).toHaveLength(20);
    expect(scope.competitors).toHaveLength(5);
    expect(scope.approvedDomains).toEqual([]);

    const plan = buildResearchQuerySlots({ scope });
    expect(plan).toHaveLength(26);
    expect(plan[0]?.slotKey).toBe("local_market");
    expect(plan.filter((entry) => entry.kind === "topic")).toHaveLength(20);
    expect(plan.filter((entry) => entry.kind === "competitor")).toHaveLength(5);

    const { events, spender } = createFakeSpender();
    const transport = createProgrammedTransport((call) => {
      const programmed = fixture.searchResponses[call];
      expect(programmed).toBeDefined();
      return { status: programmed.status, body: encodeJson({ results: programmed.results }) };
    });

    const output = await runBraveSearchResearch({
      request: baseRequest({ maxResponseBytes: 524_288 }),
      plan,
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(output.result.coverage).toHaveLength(26);
    expect(output.result.coverage.map((entry) => entry.slotKey)).toEqual(
      plan.map((entry) => entry.slotKey),
    );
    expect(output.result.attempts.length).toBeLessThanOrEqual(28);
    expect(output.result.attempts).toHaveLength(transport.calls);
    expect(output.stopReason).toBe("completed");

    const urls = output.result.sources.map((source) => source.sourceUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(output.stats.duplicatesDropped).toBeGreaterThan(0);
    expect(output.stats.unsafeDropped).toBeGreaterThan(0);

    const bySlot = new Map(output.result.coverage.map((entry) => [entry.slotKey, entry]));
    const topicSlots = plan.filter((entry) => entry.kind === "topic").map((entry) => entry.slotKey);
    expect(bySlot.get(topicSlots[7]!)?.outcome).toBe("searched_no_usable_evidence");
    expect(bySlot.get(topicSlots[11]!)?.outcome).toBe("searched_no_usable_evidence");
    expect(
      output.result.coverage.filter((entry) => entry.outcome === "supported").length,
    ).toBeGreaterThan(20);

    // Reservation precedes every call, in order.
    const reserveOrder = events.filter((event) => event.type === "reserve");
    expect(reserveOrder.length).toBe(transport.calls);
    for (const [index, event] of events.entries()) {
      if (event.type === "settle") {
        expect(events.slice(0, index).some((earlier) => earlier.type === "reserve")).toBe(true);
      }
    }

    // No business-report or customer-data egress: only q + count travel.
    for (const raw of transport.urls) {
      const parsed = new URL(raw);
      expect(`${parsed.origin}${parsed.pathname}`).toBe(BRAVE_WEB_SEARCH_ENDPOINT);
      expect([...parsed.searchParams.keys()].sort()).toEqual(["count", "q"]);
      expect(parsed.searchParams.get("q")).not.toMatch(/http/i);
    }
  });
});

describe("retry, timeout, and malformed responses", () => {
  it("retries 429 within the two-call allowance, then supports the slot", async () => {
    const { events, spender } = createFakeSpender();
    const transport = createProgrammedTransport((call) =>
      call === 0
        ? { status: 429, body: encodeJson({}) }
        : jsonResponse([validResult("https://guide.example/retry-ok")]),
    );

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:retry")],
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(2);
    expect(output.result.attempts).toHaveLength(2);
    expect(output.result.coverage[0]?.outcome).toBe("supported");
    expect(output.durableState.consumedRetries).toBe(1);
    expect(
      events.filter((event) => event.type === "settle" && event.usage.kind === "unknown"),
    ).toHaveLength(1);
  });

  it("retries 5xx and stops after the allowance, failing the slot", async () => {
    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport(() => ({
      status: 503,
      body: encodeJson({}),
    }));

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:always-down")],
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(3);
    expect(output.result.attempts).toHaveLength(3);
    expect(output.result.coverage[0]?.outcome).toBe("failed");
    expect(output.result.coverage[0]?.attemptIds).toHaveLength(3);
    expect(output.durableState.consumedRetries).toBe(2);
  });

  it("never retries redirects, client errors, timeouts, or malformed bodies", async () => {
    for (const response of [
      { status: 301, body: encodeJson({}) },
      { status: 403, body: encodeJson({}) },
      { status: 200, body: new TextEncoder().encode("not-json{{{") },
      { status: 200, body: encodeJson({ unexpected: "shape" }) },
    ]) {
      const { spender } = createFakeSpender();
      const transport = createProgrammedTransport(() => response);

      const output = await runBraveSearchResearch({
        request: baseRequest(),
        plan: [slot("topic:single-try")],
        transport,
        spender,
        gate: gate(true),
        now: () => FIXED_NOW,
      });

      expect(transport.calls).toBe(1);
      expect(output.result.coverage[0]?.outcome).toBe("failed");
      expect(output.durableState.consumedRetries).toBe(0);
    }
  });

  it("settles a timed-out call as unknown and never converts it to zero", async () => {
    const { events, spender } = createFakeSpender();
    const transport = createProgrammedTransport((_call, input) => {
      return new Promise<{ status: number; body: Uint8Array }>((_resolve, reject) => {
        input.abortSignal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const output = await runBraveSearchResearch({
      request: baseRequest({ timeoutMs: 250 }),
      plan: [slot("topic:hangs")],
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(1);
    expect(output.result.coverage[0]?.outcome).toBe("failed");
    expect(output.result.attempts[0]?.usage).toEqual({ kind: "unknown" });
    expect(events.filter((event) => event.type === "settle")).toHaveLength(1);
  });

  it("leaves usage unknown when the success settlement is refused", async () => {
    const { spender } = createFakeSpender({
      settle: () => {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_UNAVAILABLE",
          "Research spend could not be reserved.",
        );
      },
    });
    const transport = createProgrammedTransport(() =>
      jsonResponse([validResult("https://guide.example/refused")]),
    );

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:refused"), slot("topic:after")],
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(output.stopReason).toBe("settlement_failed");
    expect(output.result.coverage.map((entry) => entry.outcome)).toEqual(["failed", "not_started"]);
    expect(output.result.attempts[0]?.usage).toEqual({ kind: "unknown" });
    expect(output.durableState.attempts[0]?.usage).toEqual({ kind: "unknown" });
    expect(output.result.sources).toHaveLength(0);
  });

  it("fails a response over the streaming bound instead of parsing it", async () => {
    const transport = createProgrammedTransport((call, input) => {
      expect(input.maxResponseBytes).toBe(1024);
      return { status: 200, body: new Uint8Array(2048) };
    });
    const { spender } = createFakeSpender();

    const output = await runBraveSearchResearch({
      request: baseRequest({ maxResponseBytes: 1024 }),
      plan: [slot("topic:too-big")],
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(output.result.coverage[0]?.outcome).toBe("failed");
    expect(output.result.sources).toHaveLength(0);
    expect(output.result.attempts[0]?.usage).toEqual({ kind: "unknown" });
  });
});

describe("source filtering and truncation", () => {
  it("drops duplicates, unsafe URLs, and empty excerpts without retrying", async () => {
    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport(() =>
      jsonResponse([
        validResult("https://guide.example/kept", "Kept snippet."),
        validResult("https://guide.example/kept", "Kept snippet."),
        validResult("https://cook:secret@guide.example/private", "Credentialed."),
        validResult("ftp://files.example/old", "Wrong scheme."),
        { url: "https://guide.example/empty", title: "Empty", description: "   " },
      ]),
    );

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:filter")],
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(1);
    expect(output.result.coverage[0]?.outcome).toBe("supported");
    expect(output.result.sources).toHaveLength(1);
    expect(output.stats.duplicatesDropped).toBe(1);
    expect(output.stats.unsafeDropped).toBe(2);
    expect(output.stats.emptyExcerptsDropped).toBe(1);
  });

  it("caps admission at five results per query", async () => {
    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport(() =>
      jsonResponse(
        Array.from({ length: 8 }, (_, index) =>
          validResult(`https://guide.example/many-${index}`, `Snippet ${index}.`),
        ),
      ),
    );

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:many")],
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(output.result.sources).toHaveLength(5);
    expect(output.result.coverage[0]?.outcome).toBe("supported");
  });

  it("stops new calls once 40 sources are retained", async () => {
    const held: BraveSearchDurableState = {
      attempts: [],
      coverage: [],
      sources: Array.from({ length: 40 }, (_, index) => ({
        sourceUrl: `https://directory.example/held-${index}`,
        domain: "directory.example",
        excerptText: `Held snippet ${index}.`,
        excerptDigest: `${"b".repeat(63)}${index % 10}`,
        retrievedAt: FIXED_NOW.toISOString(),
      })),
      consumedResponseBytes: 0,
      consumedRetries: 0,
      sourceUrls: Array.from(
        { length: 40 },
        (_, index) => `https://directory.example/held-${index}`,
      ),
      startedAt: FIXED_NOW.getTime(),
    };
    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport(() =>
      jsonResponse([validResult("https://guide.example/late")]),
    );

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:late")],
      transport,
      spender,
      gate: gate(true),
      resumeFrom: held,
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(0);
    expect(output.stopReason).toBe("source_budget");
    expect(output.result.coverage[0]?.outcome).toBe("not_started");
    expect(output.result.sources).toHaveLength(40);
  });

  it("never marks a slot supported when the excerpt budget truncates its evidence", async () => {
    const sources = Array.from({ length: 39 }, (_, index) => ({
      sourceUrl: `https://directory.example/nearly-full-${index}`,
      domain: "directory.example",
      excerptText: `x`.repeat(index < 32 ? 2000 : 200),
      excerptDigest: `${"c".repeat(62)}${String(index % 100).padStart(2, "0")}`.slice(0, 64),
      retrievedAt: FIXED_NOW.toISOString(),
    }));
    const held: BraveSearchDurableState = {
      attempts: [],
      coverage: [],
      sources,
      consumedResponseBytes: 0,
      consumedRetries: 0,
      sourceUrls: sources.map((source) => source.sourceUrl),
      startedAt: FIXED_NOW.getTime(),
    };
    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport(() =>
      jsonResponse([validResult("https://guide.example/overflow", "y".repeat(500))]),
    );

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:overflow"), slot("topic:after")],
      transport,
      spender,
      gate: gate(true),
      resumeFrom: held,
      now: () => FIXED_NOW,
    });

    expect(output.stopReason).toBe("source_budget");
    expect(output.result.coverage[0]?.outcome).toBe("failed");
    expect(output.result.coverage[1]?.outcome).toBe("not_started");
    expect(output.result.coverage.every((entry) => entry.outcome !== "supported")).toBe(true);
  });

  it("marks a slot failed when source exhaustion truncates it after admissions", async () => {
    const heldSources = Array.from({ length: 39 }, (_, index) => ({
      sourceUrl: `https://directory.example/almost-full-${index}`,
      domain: "directory.example",
      excerptText: `Held snippet ${index}.`,
      excerptDigest: `${"d".repeat(63)}${index % 10}`,
      retrievedAt: FIXED_NOW.toISOString(),
    }));
    const held: BraveSearchDurableState = {
      attempts: [],
      coverage: [],
      sources: heldSources,
      consumedResponseBytes: 0,
      consumedRetries: 0,
      sourceUrls: heldSources.map((source) => source.sourceUrl),
      startedAt: FIXED_NOW.getTime(),
    };
    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport(() =>
      jsonResponse([
        validResult("https://guide.example/cut-first", "First snippet admitted."),
        validResult("https://guide.example/cut-second", "Second snippet truncated away."),
      ]),
    );

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:cut"), slot("topic:after-cut")],
      transport,
      spender,
      gate: gate(true),
      resumeFrom: held,
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(1);
    expect(output.stopReason).toBe("source_budget");
    expect(output.result.sources).toHaveLength(40);
    expect(output.result.coverage[0]?.outcome).toBe("failed");
    expect(output.result.coverage[1]?.outcome).toBe("not_started");
  });
});

describe("kill switch, budget refusals, and claim loss", () => {
  it("stops before the next call when availability is revoked, skipping by policy", async () => {
    let open = true;
    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport((call) => {
      open = false;
      return jsonResponse([validResult(`https://guide.example/first-${call}`)]);
    });

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:first"), slot("topic:second"), slot("topic:third")],
      transport,
      spender,
      gate: { isAvailable: () => open },
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(1);
    expect(output.stopReason).toBe("policy_revoked");
    expect(output.result.coverage.map((entry) => entry.outcome)).toEqual([
      "supported",
      "skipped_policy",
      "skipped_policy",
    ]);
  });

  it("treats a mid-run qualification refusal as policy revocation", async () => {
    const { spender } = createFakeSpender({
      reserve: ({ call }) => {
        if (call > 0) {
          throw new GrowthIntelligenceError(
            "RESEARCH_PROVIDER_NOT_QUALIFIED",
            "Market research is not enabled for this organization.",
          );
        }
        return { attemptId: deterministicUuid(call + 1) };
      },
    });
    const transport = createProgrammedTransport(() =>
      jsonResponse([validResult("https://guide.example/ok")]),
    );

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:one"), slot("topic:two")],
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(1);
    expect(output.stopReason).toBe("policy_revoked");
    expect(output.result.coverage.map((entry) => entry.outcome)).toEqual([
      "supported",
      "skipped_policy",
    ]);
  });

  it("marks allowance exhaustion as skipped budget with partial coverage", async () => {
    const { spender } = createFakeSpender({
      reserve: ({ call, slotKey, attemptIndex }) => {
        if (call > 1) {
          throw new GrowthIntelligenceError(
            "RESEARCH_BUDGET_ALLOWANCE_EXCEEDED",
            "The organization research allowance for today is fully reserved.",
          );
        }
        return { attemptId: deterministicUuid(attemptIndex + 1) };
      },
    });
    const transport = createProgrammedTransport((call) =>
      jsonResponse([validResult(`https://guide.example/allowance-${call}`)]),
    );

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:a"), slot("topic:b"), slot("topic:c"), slot("topic:d")],
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(2);
    expect(output.stopReason).toBe("budget_exhausted");
    expect(output.result.coverage.map((entry) => entry.outcome)).toEqual([
      "supported",
      "supported",
      "skipped_budget",
      "skipped_budget",
    ]);
  });

  it("issues no further call after the claim is lost", async () => {
    const { spender } = createFakeSpender({
      reserve: ({ call, attemptIndex }) => {
        if (call > 0) {
          throw new GrowthIntelligenceError(
            "RESEARCH_BUDGET_LEASE_STALE",
            "The worker lease is no longer current; no new call was issued.",
          );
        }
        return { attemptId: deterministicUuid(attemptIndex + 1) };
      },
    });
    const transport = createProgrammedTransport(() =>
      jsonResponse([validResult("https://guide.example/ok")]),
    );

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:kept"), slot("topic:lost"), slot("topic:never")],
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(1);
    expect(output.stopReason).toBe("claim_lost");
    expect(output.claimLost).toBe(true);
    expect(output.result.coverage.map((entry) => entry.outcome)).toEqual([
      "supported",
      "not_started",
      "not_started",
    ]);
  });

  it("stops at the deadline with partial coverage", async () => {
    const times = [
      new Date("2026-09-08T10:00:00.000Z"),
      new Date("2026-09-08T10:09:00.000Z"),
      new Date("2026-09-08T10:09:00.000Z"),
    ];
    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport(() =>
      jsonResponse([validResult("https://guide.example/ok")]),
    );

    const output = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:early"), slot("topic:late")],
      transport,
      spender,
      gate: gate(true),
      now: () => times.shift() ?? new Date("2026-09-08T10:09:00.000Z"),
    });

    expect(transport.calls).toBe(0);
    expect(output.stopReason).toBe("deadline");
    expect(output.result.coverage.map((entry) => entry.outcome)).toEqual([
      "not_started",
      "not_started",
    ]);
  });
});

describe("restart resumption and the 28-attempt ceiling", () => {
  it("resumes without re-calling completed slots and inherits consumed budget", async () => {
    const firstSpender = createFakeSpender();
    const firstTransport = createProgrammedTransport((call) =>
      jsonResponse([validResult(`https://guide.example/first-${call}`)]),
    );
    const firstPlan = [slot("topic:alpha"), slot("topic:beta")];
    const first = await runBraveSearchResearch({
      request: baseRequest(),
      plan: firstPlan,
      transport: firstTransport,
      spender: firstSpender.spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });
    expect(first.result.coverage.every((entry) => entry.outcome === "supported")).toBe(true);

    const secondSpender = createFakeSpender({
      reserve: ({ slotKey, attemptIndex }) => ({
        attemptId: deterministicUuid(100 + attemptIndex),
      }),
    });
    const secondTransport = createProgrammedTransport((call) =>
      jsonResponse([validResult(`https://guide.example/resumed-${call}`)]),
    );
    const resumed = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [...firstPlan, slot("topic:gamma")],
      transport: secondTransport,
      spender: secondSpender.spender,
      gate: gate(true),
      resumeFrom: first.durableState,
      now: () => FIXED_NOW,
    });

    expect(secondTransport.calls).toBe(1);
    expect(resumed.result.coverage.map((entry) => entry.outcome)).toEqual([
      "supported",
      "supported",
      "supported",
    ]);
    expect(resumed.result.attempts).toHaveLength(3);
    const indexes = secondSpender.events
      .filter((event) => event.type === "reserve")
      .map((event) => (event.type === "reserve" ? event.attemptIndex : -1));
    expect(indexes).toEqual([2]);
  });

  it("re-runs failed slots on resume but never completed observations", async () => {
    const failing = createProgrammedTransport(() => ({ status: 500, body: encodeJson({}) }));
    const { spender: failingSpender } = createFakeSpender();
    const failed = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:flaky"), slot("topic:steady")],
      transport: failing,
      spender: failingSpender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });
    expect(failed.result.coverage.map((entry) => entry.outcome)).toEqual(["failed", "failed"]);

    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport((call) =>
      jsonResponse([validResult(`https://guide.example/recovered-${call}`)]),
    );
    const resumed = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:flaky"), slot("topic:steady")],
      transport,
      spender,
      gate: gate(true),
      resumeFrom: failed.durableState,
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(2);
    expect(resumed.result.coverage.every((entry) => entry.outcome === "supported")).toBe(true);
    expect(resumed.result.attempts.length).toBeGreaterThan(2);
    expect(resumed.result.attempts.length).toBeLessThanOrEqual(
      RESEARCH_BUDGET_LIMITS.maxPrimarySearches + RESEARCH_BUDGET_LIMITS.maxRetryAttempts,
    );
  });

  it("inherits the original start time on resume so the deadline still binds", async () => {
    const started = new Date("2026-09-08T10:00:00.000Z");
    const { spender: firstSpender } = createFakeSpender();
    const firstTransport = createProgrammedTransport((call) =>
      jsonResponse([validResult(`https://guide.example/early-${call}`)]),
    );
    const first = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:alpha")],
      transport: firstTransport,
      spender: firstSpender,
      gate: gate(true),
      now: () => started,
    });
    expect(first.result.coverage[0]?.outcome).toBe("supported");
    expect(first.durableState.startedAt).toBe(started.getTime());

    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport((call) =>
      jsonResponse([validResult(`https://guide.example/late-${call}`)]),
    );
    const resumed = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:alpha"), slot("topic:beta")],
      transport,
      spender,
      gate: gate(true),
      resumeFrom: first.durableState,
      now: () => new Date("2026-09-08T10:09:00.000Z"),
    });

    expect(transport.calls).toBe(0);
    expect(resumed.stopReason).toBe("deadline");
    expect(resumed.durableState.startedAt).toBe(started.getTime());
    expect(resumed.result.coverage.map((entry) => entry.outcome)).toEqual([
      "supported",
      "not_started",
    ]);
  });

  it("refuses coverage keys outside the run plan", () => {
    const plan = [slot("topic:known")];

    expect(requirePlannedSlot(plan, "topic:known").kind).toBe("topic");
    expect(() => requirePlannedSlot(plan, "competitor:ghost")).toThrow(/run plan/);
    expect(() => requirePlannedSlot(plan, "local_market")).toThrow(/run plan/);
  });

  it("holds the 28-attempt ceiling including failures, then stops a resumed run", async () => {
    const scope = approvedResearchScopeSchema.parse(fixture.scope);
    const plan = buildResearchQuerySlots({ scope });
    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport(() => ({ status: 429, body: encodeJson({}) }));

    const output = await runBraveSearchResearch({
      request: baseRequest({ maxResponseBytes: 524_288 }),
      plan,
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(transport.calls).toBe(28);
    expect(output.result.attempts).toHaveLength(28);
    expect(output.durableState.consumedRetries).toBe(2);
    expect(output.result.coverage.every((entry) => entry.outcome === "failed")).toBe(true);

    const { spender: resumedSpender } = createFakeSpender();
    const resumedTransport = createProgrammedTransport(() =>
      jsonResponse([validResult("https://guide.example/too-late")]),
    );
    const resumed = await runBraveSearchResearch({
      request: baseRequest(),
      plan: [slot("topic:extra")],
      transport: resumedTransport,
      spender: resumedSpender,
      gate: gate(true),
      resumeFrom: output.durableState,
      now: () => FIXED_NOW,
    });

    expect(resumedTransport.calls).toBe(0);
    expect(resumed.stopReason).toBe("attempt_ceiling");
    expect(resumed.result.coverage[0]?.outcome).toBe("not_started");
    expect(resumed.result.attempts).toHaveLength(28);
  });
});

describe("createBraveSearchAdapter", () => {
  it("returns full-coverage retrieval through the legacy adapter surface", async () => {
    const { spender } = createFakeSpender();
    const transport = createProgrammedTransport((call) =>
      jsonResponse([validResult(`https://guide.example/adapter-${call}`)]),
    );
    const adapter = createBraveSearchAdapter({
      transport,
      spender,
      gate: gate(true),
      now: () => FIXED_NOW,
    });

    expect(adapter.availability).toEqual({ available: true, provider: "brave" });
    const result = await adapter.searchAndFetch(baseRequest());

    expect(result.coverage).toHaveLength(2);
    expect(result.coverage.map((entry) => entry.slotKey)).toEqual([
      "local_market",
      expect.stringMatching(/^topic:/),
    ]);
    expect(transport.calls).toBe(2);
  });
});
