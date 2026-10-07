"use client";

import { Upload } from "tus-js-client";

import { createClient } from "@/lib/supabase/browser";

export const REPORT_PACKAGE_BUCKET = "governed-report-packages";

export type ReportPackageResumableIntent = {
  endpoint: string;
  token: string;
  apiKey: string;
  chunkSize: number;
  storagePath: string;
};

/**
 * Upload one report file to the private governed-report-packages bucket over
 * tus resumable upload. Storage owns the RLS decision, so the member
 * credential goes with the signed path token: the token alone does not
 * identify the package row's creator and Storage would refuse as anonymous.
 */
export async function uploadReportPackageBytes(input: {
  file: File;
  intent: ReportPackageResumableIntent;
  contentType: string;
  packageId: string;
  onProgress: (percent: number) => void;
}): Promise<void> {
  // Forward the member credential to Storage; it owns the RLS decision.
  // A signed path token alone does not identify the package row's creator.
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Sign in again to upload this report.");
  const accessToken = data.session.access_token;
  await new Promise<void>((resolve, reject) => {
    const tus = new Upload(input.file, {
      endpoint: input.intent.endpoint,
      chunkSize: input.intent.chunkSize,
      uploadSize: input.file.size,
      metadata: {
        bucketName: REPORT_PACKAGE_BUCKET,
        objectName: input.intent.storagePath,
        contentType: input.contentType,
      },
      headers: {
        apikey: input.intent.apiKey,
        "x-signature": input.intent.token,
        authorization: `Bearer ${accessToken}`,
      },
      retryDelays: [0, 1_000, 3_000, 5_000],
      removeFingerprintOnSuccess: true,
      fingerprint: () =>
        Promise.resolve(`report-package:${input.packageId}:${input.file.name}:${input.file.size}`),
      onError: reject,
      onProgress: (uploaded, total) =>
        input.onProgress(total ? Math.round((uploaded / total) * 100) : 0),
      onSuccess: () => resolve(),
    });
    void tus.findPreviousUploads().then((previous) => {
      if (previous[0]) tus.resumeFromPreviousUpload(previous[0]);
      tus.start();
    }, reject);
  });
}
