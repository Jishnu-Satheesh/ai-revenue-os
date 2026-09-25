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
});

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

  it("discovers size/count/dimension ceilings by boundary probing", async () => {
    const provider = createFakeStudioProvider(
      FakeProviderConfigSchema.parse({ previewCounts: { "4:5": 1, "1:1": 1, "9:16": 1 } }),
    );
    const ceilings = await discoverCeilings(provider);
    expect(ceilings.maxSerializedRequestBytes).toBeGreaterThan(0);
    expect(ceilings.maxImages).toBeGreaterThan(0);
    expect(ceilings.nativeDimensions["4:5"]).toEqual({ width: 1024, height: 1280 });
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
});
