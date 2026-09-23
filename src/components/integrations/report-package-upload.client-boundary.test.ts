import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Slice 1 moved the §1 package detail into the drawer file, so the source
// strings below live across both files. The expectations are unchanged; only
// the scanned set widened.
const componentSource = [
  "src/components/integrations/report-package-upload.tsx",
  "src/components/integrations/report-package-drawer.tsx",
]
  .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
  .join("\n");

describe("ReportPackageUpload client boundary", () => {
  it("does not import the Node-hashed reconciliation module into the browser bundle", () => {
    expect(componentSource).not.toContain('from "@/domain/reports/reconciliation"');
    expect(componentSource).not.toContain('from "@/domain/reports/reconciliation-copy"');
  });

  it("names failed projection actions as retries and recognises a failed run", () => {
    expect(componentSource).toContain('latestProjection?.status === "failed"');
    // Optional chaining: the drawer derives above its early return so the
    // hook count never changes between open and closed renders.
    expect(componentSource).toContain('reportPackage?.status === "projection_failed"');
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
