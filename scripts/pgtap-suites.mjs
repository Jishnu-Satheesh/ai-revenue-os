import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export function resolvePgTapSuites(selectors, rootDirectory = process.cwd()) {
  if (selectors.length > 0) return selectors;

  const suiteDirectory = resolve(rootDirectory, "supabase/tests/database");
  return readdirSync(suiteDirectory)
    .filter((name) => name.endsWith("_test.sql"))
    .sort()
    .map((name) => resolve(suiteDirectory, name));
}

export function resolvePgTapDatabaseUrl(databaseUrl) {
  return (databaseUrl || DEFAULT_LOCAL_DATABASE_URL).replace(":6543", ":5432");
}
