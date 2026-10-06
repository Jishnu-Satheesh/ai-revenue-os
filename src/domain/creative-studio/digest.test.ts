import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  sha256HexBytes,
  sha256HexCanonical,
  sha256HexText,
  studioExportDigest,
  studioIdempotencyDigest,
  studioLogoSubstitutionDigest,
  studioPromptDigest,
  studioReferenceManifestDigest,
  studioTextCopyDigest,
} from "@/domain/creative-studio/digest";

function nodeHexText(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

describe("pure-TS SHA-256", () => {
  it.each([
    ["empty string", ""],
    ["short ASCII", "Weekday lunch AED 35"],
    ["newlines and spaces", "  lunch\nAED 35 \n"],
    ["Malayalam", "കേരള മീൻ കറി"],
    ["Arabic", "وجبة الغداء"],
    ["emoji past the basic multilingual plane", "🍔🍟🥤"],
    ["mixed copy", "Order on Talabat 🍔\nAED 35 — اليوم"],
    ["long input", "x".repeat(10_000)],
  ])("matches node:crypto for %s", (_name, input) => {
    expect(sha256HexText(input)).toBe(nodeHexText(input));
    expect(sha256HexText(input)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes bytes exactly as node:crypto does", () => {
    const bytes = new TextEncoder().encode("studio-final-poster-bytes 🍔");

    expect(sha256HexBytes(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("is stable: the same copy always yields the same digest", () => {
    expect(studioTextCopyDigest("Weekday lunch")).toBe(studioTextCopyDigest("Weekday lunch"));
  });

  it("treats copy that differs only in code points as different bytes", () => {
    expect(studioTextCopyDigest("ൊ")).not.toBe(studioTextCopyDigest("ൊ"));
  });
});

describe("studio digests", () => {
  it("digests the exact prompt, byte for byte", () => {
    expect(studioPromptDigest("  lunch  ")).toBe(nodeHexText("  lunch  "));
    expect(studioPromptDigest("lunch")).not.toBe(studioPromptDigest("  lunch  "));
  });

  it("digests the reference manifest independently of selection order", () => {
    const first = { kind: "product", referenceId: "b", versionId: "v", contentHash: "a".repeat(64) };
    const second = { kind: "product", referenceId: "a", versionId: "v", contentHash: "a".repeat(64) };

    expect(studioReferenceManifestDigest([first, second])).toBe(
      studioReferenceManifestDigest([second, first]),
    );
    expect(studioReferenceManifestDigest([first])).not.toBe(
      studioReferenceManifestDigest([second]),
    );
  });

  it("digests a manifest with duplicate reference ids deterministically", () => {
    const first = { kind: "product", referenceId: "dup", versionId: "v", contentHash: "a".repeat(64) };
    const second = { kind: "product", referenceId: "dup", versionId: "v", contentHash: "b".repeat(64) };

    expect(studioReferenceManifestDigest([first, second])).toBe(
      studioReferenceManifestDigest([first, second]),
    );
    expect(studioReferenceManifestDigest([first, second])).toMatch(/^[0-9a-f]{64}$/);
    expect(studioReferenceManifestDigest([first, second])).not.toBe(
      studioReferenceManifestDigest([first]),
    );
  });

  it("digests the logo substitution manifest: a moved range is a new manifest", () => {
    const substitution = {
      start: 9,
      end: 16,
      phrase: "Talabat",
      channelId: "talabat",
      logoAssetVersionId: "v",
      logoContentHash: "a".repeat(64),
      consent: true,
    };

    expect(studioLogoSubstitutionDigest([substitution])).toBe(
      studioLogoSubstitutionDigest([{ ...substitution }]),
    );
    expect(studioLogoSubstitutionDigest([substitution])).not.toBe(
      studioLogoSubstitutionDigest([{ ...substitution, start: 10 }]),
    );
    expect(studioLogoSubstitutionDigest([])).not.toBe(
      studioLogoSubstitutionDigest([substitution]),
    );
  });

  it("digests the logo substitution manifest independently of chip order", () => {
    const first = {
      start: 9,
      end: 16,
      phrase: "Talabat",
      channelId: "talabat",
      logoAssetVersionId: "v",
      logoContentHash: "a".repeat(64),
    };
    const second = {
      start: 20,
      end: 29,
      phrase: "Deliveroo",
      channelId: "deliveroo",
      logoAssetVersionId: "v",
      logoContentHash: "b".repeat(64),
    };

    expect(studioLogoSubstitutionDigest([first, second])).toBe(
      studioLogoSubstitutionDigest([second, first]),
    );
  });

  it("digests idempotency inputs canonically: key order is an accident, content is not", () => {
    const manifest = {
      operation: "generate",
      prompt: "lunch",
      textCopy: "AED 35",
      profileId: "p",
      presetId: "instagram_feed",
    };

    expect(studioIdempotencyDigest(manifest)).toBe(
      sha256HexCanonical({ presetId: "instagram_feed", profileId: "p", textCopy: "AED 35", prompt: "lunch", operation: "generate" }),
    );
    expect(studioIdempotencyDigest({ ...manifest, prompt: "dinner" })).not.toBe(
      studioIdempotencyDigest(manifest),
    );
  });

  it("gives the same export the same identity, and any transform change a new one", () => {
    const base = {
      studioVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceContentHash: "a".repeat(64),
      transform: { kind: "proportional_resize", targetWidth: 1080, targetHeight: 1350 },
      transformVersion: 1,
      presetVersion: 1,
      aspectPreset: "instagram_feed",
    } as const;

    expect(studioExportDigest(base)).toBe(studioExportDigest({ ...base }));
    expect(
      studioExportDigest({
        ...base,
        transform: { kind: "contain_pad", targetWidth: 1080, targetHeight: 1350, padColor: "#ffffff" },
      }),
    ).not.toBe(studioExportDigest(base));
    expect(
      studioExportDigest({ ...base, sourceContentHash: "b".repeat(64) }),
    ).not.toBe(studioExportDigest(base));
  });
});
