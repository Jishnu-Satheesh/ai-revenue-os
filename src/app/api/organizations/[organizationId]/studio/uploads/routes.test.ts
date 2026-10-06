import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
  },
}));

const mocks = vi.hoisted(() => ({
  routeContext: vi.fn(),
  reserveUpload: vi.fn(),
  completeUpload: vi.fn(),
  readRecord: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  serviceClient: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/organization-context")>();
  return { ...actual, getOrganizationContext: mocks.routeContext };
});

vi.mock("@/modules/creative-studio/infrastructure/repository", () => ({
  createStudioRepository: vi.fn(() => ({
    reserveUpload: mocks.reserveUpload,
    completeUpload: mocks.completeUpload,
  })),
}));

vi.mock("@/modules/creative-studio/infrastructure/reference-reader", () => ({
  createStudioUploadRecordReader: vi.fn(() => ({ read: mocks.readRecord })),
}));

vi.mock("@/modules/creative-studio/infrastructure/upload-intake", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/creative-studio/infrastructure/upload-intake")>();
  return {
    ...actual,
    createSupabaseStudioUploadObjectStore: vi.fn(() => ({
      download: mocks.download,
      upload: mocks.upload,
    })),
    createStudioUploadServiceClient: mocks.serviceClient,
  };
});

import sharp from "sharp";

import { DomainError } from "@/lib/errors";
import { POST as reservePost } from "@/app/api/organizations/[organizationId]/studio/uploads/route";
import { POST as completePost } from "@/app/api/organizations/[organizationId]/studio/uploads/[uploadId]/complete/route";

const ORG = "00000000-0000-4000-8000-000000000001";
const UPLOAD = "00000000-0000-4000-8000-000000000002";
const ACTOR = "00000000-0000-4000-8000-000000000003";
const ATTESTATION = "00000000-0000-4000-8000-000000000004";
const PATH = `${ORG}/${UPLOAD}/hero.png`;

function reserveBody(overrides: Record<string, unknown> = {}) {
  return {
    kind: "design",
    declaredSize: 412_345,
    declaredMime: "image/png",
    filename: "hero.png",
    rights: {
      accepted: true,
      attestationId: ATTESTATION,
      authorizedAiProcessing: true,
      intendedUse: "Studio reference",
    },
    ...overrides,
  };
}

function uploadRecord(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    uploadId: UPLOAD,
    actorId: ACTOR,
    reservedPath: PATH,
    state: "reserved",
    rightsAttestation: {
      accepted: true,
      attestationId: ATTESTATION,
      authorizedAiProcessing: true,
      intendedUse: "Studio reference",
    },
    finalHash: null,
    finalMime: null,
    finalWidth: null,
    finalHeight: null,
    finalBytes: null,
    expiresAt: "2100-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: "#336699" },
  })
    .png()
    .toBuffer();
}

function orgParams() {
  return { params: Promise.resolve({ organizationId: ORG }) };
}

function completeParams(uploadId: string = UPLOAD) {
  return { params: Promise.resolve({ organizationId: ORG, uploadId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.routeContext.mockResolvedValue({
    supabase: {},
    user: { id: ACTOR },
    organizationId: ORG,
    membership: { role: "admin" },
  });
  mocks.serviceClient.mockReturnValue({});
  mocks.upload.mockResolvedValue(true);
});

describe("studio upload reserve route", () => {
  it("reserves an upload and answers 201", async () => {
    mocks.reserveUpload.mockResolvedValue({
      uploadId: UPLOAD,
      reservedPath: PATH,
      expiresAt: "2026-09-26T01:00:00.000Z",
    });

    const response = await reservePost(
      new Request("http://localhost/api/studio/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reserveBody()),
      }),
      orgParams(),
    );

    expect(mocks.routeContext).toHaveBeenCalledTimes(1);
    expect(mocks.reserveUpload).toHaveBeenCalledWith({
      organizationId: ORG,
      upload: {
        kind: "design",
        declaredSize: 412_345,
        declaredMime: "image/png",
        filename: "hero.png",
        rightsAttestation: {
          accepted: true,
          attestationId: ATTESTATION,
          authorizedAiProcessing: true,
          intendedUse: "Studio reference",
        },
      },
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      uploadId: UPLOAD,
      reservedPath: PATH,
      expiresAt: "2026-09-26T01:00:00.000Z",
      bucket: "studio-uploads",
      intake: expect.objectContaining({
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
        clientValidationIsAdvisory: true,
      }),
    });
  });

  it("refuses a reservation without rights with 400 and no database call", async () => {
    const response = await reservePost(
      new Request("http://localhost/api/studio/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reserveBody({ rights: undefined })),
      }),
      orgParams(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    });
    expect(mocks.reserveUpload).not.toHaveBeenCalled();
  });

  it("answers malformed JSON with 400", async () => {
    const response = await reservePost(
      new Request("http://localhost/api/studio/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
      orgParams(),
    );

    expect(response.status).toBe(400);
    expect(mocks.reserveUpload).not.toHaveBeenCalled();
  });

  it("maps an authorization failure without touching the writer", async () => {
    mocks.routeContext.mockRejectedValue(
      new DomainError("AUTHORIZATION_ERROR", "No studio access."),
    );

    const response = await reservePost(
      new Request("http://localhost/api/studio/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reserveBody()),
      }),
      orgParams(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ code: "AUTHORIZATION_ERROR" }),
    });
    expect(mocks.reserveUpload).not.toHaveBeenCalled();
  });
});

describe("studio upload complete route", () => {
  it("finalizes a transferred upload and answers 201", async () => {
    mocks.readRecord.mockResolvedValue(uploadRecord());
    mocks.download.mockResolvedValue(await png(640, 480));
    mocks.completeUpload.mockResolvedValue({ uploadId: UPLOAD, state: "ready", replayed: false });

    const response = await completePost(
      new Request("http://localhost/api/studio/uploads/complete", { method: "POST" }),
      completeParams(),
    );

    expect(response.status).toBe(201);
    const outcome = await response.json();
    expect(outcome).toMatchObject({
      status: "ready",
      uploadId: UPLOAD,
      replayed: false,
      mimeType: "image/png",
      widthPx: 640,
      heightPx: 480,
    });
    expect(outcome.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // The service client exists only after the session authorizes.
    const [contextOrder] = mocks.routeContext.mock.invocationCallOrder;
    const [serviceOrder] = mocks.serviceClient.mock.invocationCallOrder;
    expect(contextOrder).toBeLessThan(serviceOrder!);
    // The path comes from the row, and the re-encode lands at the same key.
    expect(mocks.readRecord).toHaveBeenCalledWith(ORG, UPLOAD);
    expect(mocks.download).toHaveBeenCalledWith(PATH);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload.mock.calls[0]![0]).toMatchObject({
      path: PATH,
      contentType: "image/png",
    });
    expect(mocks.completeUpload).toHaveBeenCalledWith({
      organizationId: ORG,
      uploadId: UPLOAD,
      receipt: expect.objectContaining({
        verdict: "ready",
        finalHash: outcome.contentHash,
        finalMime: "image/png",
      }),
    });
  });

  it("accepts a declared mime that matches the transfer", async () => {
    mocks.readRecord.mockResolvedValue(uploadRecord());
    mocks.download.mockResolvedValue(await png(640, 480));
    mocks.completeUpload.mockResolvedValue({ uploadId: UPLOAD, state: "ready", replayed: false });

    const response = await completePost(
      new Request("http://localhost/api/studio/uploads/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ declaredMime: "image/png" }),
      }),
      completeParams(),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "ready" });
  });

  it("replays a duplicate finalization with 200 and touches no bytes", async () => {
    mocks.readRecord.mockResolvedValue(
      uploadRecord({
        state: "ready",
        finalHash: "d".repeat(64),
        finalMime: "image/png",
        finalWidth: 640,
        finalHeight: 480,
        finalBytes: 99_999,
      }),
    );

    const response = await completePost(
      new Request("http://localhost/api/studio/uploads/complete", { method: "POST" }),
      completeParams(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ready",
      uploadId: UPLOAD,
      replayed: true,
      contentHash: "d".repeat(64),
      mimeType: "image/png",
      byteSize: 99_999,
      widthPx: 640,
      heightPx: 480,
    });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.completeUpload).not.toHaveBeenCalled();
  });

  it("refuses poisoned bytes with 200 and settles the reservation rejected", async () => {
    mocks.readRecord.mockResolvedValue(uploadRecord());
    mocks.download.mockResolvedValue(Buffer.from("<script>alert('not an image')</script>"));
    mocks.completeUpload.mockResolvedValue({ uploadId: UPLOAD, state: "rejected", replayed: false });

    const response = await completePost(
      new Request("http://localhost/api/studio/uploads/complete", { method: "POST" }),
      completeParams(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "refused", reason: "unsupported_format" });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.completeUpload).toHaveBeenCalledWith({
      organizationId: ORG,
      uploadId: UPLOAD,
      receipt: { verdict: "rejected" },
    });
  });

  it("answers an expired reservation with 200", async () => {
    mocks.readRecord.mockResolvedValue(
      uploadRecord({ expiresAt: "2000-01-01T00:00:00.000Z" }),
    );
    mocks.completeUpload.mockResolvedValue({ uploadId: UPLOAD, state: "expired", replayed: false });

    const response = await completePost(
      new Request("http://localhost/api/studio/uploads/complete", { method: "POST" }),
      completeParams(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "expired", uploadId: UPLOAD, replayed: false });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("refuses finalization by anyone but the member who reserved it", async () => {
    mocks.readRecord.mockResolvedValue(
      uploadRecord({ actorId: "00000000-0000-4000-8000-000000000007" }),
    );

    const response = await completePost(
      new Request("http://localhost/api/studio/uploads/complete", { method: "POST" }),
      completeParams(),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ code: "TENANT_SCOPE_ERROR" }),
    });
    // Ownership fails before any privileged use: no bytes read, no settlement.
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.completeUpload).not.toHaveBeenCalled();
  });

  it("rejects a malformed upload id before constructing the service client", async () => {
    const response = await completePost(
      new Request("http://localhost/api/studio/uploads/complete", { method: "POST" }),
      completeParams("not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    });
    expect(mocks.serviceClient).not.toHaveBeenCalled();
    expect(mocks.readRecord).not.toHaveBeenCalled();
  });

  it("constructs no service client when the session does not authorize", async () => {
    mocks.routeContext.mockRejectedValue(
      new DomainError("AUTHENTICATION_ERROR", "Authentication is required."),
    );

    const response = await completePost(
      new Request("http://localhost/api/studio/uploads/complete", { method: "POST" }),
      completeParams(),
    );

    expect(response.status).toBe(401);
    expect(mocks.serviceClient).not.toHaveBeenCalled();
    expect(mocks.readRecord).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.completeUpload).not.toHaveBeenCalled();
  });
});
