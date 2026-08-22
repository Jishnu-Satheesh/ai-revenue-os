import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  resolve(process.cwd(), "src/components/integrations/report-package-upload.tsx"),
  "utf8",
);

describe("ReportPackageUpload client boundary", () => {
  it("does not import the Node-hashed reconciliation module into the browser bundle", () => {
    expect(componentSource).not.toContain('from "@/domain/reports/reconciliation"');
    expect(componentSource).toContain('from "@/domain/reports/reconciliation-copy"');
  });
});
