import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  FONT_MANIFEST,
  fontForScript,
  fontManifestDigest,
  vendoredFontPath,
  verifyFontHashes,
} from "@/domain/campaigns/font-manifest";

function observedFromManifest(overrides: Readonly<Record<string, string>> = {}) {
  const observed: Record<string, string> = {};
  for (const font of FONT_MANIFEST) observed[font.file] = font.sha256;
  return { ...observed, ...overrides };
}

describe("FONT_MANIFEST", () => {
  it("covers the three scripts this client publishes in", () => {
    const covered = new Set(FONT_MANIFEST.flatMap((font) => font.scripts));
    expect(covered).toEqual(new Set(["Latn", "Mlym", "Arab"]));
  });

  it("declares exactly one font per script, so a lookup is never ambiguous", () => {
    for (const script of ["Latn", "Mlym", "Arab"] as const) {
      expect(FONT_MANIFEST.filter((font) => font.scripts.includes(script))).toHaveLength(1);
    }
  });

  it("pins every font by a SHA-256 and a byte size", () => {
    for (const font of FONT_MANIFEST) {
      expect(font.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(font.byteSize).toBeGreaterThan(0);
      expect(font.version).not.toHaveLength(0);
      expect(font.licence).toBe("OFL-1.1");
    }
  });
});

describe("fontManifestDigest", () => {
  it("is a stable SHA-256 over the manifest", () => {
    expect(fontManifestDigest()).toMatch(/^[0-9a-f]{64}$/);
    expect(fontManifestDigest()).toBe(fontManifestDigest());
  });
});

describe("verifyFontHashes", () => {
  it("accepts the manifest's own hashes", () => {
    expect(verifyFontHashes(observedFromManifest())).toEqual({ ok: true });
  });

  it("refuses a font whose bytes changed", () => {
    const changed = FONT_MANIFEST[0]!.file;
    const result = verifyFontHashes(observedFromManifest({ [changed]: "0".repeat(64) }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems).toEqual([
      {
        file: changed,
        kind: "hash_mismatch",
        expected: FONT_MANIFEST[0]!.sha256,
        observed: "0".repeat(64),
      },
    ]);
  });

  it("refuses a font that is absent, rather than rendering without it", () => {
    const observed = observedFromManifest();
    const missing = FONT_MANIFEST[1]!.file;
    delete observed[missing];
    const result = verifyFontHashes(observed);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems).toEqual([
      { file: missing, kind: "missing", expected: FONT_MANIFEST[1]!.sha256, observed: null },
    ]);
  });

  it("refuses a font nobody declared, because an unpinned font is not an approved input", () => {
    const result = verifyFontHashes(observedFromManifest({ "Sneaky-Regular.ttf": "1".repeat(64) }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems).toEqual([
      { file: "Sneaky-Regular.ttf", kind: "unexpected", expected: null, observed: "1".repeat(64) },
    ]);
  });

  it("reports every problem at once, sorted, rather than only the first", () => {
    const observed = observedFromManifest({ [FONT_MANIFEST[0]!.file]: "0".repeat(64) });
    delete observed[FONT_MANIFEST[1]!.file];
    const result = verifyFontHashes(observed);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems).toHaveLength(2);
    expect(result.problems.map((problem) => problem.file)).toEqual(
      [...result.problems.map((problem) => problem.file)].sort(),
    );
  });
});

describe("fontForScript", () => {
  it("resolves each supported script", () => {
    expect(fontForScript("Mlym")?.family).toBe("Noto Sans Malayalam");
    expect(fontForScript("Arab")?.family).toBe("Noto Sans Arabic");
    expect(fontForScript("Latn")?.family).toBe("Noto Sans");
  });

  it("returns null for a script nothing covers, rather than a Latin fallback", () => {
    expect(fontForScript("Deva")).toBeNull();
  });
});

/**
 * The test the whole task exists for.
 *
 * A font that silently updates changes what a client publishes, so the bytes on
 * disk are checked against the pinned hashes here rather than at boot alone. If
 * this fails, someone replaced a font file and the render digest no longer means
 * what it claimed.
 */
describe("the vendored font files", () => {
  it("match their pinned hashes on disk", async () => {
    for (const font of FONT_MANIFEST) {
      const bytes = await readFile(vendoredFontPath(font.file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(font.sha256);
      expect(bytes.byteLength).toBe(font.byteSize);
    }
  });
});
