import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/components/ui/**",
        "src/app/**/layout.tsx",
        "src/app/**/page.tsx",
        "src/lib/supabase/database.types.ts",
        "src/**/*.d.ts",
      ],
      // Set just under the measured baseline on 2026-08-09 (statements and
      // lines 64.33, branches 75.75, functions 71.85). Ratchet upward as
      // coverage grows; never downward to accommodate a change. A drop is a
      // signal to add tests, not to lower the floor.
      thresholds: {
        statements: 64,
        lines: 64,
        branches: 75,
        functions: 71,
      },
    },
  },
});
