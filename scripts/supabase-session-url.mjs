import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const source = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!source) {
  console.error("DATABASE_URL (or DIRECT_URL) is not set in .env.local");
  process.exit(1);
}

// supabase db push/migration list need session-level SQL semantics, which the
// transaction-mode pooler (:6543) doesn't support, and the direct DB host is
// often network-blocked. The session-mode pooler (same host, :5432) works for both.
process.stdout.write(source.replace(":6543", ":5432"));
