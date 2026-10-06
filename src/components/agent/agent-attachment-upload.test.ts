// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { agentReportMediaType, uploadAgentReport } from "./agent-attachment-upload";

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
      if (tus.fail) this.options.onError(new Error("private signed credential must never render"));
      else this.options.onSuccess();
    }
  },
}));

const organizationId = "10000000-0000-4000-8000-000000000001";
const turnId = "20000000-0000-4000-8000-000000000002";
const attachmentId = "30000000-0000-4000-8000-000000000003";
const intent = {
  attachmentId,
  upload: {
    endpoint: "https://storage.example/storage/v1/upload/resumable",
    token: "signed-token",
    apiKey: "publishable",
    chunkSize: 6 * 1024 * 1024,
    bucket: "agent-report-staging",
    path: `${organizationId}/${turnId}/${attachmentId}/report.csv`,
  },
};

beforeEach(() => {
  tus.options = [];
  tus.fail = false;
  tus.resumed = false;
  auth.token = "member-access-token";
});

describe("agent report upload", () => {
  it("refuses to stage bytes without a current member credential", async () => {
    auth.token = null;
    const post = vi.fn();
    await expect(
      uploadAgentReport({
        organizationId,
        turnId,
        file: new File(["data"], "report.csv"),
        idempotencyKey: "attachment-key-12345",
        session: { uploaded: false },
        post,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow(/Sign in/);
    expect(tus.options).toHaveLength(0);
    expect(post).not.toHaveBeenCalled();
  });
  it("uploads resumable private bytes with the signed token and completes server-owned scope", async () => {
    const post = vi.fn(async (path: string) => (path.endsWith("/complete") ? {} : intent));
    const onProgress = vi.fn();
    await uploadAgentReport({
      organizationId,
      turnId,
      file: new File(["data"], "report.csv"),
      idempotencyKey: `agent-attachment-intent:${turnId}`,
      session: { uploaded: false },
      post,
      onProgress,
    });
    expect(tus.options[0].chunkSize).toBe(6 * 1024 * 1024);
    expect(tus.options[0].headers).toEqual({
      apikey: "publishable",
      "x-signature": "signed-token",
      authorization: "Bearer member-access-token",
    });
    expect(tus.options[0].metadata).toEqual({
      bucketName: "agent-report-staging",
      objectName: intent.upload.path,
      contentType: "text/csv",
    });
    expect(tus.resumed).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(50);
    expect(post).toHaveBeenLastCalledWith(expect.stringContaining(`${attachmentId}/complete`), {
      scope: null,
    });
  });

  it("retries completion without uploading the already completed bytes again", async () => {
    let completion = 0;
    const post = vi.fn(async (path: string) => {
      if (path.endsWith("/complete") && completion++ === 0)
        throw new Error("Completion request failed");
      return path.endsWith("/complete") ? {} : intent;
    });
    const session = { uploaded: false };
    const input = {
      organizationId,
      turnId,
      file: new File(["data"], "report.csv"),
      idempotencyKey: `agent-attachment-intent:${turnId}`,
      session,
      post,
      onProgress: vi.fn(),
    };
    await expect(uploadAgentReport(input)).rejects.toThrow("Completion request failed");
    expect(session.uploaded).toBe(true);
    await expect(uploadAgentReport(input)).resolves.toBe(attachmentId);
    expect(tus.options).toHaveLength(1);
  });

  it("rejects a foreign staging path before uploading", async () => {
    const post = vi.fn(async () => ({
      ...intent,
      upload: { ...intent.upload, path: "another-organization/file.csv" },
    }));
    await expect(
      uploadAgentReport({
        organizationId,
        turnId,
        file: new File(["data"], "report.csv"),
        idempotencyKey: "attachment-key-12345",
        session: { uploaded: false },
        post,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow(/did not match/);
    expect(tus.options).toHaveLength(0);
  });

  it("keeps transport errors free of signed credentials and does not complete failed bytes", async () => {
    tus.fail = true;
    const post = vi.fn(async () => intent);
    await expect(
      uploadAgentReport({
        organizationId,
        turnId,
        file: new File(["data"], "report.csv"),
        idempotencyKey: "attachment-key-12345",
        session: { uploaded: false },
        post,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow("The report upload stopped. Retry to continue.");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("validates CSV/XLSX and size before creating any upload", () => {
    expect(agentReportMediaType(new File(["report"], "talabat.XLSX"))).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(() => agentReportMediaType(new File(["report"], "report.pdf"))).toThrow(/CSV or XLSX/);
    expect(() => agentReportMediaType(new File([], "report.csv"))).toThrow(/1 byte/);
  });
});
