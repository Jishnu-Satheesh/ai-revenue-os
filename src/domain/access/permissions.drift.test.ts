import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  accountPermissions,
  accountRolePermissions,
  organizationPermissions,
  organizationRolePermissions,
  permissionDescriptions,
  type Permission,
} from "@/domain/access/permissions";

/**
 * The database holds the authoritative permission catalogue; this file's mirror
 * exists so the browser can hide a control a role cannot use. Two copies of the
 * same rules rot apart, and the rotted state is silent: the UI offers a button
 * the server then refuses, or hides one the user is entitled to.
 *
 * `pnpm db:types` cannot run in this project and vitest has no database, so this
 * compares the mirror against the migration's seed rows as text -- the same
 * approach `src/lib/supabase/database.types.test.ts` takes, and for the same
 * reason. `supabase/tests/database/permission_catalogue_test.sql` separately
 * asserts the live rows, so both ends are covered.
 */

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const sql = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(resolve(migrationsDirectory, name), "utf8"))
  .join("\n");

/** Reads SQL string literals out of one `(...)` tuple, unescaping `''`. */
function parseTuple(inner: string): string[] {
  const values: string[] = [];
  let index = 0;
  while (index < inner.length) {
    if (inner[index] !== "'") {
      index += 1;
      continue;
    }
    index += 1;
    let value = "";
    while (index < inner.length) {
      if (inner[index] === "'") {
        if (inner[index + 1] === "'") {
          value += "'";
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      value += inner[index];
      index += 1;
    }
    values.push(value);
  }
  return values;
}

/** The tuples of the `values` block that follows `header`, up to its `;`. */
function seededRowsFrom(body: string): string[][] {
  const rows: string[][] = [];
  let index = 0;
  let depth = 0;
  let tupleStart = -1;
  let inString = false;

  while (index < body.length) {
    const char = body[index];
    if (inString) {
      if (char === "'") {
        if (body[index + 1] === "'") {
          index += 2;
          continue;
        }
        inString = false;
      }
    } else if (char === "'") {
      inString = true;
    } else if (char === "(") {
      if (depth === 0) tupleStart = index;
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        rows.push(parseTuple(body.slice(tupleStart + 1, index)));
        // A `;` right after the closing paren ends the statement.
        if (body[index + 1] === ";") break;
      }
    } else if (char === ";" && depth === 0) {
      break;
    }
    index += 1;
  }
  return rows;
}

function seededRows(header: string): string[][] {
  const blocks: string[][] = [];
  let searchFrom = 0;

  while (true) {
    const start = sql.indexOf(header, searchFrom);
    if (start === -1) break;
    blocks.push(...seededRowsFrom(sql.slice(start + header.length)));
    searchFrom = start + header.length;
  }

  if (blocks.length === 0) throw new Error(`Seed block not found: ${header}`);
  return blocks;
}

const permissionRows = seededRows(
  "insert into public.permissions (key, description, scope) values\n",
);
const accountRows = seededRows(
  "insert into public.account_role_permissions (account_role, permission_key) values\n",
);
const organizationRows = seededRows(
  "insert into public.organization_role_permissions (organization_role, permission_key) values\n",
);

function seededFor(rows: string[][], role: string): string[] {
  return rows.filter(([seededRole]) => seededRole === role).map(([, key]) => key);
}

describe("the permission mirror matches the migration", () => {
  it("parses the migration, so a broken parser cannot pass this suite vacuously", () => {
    expect(permissionRows.length).toBeGreaterThan(20);
    expect(accountRows.length).toBeGreaterThan(5);
    expect(organizationRows.length).toBeGreaterThan(20);
    expect(permissionRows.every((row) => row.length === 3)).toBe(true);
    expect(accountRows.every((row) => row.length === 2)).toBe(true);
    expect(organizationRows.every((row) => row.length === 2)).toBe(true);
  });

  it("seeds exactly the account vocabulary the mirror declares", () => {
    const seeded = permissionRows.filter(([, , scope]) => scope === "account").map(([key]) => key);
    expect(seeded.sort()).toEqual([...accountPermissions].sort());
  });

  it("seeds exactly the organization vocabulary the mirror declares", () => {
    const seeded = permissionRows
      .filter(([, , scope]) => scope === "organization")
      .map(([key]) => key);
    expect(seeded.sort()).toEqual([...organizationPermissions].sort());
  });

  it("gives every seeded permission the mirror's description", () => {
    for (const [key, description] of permissionRows) {
      expect(description).toBe(permissionDescriptions[key as Permission]);
    }
  });

  it.each(["owner", "admin", "member"] as const)(
    "maps the same account permissions to %s in both places",
    (role) => {
      expect(seededFor(accountRows, role).sort()).toEqual([...accountRolePermissions[role]].sort());
    },
  );

  it.each(["owner", "admin", "operator", "viewer"] as const)(
    "maps the same organization permissions to %s in both places",
    (role) => {
      expect(seededFor(organizationRows, role).sort()).toEqual(
        [...organizationRolePermissions[role]].sort(),
      );
    },
  );

  it("seeds no mapping for a permission that is not in the vocabulary", () => {
    const known = new Set(permissionRows.map(([key]) => key));
    for (const [, key] of [...accountRows, ...organizationRows]) {
      expect(known.has(key)).toBe(true);
    }
  });

  it("never maps an account permission onto an organization role, or the reverse", () => {
    const scopeOf = new Map(permissionRows.map(([key, , scope]) => [key, scope]));
    for (const [, key] of accountRows) expect(scopeOf.get(key)).toBe("account");
    for (const [, key] of organizationRows) expect(scopeOf.get(key)).toBe("organization");
  });
});
