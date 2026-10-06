import { describe, expect, it } from "vitest";

import { briefRevisionSchema, type BriefRevision } from "@/domain/growth-intelligence/brief";
import { DomainError } from "@/lib/errors";
import { executeWatchCreate, type WatchKeyedCreateInput } from "./executors";
import { createWatchProjectAdapter } from "./watch-project-adapter";

const ORG = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";
const REVISION = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-10-05T07:00:00.000Z";
const INPUT = {
  organizationId: ORG, actorId: ACTOR, branchId: BRANCH,
  title: "Watch local demand", question: "What changes in local demand should we act on?",
  mode: "recurring" as const,
  schedule: { cadence: "weekly" as const, localTime: "09:00", timeZone: "Asia/Dubai" },
  researchArea: "Jumeirah", competitors: [{ name: "Public competitor", source: "operator_lead" as const }],
  investigationAreas: ["demand", "offers"] as const,
  idempotencyKey: "watch-creation-proof-00000001",
};

function fixture() {
  const documents: BriefRevision[] = [];
  const creates: Array<Record<string, unknown>> = [];
  let keyExists = false;
  let failure: DomainError | null = null;
  let readFailure: DomainError | null = null;
  let conflictWinner: BriefRevision | null = null;
  let rawDocument: unknown = null;
  let releasedScope = false;
  let sourceScopeOverride: string | undefined;
  let hideKey = false;
  const adapter = createWatchProjectAdapter({
    projects: {
      createProject: async (input) => {
        creates.push(input);
        const replayed = keyExists;
        keyExists = true;
        return { projectId: PROJECT, replayed };
      },
      saveBriefRevision: async (input) => {
        expect(input.pinnedToUpdateId).toBeNull();
        const parsed = briefRevisionSchema.parse(input.document);
        if (conflictWinner) documents.push(conflictWinner);
        if (failure) throw failure;
        documents.push(parsed);
        return { revisionId: REVISION, revisionNumber: 1, replayed: false };
      },
    },
    readLatestBrief: async () => {
      if (readFailure) throw readFailure;
      return rawDocument ?? documents.at(-1) ?? null;
    },
    readCreationKey: async ({ organizationId, idempotencyKey }) =>
      organizationId === ORG && idempotencyKey === INPUT.idempotencyKey && keyExists && !hideKey ? {
        projectId: PROJECT, scopeFingerprint: releasedScope ? null : sourceScopeOverride ?? String(creates[0].scopeFingerprint),
      } : null,
    now: () => new Date(NOW),
    newRevisionId: () => REVISION,
  });
  async function run(extra: Record<string, unknown> = {}) {
    return executeWatchCreate({ ...INPUT, investigationAreas: [...INPUT.investigationAreas], ...extra }, {
      ...adapter,
      listActive: async () => keyExists ? [{ projectId: PROJECT, title: INPUT.title,
        question: INPUT.question, mode: INPUT.mode, scopeFingerprint: null }] : [],
    });
  }
  return { run, adapter, documents, creates,
    setFailure: (next: DomainError | null) => { failure = next; },
    setReadFailure: (next: DomainError) => { readFailure = next; },
    setRawDocument: (next: unknown) => { rawDocument = next; },
    releaseScope: () => { releasedScope = true; },
    setRecordedScope: (next: string) => { sourceScopeOverride = next; },
    hideCreationKey: () => { hideKey = true; },
    setConflictWinner: (next: BriefRevision) => { conflictWinner = next; } };
}

describe("createWatchProjectAdapter", () => {
  it("persists the strict scheduler scope before returning a created receipt", async () => {
    const f = fixture();
    const result = await f.run();
    expect(result.outcome).toBe("created");
    expect(f.documents).toHaveLength(1);
    expect(f.documents[0]).toMatchObject({ revisionNumber: 1, organizationId: ORG,
      projectId: PROJECT, locationId: BRANCH, title: INPUT.title, question: INPUT.question,
      researchArea: INPUT.researchArea, competitors: INPUT.competitors,
      investigationAreas: ["demand", "offers"], evidencePeriods: [],
      businessContextSnapshotId: "00000000-0000-0000-0000-000000000000",
      frequency: "weekly", pinnedToUpdateId: null, createdAtUtc: NOW });
    // The strict source project API must not receive brief-only fields.
    expect(Object.keys(f.creates[0]).sort()).toEqual(["organizationId", "actorId", "branchId",
      "title", "question", "mode", "schedule", "idempotencyKey", "scopeFingerprint"].sort());
  });

  it("recovers a failed brief save on the same source key without creating another project", async () => {
    const f = fixture();
    f.setFailure(new DomainError("DOMAIN_ERROR", "This brief revision could not be saved."));
    await expect(f.run()).rejects.toMatchObject({ code: "DOMAIN_ERROR" });
    expect(f.documents).toHaveLength(0);
    f.setFailure(null);
    const result = await f.run();
    expect(result).toMatchObject({ outcome: "replayed", projectId: PROJECT });
    expect(f.documents).toHaveLength(1);
  });

  it("preserves an existing matching source brief including its later pin and evidence", async () => {
    const f = fixture();
    await f.run();
    const prior = f.documents[0];
    prior.pinnedToUpdateId = "66666666-6666-4666-8666-666666666666";
    const bytes = JSON.stringify(prior);
    const result = await f.run();
    expect(result.outcome).toBe("replayed");
    expect(f.documents).toHaveLength(1);
    expect(JSON.stringify(f.documents[0])).toBe(bytes);
  });

  it("refuses a later scope edit without rewriting the source brief", async () => {
    const f = fixture();
    await f.run();
    f.documents[0].researchArea = "A later source-owner change";
    const bytes = JSON.stringify(f.documents[0]);
    await expect(f.run()).rejects.toMatchObject({ code: "DOMAIN_ERROR" });
    expect(f.documents).toHaveLength(1);
    expect(JSON.stringify(f.documents[0])).toBe(bytes);
  });

  it("refuses changed research-only input on a partial-create retry", async () => {
    const f = fixture();
    f.setFailure(new DomainError("DOMAIN_ERROR", "This brief revision could not be saved."));
    await expect(f.run()).rejects.toMatchObject({ code: "DOMAIN_ERROR" });
    f.setFailure(null);
    await expect(f.run({ researchArea: "A different scope" })).rejects.toMatchObject({ code: "DOMAIN_ERROR" });
    expect(f.creates).toHaveLength(1);
    expect(f.documents).toHaveLength(0);
  });

  it("uses a matching saved brief when the source active scope was released", async () => {
    const f = fixture();
    await f.run();
    f.releaseScope();
    await expect(f.run()).resolves.toMatchObject({ outcome: "replayed", projectId: PROJECT });
    expect(f.documents).toHaveLength(1);
  });

  it("refuses a released source scope without a saved brief", async () => {
    const f = fixture();
    f.setFailure(new DomainError("DOMAIN_ERROR", "This brief revision could not be saved."));
    await expect(f.run()).rejects.toMatchObject({ code: "DOMAIN_ERROR" });
    f.releaseScope();
    f.setFailure(null);
    await expect(f.run()).rejects.toMatchObject({ code: "DOMAIN_ERROR" });
    expect(f.creates).toHaveLength(1);
    expect(f.documents).toHaveLength(0);
  });

  it("refuses a differently scoped same-key creation race before saving any brief", async () => {
    const f = fixture();
    f.setRecordedScope("0".repeat(64));
    await expect(f.run()).rejects.toMatchObject({ code: "DOMAIN_ERROR" });
    expect(f.creates).toHaveLength(1);
    expect(f.documents).toHaveLength(0);
  });

  it("requires the committed source create-key record before saving a brief", async () => {
    const f = fixture();
    f.hideCreationKey();
    await expect(f.run()).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });
    expect(f.documents).toHaveLength(0);
  });

  it("refuses a cross-tenant source brief instead of overwriting it", async () => {
    const f = fixture();
    await f.run();
    f.documents[0].organizationId = "77777777-7777-4777-8777-777777777777";
    await expect(f.run()).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
    expect(f.documents).toHaveLength(1);
  });

  it("joins a concurrently saved matching brief after a governed save conflict", async () => {
    const seed = fixture();
    await seed.run();
    const f = fixture();
    f.setConflictWinner(seed.documents[0]);
    f.setFailure(new DomainError("DOMAIN_ERROR", "This brief revision was already saved with different details; reload and try again."));
    const result = await f.run();
    expect(result.outcome).toBe("created");
    expect(f.documents).toHaveLength(1);
  });

  it("does not turn a source authorization refusal into a successful watch", async () => {
    const seed = fixture();
    await seed.run();
    const f = fixture();
    f.setConflictWinner(seed.documents[0]);
    f.setFailure(new DomainError("AUTHORIZATION_ERROR", "Permission revoked."));
    await expect(f.run()).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("does not treat a failed source brief read as a missing brief", async () => {
    const f = fixture();
    f.setReadFailure(new DomainError("INTEGRATION_ERROR", "The source brief could not be read."));
    await expect(f.run()).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });
    expect(f.documents).toHaveLength(0);
  });

  it("does not overwrite a malformed source brief", async () => {
    const f = fixture();
    f.setRawDocument({ organizationId: ORG, projectId: PROJECT, researchArea: "unvalidated" });
    await expect(f.run()).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(f.documents).toHaveLength(0);
  });

  it("does not join a concurrent winner with different branch scope", async () => {
    const seed = fixture();
    await seed.run();
    const f = fixture();
    f.setConflictWinner({ ...seed.documents[0], locationId: "88888888-8888-4888-8888-888888888888" });
    f.setFailure(new DomainError("DOMAIN_ERROR", "This brief revision was already saved with different details; reload and try again."));
    await expect(f.run()).rejects.toMatchObject({ code: "DOMAIN_ERROR" });
    expect(f.documents).toHaveLength(1);
  });

  it("uses once for a one-time watch and no fabricated evidence window", async () => {
    const f = fixture();
    await f.run({ mode: "one-time", schedule: undefined });
    expect(f.documents[0]).toMatchObject({ frequency: "once", evidencePeriods: [] });
  });

  it("rejects a forged scope fingerprint before any source write", async () => {
    const f = fixture();
    let input: WatchKeyedCreateInput | null = null;
    await executeWatchCreate({ ...INPUT, investigationAreas: [...INPUT.investigationAreas] }, {
      listActive: async () => [], createKeyed: async (next) => {
        input = next; return { projectId: PROJECT, replayed: false };
      },
    });
    if (!input) throw new Error("No validated input.");
    await expect(f.adapter.createKeyed({ ...(input as WatchKeyedCreateInput), scopeFingerprint: "0".repeat(64) }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(f.creates).toHaveLength(0);
  });
});
