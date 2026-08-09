import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const url = (process.env.DATABASE_URL ?? "").replace(":6543", ":5432");
const sql = postgres(url, { prepare: false, onnotice: () => {} });

const statement = process.argv.slice(2).join(" ");
try {
  const rows = await sql.unsafe(statement);
  console.log(JSON.stringify(rows, null, 2));
} catch (error) {
  console.error("ERROR:", String(error.message ?? error).replace(/postgres(ql)?:\/\/\S+/g, "[redacted]"));
  process.exitCode = 1;
} finally {
  await sql.end();
}
