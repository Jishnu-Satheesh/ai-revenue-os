import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { MemorySearchRow } from "@/modules/memory/application/ports";
import {
  createSubjectPackPort,
  type SubjectPackDependencies,
} from "@/modules/memory/application/subject-pack";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000002";
const CORRELATION_ID = "30000000-0000-4000-8000-000000000003";
const NOW_ISO = "2026-09-13T12:00:00.000Z";

const memoryRow: MemorySearchRow = {
  id: "60000000-0000-4000-8000-000000000006",
  memory_type: "note",
  title: "Evening prep note",
  body: "Two staff on Fridays.",
  structured_value: null,
  origin: "system_generated",
  source_tier: 2,
  source_system: null,
  source_reference: null,
  verification_state: "unverified",
  verified_at: null,
  confidence: null,
  sensitivity: "internal",
  observed_at: "2026-09-01T10:00:00.000Z",
  effective_from: null,
  effective_to: null,
  superseded_by_id: null,
  trust_rank: 2,
  freshness: "fresh",
  lexical: 3,
  semantic: 0,
  blended: 3,
};

function dependencies(
  overrides: Partial<{
    stateThrows: boolean;
    searchRows: MemorySearchRow[];
    revalidateStatuses: ("valid" | "changed" | "revoked" | "unavailable")[];
  }> = {},
): SubjectPackDependencies & {
  search: ReturnType<typeof vi.fn>;
  prepareForSubject: ReturnType<typeof vi.fn>;
  revalidateForSubject: ReturnType<typeof vi.fn>;
  consumeForSubject: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn(async () => overrides.searchRows ?? [memoryRow]);
  const prepareForSubject = vi.fn(async () => ({
    manifestId: "70000000-0000-4000-8000-000000000007",
    contextDigest: "a".repeat(64),
    status: "ready",
    selectedCount: 1,
    selectedBytes: 10,
  }));
  const statuses = [...(overrides.revalidateStatuses ?? ["valid"])];
  const revalidateForSubject = vi.fn(async () => ({
    manifestId: "70000000-0000-4000-8000-000000000007",
    status: statuses.shift() ?? "valid",
  }));
  const consumeForSubject = vi.fn(async () => ({ manifestId: "x", state: "consumed" }));
  const readState = vi.fn(async () => {
    if (overrides.stateThrows) throw new Error("state store is down");
    return {
      profile: {
        organization_id: ORGANIZATION_ID,
        business_model: "Dine-in",
        value_proposition: "Family tables",
      },
      facts: [
        {
          fact: {
            id: "40000000-0000-4000-8000-000000000004",
            fact_key: "avg_ticket",
            status: "verified",
            source: "pos",
            value: 42,
            branch_id: null,
            effective_from: null,
            effective_to: null,
          },
          scope: "organization" as const,
          conflict: null,
        },
      ],
    };
  });
  return {
    readState,
    persistence: { search },
    contexts: { prepareForSubject, revalidateForSubject, consumeForSubject },
    nowIso: () => NOW_ISO,
    search,
    prepareForSubject,
    revalidateForSubject,
    consumeForSubject,
  };
}

const input = {
  organizationId: ORGANIZATION_ID,
  actorId: ACTOR_ID,
  query: "Kerala fish curry",
  correlationId: CORRELATION_ID,
};

describe("subject pack composer", () => {
  it("pins current state plus memory through the subject purpose with canonical summaries", async () => {
    const deps = dependencies();
    const pack = await createSubjectPackPort(deps).prepare(input);

    expect(deps.search).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        memoryTypes: ["document", "note", "episode"],
        sensitivities: ["public", "internal"],
        includeSuperseded: false,
        includeExpired: false,
        includeLegacy: false,
        limit: 12,
      }),
    );
    const preparedEntries = deps.prepareForSubject.mock.calls[0]?.[0]?.entries as {
      sourceKind: string;
      summary: string;
    }[];
    const byKind = new Map(preparedEntries.map((entry) => [entry.sourceKind, entry.summary]));
    expect(byKind.get("business_profile")).toBe("Dine-in\nFamily tables");
    expect(byKind.get("business_fact")).toBe("avg_ticket [verified] pos :: 42");
    expect(byKind.get("memory_item")).toBe("Evening prep note\nTwo staff on Fridays.");
    expect(deps.prepareForSubject).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        actorId: ACTOR_ID,
        purpose: "subject_drafting",
        correlationId: CORRELATION_ID,
        policyVersion: "shared-context-v1",
      }),
    );
    expect(pack.manifestId).toBe("70000000-0000-4000-8000-000000000007");
    expect(pack.entries.length).toBeGreaterThan(0);
    expect(pack.entries.every((entry) => entry.contextRef.startsWith("ctx-"))).toBe(true);
  });

  it("keeps goals and constraints out of drafting packs", async () => {
    const deps = dependencies();
    const preparedEntries = vi.fn();
    deps.prepareForSubject.mockImplementation(async (args: {
      entries: { sourceKind: string }[] | null;
    }) => {
      preparedEntries(args.entries);
      return {
        manifestId: "70000000-0000-4000-8000-000000000007",
        contextDigest: "a".repeat(64),
        status: "ready",
        selectedCount: 0,
        selectedBytes: 0,
      };
    });
    await createSubjectPackPort(deps).prepare(input);
    const kinds = (preparedEntries.mock.calls[0]?.[0] as { sourceKind: string }[]).map(
      (entry) => entry.sourceKind,
    );
    expect(kinds).not.toContain("goal");
    expect(kinds).not.toContain("constraint");
  });

  it("rebuilds once when the pinned manifest changed, then proceeds empty", async () => {
    const deps = dependencies({ revalidateStatuses: ["changed", "revoked"] });
    const pack = await createSubjectPackPort(deps).prepare(input);

    expect(deps.prepareForSubject).toHaveBeenCalledTimes(2);
    expect(deps.prepareForSubject.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ correlationId: CORRELATION_ID }),
    );
    expect(pack.entries).toEqual([]);
    expect(pack.status).toBe("revoked");
  });

  it("stays available memory-only when current state cannot be read", async () => {
    const deps = dependencies({ stateThrows: true });
    const pack = await createSubjectPackPort(deps).prepare(input);

    expect(pack.entries.map((entry) => entry.sourceKind)).toEqual(["memory_item"]);
    expect(pack.degradedReasons).toContain("CURRENT_STATE_UNAVAILABLE");
    expect(deps.consumeForSubject).not.toHaveBeenCalled();
  });

  it("consumes the pinned manifest with the drafting model identity", async () => {
    const deps = dependencies();
    await createSubjectPackPort(deps).consume({
      organizationId: ORGANIZATION_ID,
      manifestId: "70000000-0000-4000-8000-000000000007",
      modelId: "gemini-subject-draft",
      modelCalledAt: NOW_ISO,
    });

    expect(deps.consumeForSubject).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      manifestId: "70000000-0000-4000-8000-000000000007",
      providerName: "campaign-subject-drafter",
      modelId: "gemini-subject-draft",
      modelCalledAt: NOW_ISO,
    });
  });
});
