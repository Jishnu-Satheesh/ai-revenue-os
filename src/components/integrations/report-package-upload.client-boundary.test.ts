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
    expect(componentSource).not.toContain('from "@/domain/reports/reconciliation-copy"');
  });

  it("names failed projection actions as retries and recognises a failed run", () => {
    expect(componentSource).toContain('latestProjection?.status === "failed"');
    expect(componentSource).toContain('reportPackage.status === "projection_failed"');
    expect(componentSource).toContain('"Retry projection"');
  });
});
