import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// RED: this module does not exist yet. Every test below must fail on import
// until the qualification library is implemented.
import {
  authorizeLiveRun,
  captureRetentionDisclosure,
  createFakeStudioProvider,
  decodeImageFrame,
  discoverCeilings,
  FakeProviderConfigSchema,
  FrameRecorder,
  meetsLivePassCriteria,
  renderEvidenceViewerHtml,
  runEditSequence,
  runFailureProbes,
  runQualificationRatio,
  sanitizeEvidence,
} from "./provider-qualification";

function pngBytes(width: number, height: number, fill = 0x41): Uint8Array {
  const bytes = new Uint8Array(64 + width);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  sig.forEach((b, i) => {
    bytes[i] = b;
  });
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // IHDR length
  const ihdr = [73, 72, 68, 82];
  ihdr.forEach((b, i) => {
    bytes[12 + i] = b;
  });
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8; // bit depth
  bytes[25] = 2; // color type (truecolor)
  for (let i = 33; i < bytes.length; i++) bytes[i] = fill;
  return bytes;
}

describe("decodeImageFrame", () => {
  it("decodes PNG dimensions from bytes, ignoring a wrong declared MIME", () => {
    const bytes = pngBytes(1024, 1280);
    const frame = decodeImageFrame(bytes, "image/jpeg");
    expect(frame.mime).toBe("image/png");
    expect(frame.width).toBe(1024);
    expect(frame.height).toBe(1280);
    expect(frame.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("rejects malformed bytes with a safe code and no payload", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    try {
      decodeImageFrame(bytes, "image/png");
      expect.unreachable();
    } catch (error) {
      const err = error as Error & { code?: string };
      expect(err.code).toBe("malformed_frame");
      expect(err.message).not.toContain("1,2,3");
    }
  });

  it("rejects dimensions outside the intake intersection", () => {
    const bytes = pngBytes(9000, 9000);
    try {
      decodeImageFrame(bytes, "image/png");
      expect.unreachable();
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe("dimensions_out_of_range");
    }
  });

  it("decodes JPEG SOF dimensions from bytes", () => {
    const bytes = jpegBytes(640, 480);
    const frame = decodeImageFrame(bytes, "image/jpeg");
    expect(frame.mime).toBe("image/jpeg");
    expect(frame.width).toBe(640);
    expect(frame.height).toBe(480);
  });

  it("rejects a truncated JPEG with a safe code", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00]);
    try {
      decodeImageFrame(bytes, "image/jpeg");
      expect.unreachable();
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe("malformed_frame");
    }
  });

  it("decodes VP8 lossy WebP dimensions from bytes", () => {
    const bytes = webpLossyBytes(640, 480);
    const frame = decodeImageFrame(bytes, "image/webp");
    expect(frame.mime).toBe("image/webp");
    expect(frame.width).toBe(640);
    expect(frame.height).toBe(480);
  });

  it("decodes VP8L lossless WebP dimensions from bytes", () => {
    const bytes = webpLosslessBytes(320, 200);
    const frame = decodeImageFrame(bytes, "image/webp");
    expect(frame.mime).toBe("image/webp");
    expect(frame.width).toBe(320);
    expect(frame.height).toBe(200);
  });

  it("decodes VP8X extended WebP dimensions from bytes", () => {
    const bytes = webpExtendedBytes(800, 600);
    const frame = decodeImageFrame(bytes, "image/webp");
    expect(frame.mime).toBe("image/webp");
    expect(frame.width).toBe(800);
    expect(frame.height).toBe(600);
  });

  it("rejects a truncated WebP payload with a safe code and no payload", () => {
    const bytes = webpLossyBytes(640, 480).slice(0, 22);
    try {
      decodeImageFrame(bytes, "image/webp");
      expect.unreachable();
    } catch (error) {
      const err = error as Error & { code?: string };
      expect(err.code).toBe("malformed_frame");
      expect(err.message).not.toContain("640");
    }
  });
});

function jpegBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes[0] = 0xff; // SOI
  bytes[1] = 0xd8;
  bytes[2] = 0xff; // APP0 marker
  bytes[3] = 0xe0;
  bytes[4] = 0x00; // length 16
  bytes[5] = 0x10;
  for (let i = 6; i < 20; i++) bytes[i] = 0; // APP0 filler
  bytes[20] = 0xff; // SOF0 marker
  bytes[21] = 0xc0;
  bytes[22] = 0x00; // length 11
  bytes[23] = 0x0b;
  bytes[24] = 0x08; // precision
  bytes[25] = (height >> 8) & 0xff;
  bytes[26] = height & 0xff;
  bytes[27] = (width >> 8) & 0xff;
  bytes[28] = width & 0xff;
  bytes[29] = 0x00;
  return bytes;
}

function riffWebpHeader(into: Uint8Array, fourcc: [number, number, number, number], chunkSize: number): void {
  into.set([82, 73, 70, 70], 0); // RIFF
  new DataView(into.buffer).setUint32(4, into.length - 8, true);
  into.set([87, 69, 66, 80], 8); // WEBP
  into.set(fourcc, 12);
  new DataView(into.buffer).setUint32(16, chunkSize, true);
}

function webpLossyBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  riffWebpHeader(bytes, [86, 80, 56, 32], 10); // "VP8 "
  bytes[23] = 0x9d; // start code 0x9d012a after the 3-byte frame tag
  bytes[24] = 0x01;
  bytes[25] = 0x2a;
  new DataView(bytes.buffer).setUint16(26, width, true);
  new DataView(bytes.buffer).setUint16(28, height, true);
  return bytes;
}

function webpLosslessBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(25);
  riffWebpHeader(bytes, [86, 80, 56, 76], 5); // "VP8L"
  bytes[20] = 0x2f; // lossless signature
  const bits = ((height - 1) << 14) | (width - 1);
  new DataView(bytes.buffer).setUint32(21, bits, true);
  return bytes;
}

function webpExtendedBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  riffWebpHeader(bytes, [86, 80, 56, 88], 10); // "VP8X"
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes[24] = widthMinusOne & 0xff;
  bytes[25] = (widthMinusOne >> 8) & 0xff;
  bytes[26] = (widthMinusOne >> 16) & 0xff;
  bytes[27] = heightMinusOne & 0xff;
  bytes[28] = (heightMinusOne >> 8) & 0xff;
  bytes[29] = (heightMinusOne >> 16) & 0xff;
  return bytes;
}

describe("FrameRecorder", () => {
  it("records timestamp/type/index/hash/dimensions per frame", () => {
    const recorder = new FrameRecorder();
    const bytes = pngBytes(256, 320);
    const record = recorder.recordFrame({ stage: "preview", index: 0, bytes, declaredMime: "image/png" });
    expect(record.type).toBe("preview");
    expect(record.index).toBe(0);
    expect(record.width).toBe(256);
    expect(record.mime).toBe("image/png");
    expect(typeof record.receivedAtIso).toBe("string");
    expect(recorderSnapshot(recorder).frames).toHaveLength(1);
  });

  it("rejects oversized payloads against a configured ceiling", () => {
    const recorder = new FrameRecorder({ maxFrameBytes: 16 });
    const bytes = pngBytes(64, 80);
    try {
      recorder.recordFrame({ stage: "preview", index: 0, bytes, declaredMime: "image/png" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe("oversized_frame");
    }
  });
});

function recorderSnapshot(recorder: FrameRecorder) {
  return recorder.snapshot();
}

describe("fake provider matrix", () => {
  it("runs a ratio end to end: scripted previews, final, timing, continuation", async () => {
    const provider = createFakeStudioProvider(
      FakeProviderConfigSchema.parse({
        previewCounts: { "4:5": 2, "1:1": 1, "9:16": 3 },
      }),
    );
    const result = await runQualificationRatio(provider, "4:5", {
      fixtureId: "copy-product-design-logo",
      referenceKinds: ["copy", "product", "design", "logo"],
    });
    expect(result.previewCount).toBe(2);
    expect(result.missingProgressivePreview).toBe(false);
    expect(result.frames).toHaveLength(3); // 2 previews + final
    expect(result.timeToFirstPreviewMs).not.toBeNull();
    expect(result.finalContinuationId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("flags a fast final-only run as missing progressive preview, not a pass", async () => {
    const provider = createFakeStudioProvider(
      FakeProviderConfigSchema.parse({ previewCounts: { "4:5": 0, "1:1": 0, "9:16": 0 } }),
    );
    const result = await runQualificationRatio(provider, "1:1", {
      fixtureId: "typographic",
      referenceKinds: ["typographic"],
    });
    expect(result.previewCount).toBe(0);
    expect(result.missingProgressivePreview).toBe(true);
  });

  it("emits preview_available before completed in the events sequence", async () => {
    const provider = createFakeStudioProvider(
      FakeProviderConfigSchema.parse({
        previewCounts: { "4:5": 2, "1:1": 1, "9:16": 3 },
      }),
    );
    const result = await runQualificationRatio(provider, "4:5", {
      fixtureId: "event-order",
      referenceKinds: ["copy"],
    });
    const types = result.events.map((e) => e.eventType);
    expect(types).toEqual(["preview_available", "preview_available", "completed"]);
  });

  it("supports reload plus two contextual edits including an older-version branch", async () => {
    const factory = (overrides = {}) =>
      createFakeStudioProvider(
        FakeProviderConfigSchema.parse({
          previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 },
          ...overrides,
        }),
      );
    const first = factory();
    const gen = await runQualificationRatio(first, "1:1", {
      fixtureId: "multilingual",
      referenceKinds: ["multilingual", "copy"],
    });
    // Fresh-process reload: serialize the continuation, restore in a new instance.
    const reloaded = factory();
    const edits = await runEditSequence(reloaded, {
      parentContinuationId: gen.finalContinuationId,
      parentRevisionId: gen.finalRevisionId,
      edits: [
        { instructionKind: "marker_edit", branchFromRevisionId: gen.finalRevisionId },
        { instructionKind: "marker_edit", branchFromRevisionId: gen.olderRevisionId },
      ],
    });
    expect(edits).toHaveLength(2);
    expect(edits[1].branchedFromOlderRevision).toBe(true);
    expect(edits[0].branchedFromOlderRevision).toBe(false);
  });
});

describe("failure probes", () => {
  it("distinguishes definite refusal from unknown timeout with distinct codes", async () => {
    const results = await runFailureProbes((fault) =>
      createFakeStudioProvider(
        FakeProviderConfigSchema.parse({
          previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 },
          fault,
        }),
      ),
    );
    const byName = Object.fromEntries(results.map((r) => [r.probe, r]));
    expect(byName["definite_refusal"].code).toBe("definite_refusal");
    expect(byName["definite_refusal"].certainty).toBe("definite");
    expect(byName["unknown_timeout"].code).toBe("unknown_timeout");
    expect(byName["unknown_timeout"].certainty).toBe("unknown");
    expect(byName["unknown_timeout"].code).not.toBe(byName["definite_refusal"].code);
    expect(byName["malformed_frame"].code).toBe("malformed_frame");
    expect(byName["oversized_frame"].code).toBe("oversized_frame");
    expect(byName["interruption"].code).toBe("interrupted");
    expect(byName["expired_continuation"].code).toBe("continuation_expired");
    expect(byName["unavailable_model"].code).toBe("model_unavailable");
  });

  it("attributes a raw throw on the unavailable_model path to that probe", async () => {
    const results = await runFailureProbes((fault) => {
      if (fault === "unavailable_model") {
        const fake = createFakeStudioProvider(
          FakeProviderConfigSchema.parse({
            previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 },
          }),
        );
        return {
          profile: fake.profile,
          generate(): AsyncIterable<never> {
            throw new Error("raw provider boom");
          },
          edit(): AsyncIterable<never> {
            throw new Error("raw provider boom");
          },
        };
      }
      return createFakeStudioProvider(
        FakeProviderConfigSchema.parse({
          previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 },
          fault,
        }),
      );
    });
    const byName = Object.fromEntries(results.map((r) => [r.probe, r]));
    expect(byName["unavailable_model"].probe).toBe("unavailable_model");
    expect(byName["unavailable_model"].code).toBe("interrupted");
  });
});

describe("disclosure and ceilings", () => {
  it("captures retention/deletion disclosure from the profile", () => {
    const provider = createFakeStudioProvider(
      FakeProviderConfigSchema.parse({ previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 } }),
    );
    const disclosure = captureRetentionDisclosure(provider.profile);
    expect(disclosure.provider).toBe("fake");
    expect(typeof disclosure.deletionProcedure).toBe("string");
  });

  it("discovers size/count ceilings by boundary probing over scripted fake-measured dimensions", async () => {
    // Circular by construction on the fake: it emits the candidate dimensions
    // and discovery reads them back. Live adapters must re-measure real bytes.
    const provider = createFakeStudioProvider(
      FakeProviderConfigSchema.parse({ previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 } }),
    );
    const ceilings = await discoverCeilings(provider);
    expect(ceilings.maxSerializedRequestBytes).toBeGreaterThan(0);
    expect(ceilings.maxImages).toBeGreaterThan(0);
    expect(ceilings.nativeDimensions["4:5"]).toEqual({ width: 1024, height: 1280 });
    expect(ceilings.dimensionsUnmeasured).toBe(false);
  });

  it("flags assumed native dimensions when frames cannot be decoded", async () => {
    const fake = createFakeStudioProvider(
      FakeProviderConfigSchema.parse({ previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 } }),
    );
    const undecodable = {
      profile: fake.profile,
      probeSerializedBytes: (byteLength: number) => byteLength <= fake.profile.maxInputBytes,
      probeImageCount: (count: number) => count <= fake.profile.maxImages,
      async *generate(): AsyncIterable<{
        kind: "preview";
        index: number;
        bytes: Uint8Array;
        declaredMime: string;
      }> {
        yield {
          kind: "preview",
          index: 0,
          bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
          declaredMime: "image/png",
        };
      },
      async *edit(): AsyncIterable<never> {
        // Unused by ceiling discovery.
      },
    };
    const ceilings = await discoverCeilings(undecodable);
    expect(ceilings.verifiedByBoundaryProbe).toBe(true);
    expect(ceilings.dimensionsUnmeasured).toBe(true);
    expect(ceilings.nativeDimensions["4:5"]).toEqual({ width: 1024, height: 1280 });
  });

  it("requires boundary-verified ceilings for a live PASS, never declarations alone", async () => {
    const provider = createFakeStudioProvider(
      FakeProviderConfigSchema.parse({ previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 } }),
    );
    const ratioResult = await runQualificationRatio(provider, "1:1", {
      fixtureId: "pass-gate",
      referenceKinds: ["copy"],
    });
    const ceilings = await discoverCeilings(provider);
    expect(
      meetsLivePassCriteria({ ratioResults: [ratioResult], ceilings, spendWithinCap: true }).pass,
    ).toBe(true);
    const declaredOnly = { ...ceilings, verifiedByBoundaryProbe: false };
    const decision = meetsLivePassCriteria({
      ratioResults: [ratioResult],
      ceilings: declaredOnly,
      spendWithinCap: true,
    });
    expect(decision.pass).toBe(false);
    expect(decision.reasons.join(" ")).toContain("ceilings_unverified");
  });

  it("fails live PASS on final-only runs and unmeasured dimensions", async () => {
    const provider = createFakeStudioProvider(
      FakeProviderConfigSchema.parse({ previewCounts: { "4:5": 0, "1:1": 0, "9:16": 0 } }),
    );
    const ratioResult = await runQualificationRatio(provider, "1:1", {
      fixtureId: "final-only",
      referenceKinds: ["copy"],
    });
    const ceilings = await discoverCeilings(provider);
    const unmeasured = { ...ceilings, dimensionsUnmeasured: true };
    const decision = meetsLivePassCriteria({
      ratioResults: [ratioResult],
      ceilings: unmeasured,
      spendWithinCap: true,
    });
    expect(decision.pass).toBe(false);
    expect(decision.reasons.join(" ")).toContain("missing_progressive_preview:1:1");
    expect(decision.reasons.join(" ")).toContain("dimensions_unmeasured");
  });
});

describe("fail-closed live entry", () => {
  it("refuses without an explicit authorized cap", () => {
    expect(authorizeLiveRun({}).authorized).toBe(false);
    expect(authorizeLiveRun({ STUDIO_QUALIFICATION_AUTHORIZED_BUDGET_MINOR: "0" }).authorized).toBe(false);
  });

  it("refuses without provider credentials", () => {
    expect(
      authorizeLiveRun({ STUDIO_QUALIFICATION_AUTHORIZED_BUDGET_MINOR: "5000" }).authorized,
    ).toBe(false);
  });

  it("refuses even with cap plus credentials: no live adapter ships in Task 1", () => {
    const decision = authorizeLiveRun({
      STUDIO_QUALIFICATION_AUTHORIZED_BUDGET_MINOR: "5000",
      STUDIO_QUALIFICATION_PROVIDER_API_KEY: "present-in-env-only",
    });
    expect(decision.authorized).toBe(false);
  });
});

describe("evidence hygiene and viewer", () => {
  it("sanitized evidence carries no bytes, prompts, copy, tokens, or URLs", async () => {
    const provider = createFakeStudioProvider(
      FakeProviderConfigSchema.parse({ previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 } }),
    );
    const result = await runQualificationRatio(provider, "4:5", {
      fixtureId: "secret-fixture",
      referenceKinds: ["copy"],
    });
    const evidence = sanitizeEvidence({
      ratioResults: [result],
      secretMarkers: ["TOP-SECRET-COPY", "continuation-token-live", "https://signed.example/abc"],
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("TOP-SECRET-COPY");
    expect(serialized).not.toContain("continuation-token-live");
    expect(serialized).not.toContain("https://signed.example/abc");
  });

  it("viewer labels fixture frames and never claims production streaming", () => {
    const html = renderEvidenceViewerHtml({
      title: "Qualification evidence",
      frames: [
        {
          index: 0,
          label: "preview 0",
          dataUri: "data:image/png;base64,iVBORw0KGgo=",
          width: 64,
          height: 80,
          sha256: "ab".repeat(32),
        },
      ],
    });
    expect(html).toContain("FIXTURE");
    expect(html).toContain("never production streaming");
  });

  it("escapes single quotes in viewer output", () => {
    const html = renderEvidenceViewerHtml({
      title: "Qualification evidence",
      frames: [
        {
          index: 0,
          label: "it's a preview",
          dataUri: "data:image/png;base64,iVBORw0KGgo=",
          width: 64,
          height: 80,
          sha256: "ab".repeat(32),
        },
      ],
    });
    expect(html).toContain("it&#39;s a preview");
    expect(html).not.toContain("it's a preview");
  });
});
