import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";
import { createStudioRepository } from "@/modules/creative-studio/infrastructure/repository";

const ORG = "00000000-0000-4000-8000-000000000001";
const RUN = "00000000-0000-4000-8000-000000000002";
const LEASE = "00000000-0000-4000-8000-000000000003";
const DIGEST = "a".repeat(64);

function mockClient(implementation: (fn: string, args: unknown) => unknown) {
  const rpc = vi.fn(async (fn: string, args: unknown) => implementation(fn, args));
  const client = { rpc } as unknown as SupabaseClient<Database>;
  return { client, rpc };
}

function ok<T>(data: T) {
  return { data, error: null };
}

function fails(message: string) {
  return { data: null, error: { message } };
}

describe("studio repository rpc mappings", () => {
  it("saves a document through the fenced writer", async () => {
    const { client, rpc } = mockClient(() =>
      ok({ id: RUN, revision: 2 }),
    );
    const repository = createStudioRepository(client);

    const receipt = await repository.saveDocument({
      organizationId: ORG,
      document: { id: RUN, expectedRevision: 1, title: "Poster" },
    });

    expect(receipt).toEqual({ id: RUN, revision: 2 });
    expect(rpc).toHaveBeenCalledWith("save_studio_document", {
      target_organization_id: ORG,
      input_document: { id: RUN, expectedRevision: 1, title: "Poster" },
    });
  });

  it("reports a stale document revision in plain words", async () => {
    const { client } = mockClient(() => fails("studio_document_stale_revision"));
    const repository = createStudioRepository(client);

    await expect(
      repository.saveDocument({ organizationId: ORG, document: {} }),
    ).rejects.toThrow(DomainError);
    await expect(
      repository.saveDocument({ organizationId: ORG, document: {} }),
    ).rejects.toThrow(/changed this document/i);
  });

  it("admits a run and maps the reservation receipt", async () => {
    const { client, rpc } = mockClient(() =>
      ok({
        runId: RUN,
        replayed: false,
        state: "queued",
        reservationMinor: 1000,
        policyVersion: 4,
      }),
    );
    const repository = createStudioRepository(client);

    const admission = await repository.admitRun({
      organizationId: ORG,
      run: { operation: "generate" },
    });

    expect(admission.reservationMinor).toBe(1000);
    expect(rpc).toHaveBeenCalledWith("admit_studio_run", {
      target_organization_id: ORG,
      input_run: { operation: "generate" },
    });
  });

  it("maps each admission refusal to its own plain message", async () => {
    const cases: Array<[string, RegExp]> = [
      ["studio_run_no_policy", /not enabled/i],
      ["studio_run_window_ceiling_exceeded", /budget for this window/i],
      ["studio_run_too_many_pending", /already waiting/i],
      ["studio_run_document_busy", /already working/i],
      ["studio_run_key_conflict", /already used/i],
    ];
    for (const [code, pattern] of cases) {
      const { client } = mockClient(() => fails(code));
      const repository = createStudioRepository(client);
      await expect(
        repository.admitRun({ organizationId: ORG, run: {} }),
      ).rejects.toThrow(pattern);
    }
  });

  it("claims a run and returns the lease", async () => {
    const { client } = mockClient(() =>
      ok({
        runId: RUN,
        leaseToken: LEASE,
        leaseExpiresAt: "2026-09-26T00:00:00Z",
        state: "queued",
      }),
    );
    const repository = createStudioRepository(client);

    const claim = await repository.claimRun({
      runId: RUN,
      workerId: "worker-1",
      leaseSeconds: 600,
    });

    expect(claim.leaseToken).toBe(LEASE);
  });

  it("refuses a heartbeat that did not return true", async () => {
    const { client } = mockClient(() => ok(false));
    const repository = createStudioRepository(client);

    await expect(
      repository.heartbeatRun({ runId: RUN, leaseToken: LEASE }),
    ).rejects.toThrow(/lease/);
  });

  it("appends an event and returns the database sequence", async () => {
    const { client, rpc } = mockClient(() => ok(42));
    const repository = createStudioRepository(client);

    const sequence = await repository.appendRunEvent({
      runId: RUN,
      leaseToken: LEASE,
      event: { kind: "studio.run.references_prepared" },
    });

    expect(sequence).toBe(42);
    expect(rpc).toHaveBeenCalledWith("append_studio_run_event", {
      target_run_id: RUN,
      target_lease_token: LEASE,
      input_event: { kind: "studio.run.references_prepared" },
    });
  });

  it("completes a run and maps the version receipt", async () => {
    const { client } = mockClient(() =>
      ok({
        runId: RUN,
        state: "ready",
        versionId: RUN,
        ordinal: 1,
        branch: false,
        linkStatus: "none",
        eventSequence: 7,
      }),
    );
    const repository = createStudioRepository(client);

    const completion = await repository.completeRun({
      runId: RUN,
      leaseToken: LEASE,
      result: {},
    });

    expect(completion.ordinal).toBe(1);
    expect(completion.branch).toBe(false);
  });

  it("rejects a malformed receipt instead of passing it on", async () => {
    const { client } = mockClient(() => ok({ runId: "not-a-uuid" }));
    const repository = createStudioRepository(client);

    await expect(
      repository.completeRun({ runId: RUN, leaseToken: LEASE, result: {} }),
    ).rejects.toThrow(/unexpected shape/);
  });

  it("cancels a run and reports an already-terminal run honestly", async () => {
    const { client } = mockClient(() =>
      ok({ runId: RUN, state: "ready", alreadyTerminal: true }),
    );
    const repository = createStudioRepository(client);

    const receipt = await repository.cancelRun({
      organizationId: ORG,
      runId: RUN,
    });

    expect(receipt.alreadyTerminal).toBe(true);
  });

  it("creates an export run with zero reservation", async () => {
    const { client } = mockClient(() =>
      ok({ exportId: RUN, replayed: false, runId: LEASE }),
    );
    const repository = createStudioRepository(client);

    const admission = await repository.createExport({
      organizationId: ORG,
      exportRequest: { versionId: RUN },
    });

    expect(admission.exportId).toBe(RUN);
    expect(admission.replayed).toBe(false);
  });

  it("refuses to accept an export against a malformed hash before calling", async () => {
    const { client, rpc } = mockClient(() => ok({}));
    const repository = createStudioRepository(client);

    await expect(
      repository.acceptExport({
        organizationId: ORG,
        exportId: RUN,
        expectedContentHash: "not-a-hash",
        idempotencyKey: "accept-key-000000001",
      }),
    ).rejects.toThrow(DomainError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts an export against exact bytes", async () => {
    const { client, rpc } = mockClient(() =>
      ok({ acceptanceId: RUN, replayed: false }),
    );
    const repository = createStudioRepository(client);

    const receipt = await repository.acceptExport({
      organizationId: ORG,
      exportId: RUN,
      expectedContentHash: DIGEST,
      idempotencyKey: "accept-key-000000001",
    });

    expect(receipt.acceptanceId).toBe(RUN);
    expect(rpc).toHaveBeenCalledWith("accept_studio_export", {
      target_organization_id: ORG,
      target_export_id: RUN,
      expected_content_hash: DIGEST,
      idempotency_key: "accept-key-000000001",
    });
  });

  it("maps worker export failures to their own plain messages", async () => {
    const cases: Array<[string, RegExp]> = [
      ["studio_export_not_found", /no longer exists/i],
      ["studio_export_receipt_mismatch", /does not match the admitted/i],
    ];
    for (const [code, pattern] of cases) {
      const { client } = mockClient(() => fails(code));
      const repository = createStudioRepository(client);
      await expect(
        repository.completeExport({
          organizationId: ORG,
          exportId: RUN,
          receipt: {},
        }),
      ).rejects.toThrow(pattern);
    }
  });

  it("saves a policy version and maps worker settlements", async () => {
    const { client } = mockClient((fn: string) => {
      if (fn === "save_studio_generation_policy") return ok({ version: 5 });
      if (fn === "fail_studio_run")
        return ok({ runId: RUN, state: "failed", eventSequence: 3 });
      if (fn === "reconcile_studio_run")
        return ok({ runId: RUN, state: "ready", versionId: RUN });
      if (fn === "complete_studio_upload")
        return ok({ uploadId: RUN, state: "ready", replayed: false });
      if (fn === "complete_studio_export")
        return ok({ exportId: RUN, state: "ready", replayed: false });
      throw new Error(`unexpected rpc ${fn}`);
    });
    const repository = createStudioRepository(client);

    await expect(
      repository.savePolicy({ organizationId: ORG, policy: {} }),
    ).resolves.toEqual({ version: 5 });
    await expect(
      repository.failRun({ runId: RUN, leaseToken: LEASE, failure: {} }),
    ).resolves.toMatchObject({ state: "failed" });
    await expect(
      repository.reconcileRun({ runId: RUN, receipt: {} }),
    ).resolves.toMatchObject({ state: "ready" });
    await expect(
      repository.completeUpload({
        organizationId: ORG,
        uploadId: RUN,
        receipt: {},
      }),
    ).resolves.toMatchObject({ state: "ready" });
    await expect(
      repository.completeExport({
        organizationId: ORG,
        exportId: RUN,
        receipt: {},
      }),
    ).resolves.toMatchObject({ state: "ready" });
  });

  it("reserves an upload through the fenced writer", async () => {
    const { client, rpc } = mockClient(() =>
      ok({
        uploadId: RUN,
        reservedPath: `${ORG}/${RUN}/hero.png`,
        expiresAt: "2026-09-26T01:00:00Z",
      }),
    );
    const repository = createStudioRepository(client);

    const receipt = await repository.reserveUpload({
      organizationId: ORG,
      upload: { kind: "design" },
    });

    expect(receipt.uploadId).toBe(RUN);
    expect(rpc).toHaveBeenCalledWith("reserve_studio_upload", {
      target_organization_id: ORG,
      input_upload: { kind: "design" },
    });
  });
});
