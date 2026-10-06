import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { REPORT_PACKAGE_LIMITS } from "@/domain/reports/types";
import { reportPackageUploadIntentSchema } from "@/domain/reports/schemas";
import { PROVIDER_REPORT_DEFINITIONS } from "@/domain/reports/provider-library";
import type { Database } from "@/lib/supabase/database.types";
import { requestReportPackageProfiling } from "@/modules/reports/application/dispatch";
import { profileCsvBuffer, profileXlsxBuffer, ReportProfileFailure } from "@/workflows/reports/profile-report-package";
import { attachmentIntentSchema } from "./report-intake-api";
import { resolveAgentReportScope, type AgentReportMetadataField, type AgentReportScopeMetadata } from "./report-intake-scope";
import {
  agentReportScopeSchema,
  classifyReportAttachment,
  type AgentReportScope,
  type PriorReportIdentity,
} from "./report-intake";

export type AgentAttachmentWorkerInput = {
  organizationId: string;
  turnId: string;
  attachmentId: string;
  leaseToken: string;
};

export type StagedAgentAttachment = {
  organizationId: string;
  turnId: string;
  attachmentId: string;
  createdBy: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  bucket: "agent-report-staging";
  path: string;
  expiresAt: string;
  status: "awaiting_upload" | "verified" | "promoted" | "failed" | "expired";
  digest: string | null;
  packageId: string | null;
  scope: AgentReportScope | null;
  correctionChoice: "submit_for_review" | "keep_existing" | null;
};

export type AgentAttachmentWorkerPorts = {
  load: (input: AgentAttachmentWorkerInput) => Promise<StagedAgentAttachment>;
  download: (input: { bucket: "agent-report-staging"; path: string }) => Promise<Buffer>;
  verify: (input: AgentAttachmentWorkerInput & { digest: string; scope: AgentReportScope | null }) => Promise<void>;
  listPrior: (input: { organizationId: string; scope: AgentReportScope }) => Promise<readonly PriorReportIdentity[]>;
  waitForDuplicateVerification: (input: AgentAttachmentWorkerInput & { packageId: string }) => Promise<void>;
  keepExisting: (input: AgentAttachmentWorkerInput & { packageId: string }) => Promise<void>;
  setChallenge: (input: AgentAttachmentWorkerInput & {
    kind: "metadata" | "correction";
    priorPackageId?: string;
  }) => Promise<string>;
  promote: (input: AgentAttachmentWorkerInput & {
    digest: string;
    scope: AgentReportScope;
    stagedPath: string;
    fileName: string;
    mediaType: string;
    byteSize: number;
    existingPackageId?: string;
  }) => Promise<string>;
};

export type AgentAttachmentWorkerOutcome =
  | { kind: "already_promoted"; packageId: string }
  | { kind: "metadata_required" | "correction_required"; challengeId: string }
  | { kind: "kept_existing"; packageId: string }
  | { kind: "duplicate_verification_pending"; packageId: string }
  | { kind: "correction_submitted"; packageId: string; priorPackageId: string }
  | { kind: "exact_duplicate" | "new"; packageId: string };

export async function processAgentAttachmentWithPorts(
  input: AgentAttachmentWorkerInput,
  ports: AgentAttachmentWorkerPorts,
): Promise<AgentAttachmentWorkerOutcome> {
  const attachment = await ports.load(input);
  if (attachment.organizationId !== input.organizationId ||
      attachment.turnId !== input.turnId || attachment.attachmentId !== input.attachmentId) {
    throw new Error("Attachment does not belong to this turn.");
  }
  if (attachment.status === "promoted" && attachment.packageId) {
    return { kind: "already_promoted", packageId: attachment.packageId };
  }
  if (attachment.status === "failed" || attachment.status === "expired" ||
      (attachment.status === "awaiting_upload" && Date.parse(attachment.expiresAt) <= Date.now())) {
    throw new Error("Attachment staging intent has expired.");
  }
  if (attachment.byteSize <= 0 || attachment.byteSize > REPORT_PACKAGE_LIMITS.maxCompressedBytes) {
    throw new Error("Attachment size is invalid.");
  }
  const expectedPath = `${input.organizationId}/${input.turnId}/${input.attachmentId}`;
  if (attachment.path !== expectedPath && !attachment.path.startsWith(`${expectedPath}/`)) {
    throw new Error("Attachment staging path is invalid.");
  }
  const bytes = await ports.download({ bucket: attachment.bucket, path: attachment.path });
  if (bytes.byteLength !== attachment.byteSize) throw new Error("Attachment size does not match staged bytes.");
  await validateAgentReportBytes(attachment, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (attachment.digest && attachment.digest !== digest) throw new Error("Attachment digest changed after verification.");
  const scope = attachment.scope ? agentReportScopeSchema.parse(attachment.scope) : null;
  await ports.verify({ ...input, digest, scope });
  if (!scope) {
    const challengeId = await ports.setChallenge({ ...input, kind: "metadata" });
    return { kind: "metadata_required", challengeId };
  }
  const priorPackages = await ports.listPrior({ organizationId: input.organizationId, scope });
  const classification = classifyReportAttachment({ digest, scope, priorPackages });
  if (classification.kind === "duplicate_verification_pending") {
    await ports.waitForDuplicateVerification({ ...input, packageId: classification.packageId });
    return classification;
  }
  if (classification.kind === "correction_required") {
    if (attachment.correctionChoice === "keep_existing") {
      await ports.keepExisting({ ...input, packageId: classification.priorPackageId });
      return { kind: "kept_existing", packageId: classification.priorPackageId };
    }
    if (attachment.correctionChoice !== "submit_for_review") {
      const challengeId = await ports.setChallenge({
        ...input, kind: "correction", priorPackageId: classification.priorPackageId,
      });
      return { kind: "correction_required", challengeId };
    }
    const packageId = await ports.promote({
      ...input, digest, scope, stagedPath: attachment.path,
      fileName: attachment.fileName, mediaType: attachment.mediaType, byteSize: attachment.byteSize,
    });
    return { kind: "correction_submitted", packageId, priorPackageId: classification.priorPackageId };
  }
  if (classification.kind === "metadata_required") throw new Error("Attachment scope vanished.");
  const packageId = await ports.promote({
    ...input, digest, scope, stagedPath: attachment.path,
    fileName: attachment.fileName, mediaType: attachment.mediaType, byteSize: attachment.byteSize,
    ...(classification.kind === "exact_duplicate" ? { existingPackageId: classification.packageId } : {}),
  });
  return { kind: classification.kind, packageId };
}

/** Reuse the source parser's resource and archive guards before any reuse. */
async function validateAgentReportBytes(attachment: StagedAgentAttachment, bytes: Buffer): Promise<void> {
  attachmentIntentSchema.parse({
    fileName: attachment.fileName, mediaType: attachment.mediaType,
    byteSize: attachment.byteSize, idempotencyKey: `attachment:${attachment.attachmentId}`,
  });
  if (attachment.fileName.toLowerCase().endsWith(".csv")) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("\0") || /^[\s\uFEFF]*$/.test(text)) throw new Error("INVALID_FILE_TYPE");
    } catch {
      throw new ReportProfileFailure("INVALID_FILE_TYPE");
    }
    await profileCsvBuffer(bytes);
    return;
  }
  await profileXlsxBuffer(bytes);
}

const workerInputSchema = z.object({
  organizationId: z.string().uuid(),
  turnId: z.string().uuid(),
  attachmentId: z.string().uuid(),
  leaseToken: z.string().uuid(),
}).strict();
const packageReceiptSchema = z.object({
  packageId: z.string().uuid(),
  storageBucketId: z.literal("governed-report-packages"),
  storagePath: z.string().min(1),
  status: z.string().min(1),
  replayed: z.boolean(),
}).passthrough();
const completionReceiptSchema = z.object({
  packageId: z.string().uuid(), status: z.string().min(1), replayed: z.boolean(),
}).passthrough();
const challengeReceiptSchema = z.object({ challengeId: z.string().uuid() }).passthrough();

type WorkerClient = SupabaseClient<Database>;
type WorkerRequest = AgentAttachmentWorkerInput & { supabase: WorkerClient };
type PromotionInput = Parameters<AgentAttachmentWorkerPorts["promote"]>[0];

async function workerRpc(supabase: WorkerClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await (supabase.rpc as unknown as (
    rpcName: string, rpcArgs: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>)(name, args);
  if (error || data === null) throw new Error(`Agent attachment ${name} was refused.`);
  return data;
}

function leaseArgs(input: AgentAttachmentWorkerInput) {
  return {
    p_organization_id: input.organizationId,
    p_turn_id: input.turnId,
    p_attachment_id: input.attachmentId,
    p_lease_token: input.leaseToken,
  };
}

/**
 * A Storage copy may have succeeded just before a worker crashed. On replay we
 * accept only the exact expected destination bytes, never a matching path.
 */
export async function copyVerifiedStagingObject(
  input: { sourcePath: string; destinationPath: string; expectedDigest: string },
  ports: {
    copy: (sourcePath: string, destinationPath: string) => Promise<boolean>;
    downloadDestination: (destinationPath: string) => Promise<Buffer>;
  },
): Promise<void> {
  const copied = await ports.copy(input.sourcePath, input.destinationPath);
  let bytes: Buffer;
  try {
    bytes = await ports.downloadDestination(input.destinationPath);
  } catch {
    throw new Error(copied
      ? "Copied report object could not be verified."
      : "Report copy could not be reconciled after interruption.");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== input.expectedDigest) {
    throw new Error("Destination report bytes differ from the verified attachment.");
  }
}

const correctionFields = [{
  key: "decision", label: "How should this changed report be handled?",
  kind: "single_select", required: true,
  options: [
    { value: "submit_for_review", label: "Submit as a candidate correction for review" },
    { value: "keep_existing", label: "Keep the existing report" },
  ],
}];

async function loadScopeMetadata(supabase: WorkerClient, organizationId: string): Promise<AgentReportScopeMetadata> {
  const [channels, aliases, branches, mappings, packages] = await Promise.all([
    supabase.from("organization_channels").select("id,display_name,key").eq("organization_id", organizationId).eq("status", "active").limit(101),
    supabase.from("channel_source_aliases").select("channel_id,alias").eq("organization_id", organizationId).eq("status", "active").limit(1001),
    supabase.from("branches").select("id,name,currency").eq("organization_id", organizationId).eq("is_active", true).limit(101),
    supabase.from("organization_channel_branches").select("channel_id,branch_id,effective_from,effective_to").eq("organization_id", organizationId).eq("status", "active").limit(1001),
    supabase.from("integration_report_packages").select("channel_id,report_type").eq("organization_id", organizationId).limit(1001),
  ]);
  if ([channels, aliases, branches, mappings, packages].some((result) => result.error || !result.data)) throw new Error("Report scope metadata is unavailable.");
  const channelChoices = channels.data!.map((row) => ({ id: row.id, label: row.display_name, key: row.key }));
  const aliasChoices = aliases.data!.map((row) => ({ channelId: row.channel_id, label: row.alias }));
  const normalized = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const libraryTypes = channelChoices.flatMap((channel) => {
    const names = [channel.label, channel.key, ...aliasChoices.filter((alias) => alias.channelId === channel.id).map((alias) => alias.label)].map(normalized);
    return PROVIDER_REPORT_DEFINITIONS.filter((definition) => names.some((name) => ` ${name} `.includes(` ${normalized(definition.provider)} `))).map((definition) => ({
      channelId: channel.id, reportType: definition.reportType,
      aliases: [normalized(definition.reportType), `${normalized(definition.reportType.replace(/_(daily|weekly|monthly|summary)$/, ""))} report`],
    }));
  });
  return {
    channels: channelChoices, aliases: aliasChoices,
    branches: branches.data!.map((row) => ({ id: row.id, label: row.name, currency: row.currency })),
    mappings: mappings.data!.map((row) => ({ channelId: row.channel_id, branchId: row.branch_id, effectiveFrom: row.effective_from, effectiveTo: row.effective_to })),
    reportTypes: [
      ...packages.data!.map((row) => ({ channelId: row.channel_id, reportType: row.report_type, aliases: [normalized(row.report_type)] })),
      ...libraryTypes,
    ],
  };
}

/**
 * Called only by the identifier-only Trigger task after a fenced turn claim.
 * The request path uses its member session; this adapter alone holds the worker
 * client, and every write goes through a lease-checked source-owned RPC.
 */
export async function processAgentAttachment(request: WorkerRequest): Promise<AgentAttachmentWorkerOutcome> {
  const { supabase, ...unparsed } = request;
  const input = workerInputSchema.parse(unparsed);
  await workerRpc(supabase, "authorize_agent_attachment_work", leaseArgs(input));

  const { data: turn, error: turnError } = await supabase.from("agent_turns")
    .select("thread_id,user_message_id,challenge_answers,answered_challenge_kind")
    .eq("organization_id", input.organizationId)
    .eq("id", input.turnId)
    .single();
  if (turnError || !turn) throw new Error("Agent attachment turn is unavailable.");
  const answers = turn.challenge_answers;
  const correctionChoice = turn.answered_challenge_kind === "correction" && (answers?.decision === "submit_for_review" || answers?.decision === "keep_existing")
    ? answers.decision : null;
  let metadataChallengeFields: AgentReportMetadataField[] | null = null;

  const ports: AgentAttachmentWorkerPorts = {
    load: async () => {
      const { data, error } = await supabase.from("agent_attachments")
        .select("id,organization_id,turn_id,created_by,file_name,media_type,byte_size,storage_bucket_id,storage_path,upload_expires_at,status,sha256_digest,package_id,declared_scope")
        .eq("organization_id", input.organizationId)
        .eq("turn_id", input.turnId)
        .eq("id", input.attachmentId)
        .single();
      if (error || !data || data.storage_bucket_id !== "agent-report-staging") {
        throw new Error("Agent attachment is unavailable.");
      }
      let scope = data.declared_scope ? agentReportScopeSchema.parse(data.declared_scope) : null;
      if (!scope && data.status !== "promoted") {
        const { data: message, error: messageError } = await supabase.from("agent_messages")
          .select("body").eq("organization_id", input.organizationId).eq("thread_id", turn.thread_id)
          .eq("id", turn.user_message_id).eq("role", "user").single();
        if (messageError || !message?.body) throw new Error("The report question is unavailable.");
        const resolution = resolveAgentReportScope({
          question: message.body, metadata: await loadScopeMetadata(supabase, input.organizationId),
          answers: turn.answered_challenge_kind === "metadata" ? answers : null,
        });
        if (resolution.kind === "resolved") {
          scope = resolution.scope;
          await workerRpc(supabase, "resolve_agent_attachment_scope", { ...leaseArgs(input), p_scope: scope });
        } else metadataChallengeFields = resolution.fields;
      }
      return {
        organizationId: data.organization_id, turnId: data.turn_id, attachmentId: data.id,
        createdBy: data.created_by, fileName: data.file_name, mediaType: data.media_type,
        byteSize: data.byte_size, bucket: "agent-report-staging", path: data.storage_path,
        expiresAt: data.upload_expires_at, status: data.status, digest: data.sha256_digest,
        packageId: data.package_id, scope, correctionChoice,
      };
    },
    download: async ({ bucket, path }) => {
      const { data, error } = await supabase.storage.from(bucket).download(path);
      if (error || !data) throw new Error("Staged report object is unavailable.");
      return Buffer.from(await data.arrayBuffer());
    },
    verify: async ({ digest }) => {
      await workerRpc(supabase, "verify_agent_attachment", {
        ...leaseArgs(input), p_sha256_digest: digest,
      });
    },
    listPrior: async ({ organizationId, scope }) => {
      const { data, error } = await supabase.from("integration_report_packages")
        .select("id,channel_id,branch_id,report_type,declared_period_start,declared_period_end,declared_currency,content_sha256,status,storage_path,storage_bucket_id,storage_object_id,declared_content_length,declared_content_type")
        .eq("organization_id", organizationId)
        .eq("channel_id", scope.channelId)
        .eq("branch_id", scope.branchId)
        .eq("report_type", scope.reportType)
        .eq("declared_period_start", scope.periodStart)
        .eq("declared_period_end", scope.periodEnd)
        .eq("declared_currency", scope.currency)
        .order("created_at", { ascending: false })
        .limit(1001);
      if (error || !data || data.length > 1000) throw new Error("Prior reports could not be classified safely.");
      const usable = data.filter((row) => !["awaiting_upload", "failed"].includes(row.status));
      if (usable.filter((row) => row.content_sha256 === null).length > 12) throw new Error("Too many unverified prior reports to classify safely.");
      const priorReports: PriorReportIdentity[] = [];
      for (const row of usable) {
        let digest = row.content_sha256;
        let verificationPending = false;
        if (digest === null && ["uploaded", "profiling"].includes(row.status)) {
          if (row.storage_bucket_id !== "governed-report-packages" || !row.storage_path.startsWith(`${organizationId}/${scope.channelId}/${row.id}/`) || !row.storage_object_id) throw new Error("Prior report object identity is unavailable.");
          const { data: original, error: originalError } = await supabase.storage.from("governed-report-packages").download(row.storage_path);
          if (originalError || !original) throw new Error("Prior report object could not be verified.");
          const bytes = Buffer.from(await original.arrayBuffer());
          if (bytes.byteLength !== row.declared_content_length || bytes.byteLength > REPORT_PACKAGE_LIMITS.maxCompressedBytes) throw new Error("Prior report object size changed.");
          digest = createHash("sha256").update(bytes).digest("hex");
          verificationPending = true;
        }
        priorReports.push({
          id: row.id, channelId: row.channel_id, branchId: row.branch_id,
          reportType: row.report_type, periodStart: row.declared_period_start,
          periodEnd: row.declared_period_end, currency: row.declared_currency,
          digest, verificationPending,
        });
      }
      return priorReports;
    },
    waitForDuplicateVerification: async ({ packageId }) => {
      const { data, error } = await supabase.from("integration_report_packages").select("status")
        .eq("organization_id", input.organizationId).eq("id", packageId).single();
      if (error || !data) throw new Error("Prior report source state is unavailable.");
      if (data.status === "uploaded" && !await requestReportPackageProfiling({ organizationId: input.organizationId, packageId, correlationId: input.turnId })) throw new Error("Prior report profiling could not be queued.");
    },
    keepExisting: async ({ packageId }) => {
      await workerRpc(supabase, "keep_existing_agent_report_package", { ...leaseArgs(input), p_package_id: packageId });
    },
    setChallenge: async ({ kind }) => {
      let fields: typeof correctionFields | AgentReportMetadataField[] = correctionFields;
      if (kind === "metadata") {
        if (!metadataChallengeFields) throw new Error("Report metadata questions are unavailable.");
        fields = metadataChallengeFields;
      }
      const receipt = challengeReceiptSchema.parse(await workerRpc(supabase, "set_agent_turn_challenge", {
        p_organization_id: input.organizationId,
        p_turn_id: input.turnId,
        p_lease_token: input.leaseToken,
        p_kind: kind,
        p_fields: fields,
      }));
      return receipt.challengeId;
    },
    promote: async (promotion: PromotionInput) => {
      if (promotion.existingPackageId) {
        await workerRpc(supabase, "promote_agent_attachment", {
          ...leaseArgs(input), p_package_id: promotion.existingPackageId,
          p_sha256_digest: promotion.digest,
        });
        return promotion.existingPackageId;
      }
      reportPackageUploadIntentSchema.parse({
        ...promotion.scope,
        originalFilename: promotion.fileName,
        contentType: promotion.mediaType,
        contentLength: promotion.byteSize,
        idempotencyKey: `agent-attachment:${input.attachmentId}`,
      });
      const destination = packageReceiptSchema.parse(await workerRpc(
        supabase, "begin_agent_report_package", leaseArgs(input),
      ));
      const expectedPath = `${input.organizationId}/${promotion.scope.channelId}/${destination.packageId}/1/original/report.${promotion.fileName.split(".").pop()?.toLowerCase()}`;
      if (destination.storagePath !== expectedPath) throw new Error("Governed report destination path is invalid.");
      await copyVerifiedStagingObject({
        sourcePath: promotion.stagedPath,
        destinationPath: destination.storagePath,
        expectedDigest: promotion.digest,
      }, {
        copy: async (sourcePath, destinationPath) => {
          const { error } = await supabase.storage.from("agent-report-staging")
            .copy(sourcePath, destinationPath, { destinationBucket: destination.storageBucketId });
          return !error;
        },
        downloadDestination: async (destinationPath) => {
          const { data, error } = await supabase.storage.from(destination.storageBucketId).download(destinationPath);
          if (error || !data) throw new Error("Governed report object is unavailable.");
          return Buffer.from(await data.arrayBuffer());
        },
      });
      const completed = completionReceiptSchema.parse(await workerRpc(supabase, "complete_agent_report_package", {
        ...leaseArgs(input), p_destination_sha256: promotion.digest,
      }));
      if (completed.packageId !== destination.packageId || completed.status === "failed") {
        throw new Error("Governed report package did not complete safely.");
      }
      return completed.packageId;
    },
  };

  const result = await processAgentAttachmentWithPorts(input, ports);
  if (result.kind === "new" || result.kind === "correction_submitted" || result.kind === "already_promoted") {
    const { data: reportPackage, error } = await supabase.from("integration_report_packages")
      .select("id,status")
      .eq("organization_id", input.organizationId)
      .eq("id", result.packageId)
      .single();
    if (error || !reportPackage) throw new Error("Governed report package is unavailable.");
    if (reportPackage.status === "uploaded") {
      const queued = await requestReportPackageProfiling({
        organizationId: input.organizationId,
        packageId: result.packageId,
        correlationId: input.turnId,
      });
      if (!queued) throw new Error("Governed report profiling could not be queued.");
    }
  }
  return result;
}
