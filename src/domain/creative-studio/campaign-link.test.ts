import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  studioVersionSourceSchema,
  type StudioVersionSource,
} from "@/domain/campaigns/deliverable";
import {
  StudioSourceResolutionError,
  resolveDeliverableSource,
  selectStudioCampaignCreativeSchema,
  studioSelectionIdentity,
} from "@/domain/creative-studio/campaign-link";

const STUDIO_VERSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STUDIO_EXPORT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAMPAIGN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROFILE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const KNOWN_BYTES = new TextEncoder().encode("studio-final-poster-bytes");
const KNOWN_HASH = createHash("sha256").update(KNOWN_BYTES).digest("hex");

function source(overrides: Record<string, unknown> = {}): StudioVersionSource {
  return studioVersionSourceSchema.parse({
    kind: "studio_version",
    studioVersionId: STUDIO_VERSION,
    studioExportId: null,
    contentHash: KNOWN_HASH,
    ...overrides,
  });
}

function renderInputs(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    kind: "studio_full_poster",
    studioVersionId: STUDIO_VERSION,
    studioExportId: null,
    contentHash: KNOWN_HASH,
    inputDigest: "e".repeat(64),
    providerProfileId: PROFILE,
    textCopyDigest: "f".repeat(64),
    channelLogoSubstitutionDigest: "0".repeat(64),
    referenceManifestDigest: "1".repeat(64),
    exportTransformDigest: null,
    ...overrides,
  };
}

function artifact(bytes: Uint8Array = KNOWN_BYTES) {
  return {
    bytes,
    mime: "image/png",
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  };
}

function resolutionReason(fn: () => unknown): string | null {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(StudioSourceResolutionError);
    return (error as StudioSourceResolutionError).reason;
  }
  return null;
}

describe("campaign selection", () => {
  it("admits a durable selection pinning the exact version, export and hash", () => {
    const parsed = selectStudioCampaignCreativeSchema.safeParse({
      campaignId: CAMPAIGN,
      studioVersionId: STUDIO_VERSION,
      studioExportId: null,
      contentHash: KNOWN_HASH,
      idempotencyKey: "attach-once-001",
    });

    expect(parsed.success).toBe(true);
  });

  it("gives a native selection and an export selection different identities", () => {
    const native = studioSelectionIdentity({
      studioVersionId: STUDIO_VERSION,
      studioExportId: null,
      contentHash: KNOWN_HASH,
    });
    const exported = studioSelectionIdentity({
      studioVersionId: STUDIO_VERSION,
      studioExportId: STUDIO_EXPORT,
      contentHash: KNOWN_HASH,
    });

    expect(native).not.toBe(exported);
    expect(native).toContain("native");
    expect(
      studioSelectionIdentity({
        studioVersionId: STUDIO_VERSION,
        studioExportId: null,
        contentHash: KNOWN_HASH,
      }),
    ).toBe(native);
  });
});

describe("resolveDeliverableSource", () => {
  it("resolves the immutable Studio bytes for preview, download and review", () => {
    const resolved = resolveDeliverableSource({
      source: source(),
      renderInputs: renderInputs(),
      artifact: artifact(),
    });

    expect(resolved.bytes).toBe(KNOWN_BYTES);
    expect(resolved.mime).toBe("image/png");
  });

  it("rejects a cross-arm pairing: studio source with legacy compositor inputs", () => {
    expect(
      resolutionReason(() =>
        resolveDeliverableSource({
          source: source(),
          renderInputs: {
            plateContentHash: KNOWN_HASH,
            templateVersion: 3,
            script: "Latn",
            slotValues: {},
            freeLine: null,
            brandMarkVersionId: null,
            fontManifestVersion: "2026.09.1",
            renderEngineVersion: "resvg-0.44",
          },
          artifact: artifact(),
        }),
      ),
    ).toBe("cross_arm_mismatch");
  });

  it("rejects a version/export/hash that does not match between source and inputs", () => {
    expect(
      resolutionReason(() =>
        resolveDeliverableSource({
          source: source(),
          renderInputs: renderInputs({ studioExportId: STUDIO_EXPORT }),
          artifact: artifact(),
        }),
      ),
    ).toBe("cross_arm_mismatch");
  });

  it("rejects bytes whose hash moved under the selection", () => {
    const tampered = new TextEncoder().encode("studio-final-poster-BYTES");

    expect(
      resolutionReason(() =>
        resolveDeliverableSource({
          source: source(),
          renderInputs: renderInputs(),
          artifact: artifact(tampered),
        }),
      ),
    ).toBe("hash_mismatch");
  });

  it("rejects corrupt bytes behind a stale-but-matching hash record: the bytes are hashed, not trusted", () => {
    const tampered = new TextEncoder().encode("studio-final-poster-BYTES");

    expect(
      resolutionReason(() =>
        resolveDeliverableSource({
          source: source(),
          renderInputs: renderInputs(),
          artifact: { bytes: tampered, mime: "image/png", contentHash: KNOWN_HASH },
        }),
      ),
    ).toBe("hash_mismatch");
  });
});
