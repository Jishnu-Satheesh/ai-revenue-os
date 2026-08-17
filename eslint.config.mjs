import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Layer boundaries encode the architecture in `context/03-architecture.md` and
 * ADR 0002 so a violation fails the build instead of relying on a reviewer
 * noticing it. The permitted dependency direction is:
 *
 *   app / components  ->  modules (application)  ->  domain
 *   trigger  ->  workflows  ->  modules  ->  domain
 *
 * `domain` is pure. Infrastructure is reachable only from the execution plane,
 * from route handlers, and from module code — never from a React component.
 *
 * These are expressed as import restrictions rather than through
 * eslint-plugin-boundaries: that plugin could not resolve the `@/` alias under
 * this flat config and classified every aliased import as unknown, which
 * silently disabled every rule. A rule that enforces nothing is worse than no
 * rule, because it reads as protection. Each restriction below is verified by
 * `eslint.boundaries.test.ts`.
 */
const UI = "**/components/**";
const APP = "@/app/*";
const TRIGGER = "@/trigger/*";
const INFRASTRUCTURE = "@/modules/*/infrastructure/*";
const SERVICE_CLIENT = "@/lib/supabase/service";

const restrict = (patterns) => ["error", { patterns }];

const config = [
  // Generated bundles, coverage output, and sibling worktrees are not source
  // for this checkout. Linting them reports vendored errors and can multiply
  // one repository scan into several full scans.
  {
    ignores: [".trigger/**", ".worktrees/**", "coverage/**", "test-results/**"],
  },
  ...nextVitals,
  ...nextTypescript,

  // The domain models the business. It must not reach a database, a network,
  // a workflow runtime, or React.
  {
    files: ["src/domain/**/*.ts"],
    ignores: [
      "src/domain/**/*.test.ts",
      // Known violation, exempted rather than hidden. This file is a one-line
      // `export * from "@/modules/organizations/infrastructure/repository"`,
      // which inverts the dependency direction: the domain re-exports an
      // adapter. Roughly a dozen files under `src/app` import through it, so
      // removing it is a mechanical refactor (repoint those imports at the
      // module, then delete this file) rather than a config change. Delete this
      // exemption with the shim.
      "src/domain/organizations/repository.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": restrict([
        {
          group: ["@/modules/*", "@/modules/**", "@/workflows/**", TRIGGER, APP, UI, "@/hooks/**"],
          message:
            "The domain layer is pure. Move the dependency behind a port, or move this code into a module.",
        },
      ]),
    },
  },

  // Application services orchestrate the domain behind ports. A concrete
  // adapter is injected by the composition root, never imported here.
  {
    files: ["src/modules/*/application/**/*.ts"],
    ignores: [
      "src/modules/*/application/**/*.test.ts",
      // `api.ts` and `api-schemas.ts` are each module's composition root: they
      // are `server-only`, construct the adapters, and inject them into the
      // service. Wiring has to happen somewhere, and naming that place is what
      // keeps every other file in the layer free of adapters.
      "src/modules/*/application/api.ts",
      "src/modules/*/application/api-schemas.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": restrict([
        {
          group: [INFRASTRUCTURE, APP, UI, TRIGGER],
          allowTypeImports: true,
          message:
            "Application code depends on ports, not adapters. Inject the implementation from the composition root.",
        },
      ]),
    },
  },

  // Workflow runners are plain functions over injected dependencies, which is
  // what keeps them testable without the Trigger.dev runtime.
  {
    files: ["src/workflows/**/*.ts"],
    ignores: ["src/workflows/**/*.test.ts"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": restrict([
        {
          group: [INFRASTRUCTURE, APP, UI, TRIGGER],
          allowTypeImports: true,
          message:
            "A workflow runner receives its dependencies. Only Trigger task registration may construct adapters.",
        },
      ]),
    },
  },

  // UI never reaches infrastructure or the service-role client. It renders
  // domain types and calls its own API routes.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}"],
    ignores: ["src/components/**/*.test.tsx", "src/hooks/**/*.test.ts"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": restrict([
        {
          // No type-import exemption. The service-role client bypasses RLS and
          // must not be referenced from UI in any form.
          group: [SERVICE_CLIENT, "**/lib/supabase/service"],
          message:
            "The service-role client bypasses RLS and is server-and-worker only. Call an API route instead.",
        },
        {
          // Type-only imports are permitted for now: some components still read
          // row types that belong in `src/domain`. Moving them is a follow-up;
          // runtime coupling is blocked today.
          group: [INFRASTRUCTURE, "**/modules/*/infrastructure/*", "@/workflows/**", TRIGGER],
          allowTypeImports: true,
          message:
            "UI must not import infrastructure or workflows. Render domain types and call the module's API route.",
        },
      ]),
    },
  },
];

export default config;
