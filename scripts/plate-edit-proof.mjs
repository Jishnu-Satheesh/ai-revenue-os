/**
 * Dispatch one real plate edit and check what it produced.
 *
 * The registration and the adapters are only half an answer. This exercises the
 * half that tests cannot: the image model actually answering, the compositor
 * bounding whatever it returns, the successor version being written, and the
 * edit row pointing at the right asset.
 *
 * **This spends a model call and creates a new bundle version.** It is not
 * read-only and it is not idempotent in the way a render is -- pass a fresh
 * `--key` for a genuinely new edit, or reuse one to prove the replay.
 *
 *   node scripts/plate-edit-proof.mjs --org <id> --campaign <id> --version <id> \
 *     --plate <assetId> --key <idempotencyKey> [--instruction "..."]
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

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const organizationId = arg("org");
const campaignId = arg("campaign");
const bundleVersionId = arg("version");
const parentPlateAssetId = arg("plate");
const idempotencyKey = arg("key", `edit-proof-${Date.now()}`);
const instruction = arg("instruction", "Make this area of the background a little darker.");

if (!organizationId || !campaignId || !bundleVersionId || !parentPlateAssetId) {
  console.error("--org, --campaign, --version and --plate are all required");
  process.exit(1);
}

const { data: plate, error: plateError } = await db
  .from("campaign_assets")
  .select("id, width_px, height_px, content_hash, bundle_version_id")
  .eq("organization_id", organizationId)
  .eq("id", parentPlateAssetId)
  .single();
if (plateError) {
  console.error("plate unreadable:", plateError.message);
  process.exit(1);
}
if (plate.bundle_version_id !== bundleVersionId) {
  console.error("that plate belongs to a different version");
  process.exit(1);
}

// A modest region in the upper-left quadrant: big enough to be admitted, small
// enough that the coverage ceiling is nowhere near.
const bounds = {
  xPx: Math.round(plate.width_px * 0.08),
  yPx: Math.round(plate.height_px * 0.08),
  widthPx: Math.round(plate.width_px * 0.28),
  heightPx: Math.round(plate.height_px * 0.28),
};

console.log(`editing ${parentPlateAssetId} (${plate.width_px}x${plate.height_px})`);
console.log(`region ${JSON.stringify(bounds)}`);
console.log(`instruction: ${instruction}`);

const handle = await tasks.trigger("campaign.edit-plate", {
  organizationId,
  campaignId,
  bundleVersionId,
  parentPlateAssetId,
  correlationId: randomUUID(),
  editedBy: arg("by", "cecdac67-ad1c-4cc3-acbf-3029273dacda"),
  idempotencyKey,
  annotations: [{ ordinal: 1, bounds, instruction }],
});

const finished = await runs.poll(handle.id, { pollIntervalMs: 3000 });
console.log("run:", handle.id, "status:", finished.status);
console.log("output:", JSON.stringify(finished.output));
if (finished.error) console.log("error:", JSON.stringify(finished.error));

if (finished.output?.status !== "edited") process.exit(1);

const { data: edit, error: editError } = await db
  .from("campaign_plate_edits")
  .select(
    "id, parent_plate_asset_id, child_plate_asset_id, mask_storage_path, mask_content_hash, union_coverage_ratio, annotations, model_id, cost_minor",
  )
  .eq("organization_id", organizationId)
  .eq("id", finished.output.editId)
  .maybeSingle();
if (editError) {
  console.log("edit row unreadable:", editError.message);
  process.exit(1);
}
console.log("edit row:", JSON.stringify(edit, null, 1));

const { data: child } = await db
  .from("campaign_assets")
  .select("id, asset_key, storage_path, content_hash, bundle_version_id, width_px, height_px")
  .eq("organization_id", organizationId)
  .eq("id", edit.child_plate_asset_id)
  .maybeSingle();
console.log("child asset:", JSON.stringify(child, null, 1));

const { data: version } = await db
  .from("campaign_bundle_versions")
  .select("id, version, parent_version_id, digest")
  .eq("organization_id", organizationId)
  .eq("id", finished.output.bundleVersionId)
  .maybeSingle();
console.log("successor version:", JSON.stringify(version, null, 1));

for (const [label, bucket, path] of [
  ["edited plate", "campaign-assets", child?.storage_path],
  ["union mask", "campaign-masks", edit.mask_storage_path],
]) {
  if (!path) continue;
  const { data: object, error } = await db.storage.from(bucket).download(path);
  if (error) {
    console.log(`${label} download error:`, error.message);
    continue;
  }
  const bytes = Buffer.from(await object.arrayBuffer());
  const out = `docs/verification/campaigns/plate-edit-${label.split(" ")[0]}.png`;
  writeFileSync(out, bytes);
  console.log(`saved ${out} (${bytes.length} bytes)`);
}
