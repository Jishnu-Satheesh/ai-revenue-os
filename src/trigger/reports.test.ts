import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Report Package Trigger abort on refusal", () => {
  it("imports AbortTaskRunError from the Trigger SDK", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");
    expect(source).toMatch(/import\s*{\s*AbortTaskRunError\s*,\s*logger\s*,\s*schemaTask\s*}\s*from\s*"@trigger\.dev\/sdk"/);
  });

  it("aborts exactly three report tasks without retrying when a projection is refused", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");
    // Three runs reported Completed to a live operator while their output said
    // failed. Retrying an unparseable date three times helps nobody, so the
    // refusal must fail loudly and once.
    expect(source.match(/throw new AbortTaskRunError\(/g)).toHaveLength(3);
  });

  it("places exactly one abort after the logger.info call in each task", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");

    // Scope assertions to each task's function block to prevent global ordering
    // from masking missing guards in individual tasks.

    // Profile task: from export const to next export const
    const profileStart = source.indexOf("export const reportPackageProfilingTask");
    const profileEnd = source.indexOf("export const reportPackageValidationTask");
    const profileBlock = source.slice(profileStart, profileEnd);
    const profileAbortsInBlock = profileBlock.match(/throw new AbortTaskRunError\(/g);
    const profileLogger = profileBlock.indexOf('logger.info("report_package.profile_completed"');
    const profileAbort = profileBlock.indexOf('throw new AbortTaskRunError(`report-package refused');
    expect(profileAbortsInBlock).toHaveLength(1);
    expect(profileLogger).toBeGreaterThan(0);
    expect(profileAbort).toBeGreaterThan(profileLogger);

    // Validation task: from export const to next export const
    const validationStart = source.indexOf("export const reportPackageValidationTask");
    const validationEnd = source.indexOf("export const reportPackageProjectionTask");
    const validationBlock = source.slice(validationStart, validationEnd);
    const validationAbortsInBlock = validationBlock.match(/throw new AbortTaskRunError\(/g);
    const validationLogger = validationBlock.indexOf('logger.info("report_package.validation_completed"');
    const validationAbort = validationBlock.indexOf('throw new AbortTaskRunError(`report-package refused');
    expect(validationAbortsInBlock).toHaveLength(1);
    expect(validationLogger).toBeGreaterThan(0);
    expect(validationAbort).toBeGreaterThan(validationLogger);

    // Projection task: from export const to end of file
    const projectionStart = source.indexOf("export const reportPackageProjectionTask");
    const projectionBlock = source.slice(projectionStart);
    const projectionAbortsInBlock = projectionBlock.match(/throw new AbortTaskRunError\(/g);
    const projectionLogger = projectionBlock.indexOf('logger.info("report_package.projection_completed"');
    const projectionAbort = projectionBlock.indexOf('throw new AbortTaskRunError(`report-package refused');
    expect(projectionAbortsInBlock).toHaveLength(1);
    expect(projectionLogger).toBeGreaterThan(0);
    expect(projectionAbort).toBeGreaterThan(projectionLogger);
  });
});
