import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

/**
 * Architecture rules are only worth having if they fire. A misconfigured lint
 * rule fails open — it reports nothing and reads as protection — which is how
 * this configuration was originally broken. Each case below lints a synthetic
 * file through the real config and asserts the violation is caught.
 */
const eslint = new ESLint({ cwd: process.cwd() });

async function lint(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath, warnIgnored: false });
  return (result?.messages ?? []).map((message) => `${message.ruleId}: ${message.message}`);
}

const RESTRICTED = /no-restricted-imports/;

describe("architecture boundaries", () => {
  it("stops the domain importing a module", async () => {
    const messages = await lint(
      "src/domain/memory/probe.ts",
      `import { thing } from "@/modules/memory/infrastructure/worker-repository";\nexport const probe = thing;\n`,
    );
    expect(messages.some((message) => RESTRICTED.test(message))).toBe(true);
  });

  it("stops application code importing an adapter at runtime", async () => {
    const messages = await lint(
      "src/modules/memory/application/probe.ts",
      `import { thing } from "@/modules/memory/infrastructure/repository";\nexport const probe = thing;\n`,
    );
    expect(messages.some((message) => RESTRICTED.test(message))).toBe(true);
  });

  it("allows application code to import a port type", async () => {
    const messages = await lint(
      "src/modules/memory/application/probe.ts",
      `import type { Thing } from "@/modules/memory/infrastructure/repository";\nexport type Probe = Thing;\n`,
    );
    expect(messages.some((message) => RESTRICTED.test(message))).toBe(false);
  });

  it("stops a workflow runner constructing an adapter", async () => {
    const messages = await lint(
      "src/workflows/memory/probe.ts",
      `import { thing } from "@/modules/memory/infrastructure/worker-repository";\nexport const probe = thing;\n`,
    );
    expect(messages.some((message) => RESTRICTED.test(message))).toBe(true);
  });

  it("stops a component reaching the service-role client, even as a type", async () => {
    const runtime = await lint(
      "src/components/organizations/probe.tsx",
      `import { createClient } from "@/lib/supabase/service";\nexport const probe = createClient;\n`,
    );
    const typeOnly = await lint(
      "src/components/organizations/probe.tsx",
      `import type { Client } from "@/lib/supabase/service";\nexport type Probe = Client;\n`,
    );
    expect(runtime.some((message) => RESTRICTED.test(message))).toBe(true);
    expect(typeOnly.some((message) => RESTRICTED.test(message))).toBe(true);
  });

  it("stops a component importing infrastructure at runtime", async () => {
    const messages = await lint(
      "src/components/organizations/probe.tsx",
      `import { repo } from "@/modules/organizations/infrastructure/repository";\nexport const probe = repo;\n`,
    );
    expect(messages.some((message) => RESTRICTED.test(message))).toBe(true);
  });

  it("permits the module composition root to construct adapters", async () => {
    const messages = await lint(
      "src/modules/memory/application/api.ts",
      `import { createMemoryRepository } from "@/modules/memory/infrastructure/repository";\nexport const probe = createMemoryRepository;\n`,
    );
    expect(messages.some((message) => RESTRICTED.test(message))).toBe(false);
  });

  it("permits an allowed dependency direction", async () => {
    const messages = await lint(
      "src/modules/memory/application/probe.ts",
      `import type { MemoryItem } from "@/domain/memory/types";\nexport type Probe = MemoryItem;\n`,
    );
    expect(messages.some((message) => RESTRICTED.test(message))).toBe(false);
  });
});
