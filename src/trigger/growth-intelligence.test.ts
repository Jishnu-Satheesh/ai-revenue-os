import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DomainError } from "@/lib/errors";
import {
  createQualifiedTinyfishResearchAdapter,
  createTinyfishResearchSpender,
  TINYFISH_RESEARCH_MAXIMUM_MICROS_USD_PER_ATTEMPT,
  TINYFISH_RESEARCH_PRICE_VERSION,
  TINYFISH_RESEARCH_QUOTE_MICROS_USD,
} from "@/trigger/growth-intelligence-tinyfish";

describe("Growth Intelligence Trigger registration", () => {
  it("registers five bounded schema tasks without activating a dispatcher", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source.match(/schemaTask\(\{/g)).toHaveLength(5);
    expect(source).toContain('id: "growth-intelligence.run-market-research"');
    expect(source).toContain('id: "growth-intelligence.consolidate-market-evidence"');
    expect(source).toContain('id: "growth-intelligence.dispatch-due"');
    expect(source).toContain('id: "growth-intelligence.run-synthesis"');
    expect(source).toContain('id: "growth-intelligence.run-market-monitoring-update"');
    expect(source).toContain('name: "growth-intelligence"');
    expect(source).toContain("concurrencyLimit: 1");
    expect(source).toContain("maxAttempts: 3");
    expect(source.match(/maxDuration: 300/g)).toHaveLength(5);
    expect(source).toContain("maxDuration: MONITORING_UPDATE_TASK_MAX_DURATION_S");
    expect(source.match(/schedules\.task\(/g)).toHaveLength(1);
    expect(source).not.toContain("triggerAndWait");
  });

  it("parses before privileged dependency construction in every run", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source.match(/tasks\.onCancel\(/g)).toHaveLength(1);
    expect(source).toMatch(
      /const parsed = marketResearchPayloadSchema\.parse\(payload\);\s+const dependencies = await createResearchDependencies\(signal, \{\s+organizationId: parsed\.organizationId,\s+requestId: parsed\.requestId,\s+\}\);/,
    );
    expect(source).toMatch(
      /const parsed = consolidationPayloadSchema\.parse\(payload\);\s+const dependencies = await createResearchDependencies\(signal, \{\s+organizationId: parsed\.organizationId,\s+requestId: parsed\.requestId,\s+\}\);/,
    );
    expect(source).toMatch(
      /const parsed = dispatchDuePayloadSchema\.parse\(payload\);\s+const supabase = createGrowthIntelligenceWorkerServiceClient\(\);/,
    );
    expect(source).toMatch(
      /const parsed = synthesisPayloadSchema\.parse\(payload\);\s+const dependencies = createSynthesisDependencies\(signal\);/,
    );
    expect(source).toMatch(
      /const parsed = marketMonitoringUpdatePayloadSchema\.parse\(payload\);\s+const supabase = createGrowthIntelligenceWorkerServiceClient\(\);/,
    );
    const dispatchDueBlock = source.slice(source.indexOf('id: "growth-intelligence.dispatch-due"'));
    expect(dispatchDueBlock.indexOf("dispatchDuePayloadSchema.parse(payload)")).toBeLessThan(
      dispatchDueBlock.indexOf("createGrowthIntelligenceWorkerServiceClient()"),
    );
  });

  it("dispatches identifier-only runs through the task handle", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("tasks.trigger(input.taskId, {");
    expect(source).toContain("claim_due_growth_intelligence_requests");
  });

  it("logs normalized identifiers only", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain('logger.info("growth_intelligence.research_finished"');
    expect(source).toContain('logger.info("growth_intelligence.consolidation_finished"');
    expect(source).toContain('logger.info("growth_intelligence.dispatch_finished"');
    expect(source).toContain('logger.info("growth_intelligence.synthesis_finished"');
    expect(source).toContain('logger.info("growth_intelligence.monitoring_update_finished"');
    expect(source).not.toContain("logger.info(payload");
    expect(source).not.toMatch(/logger\.(?:info|warn|error)\([^)]*evidence[\s\S]*/);
    expect(source).not.toMatch(/logger\.(?:info|warn|error)\([^)]*paraphrase[\s\S]*/);
    expect(source).not.toMatch(/logger\.(?:info|warn|error)\([^)]*idempotencyKey[\s\S]*/);
  });

  it("keeps raw business and evidence payloads out of the synthesis wiring", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("runSynthesis");
    expect(source).toContain('id: "growth-intelligence.run-synthesis"');
    for (const forbidden of [
      "monetary_impact",
      "value_numerator",
      "value_denominator",
      "signedUrl",
      "signed_url",
      "workbook",
      "report_projection",
      "prompt_version",
      "customer",
      "source_page",
      "credential",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("excludes terminal-state claims from the consolidation current count", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    // Per-claim attribution needs the claim id alongside the event type.
    expect(source).toContain("market_evidence_claim_id, event_type");
    // Terminal states mirror public.market_evidence_claim_current_state:
    // withdrawn, excluded, corrected/superseded, and expired are terminal.
    expect(source).toContain("TERMINAL_CLAIM_EVENT_TYPES");
    for (const terminal of ["expired", "withdrawn", "excluded", "corrected", "superseded"]) {
      expect(source).toContain(`"${terminal}"`);
    }
    expect(source).toMatch(/currentClaimCount: claimIds\.length - \w+/);
    expect(source).toContain("changedCount: 0");
  });

  it("selects finding lineage for the synthesis loader", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("quality_state, status, kind, channel_id, branch_id");
    expect(source).toContain("analysis_run_id, period_start, period_end, currency, value_kind");
  });

  it("fences the synthesis findings loader by branch, run lineage, window, and measure", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("branch_id");
    expect(source).toContain("analysis_run_id");
    expect(source).toContain("period_start");
    expect(source).toContain("currency");
    expect(source).toContain("value_kind");
    expect(source).toContain("run_branch_id");
    expect(source).toContain("selectBranchFindings");
  });

  it("orders the synthesis loader reads so the row cap keeps a deterministic window", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source.match(/\.order\("id", \{ ascending: true \}\)/g)).toHaveLength(2);
  });

  it("validates the synthesis branch before interpolating it into the findings filter", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("UUID_PATTERN");
    expect(source).toContain("branch_id.eq.${");
  });

  it("threads exact branch/profile/research lineage into the synthesis claims loader", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("toEligibleMarketClaims");
    expect(source).toContain("market_research_run_id");
    expect(source).toContain("growth_intelligence_request_id");
  });

  it("wires real extraction and support-review phases instead of the Task 6/8 marker", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).not.toContain("Task 6/8 must remove");
    expect(source).not.toContain("as unknown as Parameters<typeof runMarketResearch>");
    expect(source).toContain("supportReview:");
    expect(source).toContain("excerptProvenance:");
    expect(source).toContain("EXTRACTION_UNAVAILABLE");
  });

  it("parses branch profiles through the v1/v2 union instead of v1 only", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("marketProfileDocumentSchema");
    expect(source).not.toMatch(
      /document: marketProfileDocumentV1Schema\.parse\(version\.profile_document\)/,
    );
  });

  it("bounds the research plan by the full slot count within plan ceilings", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("buildResearchQuerySlots");
    expect(source).toContain("maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery");
    expect(source).toContain("maxRedirects: 0");
    expect(source).toContain("maxPipelineReservationMicrosUsd");
  });

  it("injects the monitoring brief builder into the research factory", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("createMonitoringResearchBriefBuilder");
    expect(source).toContain("researchBrief:");
    expect(source).toContain("loadSnapshot: async () => null");
    expect(source).toContain("qualified: false");
  });

  it("gates the synthesis context builder on configured snapshot loading", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("createMonitoringSynthesisContextBuilder");
    expect(source).toContain("MONITORING_CONTEXT_SNAPSHOTS_ENABLED");
  });

  it("keeps monitoring research fail-closed behind the qualified-provider gate", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("createFailClosedMonitoringResearch");
    expect(source).toContain("getQualifiedMarketResearchAdapter()");
    expect(source).toContain("ADAPTER_UNAVAILABLE");
    expect(source).toContain("RESEARCH_EXECUTION_UNAVAILABLE");
  });

  it("nudges the monitoring update task with identifiers only", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("triggerMarketMonitoringUpdate");
    expect(source).toContain(
      'tasks.trigger("growth-intelligence.run-market-monitoring-update"',
    );
    expect(source).toContain("briefRevisionId: input.briefRevisionId");
  });

  it("cancels the monitoring update run by identifiers", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain('taskId !== "growth-intelligence.run-market-monitoring-update"');
    expect(source).toContain("marketMonitoringUpdatePayloadSchema.parse(payload)");
    expect(source).toContain("updateId: parsed.updateId");
  });

  it("schedules the monitoring sweep every five minutes with per-org fairness", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain('id: "growth-intelligence.monitoring-sweep"');
    expect(source).toContain('cron: "*/5 * * * *"');
    expect(source).toContain("MONITORING_SWEEP_LIMIT");
    expect(source).toContain("MONITORING_SWEEP_MAX_PER_ORGANIZATION");
    expect(source).toContain("enqueueDueMonitoringUpdates");
    expect(source).toContain("orderDueMonitoringProjectsFairly");
    expect(source).toContain("listDueMonitoringProjects");
    expect(source).toContain("maxPerOrganization: MONITORING_SWEEP_MAX_PER_ORGANIZATION");
    expect(source).toContain('logger.info("growth_intelligence.monitoring_sweep_finished"');
    expect(source).toContain('taskId !== "growth-intelligence.monitoring-sweep"');
    expect(source).not.toContain("percent");
  });

  it("settles durable lifecycle rows around the update run with the G45 lease", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source).toContain("createMonitoringLifecycleHooks");
    expect(source).toContain("lifecycle: createMonitoringLifecycleHooks(supabase)");
    expect(source).toContain("open_monitoring_update");
    expect(source).toContain("settle_monitoring_update");
    expect(source).toContain('from("growth_intelligence_monitoring_updates")');
    expect(source).toContain("cancel_monitoring_update");
    expect(source).toContain("WORKER_CANCELLED");
  });
});

describe("TinyFish research assembly (Task 5)", () => {
  const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
  const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
  const CLAIM_TOKEN = "33333333-3333-4333-8333-333333333333";
  const RESERVATION_ID = "44444444-4444-4444-8444-444444444444";
  const FAKE_KEY = "task5-test-key-never-sent-live";

  const savedEnv = { key: "", gate: "" };
  const hadKey = { current: false };
  const hadGate = { current: false };

  beforeEach(() => {
    hadKey.current = "TINYFISH_SEARCH_API_KEY" in process.env;
    hadGate.current = "TINYFISH_MARKET_RESEARCH_ENABLED" in process.env;
    savedEnv.key = process.env.TINYFISH_SEARCH_API_KEY ?? "";
    savedEnv.gate = process.env.TINYFISH_MARKET_RESEARCH_ENABLED ?? "";
    delete process.env.TINYFISH_SEARCH_API_KEY;
    delete process.env.TINYFISH_MARKET_RESEARCH_ENABLED;
  });

  afterEach(() => {
    if (hadKey.current) process.env.TINYFISH_SEARCH_API_KEY = savedEnv.key;
    else delete process.env.TINYFISH_SEARCH_API_KEY;
    if (hadGate.current) process.env.TINYFISH_MARKET_RESEARCH_ENABLED = savedEnv.gate;
    else delete process.env.TINYFISH_MARKET_RESEARCH_ENABLED;
  });

  function validRequest() {
    return {
      scope: {
        publicBusinessName: "Acme Bakery",
        approvedDomains: [],
        niches: ["bakery"],
        city: "Austin",
        countryCode: "US",
        topics: ["sourdough demand"],
        competitors: [],
      },
      maxQueries: 26,
      maxResultsPerQuery: 5,
      maxResponseBytes: 524288,
      maxRedirects: 0,
      timeoutMs: 5000,
      maxCostMicrosUsd: 1000000,
    };
  }

  function persistenceFor(
    qualification: { provider: string; available: boolean; blockers: string[] } | null,
    options?: { failRpc?: boolean },
  ) {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (options?.failRpc) throw new Error("connection reset");
      if (name === "check_research_provider_qualification_for") {
        return { data: qualification, error: null };
      }
      if (name === "reserve_research_request_budget") {
        return {
          data: {
            reservationId: RESERVATION_ID,
            organizationId: ORGANIZATION_ID,
            requestId: REQUEST_ID,
            allowanceDay: "2026-09-18",
            quoteMicrosUsd: TINYFISH_RESEARCH_QUOTE_MICROS_USD,
            priceVersion: TINYFISH_RESEARCH_PRICE_VERSION,
            replayed: false,
          },
          error: null,
        };
      }
      if (name === "reserve_research_attempt") {
        return {
          data: {
            attemptId: randomUUID(),
            reservationId: RESERVATION_ID,
            allowanceDay: "2026-09-18",
            maximumMicrosUsd: TINYFISH_RESEARCH_MAXIMUM_MICROS_USD_PER_ATTEMPT,
            replayed: false,
          },
          error: null,
        };
      }
      if (name === "settle_research_attempt") {
        const usage = args.p_usage as { kind: string; microsUsd?: number };
        return {
          data: {
            attemptId: args.p_attempt_id,
            settlementKind: usage.kind,
            actualMicrosUsd: usage.kind === "unknown" ? null : (usage.microsUsd ?? 0),
            overrunBlocked: false,
            replayed: false,
          },
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    return { persistence: { rpc }, rpc };
  }

  function tinyfishPage(query: string, page: number, count: number) {
    const results =
      page > 0
        ? []
        : Array.from({ length: count }, (_, index) => ({
            position: index + 1,
            site_name: "example.com",
            title: `Bakery insight ${index + 1}`,
            snippet: "Sourdough demand grows steadily across neighborhood bakeries.",
            url: `https://example.com/research/${encodeURIComponent(query)}-${index}`,
            publisher: "Example",
            date: "2026-09-01",
          }));
    return { query, results, total_results: results.length, page };
  }

  it("reports the blocked baseline without any RPC when the key is missing", async () => {
    process.env.TINYFISH_MARKET_RESEARCH_ENABLED = "true";
    const { persistence, rpc } = persistenceFor({
      provider: "tinyfish",
      available: true,
      blockers: [],
    });

    const adapter = await createQualifiedTinyfishResearchAdapter({
      persistence,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => CLAIM_TOKEN,
    });

    expect(adapter.availability).toEqual({ available: false, provider: "brave" });
    await expect(adapter.searchAndFetch(validRequest())).rejects.toBeInstanceOf(DomainError);
    await expect(adapter.searchAndFetch(validRequest())).rejects.toEqual(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports the blocked baseline without any RPC when the kill-switch is closed", async () => {
    process.env.TINYFISH_SEARCH_API_KEY = FAKE_KEY;
    const { persistence, rpc } = persistenceFor({
      provider: "tinyfish",
      available: true,
      blockers: [],
    });

    const adapter = await createQualifiedTinyfishResearchAdapter({
      persistence,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => CLAIM_TOKEN,
    });

    expect(adapter.availability).toEqual({ available: false, provider: "brave" });
    await expect(adapter.searchAndFetch(validRequest())).rejects.toEqual(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports the blocked baseline for an unqualified tinyfish lane", async () => {
    process.env.TINYFISH_SEARCH_API_KEY = FAKE_KEY;
    process.env.TINYFISH_MARKET_RESEARCH_ENABLED = "true";
    const { persistence, rpc } = persistenceFor({
      provider: "tinyfish",
      available: false,
      blockers: ["credential_missing"],
    });

    const adapter = await createQualifiedTinyfishResearchAdapter({
      persistence,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => CLAIM_TOKEN,
    });

    expect(adapter.availability).toEqual({ available: false, provider: "brave" });
    await expect(adapter.searchAndFetch(validRequest())).rejects.toEqual(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("check_research_provider_qualification_for", {
      p_provider: "tinyfish",
    });
  });

  it("pins the lane to tinyfish when a wrong-provider qualification is staged", async () => {
    process.env.TINYFISH_SEARCH_API_KEY = FAKE_KEY;
    process.env.TINYFISH_MARKET_RESEARCH_ENABLED = "true";
    const { persistence, rpc } = persistenceFor({
      provider: "brave",
      available: true,
      blockers: [],
    });

    const adapter = await createQualifiedTinyfishResearchAdapter({
      persistence,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => CLAIM_TOKEN,
    });

    expect(adapter.availability).toEqual({ available: false, provider: "brave" });
    await expect(adapter.searchAndFetch(validRequest())).rejects.toEqual(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("check_research_provider_qualification_for", {
      p_provider: "tinyfish",
    });
  });

  it("reports the blocked baseline without any RPC when the key is whitespace-only", async () => {
    process.env.TINYFISH_SEARCH_API_KEY = "   ";
    process.env.TINYFISH_MARKET_RESEARCH_ENABLED = "true";
    const { persistence, rpc } = persistenceFor({
      provider: "tinyfish",
      available: true,
      blockers: [],
    });

    const adapter = await createQualifiedTinyfishResearchAdapter({
      persistence,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => CLAIM_TOKEN,
    });

    expect(adapter.availability).toEqual({ available: false, provider: "brave" });
    await expect(adapter.searchAndFetch(validRequest())).rejects.toBeInstanceOf(DomainError);
    await expect(adapter.searchAndFetch(validRequest())).rejects.toEqual(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails the tinyfish lane closed on transport failure", async () => {
    process.env.TINYFISH_SEARCH_API_KEY = FAKE_KEY;
    process.env.TINYFISH_MARKET_RESEARCH_ENABLED = "true";
    const { persistence } = persistenceFor(null, { failRpc: true });

    const adapter = await createQualifiedTinyfishResearchAdapter({
      persistence,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => CLAIM_TOKEN,
    });

    expect(adapter.availability).toEqual({ available: false, provider: "brave" });
    await expect(adapter.searchAndFetch(validRequest())).rejects.toEqual(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
  });

  it("selects the delegating adapter for a qualified lane with key and spends fenced", async () => {
    process.env.TINYFISH_SEARCH_API_KEY = FAKE_KEY;
    process.env.TINYFISH_MARKET_RESEARCH_ENABLED = "true";
    const { persistence, rpc } = persistenceFor({
      provider: "tinyfish",
      available: true,
      blockers: [],
    });
    const seenKeys: Array<string | undefined> = [];
    const fetchImpl = (async (url: string, init: { headers?: Record<string, string> }) => {
      seenKeys.push(init.headers?.["X-API-Key"]);
      const parsed = new URL(url);
      const body = tinyfishPage(
        parsed.searchParams.get("query") ?? "q",
        Number(parsed.searchParams.get("page") ?? "0"),
        5,
      );
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const adapter = await createQualifiedTinyfishResearchAdapter({
      persistence,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => CLAIM_TOKEN,
      fetchImpl,
    });

    expect(adapter.availability).toEqual({ available: true, provider: "tinyfish" });
    const result = await adapter.searchAndFetch(validRequest());
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.coverage).toHaveLength(2);

    const names = rpc.mock.calls.map((call) => call[0]);
    expect(names[0]).toBe("check_research_provider_qualification_for");
    expect(names).toContain("reserve_research_request_budget");
    expect(names).toContain("reserve_research_attempt");
    expect(names).toContain("settle_research_attempt");
    expect(rpc).toHaveBeenCalledWith(
      "reserve_research_request_budget",
      expect.objectContaining({
        p_organization_id: ORGANIZATION_ID,
        p_request_id: REQUEST_ID,
        p_quote_micros_usd: TINYFISH_RESEARCH_QUOTE_MICROS_USD,
        p_price_version: TINYFISH_RESEARCH_PRICE_VERSION,
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "reserve_research_attempt",
      expect.objectContaining({
        p_organization_id: ORGANIZATION_ID,
        p_claim_token: CLAIM_TOKEN,
      }),
    );
    expect(seenKeys.length).toBeGreaterThan(0);
    for (const key of seenKeys) expect(key).toBe(FAKE_KEY);
  });

  it("reserves before the call and settles every usage kind through the fenced wrappers", async () => {
    const reserveRequestBudget = vi.fn(async () => ({ replayed: false }));
    const reserveAttempt = vi.fn(async () => ({ attemptId: randomUUID() }));
    const settleAttempt = vi.fn(async () => undefined);
    const spender = createTinyfishResearchSpender({
      budget: { reserveRequestBudget, reserveAttempt, settleAttempt } as never,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => CLAIM_TOKEN,
    });

    const first = await spender.reserve({ slotKey: "topic:sourdough", attemptIndex: 0 });
    expect(first.attemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    await spender.reserve({ slotKey: "topic:sourdough", attemptIndex: 1 });
    expect(reserveRequestBudget).toHaveBeenCalledTimes(1);
    expect(reserveRequestBudget).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      quoteMicrosUsd: TINYFISH_RESEARCH_QUOTE_MICROS_USD,
      priceVersion: TINYFISH_RESEARCH_PRICE_VERSION,
    });
    expect(reserveAttempt).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      scope: { kind: "request", requestId: REQUEST_ID },
      phase: "research",
      slotKey: "topic:sourdough",
      attemptIndex: 1,
      maximumMicrosUsd: TINYFISH_RESEARCH_MAXIMUM_MICROS_USD_PER_ATTEMPT,
      claimToken: CLAIM_TOKEN,
    });

    await spender.settle({ attemptId: first.attemptId, usage: { kind: "reported", microsUsd: 0 } });
    await spender.settle({
      attemptId: first.attemptId,
      usage: { kind: "estimated", microsUsd: 120 },
    });
    await spender.settle({ attemptId: first.attemptId, usage: { kind: "unknown" } });
    expect(settleAttempt).toHaveBeenCalledTimes(3);
    expect(settleAttempt).toHaveBeenNthCalledWith(1, {
      organizationId: ORGANIZATION_ID,
      attemptId: first.attemptId,
      usage: { kind: "reported", microsUsd: 0 },
    });
    expect(settleAttempt).toHaveBeenNthCalledWith(3, {
      organizationId: ORGANIZATION_ID,
      attemptId: first.attemptId,
      usage: { kind: "unknown" },
    });
  });

  it("contains settlement failure as unknown and never writes zero", async () => {
    const settleAttempt = vi.fn(async () => {
      throw new Error("settle_research_attempt exploded");
    });
    const spender = createTinyfishResearchSpender({
      budget: {
        reserveRequestBudget: vi.fn(async () => ({ replayed: true })),
        reserveAttempt: vi.fn(async () => ({ attemptId: randomUUID() })),
        settleAttempt,
      } as never,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => CLAIM_TOKEN,
    });

    const reserved = await spender.reserve({ slotKey: "topic:sourdough", attemptIndex: 0 });
    await expect(
      spender.settle({ attemptId: reserved.attemptId, usage: { kind: "unknown" } }),
    ).rejects.toThrow("settle_research_attempt exploded");
    expect(settleAttempt).toHaveBeenCalledTimes(1);
  });

  it("refuses to reserve before the workflow claim with zero spend", async () => {
    const reserveRequestBudget = vi.fn(async () => ({ replayed: false }));
    const reserveAttempt = vi.fn(async () => ({ attemptId: randomUUID() }));
    const spender = createTinyfishResearchSpender({
      budget: { reserveRequestBudget, reserveAttempt, settleAttempt: vi.fn() } as never,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => null,
    });

    await expect(spender.reserve({ slotKey: "topic:sourdough", attemptIndex: 0 })).rejects.toEqual(
      expect.objectContaining({ code: "RESEARCH_BUDGET_UNAVAILABLE" }),
    );
    expect(reserveRequestBudget).not.toHaveBeenCalled();
    expect(reserveAttempt).not.toHaveBeenCalled();
  });
});
