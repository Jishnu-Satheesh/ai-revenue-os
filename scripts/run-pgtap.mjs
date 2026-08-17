import { readFileSync } from "node:fs";
import postgres from "postgres";
import { config } from "dotenv";

import { resolvePgTapDatabaseUrl, resolvePgTapSuites } from "./pgtap-suites.mjs";

const suitePaths = resolvePgTapSuites(process.argv.slice(2));

if (suitePaths.length === 0) {
  console.error("No pgTAP suites found in supabase/tests/database.");
  process.exit(1);
}

config({ path: ".env.local", quiet: true });

const url = resolvePgTapDatabaseUrl(process.env.DATABASE_URL);
const sql = postgres(url, { prepare: false, onnotice: () => {}, max: 1 });
const redact = (value) => String(value).replace(/postgres(ql)?:\/\/\S+/g, "[redacted]");

let failedAssertions = 0;
let failedSuites = 0;

try {
  for (const suitePath of suitePaths) {
    try {
      const body = readFileSync(suitePath, "utf8");
      const results = await sql.unsafe(body).simple();
      const lines = [];
      for (const result of Array.isArray(results[0]) ? results : [results]) {
        for (const row of result ?? []) {
          const value = Object.values(row)[0];
          if (typeof value === "string") lines.push(value);
        }
      }
      const suiteFailures = lines.filter((line) => /^not ok/.test(line));

      // A plan mismatch is a failure, not a note. pgTAP reports it as a bare
      // "Looks like you planned N tests but ran M" diagnostic rather than a
      // `not ok`, so counting only `not ok` reported a green suite that had
      // silently gained an assertion -- and would do the same for one that
      // silently stopped running a dozen.
      const planMismatch = lines.filter((line) => /^# Looks like you planned/.test(line));
      const suiteProblems = suiteFailures.length + planMismatch.length;

      failedAssertions += suiteProblems;
      console.log(`\n# ${suitePath}`);
      console.log(lines.join("\n"));
      console.log(
        `\n--- ${suiteProblems === 0 ? "PASS" : "FAIL"}: ${suiteProblems} failing assertion(s)`,
      );
    } catch (error) {
      failedSuites += 1;
      console.error(`ERROR in ${suitePath}:`, redact(error.message ?? error));
      if (error.position) console.error("position:", error.position);
      if (error.detail) console.error("detail:", redact(error.detail));
      await sql
        .unsafe("rollback")
        .simple()
        .catch(() => undefined);
    }
  }
} catch (error) {
  console.error("ERROR:", redact(error.message ?? error));
  if (error.position) console.error("position:", error.position);
  if (error.detail) console.error("detail:", redact(error.detail));
  process.exitCode = 1;
} finally {
  await sql.end();
}

if (failedAssertions > 0 || failedSuites > 0) {
  console.error(
    `\n--- FAIL: ${failedAssertions} failing assertion(s) across ${failedSuites} failed suite(s)`,
  );
  process.exitCode = 1;
}
