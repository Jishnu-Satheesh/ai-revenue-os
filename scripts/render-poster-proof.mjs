/**
 * Dispatch real poster renders and fetch what they produced.
 *
 * The Trigger MCP server is not always reachable from this machine, and the
 * render proof should not depend on it: this goes straight through the SDK with
 * the project's own secret key, then reads the recorded row and downloads the
 * object it points at.
 *
 * Read-only apart from the render itself, which is idempotent by content: the
 * same inputs produce the same digest and the database replays the row it
 * already has rather than writing a second one. Running it twice is how the
 * determinism claim is checked, not something to avoid.
 *
 *   node scripts/render-poster-proof.mjs --version <id> --direction <id> \
 *     --script Latn|Mlym|Arab [--template core_feed_headline] [--out <path>]
 *
 * The plate is resolved from the direction's own `assetIds` against that
 * version's asset rows, because the worker refuses a plate belonging to a
 * different version and passing one by hand is how that gets discovered slowly.
 */
import { createClient } from "@supabase/supabase-js";
import { configure, runs, tasks } from "@trigger.dev/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

configure({ secretKey: env.TRIGGER_SECRET_KEY });

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ORGANIZATION_ID = "2dda45b8-82db-4f5f-b17d-611b9bbb7846";
const CAMPAIGN_ID = "5f2292f5-946d-4607-87f3-163ac0f3cdb2";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const bundleVersionId = arg("version", "bbc34c36-fee2-4a5e-b487-23a5741ca44c");
const directionId = arg("direction");
const script = arg("script", "Latn");
const templateKey = arg("template", "core_feed_headline");
const extra = arg("extra", null);

if (!directionId) {
  console.error("--direction is required");
  process.exit(1);
}

const { data: version, error: versionError } = await db
  .from("campaign_bundle_versions")
  .select("manifest, version")
  .eq("organization_id", ORGANIZATION_ID)
  .eq("id", bundleVersionId)
  .single();
if (versionError) {
  console.error("version unreadable:", versionError.message);
  process.exit(1);
}

const direction = version.manifest.directions.find((candidate) => candidate.id === directionId);
if (!direction) {
  console.error(`no direction ${directionId} in v${version.version}`);
  process.exit(1);
}

const { data: assets, error: assetError } = await db
  .from("campaign_assets")
  .select("id, asset_key")
  .eq("organization_id", ORGANIZATION_ID)
  .eq("bundle_version_id", bundleVersionId);
if (assetError) {
  console.error("assets unreadable:", assetError.message);
  process.exit(1);
}

const plate = assets.find((asset) => asset.asset_key === direction.assetIds[0]);
if (!plate) {
  console.error(`direction's asset ${direction.assetIds[0]} has no row in this version`);
  process.exit(1);
}

const copy = direction.copy[0];
console.log(`v${version.version} ${directionId} / ${script} / ${templateKey}`);
console.log(`  hook: ${copy.hook}`);
console.log(`  cta:  ${copy.callToAction}`);

const handle = await tasks.trigger("campaign.render-poster", {
  organizationId: ORGANIZATION_ID,
  campaignId: CAMPAIGN_ID,
  bundleVersionId,
  plateAssetId: plate.id,
  correlationId: randomUUID(),
  templateKey,
  templateVersion: 1,
  script,
  directionId,
  channel: "instagram",
  extra,
});
const finished = await runs.poll(handle.id, { pollIntervalMs: 2000 });

console.log("run:", handle.id, "status:", finished.status);
console.log("output:", JSON.stringify(finished.output));
if (finished.error) console.log("error:", JSON.stringify(finished.error));

if (finished.output?.status !== "rendered") process.exit(1);

const { data: row, error } = await db
  .from("campaign_poster_renders")
  .select(
    "id, state, template_key, script, text_values, render_digest, output_storage_path, output_content_hash, output_width_px, output_height_px",
  )
  .eq("organization_id", ORGANIZATION_ID)
  .eq("render_digest", finished.output.renderDigest)
  .maybeSingle();

if (error) {
  console.log("row read error:", error.message);
  process.exit(1);
}

console.log("recorded row:", JSON.stringify(row, null, 1));

const { data: object, error: downloadError } = await db.storage
  .from("campaign-assets")
  .download(row.output_storage_path);

if (downloadError) {
  console.log("download error:", downloadError.message);
  process.exit(1);
}

const bytes = Buffer.from(await object.arrayBuffer());
const out = arg("out", `docs/verification/campaigns/poster-${templateKey}-${script}.png`);
writeFileSync(out, bytes);
console.log(`saved ${out} (${bytes.length} bytes)`);
