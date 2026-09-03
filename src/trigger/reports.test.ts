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

describe("Link A and Link B error handling guarantees", () => {
  it("Link A wraps the RPC in try/catch to prevent escape of network errors", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");

    // Find the advanceReportPackageOnAdmission function
    const linkAStart = source.indexOf("export async function advanceReportPackageOnAdmission");
    const linkAEnd = source.indexOf("export async function advanceReportPackageToProjection");
    const linkABlock = source.slice(linkAStart, linkAEnd);

    // Verify it has try and catch
    expect(linkABlock).toContain("try {");
    expect(linkABlock).toContain("} catch (error) {");

    // Verify the RPC call is inside the try block
    const tryBlock = linkABlock.slice(linkABlock.indexOf("try {"), linkABlock.indexOf("} catch"));
    expect(tryBlock).toContain('supabase.rpc("advance_governed_report_package_on_admission"');

    // Verify it returns { outcome: "not_admitted" } in the catch
    const catchBlock = linkABlock.slice(linkABlock.indexOf("} catch"));
    expect(catchBlock).toContain('return { outcome: "not_admitted" }');
  });

  it("Link B wraps the RPC in try/catch to prevent escape of network errors", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");

    // Find the advanceReportPackageToProjection function
    const linkBStart = source.indexOf("export async function advanceReportPackageToProjection");
    const linkBEnd = source.indexOf("export const reportPackageProfilingTask");
    const linkBBlock = source.slice(linkBStart, linkBEnd);

    // Verify it has try and catch
    expect(linkBBlock).toContain("try {");
    expect(linkBBlock).toContain("} catch (error) {");

    // Verify the RPC call is inside the try block
    const tryBlock = linkBBlock.slice(linkBBlock.indexOf("try {"), linkBBlock.indexOf("} catch"));
    expect(tryBlock).toContain('supabase.rpc("advance_admitted_report_package_to_projection"');

    // Verify it returns { outcome: "not_ready" } in the catch
    const catchBlock = linkBBlock.slice(linkBBlock.indexOf("} catch"));
    expect(catchBlock).toContain('return { outcome: "not_ready" }');
  });

  it("Link A and Link B are exported so their error handling can be unit tested", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");

    // Verify both functions are exported
    expect(source).toContain("export async function advanceReportPackageOnAdmission");
    expect(source).toContain("export async function advanceReportPackageToProjection");
  });
});
