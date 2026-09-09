import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const testEnv = vi.hoisted(() => ({
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
  AI_DEFAULT_MODEL: "test-model",
}));

vi.mock("@/lib/env", () => ({ env: testEnv }));

import type { EventPublisher } from "@/domain/events/types";
import {
  parseSynthesisOutput,
  toCompactSynthesisInput,
  SYNTHESIS_MODEL_VERSION,
  type SynthesisProvider,
} from "@/modules/growth-intelligence/infrastructure/synthesis-provider";
import type { SynthesisRepository } from "@/modules/growth-intelligence/infrastructure/synthesis-repository";
import {
  createSynthesisService,
  type ExistingSynthesisItem,
} from "@/modules/growth-intelligence/application/synthesis-service";

const organizationId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const claimToken = "30000000-0000-4000-8000-000000000003";
const runId = "40000000-0000-4000-8000-000000000004";
const correlationId = "60000000-0000-4000-8000-000000000006";
const profileVersionId = "70000000-0000-4000-8000-000000000007";
const findingId = "10000000-0000-4000-8000-000000000011";
const claimId = "20000000-0000-4000-8000-000000000022";
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const digestC = "c".repeat(64);

const profile = {
  approvedName: "Kerala Kitchen",
  niches: ["Kerala cuisine"],
  geographies: [{ layer: "city" as const, ref: "ae:du:dubai", name: "Dubai" }],
  topics: ["Local events"],
};

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: findingId,
    digest: digestA,
    code: "DEMAND_SOFTNESS",
    severity: "high" as const,
    headline: "Weekend demand softened across dine-in.",
    limitations: [] as string[],
    analysisRunId: "41000000-0000-4000-8000-000000000040",
    branchId: null,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    currency: "AED",
    valueKind: "money" as const,
    scope: "branch" as const,
    stale: false,
    ...overrides,
  };
}

function claim(overrides: Record<string, unknown> = {}) {
  return {
    id: claimId,
    digest: digestB,
    paraphrase: "A public notice lists a weekend food festival near the trade area.",
    quotation: null,
    geographicLayer: "city" as const,
    geographyRef: "ae:du:dubai",
    supportGrade: "single_source" as const,
    freshness: "current" as const,
    limitations: [] as string[],
    researchRunId: "42000000-0000-4000-8000-000000000040",
    branchId: null,
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    kind: "recommendation",
    narrative: "Prepare additional weekend servings while the festival notice stands.",
    claimIds: [claimId],
    businessFindingIds: [findingId],
    geographicLayer: "city",
    geographyRef: "ae:du:dubai",
    limitations: [],
    staleBusinessEvidence: false,
    missingInput: null,
    ...overrides,
  };
}

function providerReturning(outputs: unknown[]): SynthesisProvider {
  const generate = vi.fn(async () => outputs.shift() ?? { candidates: [] });
  return {
    modelProvider: "test-synthesis",
    modelName: "test-model",
    modelVersion: "growth-synthesis@1",
    generate,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const findings = {
    load: vi.fn(async () => ({
      findings: [finding()],
      fresh: true,
      coverage: { scoped: 1, broaderContext: 0, excludedOutOfWindow: 0 },
    })),
  };
  const claims = { load: vi.fn(async () => [claim()]) };
  const goals = { load: vi.fn(async () => [{ ref: "weekend-covers" }]) };
  const existingItems = { load: vi.fn(async () => []) };
  const provider = providerReturning([{ candidates: [candidate()] }]);
  const synthesis = {
    begin: vi.fn(async () => ({ runId, status: "running", replayed: false })),
    complete: vi.fn(async (_input: Parameters<SynthesisRepository["complete"]>[0]) => ({
      runId,
      status: "completed",
      itemCount: 1,
      supersededItemIds: [],
    })),
    fail: vi.fn(async () => ({ runId, status: "failed" })),
    decide: vi.fn(),
    setPreference: vi.fn(),
    recordFeedback: vi.fn(),
  };
  const events = {
    publish: vi.fn(async (_event: Parameters<EventPublisher["publish"]>[0]) => {}),
  };
  return {
    findings,
    claims,
    goals,
    existingItems,
    provider,
    synthesisVersion: SYNTHESIS_MODEL_VERSION,
    buildCompactInput: toCompactSynthesisInput,
    parseOutput: parseSynthesisOutput,
    synthesis,
    events,
    now: () => new Date("2026-09-03T06:00:00Z"),
    ...overrides,
  };
}

const input = {
  organizationId,
  requestId,
  claimToken,
  branchId: null,
  channelId: null,
  profileVersionId,
  profile,
  correlationId,
};

describe("createSynthesisService", () => {
  it("persists combined business and market evidence and emits committed-outcome events", async () => {
    const deps = dependencies();
    const service = createSynthesisService(deps);
    const result = await service.synthesize(input);
    expect(result.outcome).toBe("completed");
    expect(deps.synthesis.complete).toHaveBeenCalledTimes(1);
    const completed = deps.synthesis.complete.mock.calls[0]![0];
    expect(completed.result.outcome).toBe("completed");
    expect(completed.result.items).toHaveLength(1);
    expect(completed.result.items[0]!.supportGrade).toBe("single_source");
    expect(completed.result.items[0]!.freshness).toBe("current");
    expect(completed.result.items[0]!.urgency).toBe("high");
    expect(completed.result.items[0]!.activityMonth).toBe("2026-09");
    const names = deps.events.publish.mock.calls.map((call) => call[0].eventName);
    expect(names).toContain("growth_intelligence.synthesized");
    expect(names).toContain("growth_intelligence.item_created");
    expect(names).not.toContain("growth_intelligence.item_superseded");
  });

  it("synthesizes business-only evidence as a data gap naming the missing market input", async () => {
    const deps = dependencies({
      claims: { load: vi.fn(async () => []) },
      provider: providerReturning([
        {
          candidates: [
            {
              kind: "data_gap",
              narrative: "No eligible market evidence is current for this synthesis run.",
              claimIds: [],
              businessFindingIds: [findingId],
              geographicLayer: "city",
              geographyRef: "ae:du:dubai",
              limitations: [],
              staleBusinessEvidence: false,
              missingInput: "MARKET_EVIDENCE",
            },
          ],
        },
      ]),
    });
    const result = await createSynthesisService(deps).synthesize(input);
    expect(result.outcome).toBe("completed");
    const completed = deps.synthesis.complete.mock.calls[0]![0];
    expect(completed.result.items[0]!.kind).toBe("data_gap");
    expect(completed.result.items[0]!.missingInput).toBe("MARKET_EVIDENCE");
  });

  it("accepts market-only advice only with a declared stale-data limitation", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          findings: [],
          fresh: false,
          coverage: { scoped: 0, broaderContext: 0, excludedOutOfWindow: 0 },
        })),
      },
      claims: {
        load: vi.fn(async () => [claim({ freshness: "stale" as const })]),
      },
      provider: providerReturning([
        {
          candidates: [
            {
              kind: "insight",
              narrative: "The festival notice is recorded; business evidence is stale.",
              claimIds: [claimId],
              businessFindingIds: [],
              geographicLayer: "city",
              geographyRef: "ae:du:dubai",
              limitations: ["STALE_BUSINESS_EVIDENCE"],
              staleBusinessEvidence: true,
              missingInput: null,
            },
          ],
        },
      ]),
    });
    const result = await createSynthesisService(deps).synthesize(input);
    expect(result.outcome).toBe("completed");
    const completed = deps.synthesis.complete.mock.calls[0]![0];
    expect(completed.result.items[0]!.freshness).toBe("stale");
  });

  it("fails closed when market evidence is missing and no finding can ground a gap", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          findings: [],
          fresh: false,
          coverage: { scoped: 0, broaderContext: 0, excludedOutOfWindow: 0 },
        })),
      },
      claims: { load: vi.fn(async () => []) },
      provider: providerReturning([{ candidates: [] }, { candidates: [] }]),
    });
    const result = await createSynthesisService(deps).synthesize(input);
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.code).toBe("SYNTHESIS_CANDIDATE_INVALID");
    expect(deps.synthesis.complete).not.toHaveBeenCalled();
    expect(deps.events.publish).not.toHaveBeenCalled();
  });

  it("fails closed with a safe code when no valid candidate survives repair", async () => {
    const deps = dependencies({
      provider: providerReturning([
        { candidates: [candidate({ claimIds: [] })] },
        { candidates: [{ kind: "prophecy" }] },
      ]),
    });
    const service = createSynthesisService(deps);
    const result = await service.synthesize(input);
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.code).toBe("SYNTHESIS_CANDIDATE_INVALID");
    expect(deps.provider.generate).toHaveBeenCalledTimes(2);
    expect(deps.synthesis.fail).toHaveBeenCalledTimes(1);
    expect(deps.synthesis.complete).not.toHaveBeenCalled();
    expect(deps.events.publish).not.toHaveBeenCalled();
  });

  it("fails closed when the model output is malformed and repair also fails", async () => {
    const deps = dependencies({
      provider: providerReturning([{ refusal: "nope" }, { candidates: "not-a-list" }]),
    });
    const result = await createSynthesisService(deps).synthesize(input);
    expect(result.outcome).toBe("failed");
    expect(deps.provider.generate).toHaveBeenCalledTimes(2);
    expect(deps.synthesis.fail).toHaveBeenCalledTimes(1);
  });

  it("replays a duplicate run without calling the model or emitting events", async () => {
    const deps = dependencies({
      synthesis: {
        begin: vi.fn(async () => ({ runId, status: "completed", replayed: true })),
        complete: vi.fn(),
        fail: vi.fn(),
        decide: vi.fn(),
        setPreference: vi.fn(),
        recordFeedback: vi.fn(),
      },
    });
    const result = await createSynthesisService(deps).synthesize(input);
    expect(result).toEqual({ outcome: "replayed", runId });
    expect(deps.provider.generate).not.toHaveBeenCalled();
    expect(deps.events.publish).not.toHaveBeenCalled();
  });

  it("emits item_superseded once per committed-outcome id", async () => {
    const supersededItemId = "90000000-0000-4000-8000-000000000009";
    const deps = dependencies({
      existingItems: {
        load: vi.fn(
          async (): Promise<ExistingSynthesisItem[]> => [
            {
              id: supersededItemId,
              kind: "recommendation",
              geographicLayer: "city",
              geographyRef: "ae:du:dubai",
              itemFingerprint: digestC,
              evidenceFingerprint: digestC,
            },
          ],
        ),
      },
      synthesis: {
        begin: vi.fn(async () => ({ runId, status: "running", replayed: false })),
        complete: vi.fn(async () => ({
          runId,
          status: "completed",
          itemCount: 1,
          supersededItemIds: [supersededItemId],
        })),
        fail: vi.fn(async () => ({ runId, status: "failed" })),
        decide: vi.fn(),
        setPreference: vi.fn(),
        recordFeedback: vi.fn(),
      },
    });
    const result = await createSynthesisService(deps).synthesize(input);
    expect(result.outcome).toBe("completed");
    if (result.outcome === "completed") {
      expect(result.createdFingerprints).toHaveLength(1);
      expect(result.supersededItemIds).toEqual([supersededItemId]);
    }
    const superseded = deps.events.publish.mock.calls.filter(
      (call) => call[0].eventName === "growth_intelligence.item_superseded",
    );
    expect(superseded).toHaveLength(1);
    expect(superseded[0]![0].payload).toMatchObject({
      requestId,
      runId,
      supersededItemId,
    });
  });

  it("never emits item_superseded from lineage classification alone", async () => {
    const deps = dependencies({
      existingItems: {
        load: vi.fn(
          async (): Promise<ExistingSynthesisItem[]> => [
            {
              id: "90000000-0000-4000-8000-000000000009",
              kind: "recommendation",
              geographicLayer: "city",
              geographyRef: "ae:du:dubai",
              itemFingerprint: digestC,
              evidenceFingerprint: digestC,
            },
          ],
        ),
      },
    });
    const result = await createSynthesisService(deps).synthesize(input);
    expect(result.outcome).toBe("completed");
    if (result.outcome === "completed") {
      expect(result.createdFingerprints).toHaveLength(1);
      expect(result.supersededItemIds).toEqual([]);
    }
    const names = deps.events.publish.mock.calls.map((call) => call[0].eventName);
    expect(names).toContain("growth_intelligence.item_created");
    expect(names).not.toContain("growth_intelligence.item_superseded");
  });

  it("never forwards raw metrics, report rows, workbook data, customer data, signed URLs, or source pages to the model", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          findings: [
            {
              ...finding(),
              metricValue: 412.5,
              reportRow: { revenue: 99_000 },
              workbookCells: ["A1"],
              customerName: "A private regular",
              signedUrl: "https://storage.example/signed?token=abc",
              sourcePage: "<html>full page</html>",
            },
          ],
          fresh: true,
          coverage: { scoped: 1, broaderContext: 0, excludedOutOfWindow: 0 },
        })),
      },
    });
    await createSynthesisService(deps).synthesize(input);
    const seen = vi.mocked(deps.provider.generate).mock.calls[0]![0];
    const serialized = JSON.stringify(seen.context);
    for (const forbidden of [
      "metricValue",
      "reportRow",
      "workbookCells",
      "customerName",
      "signedUrl",
      "sourcePage",
      "https://",
      "revenue",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("derives deterministic verdicts the model can never choose", async () => {
    const deps = dependencies({
      provider: providerReturning([
        {
          candidates: [
            candidate({
              narrative: "Weekend covers may move with the festival notice.",
              limitations: ["BROADER_MARKET_INFERENCE"],
            }),
          ],
        },
      ]),
      claims: {
        load: vi.fn(async () => [claim({ supportGrade: "corroborated" as const })]),
      },
    });
    await createSynthesisService(deps).synthesize(input);
    const completed = deps.synthesis.complete.mock.calls[0]![0];
    expect(completed.result.items[0]!.supportGrade).toBe("corroborated");
    expect(completed.result.items[0]!.goalAlignment).toBe("none");
  });
});

const branchA = "30000000-0000-4000-8000-000000000030";
const branchB = "30000000-0000-4000-8000-000000000031";
const analysisRunA = "41000000-0000-4000-8000-000000000041";
const analysisRunB = "41000000-0000-4000-8000-000000000042";
const researchRunA = "42000000-0000-4000-8000-000000000042";
const findingA = "11000000-0000-4000-8000-000000000011";
const findingB = "11000000-0000-4000-8000-000000000012";
const findingOrg = "11000000-0000-4000-8000-000000000013";

function branchFinding(overrides: Record<string, unknown> = {}) {
  return {
    ...finding(),
    analysisRunId: analysisRunA,
    branchId: branchA,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    currency: "AED",
    valueKind: "money" as const,
    scope: "branch" as const,
    stale: false,
    ...overrides,
  };
}

function branchClaim(overrides: Record<string, unknown> = {}) {
  return {
    ...claim(),
    researchRunId: researchRunA,
    branchId: branchA,
    ...overrides,
  };
}

const branchInput = { ...input, branchId: branchA };

describe("branch-fenced business synthesis", () => {
  it("threads the exact branch into the findings and claims loaders", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          findings: [branchFinding({ id: findingA })],
          fresh: true,
          coverage: { scoped: 1, broaderContext: 0, excludedOutOfWindow: 0 },
        })),
      },
      claims: { load: vi.fn(async () => [branchClaim()]) },
    });
    await createSynthesisService(deps).synthesize(branchInput);
    expect(deps.findings.load).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, branchId: branchA, channelId: null }),
    );
    expect(deps.claims.load).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, profileVersionId, branchId: branchA }),
    );
  });

  it("advises from branch A evidence only: B and organization findings never reach the provider", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          // The loader already excluded branch B and labelled the
          // organization row broader context; A sales 100 is the metric.
          findings: [
            branchFinding({ id: findingA }),
            {
              ...branchFinding({ id: findingOrg, branchId: null }),
              scope: "broader_context" as const,
            },
          ],
          fresh: true,
          coverage: { scoped: 1, broaderContext: 1, excludedOutOfWindow: 0 },
        })),
      },
      claims: { load: vi.fn(async () => [branchClaim()]) },
      provider: providerReturning([
        {
          candidates: [
            candidate({
              narrative: "Weekend servings track the recorded branch demand.",
              businessFindingIds: [findingA],
            }),
          ],
        },
      ]),
    });
    const result = await createSynthesisService(deps).synthesize(branchInput);
    expect(result.outcome).toBe("completed");
    const seen = vi.mocked(deps.provider.generate).mock.calls[0]![0];
    const findingIds = (seen.context.findings as Array<{ id: string }>).map((entry) => entry.id);
    expect(findingIds).toContain(findingA);
    expect(findingIds).not.toContain(findingB);
    const completed = deps.synthesis.complete.mock.calls[0]![0];
    expect(completed.result.items[0]!.branchId).toBe(branchA);
  });

  it("yields a data gap when branch A has no in-scope findings, never B fallback", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          findings: [
            {
              ...branchFinding({ id: findingOrg, branchId: null }),
              scope: "broader_context" as const,
            },
          ],
          fresh: false,
          coverage: { scoped: 0, broaderContext: 1, excludedOutOfWindow: 0 },
        })),
      },
      claims: { load: vi.fn(async () => []) },
      provider: providerReturning([
        {
          candidates: [
            {
              kind: "data_gap",
              narrative: "No in-scope business evidence is current for this branch.",
              claimIds: [],
              businessFindingIds: [],
              geographicLayer: "city",
              geographyRef: "ae:du:dubai",
              limitations: ["STALE_BUSINESS_EVIDENCE"],
              staleBusinessEvidence: false,
              missingInput: "BRANCH_BUSINESS_EVIDENCE",
            },
          ],
        },
      ]),
    });
    const result = await createSynthesisService(deps).synthesize(branchInput);
    expect(result.outcome).toBe("completed");
    const completed = deps.synthesis.complete.mock.calls[0]![0];
    expect(completed.result.items[0]!.kind).toBe("data_gap");
    expect(completed.result.items[0]!.branchId).toBe(branchA);
  });

  it("fails closed when cited findings mix currencies without a declared limitation", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          findings: [
            branchFinding({ id: findingA, currency: "AED" }),
            branchFinding({ id: findingB, digest: "e".repeat(64), currency: "USD" }),
          ],
          fresh: true,
          coverage: { scoped: 2, broaderContext: 0, excludedOutOfWindow: 0 },
        })),
      },
      claims: { load: vi.fn(async () => [branchClaim()]) },
      provider: providerReturning([
        { candidates: [candidate({ businessFindingIds: [findingA, findingB] })] },
        { candidates: [candidate({ businessFindingIds: [findingA, findingB] })] },
      ]),
    });
    const result = await createSynthesisService(deps).synthesize(branchInput);
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.code).toBe("SYNTHESIS_CANDIDATE_INVALID");
    expect(deps.synthesis.complete).not.toHaveBeenCalled();
  });

  it("accepts mixed currencies only with a declared mixed-measure limitation", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          findings: [
            branchFinding({ id: findingA, currency: "AED" }),
            branchFinding({ id: findingB, digest: "e".repeat(64), currency: "USD" }),
          ],
          fresh: true,
          coverage: { scoped: 2, broaderContext: 0, excludedOutOfWindow: 0 },
        })),
      },
      claims: { load: vi.fn(async () => [branchClaim()]) },
      provider: providerReturning([
        {
          candidates: [
            candidate({
              businessFindingIds: [findingA, findingB],
              limitations: ["MIXED_MEASURE_EVIDENCE"],
            }),
          ],
        },
      ]),
    });
    const result = await createSynthesisService(deps).synthesize(branchInput);
    expect(result.outcome).toBe("completed");
  });

  it("fails closed when cited findings overlap across analysis runs without declaration", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          findings: [
            branchFinding({
              id: findingA,
              analysisRunId: analysisRunA,
              periodStart: "2026-08-01",
              periodEnd: "2026-08-31",
            }),
            branchFinding({
              id: findingB,
              digest: "e".repeat(64),
              analysisRunId: analysisRunB,
              periodStart: "2026-08-15",
              periodEnd: "2026-09-15",
            }),
          ],
          fresh: true,
          coverage: { scoped: 2, broaderContext: 0, excludedOutOfWindow: 0 },
        })),
      },
      claims: { load: vi.fn(async () => [branchClaim()]) },
      provider: providerReturning([
        { candidates: [candidate({ businessFindingIds: [findingA, findingB] })] },
        { candidates: [candidate({ businessFindingIds: [findingA, findingB] })] },
      ]),
    });
    const result = await createSynthesisService(deps).synthesize(branchInput);
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.code).toBe("SYNTHESIS_CANDIDATE_INVALID");
    expect(deps.synthesis.complete).not.toHaveBeenCalled();
  });

  it("fails closed when a stale finding is cited without a stale-data limitation", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          // The loader still reports fresh overall business evidence: this
          // one partial-quality finding is stale on its own.
          findings: [branchFinding({ id: findingA, stale: true })],
          fresh: true,
          coverage: { scoped: 1, broaderContext: 0, excludedOutOfWindow: 0 },
        })),
      },
      claims: { load: vi.fn(async () => [branchClaim()]) },
      provider: providerReturning([
        { candidates: [candidate({ businessFindingIds: [findingA] })] },
        { candidates: [candidate({ businessFindingIds: [findingA] })] },
      ]),
    });
    const result = await createSynthesisService(deps).synthesize(branchInput);
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.code).toBe("SYNTHESIS_CANDIDATE_INVALID");
    expect(deps.synthesis.complete).not.toHaveBeenCalled();
  });

  it("fails closed when broader-context evidence is cited as branch measurement", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          findings: [
            {
              ...branchFinding({ id: findingOrg, branchId: null }),
              scope: "broader_context" as const,
            },
          ],
          fresh: true,
          coverage: { scoped: 0, broaderContext: 1, excludedOutOfWindow: 0 },
        })),
      },
      claims: { load: vi.fn(async () => [branchClaim()]) },
      provider: providerReturning([
        { candidates: [candidate({ businessFindingIds: [findingOrg] })] },
        { candidates: [candidate({ businessFindingIds: [findingOrg] })] },
      ]),
    });
    const result = await createSynthesisService(deps).synthesize(branchInput);
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.code).toBe("SYNTHESIS_CANDIDATE_INVALID");
    expect(deps.synthesis.complete).not.toHaveBeenCalled();
  });

  it("accepts labelled broader context with the broader-inference limitation", async () => {
    const deps = dependencies({
      findings: {
        load: vi.fn(async () => ({
          findings: [
            branchFinding({ id: findingA }),
            {
              ...branchFinding({ id: findingOrg, digest: "f".repeat(64), branchId: null }),
              scope: "broader_context" as const,
            },
          ],
          fresh: true,
          coverage: { scoped: 1, broaderContext: 1, excludedOutOfWindow: 0 },
        })),
      },
      claims: { load: vi.fn(async () => [branchClaim()]) },
      provider: providerReturning([
        {
          candidates: [
            candidate({
              narrative: "Branch demand is recorded; the wider market notice is context only.",
              businessFindingIds: [findingA, findingOrg],
              limitations: ["BROADER_MARKET_INFERENCE"],
            }),
          ],
        },
      ]),
    });
    const result = await createSynthesisService(deps).synthesize(branchInput);
    expect(result.outcome).toBe("completed");
  });
});
