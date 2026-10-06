import postgres from "postgres";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const url = env.split("\n").find((l) => l.startsWith("DATABASE_URL="))?.slice(13).replace(/^"|"$/g, "");
const sql = postgres(url, { prepare: false, ssl: "require", max: 1 });

const migration = readFileSync("supabase/migrations/20260916120000_campaign_research_worker_drafting.sql", "utf8");
const suite = readFileSync("supabase/tests/database/campaign_research_worker_drafting_test.sql", "utf8")
  .replace(/^begin;\s*/m, "")
  .replace(/rollback;\s*$/m, "");

class Rollback extends Error {}

try {
  await sql.begin(async (tx) => {
    console.log("--- applying migration ---");
    await tx.unsafe(migration);
    console.log("migration applied");

    console.log("--- auth.uid() under service_role ---");
    await tx`set local role service_role`;
    await tx`set local request.jwt.claim.sub = ''`;
    const uid = await tx`select auth.uid() is null as is_null`;
    console.log("auth.uid() is null:", uid[0].is_null);
    await tx`reset role`;

    console.log("--- running pgTAP suite ---");
    const rows = await tx.unsafe(suite);
    const results = Array.isArray(rows[0]) ? rows.flat() : rows;
    let pass = 0, fail = 0;
    for (const row of results) {
      const line = Object.values(row)[0];
      if (typeof line !== "string") continue;
      if (line.startsWith("ok ")) pass += 1;
      else if (line.startsWith("not ok ")) { fail += 1; console.log(line); }
      else if (line.trim().startsWith("#") && fail > 0) console.log(line);
    }
    console.log(`pgTAP: ${pass} passed, ${fail} failed`);
    throw new Rollback();
  });
} catch (error) {
  if (!(error instanceof Rollback)) {
    console.log("REHEARSAL ERROR:", error.message);
    if (error.position) console.log("  at position", error.position);
    if (error.where) console.log("  where:", error.where);
  } else {
    console.log("--- rolled back ---");
  }
}

const after = await sql`
  select
    (select count(*)::int from public.campaign_proposals) as proposals,
    (select count(*)::int from public.campaign_research_runs) as runs,
    (select count(*)::int from information_schema.columns
      where table_name='campaign_research_runs' and column_name='requested_by') as requested_by_column,
    has_function_privilege('service_role','public.request_campaign_proposal(uuid, jsonb)','EXECUTE') as worker_can_draft
`;
console.log("staging after rehearsal:", JSON.stringify(after[0]));
await sql.end();
