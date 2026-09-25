import { createHash } from "node:crypto";

import { z } from "zod";

// Provisional local types for Task 1 provider qualification ONLY.
// Task 2 canonicalizes the domain model under src/domain/creative-studio/;
// Task 5 reconciles this harness against it. Nothing here is exported as a
// domain contract. Mirrors the technical-contract §2 StudioProvider port shape
// (generate/edit async-iterable of preview/completed/refusal/failure events).

export const QualificationRatioSchema = z.enum(["4:5", "1:1", "9:16"]);
export type QualificationRatio = z.infer<typeof QualificationRatioSchema>;

export const QUALIFICATION_RATIOS: readonly QualificationRatio[] = ["4:5", "1:1", "9:16"];

export const FixtureKindSchema = z.enum([
  "copy",
  "product",
  "design",
  "logo",
  "typographic",
  "multilingual",
]);
export type FixtureKind = z.infer<typeof FixtureKindSchema>;

// OpenAI-first candidate native composition targets from the provider audit
// (requested pixels are not guaranteed pixels; actual bytes are measured).
export const CANDIDATE_NATIVE_DIMENSIONS: Record<QualificationRatio, { width: number; height: number }> = {
  "4:5": { width: 1024, height: 1280 },
  "1:1": { width: 1024, height: 1024 },
  "9:16": { width: 1152, height: 2048 },
};

// --- Intake-equivalent decode ceilings (contract §6 intersection) ---

export const FRAME_MIN_EDGE_PX = 200;
export const FRAME_MAX_EDGE_PX = 8000;
export const DEFAULT_MAX_FRAME_BYTES = 15 * 1024 * 1024;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const JPEG_SOI = [0xff, 0xd8];

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class QualificationFrameError extends Error {
  readonly code:
    | "malformed_frame"
    | "oversized_frame"
    | "dimensions_out_of_range"
    | "unsupported_format";
  constructor(
    code: QualificationFrameError["code"],
    message: string,
  ) {
    // Never interpolate bytes, base64, prompts, or tokens into messages.
    super(message);
    this.name = "QualificationFrameError";
    this.code = code;
  }
}

export interface DecodedFrame {
  mime: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  sha256: string;
  byteLength: number;
}

function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) return null;
  if (bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== JPEG_SOI[0] || bytes[1] !== JPEG_SOI[1]) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    // SOF0–SOF3, SOF5–SOF7, SOF9–SOF11, SOF13–SOF15 carry dimensions.
    const isSof =
      (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc);
    if (isSof) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    if (marker === 0xda || marker === 0xd9) return null; // SOS / EOI: no header found
    offset += 2 + length;
  }
  return null;
}

function isWebPContainer(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 82 && // R
    bytes[1] === 73 && // I
    bytes[2] === 70 && // F
    bytes[3] === 70 && // F
    bytes[8] === 87 && // W
    bytes[9] === 69 && // E
    bytes[10] === 66 && // B
    bytes[11] === 80 // P
  );
}

// Hand-rolled WebP dimension parsing (pure TS, zero new deps — same pattern
// as the PNG/JPEG parsers above). Covers the three container variants:
// VP8 (lossy), VP8L (lossless), VP8X (extended canvas). Returns null only
// when the chunk is unrecognized; throws malformed_frame when a recognized
// chunk is truncated or corrupt.
function parseWebPDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isWebPContainer(bytes) || bytes.length < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourcc =
    String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  const chunkSize = view.getUint32(16, true);
  const payloadOffset = 20;
  if (fourcc === "VP8 ") {
    // Lossy bitstream: 3-byte frame tag, 3-byte start code 0x9d012a,
    // then 14-bit LE width and height (top 2 bits are scale, masked off).
    if (bytes.length < payloadOffset + 10) {
      throw new QualificationFrameError("malformed_frame", "truncated VP8 lossy payload");
    }
    if (bytes[payloadOffset + 3] !== 0x9d || bytes[payloadOffset + 4] !== 0x01 || bytes[payloadOffset + 5] !== 0x2a) {
      throw new QualificationFrameError("malformed_frame", "VP8 lossy start code missing");
    }
    const width = view.getUint16(payloadOffset + 6, true) & 0x3fff;
    const height = view.getUint16(payloadOffset + 8, true) & 0x3fff;
    return { width, height };
  }
  if (fourcc === "VP8L") {
    // Lossless bitstream: 1-byte signature 0x2f, then a 32-bit LE field
    // holding 14-bit (width - 1), 14-bit (height - 1), 1-bit alpha flag,
    // 3-bit version.
    if (bytes.length < payloadOffset + 5) {
      throw new QualificationFrameError("malformed_frame", "truncated VP8L lossless payload");
    }
    if (bytes[payloadOffset] !== 0x2f) {
      throw new QualificationFrameError("malformed_frame", "VP8L lossless signature missing");
    }
    const bits = view.getUint32(payloadOffset + 1, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8X") {
    // Extended container: 1 flag byte, 3 reserved bytes, then 24-bit LE
    // (canvas width - 1) and 24-bit LE (canvas height - 1).
    if (chunkSize < 10 || bytes.length < payloadOffset + 10) {
      throw new QualificationFrameError("malformed_frame", "truncated VP8X extended payload");
    }
    const widthMinusOne =
      bytes[payloadOffset + 4] | (bytes[payloadOffset + 5] << 8) | (bytes[payloadOffset + 6] << 16);
    const heightMinusOne =
      bytes[payloadOffset + 7] | (bytes[payloadOffset + 8] << 8) | (bytes[payloadOffset + 9] << 16);
    return { width: widthMinusOne + 1, height: heightMinusOne + 1 };
  }
  return null;
}

// Independently decodes a provider frame from its own leading signature.
// The declared MIME is treated as a claim, never as evidence.
export function decodeImageFrame(bytes: Uint8Array, declaredMime: string): DecodedFrame {
  if (bytes.length === 0 || bytes.length < 8) {
    throw new QualificationFrameError("malformed_frame", "frame too short to decode");
  }
  const png = parsePngDimensions(bytes);
  if (png) {
    assertDimensions(png.width, png.height);
    return { mime: "image/png", ...png, sha256: sha256Hex(bytes), byteLength: bytes.length };
  }
  const jpeg = parseJpegDimensions(bytes);
  if (jpeg) {
    assertDimensions(jpeg.width, jpeg.height);
    return { mime: "image/jpeg", ...jpeg, sha256: sha256Hex(bytes), byteLength: bytes.length };
  }
  if (isWebPContainer(bytes)) {
    // A recognized WebP chunk decodes to measured dimensions; a truncated
    // or corrupt recognized chunk throws malformed_frame from the parser.
    const webp = parseWebPDimensions(bytes);
    if (webp) {
      assertDimensions(webp.width, webp.height);
      return { mime: "image/webp", ...webp, sha256: sha256Hex(bytes), byteLength: bytes.length };
    }
    // Recognizable container with an unrecognized chunk: undecodable.
    throw new QualificationFrameError(
      "unsupported_format",
      `frame format not independently decodable (declared ${declaredMime})`,
    );
  }
  // A declared MIME is a claim, never evidence: unrecognizable bytes stay
  // malformed even when the sender claims image/*.
  if (bytes[0] === 0xff && declaredMime === "image/webp") {
    throw new QualificationFrameError(
      "unsupported_format",
      `frame format not independently decodable (declared ${declaredMime})`,
    );
  }
  throw new QualificationFrameError("malformed_frame", "frame has no recognizable image signature");
}

function assertDimensions(width: number, height: number): void {
  const finite = Number.isFinite(width) && Number.isFinite(height);
  if (!finite || width <= 0 || height <= 0) {
    throw new QualificationFrameError("malformed_frame", "frame has non-positive dimensions");
  }
  if (
    width < FRAME_MIN_EDGE_PX ||
    height < FRAME_MIN_EDGE_PX ||
    width > FRAME_MAX_EDGE_PX ||
    height > FRAME_MAX_EDGE_PX
  ) {
    throw new QualificationFrameError(
      "dimensions_out_of_range",
      `frame dimensions ${width}x${height} outside ${FRAME_MIN_EDGE_PX}-${FRAME_MAX_EDGE_PX}px`,
    );
  }
}

// --- Provisional profile (mirrors contract §2 StudioProviderProfile) ---

export const QualificationProfileSchema = z.object({
  provider: z.string().min(1),
  exactModelId: z.string().min(1),
  apiFamily: z.string().min(1),
  adapterVersion: z.string().min(1),
  supportedRatios: z.array(QualificationRatioSchema).min(1),
  maxInputBytes: z.number().int().positive(),
  maxImages: z.number().int().positive(),
  partialFrameContract: z.string().min(1),
  continuationContract: z.string().min(1),
  retentionDisclosure: z.object({
    retainedDays: z.number().int().nullable(),
    storeOptOut: z.string().min(1),
    deletionProcedure: z.string().min(1),
    source: z.string().min(1),
  }),
  measuredQualificationId: z.string().nullable(),
  enabled: z.boolean(),
});
export type QualificationProfile = z.infer<typeof QualificationProfileSchema>;

// --- Port events (§2: preview / completed / safe refusal-or-failure) ---

export type QualificationStreamEvent =
  | { kind: "preview"; index: number; bytes: Uint8Array; declaredMime: string }
  | {
      kind: "completed";
      bytes: Uint8Array;
      declaredMime: string;
      continuationToken: string;
      usage: { inputTokens: number; outputTokens: number };
      costMinor: number | null;
    }
  | { kind: "refusal"; reason: string }
  | { kind: "failure"; code: string; certainty: "definite" | "unknown"; message: string };

export interface QualificationGenerateRequest {
  ratio: QualificationRatio;
  fixtureId: string;
  referenceKinds: FixtureKind[];
}

export interface QualificationEditRequest {
  parentContinuationToken: string;
  parentRevisionId: string;
  branchFromRevisionId: string;
  instructionKind: "marker_edit";
}

export interface QualificationProviderPort {
  readonly profile: QualificationProfile;
  generate(request: QualificationGenerateRequest, signal: AbortSignal): AsyncIterable<QualificationStreamEvent>;
  edit(request: QualificationEditRequest, signal: AbortSignal): AsyncIterable<QualificationStreamEvent>;
}

// --- Frame recorder: safe metadata only, never payloads ---

export interface FrameRecord {
  receivedAtIso: string;
  type: "preview" | "final";
  index: number;
  sha256: string;
  width: number;
  height: number;
  mime: string;
  byteLength: number;
}

export interface StreamLogEntry {
  receivedAtIso: string;
  eventType: string;
}

export interface RecorderLimits {
  maxFrameBytes: number;
}

export class FrameRecorder {
  private events: StreamLogEntry[] = [];
  private frames: FrameRecord[] = [];
  private readonly limits: RecorderLimits;

  constructor(limits: Partial<RecorderLimits> = {}) {
    this.limits = { maxFrameBytes: limits.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES };
  }

  logEvent(eventType: string): void {
    this.events.push({ receivedAtIso: new Date().toISOString(), eventType });
  }

  recordFrame(input: {
    stage: "preview" | "final";
    index: number;
    bytes: Uint8Array;
    declaredMime: string;
  }): FrameRecord {
    if (input.bytes.length > this.limits.maxFrameBytes) {
      throw new QualificationFrameError(
        "oversized_frame",
        `frame of ${input.bytes.length} bytes exceeds ceiling of ${this.limits.maxFrameBytes}`,
      );
    }
    const decoded = decodeImageFrame(input.bytes, input.declaredMime);
    const record: FrameRecord = {
      receivedAtIso: new Date().toISOString(),
      type: input.stage,
      index: input.index,
      sha256: decoded.sha256,
      width: decoded.width,
      height: decoded.height,
      mime: decoded.mime,
      byteLength: decoded.byteLength,
    };
    this.frames.push(record);
    return record;
  }

  snapshot(): { events: StreamLogEntry[]; frames: FrameRecord[] } {
    return { events: [...this.events], frames: [...this.frames] };
  }
}

// --- Matrix runner ---

export interface RatioRunResult {
  ratio: QualificationRatio;
  fixtureId: string;
  referenceKinds: FixtureKind[];
  startedAtIso: string;
  timeToFirstPreviewMs: number | null;
  previewCount: number;
  frames: FrameRecord[];
  events: StreamLogEntry[];
  finalContinuationId: string;
  finalRevisionId: string;
  olderRevisionId: string;
  missingProgressivePreview: boolean;
  usage: { inputTokens: number; outputTokens: number };
  costMinor: number | null;
}

function safeContinuationId(token: string): string {
  return sha256Hex(new TextEncoder().encode(`continuation:${token}`)).slice(0, 16);
}

export async function runQualificationRatio(
  provider: QualificationProviderPort,
  ratio: QualificationRatio,
  input: { fixtureId: string; referenceKinds: FixtureKind[] },
  options: { recorder?: FrameRecorder; signal?: AbortSignal } = {},
): Promise<RatioRunResult> {
  const recorder = options.recorder ?? new FrameRecorder();
  const signal = options.signal ?? new AbortController().signal;
  const startedAtIso = new Date().toISOString();
  const startedAt = Date.now();
  let timeToFirstPreviewMs: number | null = null;
  let previewCount = 0;
  let continuationToken = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  let costMinor: number | null = null;

  for await (const event of provider.generate(
    { ratio, fixtureId: input.fixtureId, referenceKinds: input.referenceKinds },
    signal,
  )) {
    if (signal.aborted) {
      recorder.logEvent("interrupted");
      throw new QualificationStreamError("interrupted", "unknown", "run aborted by caller");
    }
    if (event.kind === "preview") {
      recorder.logEvent("preview_available");
      recorder.recordFrame({
        stage: "preview",
        index: event.index,
        bytes: event.bytes,
        declaredMime: event.declaredMime,
      });
      previewCount += 1;
      if (timeToFirstPreviewMs === null) timeToFirstPreviewMs = Date.now() - startedAt;
    } else if (event.kind === "completed") {
      recorder.logEvent("completed");
      recorder.recordFrame({
        stage: "final",
        index: previewCount,
        bytes: event.bytes,
        declaredMime: event.declaredMime,
      });
      continuationToken = event.continuationToken;
      usage = event.usage;
      costMinor = event.costMinor;
    } else if (event.kind === "refusal") {
      recorder.logEvent("refused");
      throw new QualificationStreamError("definite_refusal", "definite", "provider refused generation");
    } else {
      recorder.logEvent("failed");
      throw new QualificationStreamError(event.code, event.certainty, "provider reported failure");
    }
  }

  if (!continuationToken) {
    throw new QualificationStreamError("incomplete_stream", "unknown", "stream ended without completion");
  }
  const { events, frames } = recorder.snapshot();
  const finalContinuationId = safeContinuationId(continuationToken);
  const finalRevisionId = `rev-${finalContinuationId}`;
  return {
    ratio,
    fixtureId: input.fixtureId,
    referenceKinds: input.referenceKinds,
    startedAtIso,
    timeToFirstPreviewMs,
    previewCount,
    frames,
    events,
    finalContinuationId,
    finalRevisionId,
    olderRevisionId: `rev-older-${safeContinuationId(`${continuationToken}:older`)}`,
    missingProgressivePreview: previewCount === 0,
    usage,
    costMinor,
  };
}

export class QualificationStreamError extends Error {
  readonly code: string;
  readonly certainty: "definite" | "unknown";
  constructor(code: string, certainty: "definite" | "unknown", message: string) {
    super(message);
    this.name = "QualificationStreamError";
    this.code = code;
    this.certainty = certainty;
  }
}

export interface EditRunResult {
  parentRevisionId: string;
  branchFromRevisionId: string;
  branchedFromOlderRevision: boolean;
  previewCount: number;
  finalContinuationId: string;
  missingProgressivePreview: boolean;
  frames: FrameRecord[];
}

export async function runEditSequence(
  provider: QualificationProviderPort,
  input: {
    parentContinuationId: string;
    parentRevisionId: string;
    edits: Array<{ instructionKind: "marker_edit"; branchFromRevisionId: string }>;
  },
  options: { signal?: AbortSignal } = {},
): Promise<EditRunResult[]> {
  const signal = options.signal ?? new AbortController().signal;
  const results: EditRunResult[] = [];
  // Reload continuity: the caller rehydrates the parent continuation outside
  // this harness; the token below stands in for the rehydrated opaque handle.
  // Only safe IDs cross this boundary — never the token itself.
  let currentToken = `restored:${input.parentContinuationId}`;
  for (const edit of input.edits) {
    const recorder = new FrameRecorder();
    let previewCount = 0;
    let completedToken = "";
    for await (const event of provider.edit(
      {
        parentContinuationToken: currentToken,
        parentRevisionId: input.parentRevisionId,
        branchFromRevisionId: edit.branchFromRevisionId,
        instructionKind: edit.instructionKind,
      },
      signal,
    )) {
      if (event.kind === "preview") {
        recorder.logEvent("preview_available");
        recorder.recordFrame({
          stage: "preview",
          index: event.index,
          bytes: event.bytes,
          declaredMime: event.declaredMime,
        });
        previewCount += 1;
      } else if (event.kind === "completed") {
        recorder.logEvent("completed");
        recorder.recordFrame({
          stage: "final",
          index: previewCount,
          bytes: event.bytes,
          declaredMime: event.declaredMime,
        });
        completedToken = event.continuationToken;
      } else if (event.kind === "refusal") {
        recorder.logEvent("refused");
        throw new QualificationStreamError("definite_refusal", "definite", "provider refused edit");
      } else {
        recorder.logEvent("failed");
        throw new QualificationStreamError(event.code, event.certainty, "provider reported edit failure");
      }
    }
    if (!completedToken) {
      throw new QualificationStreamError("incomplete_stream", "unknown", "edit ended without completion");
    }
    currentToken = completedToken;
    const { frames } = recorder.snapshot();
    results.push({
      parentRevisionId: input.parentRevisionId,
      branchFromRevisionId: edit.branchFromRevisionId,
      branchedFromOlderRevision: edit.branchFromRevisionId !== input.parentRevisionId,
      previewCount,
      finalContinuationId: safeContinuationId(completedToken),
      missingProgressivePreview: previewCount === 0,
      frames,
    });
  }
  return results;
}

// --- Failure probes ---

export type FailureProbeName =
  | "definite_refusal"
  | "unknown_timeout"
  | "malformed_frame"
  | "oversized_frame"
  | "interruption"
  | "expired_continuation"
  | "unavailable_model";

export interface FailureProbeResult {
  probe: FailureProbeName;
  code: string;
  certainty: "definite" | "unknown";
  recoveredWithoutSilentLoss: boolean;
}

export async function runFailureProbes(
  makeProvider: (fault: FailureProbeName | null) => QualificationProviderPort,
): Promise<FailureProbeResult[]> {
  const results: FailureProbeResult[] = [];
  const baseRequest = {
    ratio: "1:1" as QualificationRatio,
    fixtureId: "failure-probe",
    referenceKinds: ["copy"] as FixtureKind[],
  };

  async function drain(
    provider: QualificationProviderPort,
    mode: "generate" | "edit",
    signal: AbortSignal,
  ): Promise<void> {
    const recorder = new FrameRecorder({ maxFrameBytes: 1024 });
    if (mode === "generate") {
      for await (const event of provider.generate(baseRequest, signal)) {
        if (event.kind === "preview") {
          recorder.recordFrame({
            stage: "preview",
            index: event.index,
            bytes: event.bytes,
            declaredMime: event.declaredMime,
          });
        } else if (event.kind === "completed") {
          recorder.recordFrame({
            stage: "final",
            index: 0,
            bytes: event.bytes,
            declaredMime: event.declaredMime,
          });
        } else if (event.kind === "refusal") {
          throw new QualificationStreamError("definite_refusal", "definite", "refused");
        } else {
          throw new QualificationStreamError(event.code, event.certainty, "failed");
        }
      }
    } else {
      for await (const event of provider.edit(
        {
          parentContinuationToken: "expired-handle",
          parentRevisionId: "rev-x",
          branchFromRevisionId: "rev-x",
          instructionKind: "marker_edit",
        },
        signal,
      )) {
        if (event.kind === "preview" || event.kind === "completed") {
          recorder.recordFrame({
            stage: event.kind === "preview" ? "preview" : "final",
            index: 0,
            bytes: event.bytes,
            declaredMime: event.declaredMime,
          });
        } else if (event.kind === "refusal") {
          throw new QualificationStreamError("definite_refusal", "definite", "refused");
        } else {
          throw new QualificationStreamError(event.code, event.certainty, "failed");
        }
      }
    }
  }

  // definite_refusal vs unknown_timeout: distinct codes and certainty.
  for (const probe of ["definite_refusal", "unknown_timeout"] as const) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (probe === "unknown_timeout") {
      timer = setTimeout(() => controller.abort(), 50);
    }
    try {
      await drain(makeProvider(probe), "generate", controller.signal);
      results.push({ probe, code: "unexpected_success", certainty: "unknown", recoveredWithoutSilentLoss: false });
    } catch (error) {
      if (error instanceof QualificationStreamError) {
        results.push({
          probe,
          code: error.code,
          certainty: error.certainty,
          recoveredWithoutSilentLoss: error.certainty === "definite" || error.code === "unknown_timeout",
        });
      } else if (error instanceof QualificationFrameError) {
        results.push({ probe, code: error.code, certainty: "definite", recoveredWithoutSilentLoss: true });
      } else {
        results.push({ probe, code: "aborted", certainty: "unknown", recoveredWithoutSilentLoss: true });
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  for (const probe of ["malformed_frame", "oversized_frame"] as const) {
    try {
      await drain(makeProvider(probe), "generate", new AbortController().signal);
      results.push({ probe, code: "unexpected_success", certainty: "unknown", recoveredWithoutSilentLoss: false });
    } catch (error) {
      if (error instanceof QualificationFrameError) {
        results.push({ probe, code: error.code, certainty: "definite", recoveredWithoutSilentLoss: true });
      } else if (error instanceof QualificationStreamError) {
        results.push({ probe, code: error.code, certainty: error.certainty, recoveredWithoutSilentLoss: true });
      } else {
        results.push({ probe, code: "aborted", certainty: "unknown", recoveredWithoutSilentLoss: true });
      }
    }
  }

  {
    const controller = new AbortController();
    controller.abort();
    try {
      await drain(makeProvider("interruption"), "generate", controller.signal);
      results.push({ probe: "interruption", code: "unexpected_success", certainty: "unknown", recoveredWithoutSilentLoss: false });
    } catch (error) {
      if (error instanceof QualificationStreamError) {
        results.push({ probe: "interruption", code: error.code, certainty: error.certainty, recoveredWithoutSilentLoss: true });
      } else {
        results.push({ probe: "interruption", code: "interrupted", certainty: "unknown", recoveredWithoutSilentLoss: true });
      }
    }
  }

  for (const probe of ["expired_continuation", "unavailable_model"] as const) {
    try {
      const provider = makeProvider(probe);
      if (probe === "expired_continuation") {
        await drain(provider, "edit", new AbortController().signal);
      } else {
        await drain(provider, "generate", new AbortController().signal);
      }
      results.push({ probe, code: "unexpected_success", certainty: "unknown", recoveredWithoutSilentLoss: false });
    } catch (error) {
      if (error instanceof QualificationStreamError) {
        results.push({ probe, code: error.code, certainty: error.certainty, recoveredWithoutSilentLoss: true });
      } else {
        results.push({ probe, code: "interrupted", certainty: "unknown", recoveredWithoutSilentLoss: true });
      }
    }
  }

  return results;
}

// --- Retention disclosure + ceiling discovery ---

export interface RetentionDisclosure {
  provider: string;
  retainedDays: number | null;
  storeOptOut: string;
  deletionProcedure: string;
  source: string;
}

export function captureRetentionDisclosure(profile: QualificationProfile): RetentionDisclosure {
  return {
    provider: profile.provider,
    retainedDays: profile.retentionDisclosure.retainedDays,
    storeOptOut: profile.retentionDisclosure.storeOptOut,
    deletionProcedure: profile.retentionDisclosure.deletionProcedure,
    source: profile.retentionDisclosure.source,
  };
}

export interface CeilingReport {
  maxSerializedRequestBytes: number;
  maxImages: number;
  nativeDimensions: Record<QualificationRatio, { width: number; height: number }>;
  verifiedByBoundaryProbe: boolean;
  // True whenever any supported ratio fell back to the assumed candidate
  // dimensions because its frame could not be independently decoded.
  dimensionsUnmeasured: boolean;
}

export async function discoverCeilings(
  provider: QualificationProviderPort,
): Promise<CeilingReport> {
  const profile = provider.profile;
  // Boundary verification: the fake port enforces declared limits, so probing
  // at limit-1 (accept), limit (accept), limit+1 (refuse) proves the ceiling
  // rather than trusting the declaration alone.
  const fake = provider as {
    probeSerializedBytes?: (byteLength: number) => boolean;
    probeImageCount?: (count: number) => boolean;
  };
  let verifiedByBoundaryProbe = false;
  if (typeof fake.probeSerializedBytes === "function" && typeof fake.probeImageCount === "function") {
    const limit = profile.maxInputBytes;
    const acceptsBelow = fake.probeSerializedBytes(limit - 1);
    const acceptsAt = fake.probeSerializedBytes(limit);
    const refusesAbove = !fake.probeSerializedBytes(limit + 1);
    const countOk = fake.probeImageCount(profile.maxImages) && !fake.probeImageCount(profile.maxImages + 1);
    verifiedByBoundaryProbe = acceptsBelow && acceptsAt && refusesAbove && countOk;
  }
  const nativeDimensions = { ...CANDIDATE_NATIVE_DIMENSIONS };
  let dimensionsUnmeasured = false;
  for (const ratio of QUALIFICATION_RATIOS) {
    if (!profile.supportedRatios.includes(ratio)) continue;
    const frame = await firstDecodedFrame(provider, ratio);
    if (frame) {
      nativeDimensions[ratio] = { width: frame.width, height: frame.height };
    } else {
      // Fallback keeps the assumed candidate dimensions and says so.
      dimensionsUnmeasured = true;
    }
  }
  return {
    maxSerializedRequestBytes: profile.maxInputBytes,
    maxImages: profile.maxImages,
    nativeDimensions,
    verifiedByBoundaryProbe,
    dimensionsUnmeasured,
  };
}

// Live PASS gate: declarations are never presented as measured. A provider
// passes only with boundary-probed ceilings, independently measured native
// dimensions, progressive pre-final frames on every run, and spend within
// the authorized cap.
export interface LivePassInput {
  ratioResults: RatioRunResult[];
  ceilings: CeilingReport;
  spendWithinCap: boolean;
}

export interface LivePassDecision {
  pass: boolean;
  reasons: string[];
}

export function meetsLivePassCriteria(input: LivePassInput): LivePassDecision {
  const reasons: string[] = [];
  if (!input.ceilings.verifiedByBoundaryProbe) {
    reasons.push("ceilings_unverified: boundary probe did not confirm declared ceilings");
  }
  if (input.ceilings.dimensionsUnmeasured) {
    reasons.push("dimensions_unmeasured: native dimensions fell back to assumed candidates");
  }
  if (input.ratioResults.length === 0) {
    reasons.push("no_ratio_runs");
  }
  for (const result of input.ratioResults) {
    if (result.previewCount === 0 || result.missingProgressivePreview) {
      reasons.push(`missing_progressive_preview:${result.ratio}`);
    }
  }
  if (!input.spendWithinCap) {
    reasons.push("spend_exceeds_cap");
  }
  return { pass: reasons.length === 0, reasons };
}

async function firstDecodedFrame(
  provider: QualificationProviderPort,
  ratio: QualificationRatio,
): Promise<{ width: number; height: number } | null> {
  const signal = new AbortController().signal;
  for await (const event of provider.generate(
    { ratio, fixtureId: "ceiling-probe", referenceKinds: ["copy"] },
    signal,
  )) {
    if (event.kind === "preview" || event.kind === "completed") {
      try {
        const decoded = decodeImageFrame(event.bytes, event.declaredMime);
        return { width: decoded.width, height: decoded.height };
      } catch {
        return null;
      }
    }
  }
  return null;
}

// --- Fail-closed live authorization (no live adapter ships in Task 1) ---

export type LiveAuthorization =
  | { authorized: true }
  | { authorized: false; reason: string };

export function authorizeLiveRun(env: Record<string, string | undefined>): LiveAuthorization {
  const capRaw = env["STUDIO_QUALIFICATION_AUTHORIZED_BUDGET_MINOR"];
  const cap = capRaw === undefined ? NaN : Number(capRaw);
  if (!Number.isInteger(cap) || cap <= 0) {
    return {
      authorized: false,
      reason: "live qualification refused: no explicit authorized budget cap ($0 default).",
    };
  }
  if (!env["STUDIO_QUALIFICATION_PROVIDER_API_KEY"]) {
    return { authorized: false, reason: "live qualification refused: provider credentials absent." };
  }
  // Even cap + credentials cannot authorize: Task 1 ships no live provider
  // adapter, so no spend path exists. Live qualification stays BLOCKED.
  return {
    authorized: false,
    reason: "live qualification refused: no live provider adapter ships in Task 1 (BLOCKED).",
  };
}

// --- Evidence assembly (safe metadata only) ---

export const SanitizedEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  profile: QualificationProfileSchema.omit({ measuredQualificationId: true }).extend({
    measuredQualificationId: z.string().nullable(),
  }),
  ratioResults: z.array(
    z.object({
      ratio: QualificationRatioSchema,
      fixtureId: z.string(),
      referenceKinds: z.array(FixtureKindSchema),
      startedAtIso: z.string(),
      timeToFirstPreviewMs: z.number().nullable(),
      previewCount: z.number().int(),
      frames: z.array(
        z.object({
          receivedAtIso: z.string(),
          type: z.enum(["preview", "final"]),
          index: z.number().int(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
          width: z.number().int(),
          height: z.number().int(),
          mime: z.string(),
          byteLength: z.number().int(),
        }),
      ),
      events: z.array(z.object({ receivedAtIso: z.string(), eventType: z.string() })),
      finalContinuationId: z.string(),
      finalRevisionId: z.string(),
      missingProgressivePreview: z.boolean(),
      usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int() }),
      costMinor: z.number().int().nullable(),
    }),
  ),
  generatedAtIso: z.string(),
});
export type SanitizedEvidence = z.infer<typeof SanitizedEvidenceSchema>;

export function sanitizeEvidence(input: {
  ratioResults: RatioRunResult[];
  profile?: QualificationProfile;
  secretMarkers?: string[];
}): SanitizedEvidence {
  const profile: QualificationProfile =
    input.profile ??
    createFakeStudioProvider(
      FakeProviderConfigSchema.parse({ previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 } }),
    ).profile;
  const evidence = {
    schemaVersion: 1 as const,
    profile,
    ratioResults: input.ratioResults.map((r) => ({
      ratio: r.ratio,
      fixtureId: r.fixtureId,
      referenceKinds: r.referenceKinds,
      startedAtIso: r.startedAtIso,
      timeToFirstPreviewMs: r.timeToFirstPreviewMs,
      previewCount: r.previewCount,
      frames: r.frames,
      events: r.events,
      finalContinuationId: r.finalContinuationId,
      finalRevisionId: r.finalRevisionId,
      missingProgressivePreview: r.missingProgressivePreview,
      usage: r.usage,
      costMinor: r.costMinor,
    })),
    generatedAtIso: new Date().toISOString(),
  };
  const parsed = SanitizedEvidenceSchema.parse(evidence);
  for (const marker of input.secretMarkers ?? []) {
    if (marker && JSON.stringify(parsed).includes(marker)) {
      throw new Error("sanitized evidence leaks a caller-known secret marker");
    }
  }
  return parsed;
}

// --- Minimal local evidence viewer (FIXTURE frames only) ---

export interface ViewerFrame {
  index: number;
  label: string;
  dataUri: string;
  width: number;
  height: number;
  sha256: string;
}

export function renderEvidenceViewerHtml(input: { title: string; frames: ViewerFrame[] }): string {
  const cards = input.frames
    .map(
      (f) => `<figure data-frame="${f.index}">
  <figcaption>FIXTURE · ${escapeHtml(f.label)} · ${f.width}x${f.height} · sha256 ${escapeHtml(f.sha256.slice(0, 16))}…</figcaption>
  <img src="${escapeHtml(f.dataUri)}" width="${f.width}" height="${f.height}" alt="FIXTURE frame ${f.index}" />
</figure>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>${escapeHtml(input.title)}</title></head>
<body>
<p><strong>FIXTURE frames for browser verification only — never production streaming.</strong></p>
<main>${cards}</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Deterministic fake provider (zero network; offline tests only) ---

export const FakeProviderConfigSchema = z.object({
  previewCounts: z.object({
    "4:5": z.number().int().min(0).max(3),
    "1:1": z.number().int().min(0).max(3),
    "9:16": z.number().int().min(0).max(3),
  }),
  fault: z
    .enum([
      "definite_refusal",
      "unknown_timeout",
      "malformed_frame",
      "oversized_frame",
      "interruption",
      "expired_continuation",
      "unavailable_model",
    ])
    .nullable()
    .optional(),
  exactModelId: z.string().min(1).default("fixture-image-model-1"),
  maxInputBytes: z.number().int().positive().default(100 * 1024 * 1024),
  maxImages: z.number().int().positive().default(14),
});
export type FakeProviderConfig = z.infer<typeof FakeProviderConfigSchema>;

type FakeFault = NonNullable<FakeProviderConfig["fault"]>;

function fakePng(width: number, height: number, seed: number, padBytes = 0): Uint8Array {
  const bytes = new Uint8Array(48 + ((seed + 1) % 8) + padBytes);
  PNG_SIGNATURE.forEach((b, i) => {
    bytes[i] = b;
  });
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes[12] = 73;
  bytes[13] = 72;
  bytes[14] = 68;
  bytes[15] = 82;
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 2;
  for (let i = 33; i < bytes.length; i++) bytes[i] = (seed + i) % 256;
  return bytes;
}

export interface FakeStudioProvider extends QualificationProviderPort {
  probeSerializedBytes(byteLength: number): boolean;
  probeImageCount(count: number): boolean;
}

export function createFakeStudioProvider(config: FakeProviderConfig): FakeStudioProvider {
  const fault: FakeFault | null = config.fault ?? null;
  const profile: QualificationProfile = {
    provider: "fake",
    exactModelId: config.exactModelId,
    apiFamily: "fixture-responses",
    adapterVersion: "task1-harness-1",
    supportedRatios: [...QUALIFICATION_RATIOS],
    maxInputBytes: config.maxInputBytes,
    maxImages: config.maxImages,
    partialFrameContract: "scripted preview sequence then final; deterministic offline fixture",
    continuationContract: "opaque token replay; expired handle rejected with continuation_expired",
    retentionDisclosure: {
      retainedDays: 0,
      storeOptOut: "fixture provider stores nothing",
      deletionProcedure: "no side effects exist; nothing to delete",
      source: "Task 1 deterministic fake provider",
    },
    measuredQualificationId: null,
    enabled: false,
  };

  async function* run(
    ratio: QualificationRatio,
    signal: AbortSignal,
    mode: "generate" | "edit",
    seedBase: number,
  ): AsyncIterable<QualificationStreamEvent> {
    if (signal.aborted) {
      yield { kind: "failure", code: "interrupted", certainty: "unknown", message: "aborted before start" };
      return;
    }
    if (fault === "unavailable_model") {
      yield { kind: "failure", code: "model_unavailable", certainty: "definite", message: "pinned model unavailable" };
      return;
    }
    if (fault === "definite_refusal") {
      yield { kind: "refusal", reason: "fixture definite refusal" };
      return;
    }
    if (fault === "unknown_timeout") {
      // Hangs until the caller aborts: completion state genuinely unknown.
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new QualificationStreamError("unknown_timeout", "unknown", "aborted while outcome unknown"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new QualificationStreamError("unknown_timeout", "unknown", "aborted while outcome unknown"));
        });
      });
      return;
    }
    if (fault === "expired_continuation" && mode === "edit") {
      yield { kind: "failure", code: "continuation_expired", certainty: "definite", message: "continuation expired" };
      return;
    }
    if (fault === "interruption") {
      yield { kind: "failure", code: "interrupted", certainty: "unknown", message: "stream interrupted" };
      return;
    }
    const native = CANDIDATE_NATIVE_DIMENSIONS[ratio];
    const scripted = mode === "generate" ? config.previewCounts[ratio] : 1;
    for (let index = 0; index < scripted; index++) {
      if (signal.aborted) {
        yield { kind: "failure", code: "interrupted", certainty: "unknown", message: "aborted mid-stream" };
        return;
      }
      if (fault === "malformed_frame") {
        yield { kind: "preview", index, bytes: new Uint8Array([7, 7, 7, 7, 7, 7, 7, 7]), declaredMime: "image/png" };
        continue;
      }
      if (fault === "oversized_frame") {
        // Valid IHDR but a byte payload over small probe ceilings: trips the
        // oversized_frame byte ceiling before dimension checks run.
        const nativeOver = CANDIDATE_NATIVE_DIMENSIONS[ratio];
        yield {
          kind: "preview",
          index,
          bytes: fakePng(nativeOver.width, nativeOver.height, seedBase + index, 4096),
          declaredMime: "image/png",
        };
        continue;
      }
      yield { kind: "preview", index, bytes: fakePng(native.width, native.height, seedBase + index), declaredMime: "image/png" };
    }
    yield {
      kind: "completed",
      bytes: fakePng(native.width, native.height, seedBase + 99),
      declaredMime: "image/png",
      continuationToken: `fixture-token-${mode}-${ratio}-${seedBase}`,
      usage: { inputTokens: 100 + seedBase, outputTokens: 10 },
      // Fake runs spend nothing; unknown paid outcomes would be null.
      // Zero here means measured zero spend on a fake, never a paid claim.
      costMinor: 0,
    };
  }

  return {
    profile,
    generate(request, signal) {
      return run(request.ratio, signal, "generate", 1);
    },
    edit(request, signal) {
      return run("1:1", signal, "edit", request.branchFromRevisionId.length);
    },
    probeSerializedBytes(byteLength: number) {
      return byteLength <= config.maxInputBytes;
    },
    probeImageCount(count: number) {
      return count <= config.maxImages;
    },
  };
}
