/**
 * Dispatch one real poster render and fetch what it produced.
 *
 * The Trigger MCP server is not always reachable from this machine, and the
 * render proof should not depend on it: this goes straight through the SDK with
 * the project's own secret key, then reads the recorded row and downloads the
 * object it points at.
 *
 * Read-only apart from the render itself, which is idempotent by content: the
 * same inputs produce the same digest and the database replays the row it
 * already has rather than writing a second one.
 *
 *   node scripts/render-poster-proof.mjs <templateKey> [script] [directionId]
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
const BUNDLE_VERSION_ID = "37b0b4d4-ab69-4ba7-9496-366567d833b2";
const PLATE_ASSET_ID = "a0dd1ef4-3397-42be-a1aa-afb91dd5261b";

const templateKey = process.argv[2] ?? "core_feed_headline";
const script = process.argv[3] ?? "Latn";
const directionId = process.argv[4] ?? "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const payload = {
  organizationId: ORGANIZATION_ID,
  campaignId: CAMPAIGN_ID,
  bundleVersionId: BUNDLE_VERSION_ID,
  plateAssetId: PLATE_ASSET_ID,
  correlationId: randomUUID(),
  templateKey,
  templateVersion: 1,
  script,
  directionId,
  channel: "instagram",
  extra: null,
};

console.log(`dispatching ${templateKey} / ${script} ...`);
const handle = await tasks.trigger("campaign.render-poster", payload);
const finished = await runs.poll(handle.id, { pollIntervalMs: 2000 });

console.log("run:", handle.id);
console.log("status:", finished.status);
console.log("output:", JSON.stringify(finished.output));
if (finished.error) console.log("error:", JSON.stringify(finished.error));

if (finished.output?.status !== "rendered") process.exit(1);

const { data: row, error } = await db
  .from("campaign_poster_renders")
  .select("id, state, template_key, script, text_values, render_digest, output_storage_path, output_content_hash, output_width_px, output_height_px")
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
const out = `docs/verification/campaigns/poster-${templateKey}-${script}.png`;
writeFileSync(out, bytes);
console.log(`saved ${out} (${bytes.length} bytes)`);
