/**
 * Development seed: a bundle version whose copy is actually Malayalam and Arabic.
 *
 * The Studio renders the words the manifest already carries -- it does not
 * translate, and deliberately so. So a Malayalam poster needs a version whose
 * copy *is* Malayalam, and until one exists the Malayalam promise cannot be
 * proved end to end against real data.
 *
 * This writes one through `create_campaign_bundle_version`, the same path the
 * generation pipeline uses, rather than editing a stored manifest in place. That
 * matters: the digest is recomputed over the new manifest, the version is a
 * successor with a parent, and any approval against the parent is revoked by the
 * function itself. Hand-patching the JSON would have left a digest that no
 * longer described the document and an approval still pointing at it.
 *
 * The copy is authored here, by hand, for the pilot organization's own dish. It
 * is a development fixture and says so: no model produced it, and nothing about
 * it claims to be an approved translation of the English version. A production
 * path for multilingual copy is a separate question with its own approval
 * consequences -- see spec 020 section 18.2.
 *
 *   pnpm tsx scripts/seed-non-latin-campaign-copy.ts [--write]
 *
 * Without `--write` it prints what it would do and touches nothing.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

import { bundleDigest } from "@/domain/campaigns/digest";
import { campaignBundleManifestSchema } from "@/domain/campaigns/schemas";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";

const ORGANIZATION_ID = "2dda45b8-82db-4f5f-b17d-611b9bbb7846";
const CAMPAIGN_ID = "5f2292f5-946d-4607-87f3-163ac0f3cdb2";
const PARENT_VERSION_ID = "37b0b4d4-ab69-4ba7-9496-366567d833b2";

/** Direction id -> the script its copy is written in. */
const MALAYALAM_DIRECTION = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ARABIC_DIRECTION = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const LATIN_DIRECTION = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";

/**
 * Chosen to exercise the shaping that actually breaks, not merely to be
 * non-Latin. The Malayalam carries the conjuncts ങ്ങ, മ്പ, ന്ന, സ്വ and ക്ക and
 * the vowel sign െ, which is stored after its consonant and drawn before it --
 * a renderer that ignores reordering produces something a reader sees instantly.
 * The Arabic requires contextual joining throughout and lays out right to left.
 */
const COPY: Record<string, { hook: string; caption: string; callToAction: string }> = {
  [MALAYALAM_DIRECTION]: {
    hook: "ഞങ്ങളുടെ നെയ്മീൻ കറിയുടെ സമ്പന്നമായ രുചി ആസ്വദിക്കൂ.",
    caption:
      "പരമ്പരാഗത ചുവന്ന മൺകലത്തിൽ വിളമ്പുന്ന ഞങ്ങളുടെ നെയ്മീൻ കറി, പുളിയും തേങ്ങയും ചേർന്ന കടും ചുവപ്പ് ഗ്രേവിയിൽ തയ്യാറാക്കിയത്. ഫ്രഷ് കറിവേപ്പില ചേർത്ത് വിളമ്പുന്നു. [source: operator-confirmed-subject]",
    callToAction: "മെനു കാണുക",
  },
  [ARABIC_DIRECTION]: {
    hook: "تذوق النكهات الغنية في كاري سمك الكنعد.",
    caption:
      "كاري سمك الكنعد المميز لدينا، محضّر بشرائح طرية في صلصة التمر الهندي وجوز الهند بلون أحمر داكن، ويُقدّم في قدر فخاري تقليدي مع أوراق الكاري الطازجة. [source: operator-confirmed-subject]",
    callToAction: "شاهد القائمة",
  },
};

function environment(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

async function main() {
  const write = process.argv.includes("--write");
  const env = environment();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: parent, error: parentError } = await db
    .from("campaign_bundle_versions")
    .select("id, version, manifest, source_snapshot_id")
    .eq("organization_id", ORGANIZATION_ID)
    .eq("id", PARENT_VERSION_ID)
    .single();
  if (parentError || !parent) throw new Error(`parent unreadable: ${parentError?.message}`);

  const { data: assets, error: assetError } = await db
    .from("campaign_assets")
    .select("asset_key, storage_path")
    .eq("organization_id", ORGANIZATION_ID)
    .eq("bundle_version_id", PARENT_VERSION_ID);
  if (assetError || !assets) throw new Error(`assets unreadable: ${assetError?.message}`);

  const base = campaignBundleManifestSchema.parse(parent.manifest);

  // The successor. Version number is assigned by the function under its own
  // lock, so it is read back rather than guessed -- but the manifest carries it
  // and a check constraint compares the two, so it has to be right here first.
  const nextVersion = parent.version + 1;

  const manifest: CampaignBundleManifest = campaignBundleManifestSchema.parse({
    ...base,
    version: nextVersion,
    directions: base.directions.map((direction) => {
      const replacement = COPY[direction.id];
      if (replacement === undefined) return direction;
      return {
        ...direction,
        copy: direction.copy.map((copy) => ({ ...copy, ...replacement })),
      };
    }),
    /**
     * Recorded in the manifest, so the choice of template is inside the digest
     * and inside whatever approval is given next -- the treatment ADR 0020 gave
     * the generation policy. Both feed templates are named because both are
     * being proved; all three scripts because all three are.
     */
    posterPlan: {
      placements: [
        { placement: "feed_image", templateKey: "core_feed_headline", templateVersion: 1 },
      ],
      scripts: ["Latn", "Mlym", "Arab"],
    },
  });

  const digest = bundleDigest(manifest);
  const storagePaths = Object.fromEntries(
    assets.map((asset) => [asset.asset_key as string, asset.storage_path as string]),
  );

  console.log(`parent v${parent.version} -> new v${nextVersion}`);
  console.log(`digest ${digest}`);
  for (const direction of manifest.directions) {
    console.log(`  ${direction.id}`);
    console.log(`    hook: ${direction.copy[0].hook}`);
    console.log(`    cta:  ${direction.copy[0].callToAction}`);
  }
  console.log(`  latin direction (unchanged): ${LATIN_DIRECTION}`);

  if (!write) {
    console.log("\ndry run. pass --write to create the version.");
    return;
  }

  const { data, error } = await db.rpc("create_campaign_bundle_version", {
    target_organization_id: ORGANIZATION_ID,
    input_bundle: {
      organization_id: ORGANIZATION_ID,
      campaign_id: CAMPAIGN_ID,
      source_snapshot_id: parent.source_snapshot_id,
      digest,
      manifest,
      total_spend_ceiling: manifest.totalSpendCeiling,
      directions: manifest.directions,
      assets: manifest.assets.map((asset) => ({
        ...asset,
        storagePath: storagePaths[asset.id],
      })),
      actions: manifest.actions,
      measurement_plan: manifest.measurementPlan,
    },
  });
  if (error) throw new Error(`rpc failed: ${error.message}`);

  console.log("\ncreated:", JSON.stringify(data, null, 1));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
