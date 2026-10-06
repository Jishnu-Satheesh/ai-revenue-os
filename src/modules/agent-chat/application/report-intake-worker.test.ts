import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/reports/application/dispatch", () => ({
  requestReportPackageProfiling: vi.fn(),
}));

import {
  copyVerifiedStagingObject,
  processAgentAttachment,
  processAgentAttachmentWithPorts,
} from "./report-intake-worker";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const ids = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  turnId: "22222222-2222-4222-8222-222222222222",
  attachmentId: "33333333-3333-4333-8333-333333333333",
  leaseToken: "44444444-4444-4444-8444-444444444444",
};
const scope = {
  channelId: "55555555-5555-4555-8555-555555555555",
  branchId: "66666666-6666-4666-8666-666666666666",
  reportType: "Talabat sales",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  currency: "AED",
};
const digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function ports(overrides: Record<string, unknown> = {}) {
  return {
    load: vi.fn(async () => ({
      ...ids,
      createdBy: "77777777-7777-4777-8777-777777777777",
      fileName: "sales.csv",
      mediaType: "text/csv",
      byteSize: 3,
      bucket: "agent-report-staging" as const,
      path: `${ids.organizationId}/${ids.turnId}/${ids.attachmentId}`,
      expiresAt: "2099-01-01T00:00:00Z",
      status: "awaiting_upload" as const,
      digest: null,
      packageId: null,
      scope,
      correctionChoice: null,
    })),
    download: vi.fn(async () => Buffer.from("abc")),
    verify: vi.fn(async () => {}),
    listPrior: vi.fn(async () => []),
    setChallenge: vi.fn(async () => "88888888-8888-4888-8888-888888888888"),
    keepExisting: vi.fn(async () => {}),
    waitForDuplicateVerification: vi.fn(async () => {}),
    promote: vi.fn(async () => "99999999-9999-4999-8999-999999999999"),
    ...overrides,
  };
}

describe("worker report intake", () => {
  it("hashes staged bytes before an exact duplicate can be reused", async () => {
    const deps = ports({
      listPrior: vi.fn(async () => [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ...scope, digest },
      ]),
      promote: vi.fn(async () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    });
    const result = await processAgentAttachmentWithPorts(ids, deps);
    expect(result).toEqual({
      kind: "exact_duplicate",
      packageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(deps.verify).toHaveBeenCalledWith(expect.objectContaining({ digest }));
    expect(deps.promote).toHaveBeenCalledWith(
      expect.objectContaining({ existingPackageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    );
  });

  it("asks a person before changing bytes in the same report scope", async () => {
    const deps = ports({
      listPrior: vi.fn(async () => [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ...scope, digest: "b".repeat(64) },
      ]),
    });
    const result = await processAgentAttachmentWithPorts(ids, deps);
    expect(result.kind).toBe("correction_required");
    expect(deps.setChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "correction",
        priorPackageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    );
    expect(deps.promote).not.toHaveBeenCalled();
  });

  it("resumes a correction only after the stored human choice, without approving replacement", async () => {
    const priorPackageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const correctedPackageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const deps = ports({
      load: vi.fn(async () => ({
        ...ids,
        createdBy: "77777777-7777-4777-8777-777777777777",
        fileName: "sales.csv",
        mediaType: "text/csv",
        byteSize: 3,
        bucket: "agent-report-staging" as const,
        path: `${ids.organizationId}/${ids.turnId}/${ids.attachmentId}`,
        expiresAt: "2099-01-01T00:00:00Z",
        status: "verified" as const,
        digest,
        packageId: null,
        scope,
        correctionChoice: "submit_for_review",
      })),
      listPrior: vi.fn(async () => [{ id: priorPackageId, ...scope, digest: "b".repeat(64) }]),
      promote: vi.fn(async () => correctedPackageId),
    });
    const result = await processAgentAttachmentWithPorts(ids, deps);
    expect(result).toEqual({
      kind: "correction_submitted",
      packageId: correctedPackageId,
      priorPackageId,
    });
    expect(deps.setChallenge).not.toHaveBeenCalled();
    expect(deps.promote).toHaveBeenCalledWith(
      expect.not.objectContaining({ existingPackageId: priorPackageId }),
    );
  });

  it("keeps the prior package when the person declines a changed file", async () => {
    const priorPackageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const deps = ports({
      load: vi.fn(async () => ({
        ...ids,
        createdBy: "77777777-7777-4777-8777-777777777777",
        fileName: "sales.csv",
        mediaType: "text/csv",
        byteSize: 3,
        bucket: "agent-report-staging" as const,
        path: `${ids.organizationId}/${ids.turnId}/${ids.attachmentId}`,
        expiresAt: "2099-01-01T00:00:00Z",
        status: "verified" as const,
        digest,
        packageId: null,
        scope,
        correctionChoice: "keep_existing",
      })),
      listPrior: vi.fn(async () => [{ id: priorPackageId, ...scope, digest: "b".repeat(64) }]),
    });
    expect(await processAgentAttachmentWithPorts(ids, deps)).toEqual({
      kind: "kept_existing",
      packageId: priorPackageId,
    });
    expect(deps.promote).not.toHaveBeenCalled();
    expect(deps.keepExisting).toHaveBeenCalledWith(
      expect.objectContaining({ packageId: priorPackageId }),
    );
  });

  it("waits for an identical active package to finish source verification without creating another", async () => {
    const packageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const deps = ports({
      listPrior: vi.fn(async () => [
        { id: packageId, ...scope, digest, verificationPending: true },
      ]),
    });
    expect(await processAgentAttachmentWithPorts(ids, deps)).toEqual({
      kind: "duplicate_verification_pending",
      packageId,
    });
    expect(deps.waitForDuplicateVerification).toHaveBeenCalledWith(
      expect.objectContaining({ packageId }),
    );
    expect(deps.promote).not.toHaveBeenCalled();
  });

  it("does not submit an unverified older package as an exact duplicate", async () => {
    const deps = ports({
      listPrior: vi.fn(async () => [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ...scope, digest: null },
      ]),
    });
    expect((await processAgentAttachmentWithPorts(ids, deps)).kind).toBe("correction_required");
    expect(deps.promote).not.toHaveBeenCalled();
  });

  it("does not trust incomplete object bytes", async () => {
    const deps = ports({ download: vi.fn(async () => Buffer.from("ab")) });
    await expect(processAgentAttachmentWithPorts(ids, deps)).rejects.toThrow("size");
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it("refuses binary content declared as a CSV before digest reuse", async () => {
    const deps = ports({ download: vi.fn(async () => Buffer.from([0, 1, 2])) });
    await expect(processAgentAttachmentWithPorts(ids, deps)).rejects.toThrow("INVALID_FILE_TYPE");
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.listPrior).not.toHaveBeenCalled();
  });

  it("checks an XLSX archive instead of trusting its filename", async () => {
    const deps = ports({
      load: vi.fn(async () => ({
        ...ids,
        createdBy: "77777777-7777-4777-8777-777777777777",
        fileName: "sales.xlsx",
        mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        byteSize: 3,
        bucket: "agent-report-staging" as const,
        path: `${ids.organizationId}/${ids.turnId}/${ids.attachmentId}`,
        expiresAt: "2099-01-01T00:00:00Z",
        status: "awaiting_upload" as const,
        digest: null,
        packageId: null,
        scope,
        correctionChoice: null,
      })),
    });
    await expect(processAgentAttachmentWithPorts(ids, deps)).rejects.toThrow("UNREADABLE_WORKBOOK");
    expect(deps.promote).not.toHaveBeenCalled();
  });
});

describe("governed report object copy", () => {
  it("reconciles a prior successful copy by checking the destination digest", async () => {
    const copy = vi.fn(async () => false);
    const downloadDestination = vi.fn(async () => Buffer.from("abc"));
    await expect(
      copyVerifiedStagingObject(
        {
          sourcePath: "staging/original",
          destinationPath: "governed/report.csv",
          expectedDigest: digest,
        },
        { copy, downloadDestination },
      ),
    ).resolves.toBeUndefined();
    expect(copy).toHaveBeenCalledOnce();
    expect(downloadDestination).toHaveBeenCalledWith("governed/report.csv");
  });

  it("refuses a conflicting destination even when the copy call reports success", async () => {
    await expect(
      copyVerifiedStagingObject(
        {
          sourcePath: "staging/original",
          destinationPath: "governed/report.csv",
          expectedDigest: digest,
        },
        {
          copy: async () => true,
          downloadDestination: async () => Buffer.from("different"),
        },
      ),
    ).rejects.toThrow("differ");
  });
});

describe("concrete report scope adapter", () => {
  it("reads the exact tenant user message and reuses a report without a metadata questionnaire", async () => {
    const threadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const messageId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const packageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const declared = {
      ...scope,
      reportType: "performance_daily",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-30",
    };
    const rows: Record<string, unknown> = {
      agent_turns: {
        thread_id: threadId,
        user_message_id: messageId,
        challenge_answers: null,
        answered_challenge_kind: null,
      },
      agent_messages: {
        body: "This is a Talabat performance report from Oct 1 to Oct 30 - 2026. What do you think about it?",
      },
      agent_attachments: {
        id: ids.attachmentId,
        organization_id: ids.organizationId,
        turn_id: ids.turnId,
        created_by: "77777777-7777-4777-8777-777777777777",
        file_name: "sales.csv",
        media_type: "text/csv",
        byte_size: 3,
        storage_bucket_id: "agent-report-staging",
        storage_path: `${ids.organizationId}/${ids.turnId}/${ids.attachmentId}/original`,
        upload_expires_at: "2099-01-01T00:00:00Z",
        status: "awaiting_upload",
        sha256_digest: null,
        package_id: null,
        declared_scope: null,
      },
      organization_channels: [{ id: scope.channelId, display_name: "Talabat", key: "talabat" }],
      channel_source_aliases: [],
      organization_channel_branches: [],
      branches: [{ id: scope.branchId, name: "Downtown", currency: "AED" }],
      integration_report_packages: [
        {
          id: packageId,
          channel_id: scope.channelId,
          branch_id: scope.branchId,
          report_type: declared.reportType,
          declared_period_start: declared.periodStart,
          declared_period_end: declared.periodEnd,
          declared_currency: "AED",
          content_sha256: digest,
          status: "projected",
        },
      ],
    };
    const filters: { table: string; key: string; value: unknown }[] = [];
    const from = (table: string) => {
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        eq: (key: string, value: unknown) => {
          filters.push({ table, key, value });
          return query;
        },
        single: async () => ({ data: rows[table], error: null }),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: rows[table], error: null }).then(resolve),
      };
      return query;
    };
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => {
      void _name;
      void _args;
      return { data: {}, error: null };
    });
    const supabase = {
      rpc,
      from,
      storage: {
        from: () => ({ download: async () => ({ data: new Blob(["abc"]), error: null }) }),
      },
    } as unknown as SupabaseClient<Database>;
    expect(await processAgentAttachment({ ...ids, supabase })).toEqual({
      kind: "exact_duplicate",
      packageId,
    });
    expect(rpc).toHaveBeenCalledWith(
      "resolve_agent_attachment_scope",
      expect.objectContaining({ p_scope: declared }),
    );
    expect(rpc.mock.calls.some(([name]) => name === "set_agent_turn_challenge")).toBe(false);
    expect(filters.filter((filter) => filter.table === "agent_messages")).toEqual([
      { table: "agent_messages", key: "organization_id", value: ids.organizationId },
      { table: "agent_messages", key: "thread_id", value: threadId },
      { table: "agent_messages", key: "id", value: messageId },
      { table: "agent_messages", key: "role", value: "user" },
    ]);
  });
});
