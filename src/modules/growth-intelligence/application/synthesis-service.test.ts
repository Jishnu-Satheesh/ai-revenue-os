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
  const findings = { load: vi.fn(async () => ({ findings: [finding()], fresh: true })) };
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
      findings: { load: vi.fn(async () => ({ findings: [], fresh: false })) },
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
      findings: { load: vi.fn(async () => ({ findings: [], fresh: false })) },
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
