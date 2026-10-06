"use client";

import { Upload } from "tus-js-client";
import { z } from "zod";

import { REPORT_PACKAGE_LIMITS } from "@/domain/reports/types";
import { createClient } from "@/lib/supabase/browser";

export const AGENT_REPORT_ACCEPT =
  ".csv,.xlsx,text/csv,application/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function agentReportMediaType(file: Pick<File, "name" | "size">): string {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (file.size <= 0 || file.size > REPORT_PACKAGE_LIMITS.maxCompressedBytes) {
    throw new Error("Choose a report between 1 byte and 50 MB.");
  }
  if (extension === "csv") return "text/csv";
  if (extension === "xlsx")
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  throw new Error("Choose one CSV or XLSX report.");
}

const uploadIntentSchema = z.object({
  attachmentId: z.string().uuid(),
  upload: z.object({
    endpoint: z.string().url(),
    token: z.string().min(1),
    apiKey: z.string().min(1),
    chunkSize: z.literal(6 * 1024 * 1024),
    bucket: z.literal("agent-report-staging"),
    path: z.string().min(1),
  }),
});

/** Kept in session memory, including after a failed completion request. */
export type AgentReportUploadSession = { attachmentId?: string; uploaded: boolean };

export async function uploadAgentReport(input: {
  organizationId: string;
  turnId: string;
  file: File;
  idempotencyKey: string;
  session: AgentReportUploadSession;
  post: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const mediaType = agentReportMediaType(input.file);
  const base = `/api/organizations/${input.organizationId}/agent/turns/${input.turnId}/attachments`;
  if (!input.session.uploaded) {
    // Forward the member credential to Storage; it owns the RLS decision.
    // A signed path token alone does not identify the staging row's creator.
    const { data, error } = await createClient().auth.getSession();
    if (error || !data.session?.access_token)
      throw new Error("Sign in again to upload this report.");
    const intent = uploadIntentSchema.parse(
      await input.post(base, {
        fileName: input.file.name,
        mediaType,
        byteSize: input.file.size,
        idempotencyKey: input.idempotencyKey,
      }),
    );
    const prefix = `${input.organizationId}/${input.turnId}/${intent.attachmentId}`;
    if (intent.upload.path !== prefix && !intent.upload.path.startsWith(`${prefix}/`)) {
      throw new Error("The secure report upload did not match this conversation.");
    }
    input.session.attachmentId = intent.attachmentId;
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(input.file, {
        endpoint: intent.upload.endpoint,
        chunkSize: intent.upload.chunkSize,
        uploadSize: input.file.size,
        metadata: {
          bucketName: intent.upload.bucket,
          objectName: intent.upload.path,
          contentType: mediaType,
        },
        headers: {
          apikey: intent.upload.apiKey,
          "x-signature": intent.upload.token,
          authorization: `Bearer ${data.session.access_token}`,
        },
        retryDelays: [0, 1_000, 3_000, 5_000],
        removeFingerprintOnSuccess: true,
        fingerprint: () =>
          Promise.resolve(
            `agent-report:${intent.attachmentId}:${input.file.size}:${input.file.lastModified}`,
          ),
        onProgress: (uploaded, total) =>
          input.onProgress(total ? Math.round((uploaded / total) * 100) : 0),
        onError: () => {
          cleanUp();
          reject(new Error("The report upload stopped. Retry to continue."));
        },
        onSuccess: () => {
          cleanUp();
          resolve();
        },
      });
      const abort = () => {
        void upload.abort();
        cleanUp();
        reject(new Error("The report upload was interrupted."));
      };
      const cleanUp = () => input.signal?.removeEventListener("abort", abort);
      input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) {
        abort();
        return;
      }
      void upload.findPreviousUploads().then(
        (previous) => {
          if (input.signal?.aborted) return;
          if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
          upload.start();
        },
        () => {
          cleanUp();
          reject(new Error("The report upload could not resume. Retry to continue."));
        },
      );
    });
    input.session.uploaded = true;
  }
  const attachmentId = input.session.attachmentId;
  if (!attachmentId) throw new Error("The report upload has no attachment identity.");
  await input.post(`${base}/${attachmentId}/complete`, { scope: null });
  return attachmentId;
}
