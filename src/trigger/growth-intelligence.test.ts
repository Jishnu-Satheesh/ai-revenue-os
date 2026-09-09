import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Growth Intelligence Trigger registration", () => {
  it("registers four bounded schema tasks without activating a dispatcher", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source.match(/schemaTask\(\{/g)).toHaveLength(4);
    expect(source).toContain('id: "growth-intelligence.run-market-research"');
    expect(source).toContain('id: "growth-intelligence.consolidate-market-evidence"');
    expect(source).toContain('id: "growth-intelligence.dispatch-due"');
    expect(source).toContain('id: "growth-intelligence.run-synthesis"');
    expect(source).toContain('name: "growth-intelligence"');
    expect(source).toContain("concurrencyLimit: 1");
    expect(source).toContain("maxAttempts: 3");
    expect(source.match(/maxDuration: 300/g)).toHaveLength(4);
    expect(source).not.toContain("schedules.task");
    expect(source).not.toContain("triggerAndWait");
  });

  it("parses before privileged dependency construction in every run", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/growth-intelligence.ts"),
      "utf8",
    );

    expect(source.match(/tasks\.onCancel\(/g)).toHaveLength(1);
    expect(source).toMatch(
      /const parsed = marketResearchPayloadSchema\.parse\(payload\);\s+const dependencies = createResearchDependencies\(signal\);/,
    );
    expect(source).toMatch(
      /const parsed = consolidationPayloadSchema\.parse\(payload\);\s+const dependencies = createResearchDependencies\(signal\);/,
    );
    expect(source).toMatch(
      /const parsed = dispatchDuePayloadSchema\.parse\(payload\);\s+const supabase = createGrowthIntelligenceWorkerServiceClient\(\);/,
    );
    expect(source).toMatch(
      /const parsed = synthesisPayloadSchema\.parse\(payload\);\s+const dependencies = createSynthesisDependencies\(signal\);/,
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
});
