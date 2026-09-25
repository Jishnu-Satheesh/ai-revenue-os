import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Browser applicability is schema-only until Task 7: the client may reach the
 * Studio contracts, never Node built-ins, the network, or the worker. The
 * global `src/lib/client-module-boundary.test.ts` guards every real client
 * component; this suite guards the Studio module boundary itself, so a future
 * server-only helper cannot slip into the supported exports unnoticed.
 */

const DOMAIN_DIR = new URL(".", import.meta.url);
const MODULE_INDEX = new URL("../../modules/creative-studio/index.ts", import.meta.url);
const REPO_ROOT = join(DOMAIN_DIR.pathname, "../../..");

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

// Static import/export-from in either quote style (type-only forms are
// erased at compile time, so they cannot drag a Node built-in into the
// browser bundle and are skipped), side-effect imports, and dynamic imports.
const STATIC_FROM_PATTERN = /^[ \t]*(?:import|export)\s+(type\s+)?[^;]*?\bfrom\s+["']([^"']+)["']/gm;
const SIDE_EFFECT_PATTERN = /^[ \t]*import\s+["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function runtimeImports(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(STATIC_FROM_PATTERN)) {
    if (match[1]) continue;
    specifiers.push(match[2]!);
  }
  for (const match of source.matchAll(SIDE_EFFECT_PATTERN)) {
    specifiers.push(match[1]!);
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT_PATTERN)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

/**
 * Files reachable from the supported module index through relative or `@/`
 * imports — anywhere under `src/`, so a future `node:` import smuggled via
 * `@/lib/*` is traversed and fails this suite instead of evading it. The
 * Task 1 qualification harness under
 * `src/modules/creative-studio/infrastructure/` is deliberately NOT in this
 * set: it is a server/CLI-only adapter and must never join the supported
 * browser surface.
 */
function reachableFromIndex(): string[] {
  const candidates = (specifier: string, from: string): string[] => {
    if (specifier.startsWith("@/")) {
      const base = join(REPO_ROOT, "src", specifier.slice(2));
      return [`${base}.ts`, join(base, "index.ts")];
    }
    if (specifier.startsWith(".")) {
      const base = join(from, specifier);
      return [`${base}.ts`, join(base, "index.ts")];
    }
    return [];
  };

  const entry = join(REPO_ROOT, "src/modules/creative-studio/index.ts");
  const seen = new Set<string>([entry]);
  const stack = [entry];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const fromDir = join(current, "..");
    for (const specifier of runtimeImports(readFileSync(current, "utf8"))) {
      for (const resolved of candidates(specifier, fromDir)) {
        if (!resolved.startsWith(join(REPO_ROOT, "src/"))) {
          continue;
        }
        try {
          readFileSync(resolved, "utf8");
        } catch {
          continue;
        }
        if (!seen.has(resolved)) {
          seen.add(resolved);
          stack.push(resolved);
        }
        break;
      }
    }
  }
  return [...seen];
}

/**
 * The exact reachable set, pinned so a future import that pulls a new file
 * into the supported browser surface fails loudly here instead of slipping
 * in unnoticed. Legitimate growth updates this list deliberately.
 */
const PINNED_REACHABLE_FILES = [
  "src/domain/campaigns/canonical-json.ts",
  "src/domain/campaigns/deliverable.ts",
  "src/domain/campaigns/errors.ts",
  "src/domain/creative-studio/campaign-link.ts",
  "src/domain/creative-studio/digest.ts",
  "src/domain/creative-studio/events.ts",
  "src/domain/creative-studio/index.ts",
  "src/domain/creative-studio/policy.ts",
  "src/domain/creative-studio/provider.ts",
  "src/domain/creative-studio/schemas.ts",
  "src/modules/creative-studio/index.ts",
];

describe("studio client boundary", () => {
  it("keeps the domain contracts and the supported module surface free of node: imports", () => {
    const files = [...sourceFiles(DOMAIN_DIR.pathname), ...reachableFromIndex()];

    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["']node:/);
      expect(source, file).not.toMatch(/require\(\s*["']node:/);
      expect(source, file).not.toMatch(/import\(\s*["']node:/);
    }
  });

  it("pins the exact reachable set behind the supported module index", () => {
    const actual = reachableFromIndex()
      .map((file) => relative(REPO_ROOT, file))
      .sort();

    expect(actual).toEqual(PINNED_REACHABLE_FILES);
  });

  it("exposes the supported contracts through the module index", async () => {
    expect(MODULE_INDEX).toBeDefined();
    const studio = await import("@/modules/creative-studio");

    for (const name of [
      "studioDraftSchema",
      "studioReferenceSchema",
      "channelLogoSubstitutionSchema",
      "studioMarkerSchema",
      "studioProviderProfileSchema",
      "studioGenerationPolicySchema",
      "selectStudioCampaignCreativeSchema",
      "studioFullPosterRenderInputsSchema",
      "deliverableRenderInputsUnionSchema",
      "resolveDeliverableSource",
      "transitionRunState",
      "reserveStudioRun",
      "studioTextCopyDigest",
    ]) {
      expect(studio, name).toHaveProperty(name);
    }
  });
});
