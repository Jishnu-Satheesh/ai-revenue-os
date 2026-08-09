import { readFileSync } from "node:fs";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const url = (process.env.DATABASE_URL ?? "").replace(":6543", ":5432");
const sql = postgres(url, { prepare: false, onnotice: () => {}, max: 1 });
const redact = (value) => String(value).replace(/postgres(ql)?:\/\/\S+/g, "[redacted]");

try {
  const body = readFileSync(process.argv[2], "utf8");
  const results = await sql.unsafe(body).simple();
  const lines = [];
  for (const result of Array.isArray(results[0]) ? results : [results]) {
    for (const row of result ?? []) {
      const value = Object.values(row)[0];
      if (typeof value === "string") lines.push(value);
    }
  }
  const output = lines.join("\n");
  console.log(output);
  const failed = lines.filter((line) => /^not ok/.test(line));
  console.log(`\n--- ${failed.length === 0 ? "PASS" : "FAIL"}: ${failed.length} failing assertion(s)`);
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error("ERROR:", redact(error.message ?? error));
  if (error.position) console.error("position:", error.position);
  if (error.detail) console.error("detail:", redact(error.detail));
  process.exitCode = 1;
} finally {
  await sql.end();
}
