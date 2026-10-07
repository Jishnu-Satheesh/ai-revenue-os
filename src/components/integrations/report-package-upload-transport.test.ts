// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { REPORT_PACKAGE_BUCKET, uploadReportPackageBytes } from "./report-package-upload-transport";

type Options = {
  onProgress: (loaded: number, total: number) => void;
  onSuccess: () => void;
  onError: (error: Error) => void;
  headers: Record<string, string>;
  metadata: Record<string, string>;
  chunkSize: number;
};
const tus = vi.hoisted(() => ({ options: [] as Options[], fail: false, resumed: false }));
const auth = vi.hoisted(() => ({ token: "member-access-token" as string | null }));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: auth.token ? { access_token: auth.token } : null },
        error: null,
      }),
    },
  }),
}));
vi.mock("tus-js-client", () => ({
  Upload: class {
    options: Options;
    constructor(_file: File, options: Options) {
      this.options = options;
      tus.options.push(options);
    }
    findPreviousUploads() {
      return Promise.resolve([{ uploadUrl: "https://storage.example/resume" }]);
    }
    resumeFromPreviousUpload() {
      tus.resumed = true;
    }
    abort() {
      return Promise.resolve();
    }
    start() {
      this.options.onProgress(2, 4);
      if (tus.fail) this.options.onError(new Error("tus failed"));
      else this.options.onSuccess();
    }
  },
}));

const PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const STORAGE_PATH = `${ORGANIZATION_ID}/${PACKAGE_ID}/1/original/report.csv`;
const intent = {
  endpoint: "https://storage.example/storage/v1/upload/resumable",
  token: "signed-token",
  apiKey: "publishable",
  chunkSize: 6 * 1024 * 1024,
  storagePath: STORAGE_PATH,
};

beforeEach(() => {
  tus.options = [];
  tus.fail = false;
  tus.resumed = false;
  auth.token = "member-access-token";
});

describe("report package resumable upload", () => {
  it("refuses to upload without a current member credential", async () => {
    auth.token = null;
    await expect(
      uploadReportPackageBytes({
        file: new File(["data"], "sep 2026 full.csv"),
        intent,
        contentType: "text/csv",
        packageId: PACKAGE_ID,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow(/Sign in/);
    expect(tus.options).toHaveLength(0);
  });

  it("forwards the member credential alongside the signed token", async () => {
    const onProgress = vi.fn();
    await uploadReportPackageBytes({
      file: new File(["data"], "sep 2026 full.csv"),
      intent,
      contentType: "text/csv",
      packageId: PACKAGE_ID,
      onProgress,
    });
    expect(tus.options[0].chunkSize).toBe(6 * 1024 * 1024);
    expect(tus.options[0].headers).toEqual({
      apikey: "publishable",
      "x-signature": "signed-token",
      authorization: "Bearer member-access-token",
    });
    expect(tus.options[0].metadata).toEqual({
      bucketName: REPORT_PACKAGE_BUCKET,
      objectName: STORAGE_PATH,
      contentType: "text/csv",
    });
    expect(tus.resumed).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it("surfaces a failed tus upload to the caller", async () => {
    tus.fail = true;
    await expect(
      uploadReportPackageBytes({
        file: new File(["data"], "sep 2026 full.csv"),
        intent,
        contentType: "text/csv",
        packageId: PACKAGE_ID,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow("tus failed");
  });
});
