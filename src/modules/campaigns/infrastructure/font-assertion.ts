import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

import { CampaignError } from "@/domain/campaigns/errors";
import {
  VENDORED_FONT_DIR,
  describeFontProblem,
  verifyFontHashes,
  vendoredFontPath,
} from "@/domain/campaigns/font-manifest";

/**
 * Prove the fonts on disk are the fonts that were approved, before rendering.
 *
 * This runs at worker start and **throws**. A warning would be the wrong shape:
 * the failure it guards against is silent by nature, because a renderer handed
 * the wrong font does not error — it draws empty boxes at a plausible width and
 * publishes them. Refusing to start is loud, early, and costs nothing compared
 * with a client's feed carrying unreadable Malayalam.
 *
 * The hash reading is here rather than in the domain so the decision itself
 * stays pure and testable without a filesystem.
 */

export type FontHashReader = () => Promise<Readonly<Record<string, string>>>;

/** SHA-256 of every font file present in the vendored directory. */
export async function readFontHashes(): Promise<Readonly<Record<string, string>>> {
  const entries = await readdir(VENDORED_FONT_DIR);
  const observed: Record<string, string> = {};

  for (const file of entries) {
    // Only font files are pinned. The licence and the README live here too and
    // are documentation, not inputs to a rendering.
    if (!file.toLowerCase().endsWith(".ttf") && !file.toLowerCase().endsWith(".otf")) continue;
    const bytes = await readFile(vendoredFontPath(file));
    observed[file] = createHash("sha256").update(bytes).digest("hex");
  }

  return observed;
}

export async function assertVendoredFonts(read: FontHashReader = readFontHashes): Promise<void> {
  const result = verifyFontHashes(await read());
  if (result.ok) return;

  // Every problem, not the first. Someone repairing a font directory should see
  // the whole picture in one pass rather than a restart at a time.
  const detail = result.problems.map(describeFontProblem).join(" ");
  throw new CampaignError(
    "CAMPAIGN_FONT_MANIFEST_MISMATCH",
    `The vendored fonts do not match their pinned manifest, so nothing may be rendered. ${detail}`,
  );
}
