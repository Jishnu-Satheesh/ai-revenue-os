import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Report Package Trigger abort on refusal", () => {
  it("imports AbortTaskRunError from the Trigger SDK", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");
    expect(source).toContain('import { AbortTaskRunError');
    expect(source).toContain("} from \"@trigger.dev/sdk\"");
  });

  it("aborts exactly three report tasks without retrying when a projection is refused", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");
    // Three runs reported Completed to a live operator while their output said
    // failed. Retrying an unparseable date three times helps nobody, so the
    // refusal must fail loudly and once.
    expect(source.match(/throw new AbortTaskRunError\(/g)).toHaveLength(3);
  });

  it("places the abort after the logger.info call in each task", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");

    // For profile task: logger.info comes before abort
    const profileLogger = source.indexOf('logger.info("report_package.profile_completed"');
    const profileAbort = source.indexOf('throw new AbortTaskRunError(`report-package refused');
    expect(profileLogger).toBeGreaterThan(0);
    expect(profileAbort).toBeGreaterThan(profileLogger);

    // For validation task: logger.info comes before abort
    const validationLogger = source.indexOf('logger.info("report_package.validation_completed"');
    const validationAbort = source.indexOf('throw new AbortTaskRunError(`report-package refused', profileAbort + 1);
    expect(validationLogger).toBeGreaterThan(0);
    expect(validationAbort).toBeGreaterThan(validationLogger);

    // For projection task: logger.info comes before abort
    const projectionLogger = source.indexOf('logger.info("report_package.projection_completed"');
    const projectionAbort = source.indexOf(
      'throw new AbortTaskRunError(`report-package refused',
      validationAbort + 1,
    );
    expect(projectionLogger).toBeGreaterThan(0);
    expect(projectionAbort).toBeGreaterThan(projectionLogger);
  });
});
