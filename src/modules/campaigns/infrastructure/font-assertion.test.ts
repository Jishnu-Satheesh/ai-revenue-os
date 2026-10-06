import { describe, expect, it } from "vitest";

import { CampaignError } from "@/domain/campaigns/errors";
import { FONT_MANIFEST } from "@/domain/campaigns/font-manifest";
import {
  assertVendoredFonts,
  readFontHashes,
} from "@/modules/campaigns/infrastructure/font-assertion";

describe("readFontHashes", () => {
  it("hashes every vendored file that is actually on disk", async () => {
    const observed = await readFontHashes();
    for (const font of FONT_MANIFEST) expect(observed[font.file]).toBe(font.sha256);
  });
});

describe("assertVendoredFonts", () => {
  it("passes against the real vendored fonts", async () => {
    await expect(assertVendoredFonts()).resolves.toBeUndefined();
  });

  it("throws rather than warns when a font was replaced", async () => {
    const swapped = { ...(await readFontHashes()), [FONT_MANIFEST[0]!.file]: "0".repeat(64) };
    await expect(assertVendoredFonts(async () => swapped)).rejects.toBeInstanceOf(CampaignError);
  });

  it("names every problem in the message, so one restart shows the whole picture", async () => {
    const broken = { ...(await readFontHashes()), [FONT_MANIFEST[0]!.file]: "0".repeat(64) };
    delete broken[FONT_MANIFEST[1]!.file];
    await expect(assertVendoredFonts(async () => broken)).rejects.toThrow(
      new RegExp(`${FONT_MANIFEST[0]!.file}[\\s\\S]*${FONT_MANIFEST[1]!.file}`),
    );
  });

  it("carries a stable code so callers can act on it", async () => {
    const swapped = { ...(await readFontHashes()), [FONT_MANIFEST[0]!.file]: "0".repeat(64) };
    await expect(assertVendoredFonts(async () => swapped)).rejects.toMatchObject({
      code: "CAMPAIGN_FONT_MANIFEST_MISMATCH",
    });
  });
});
