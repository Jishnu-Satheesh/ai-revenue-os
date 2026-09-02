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

  it("shows a failed projection's own reason, not only its category", () => {
    // A code alone leaves an operator with nothing to act on and nothing to
    // report. The run records what the failure knew about itself; this is the
    // only place it reaches the person who uploaded the file.
    expect(componentSource).toContain("latestProjection.failure_detail");
    expect(componentSource).toContain("Why it stopped");
  });
});
