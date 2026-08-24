import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * No browser bundle may reach a Node built-in.
 *
 * A `node:crypto` import inside a module a client component pulls in does not
 * degrade — it fails the build outright, and the failure names a file three or
 * four hops away from the component that caused it. This has happened twice:
 * once when the upload screen started reading a projection declaration, and
 * once when the revise screen started previewing a campaign diff. Both times
 * the Node dependency was a hashing function sitting in the same module as the
 * pure code the screen actually wanted.
 *
 * A type-only import is erased before the bundler sees it, so it is not a
 * violation and is skipped here for the same reason the compiler skips it.
 */

const SOURCE_ROOT = "src";
const NODE_BUILTINS = /^(node:|fs$|path$|crypto$|stream$|os$|child_process$|worker_threads$)/;

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    found.push(full);
  }
  return found;
}

const files = new Map(sourceFiles(SOURCE_ROOT).map((path) => [path, readFileSync(path, "utf8")]));

function resolveAlias(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  const base = join(SOURCE_ROOT, specifier.slice(2));
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

const IMPORT_PATTERN = /^[ \t]*import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm;

function runtimeImports(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    // `import type` never reaches the bundler.
    if (match[1]) continue;
    specifiers.push(match[2]);
  }
  return specifiers;
}

/** The chain from the client component to the offending import, for the failure message. */
function nodeImportChain(entry: string): string | null {
  const seen = new Set<string>();
  const parents = new Map<string, string>();
  const stack = [entry];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const specifier of runtimeImports(files.get(current) ?? "")) {
      if (NODE_BUILTINS.test(specifier)) {
        const chain = [specifier];
        for (let node: string | undefined = current; node; node = parents.get(node)) {
          chain.unshift(relative(".", node));
        }
        return chain.join(" -> ");
      }
      const resolved = resolveAlias(specifier);
      if (resolved && !seen.has(resolved)) {
        parents.set(resolved, current);
        stack.push(resolved);
      }
    }
  }
  return null;
}

describe("client module boundary", () => {
  const clientComponents = [...files.entries()]
    .filter(([, source]) => source.trimStart().startsWith('"use client"'))
    .map(([path]) => path);

  it("finds the client components to check", () => {
    expect(clientComponents.length).toBeGreaterThan(50);
  });

  it.each(clientComponents)("%s reaches no Node built-in", (entry) => {
    expect(nodeImportChain(entry)).toBeNull();
  });
});
