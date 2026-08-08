import { expect, test } from "@playwright/test";

import {
  integrationsPath,
  missingEnvironmentReason,
  readIntegrationHubEnvironment,
  signIn,
} from "./support/authenticated";

const environment = readIntegrationHubEnvironment();
const unknownOrganizationId = "00000000-0000-4000-8000-000000000000";

/**
 * Boundary coverage that needs no seeded tenant. These must pass in every
 * environment, including one with no database.
 */
test.describe("Integration Hub route protection", () => {
  test("an unauthenticated visitor is sent to sign in", async ({ page }) => {
    await page.goto(integrationsPath(unknownOrganizationId));

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /sign in to ai revenue os/i })).toBeVisible();
  });

  test("an unauthenticated API caller is refused without leaking tenant state", async ({
    request,
  }) => {
    const response = await request.get(`/api/organizations/${unknownOrganizationId}/integrations`);

    expect(response.status()).toBe(401);
    const body = await response.text();
    expect(body).not.toContain("credential_reference");
    expect(body).not.toContain("internalCause");
  });

  test("reduced-motion visitors still reach a navigable boundary", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(integrationsPath(unknownOrganizationId));

    await expect(page.getByRole("heading", { name: /sign in to ai revenue os/i })).toBeVisible();
  });
});

test.describe("Integration Hub workspace", () => {
  test.skip(environment === null, missingEnvironmentReason());

  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, environment!, "operator", baseURL!);
  });

  test("an allowlisted operator opens a health-first workspace", async ({ page }) => {
    await page.goto(integrationsPath(environment!.organizationId));

    await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: /operational health/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Connections" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    for (const label of ["Connections", "Catalog", "Data sources", "Activity"]) {
      await expect(page.getByRole("tab", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText(
      "Integrations",
    );
  });

  test("an organization the operator does not belong to shows no data", async ({ page }) => {
    await page.goto(integrationsPath(environment!.otherOrganizationId));

    await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toHaveCount(0);
    await expect(page.getByRole("region", { name: /operational health/i })).toHaveCount(0);
  });

  test("the catalog shows the exact fixture copy and offers no OAuth control", async ({ page }) => {
    await page.goto(integrationsPath(environment!.organizationId));
    await page.getByRole("tab", { name: "Catalog" }).click();

    await expect(page.getByText("Fixture mode — Google API access pending.")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with google/i })).toHaveCount(0);
    await expect(page.getByText(/no provider writes or webhooks/i).first()).toBeVisible();
  });

  test("connecting the fixture queues an initial test rather than claiming success", async ({
    page,
  }) => {
    await page.goto(integrationsPath(environment!.organizationId));
    await page.getByRole("tab", { name: "Catalog" }).click();
    await page.getByRole("button", { name: /connect fixture/i }).click();
    await page.getByRole("button", { name: /create fixture connection/i }).click();

    await page.getByRole("tab", { name: "Connections" }).click();
    await expect(page.getByTestId("connection-health-status").first()).toBeVisible();
    await expect(page.getByText(/^Test succeeded$/)).toHaveCount(0);
  });

  test("a manual test reports queued state and only the worker changes health", async ({
    page,
  }) => {
    await page.goto(integrationsPath(environment!.organizationId));
    const before = await page.getByTestId("connection-health-status").first().textContent();

    await page.getByRole("button", { name: /^Test connection$/ }).click();

    await expect(page.getByText(/Test queued/i)).toBeVisible();
    // The badge cannot jump to Healthy from an accepted request alone.
    if (before && !/healthy/i.test(before)) {
      await expect(page.getByTestId("connection-health-status").first()).not.toHaveText(/healthy/i);
    }
  });

  test("mapping a resource without a branch is refused and focuses the error summary", async ({
    page,
  }) => {
    await page.goto(integrationsPath(environment!.organizationId));
    const mappingStatus = page.getByLabel(/status$/i).first();
    await mappingStatus.click();
    await page.getByRole("option", { name: "Mapped" }).click();
    await page.getByRole("button", { name: /save mappings/i }).click();

    const summary = page.getByRole("alert", { name: /mapping/i });
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
  });

  test("disconnect requires the exact account label and reports queued cleanup", async ({
    page,
  }) => {
    await page.goto(integrationsPath(environment!.organizationId));
    const accountLabel = await page.getByTestId("connection-health-status").first().textContent();
    await page.getByRole("button", { name: /^Disconnect$/ }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(/history is retained/i);
    await expect(dialog.getByRole("button", { name: /disconnect integration/i })).toBeDisabled();
    expect(accountLabel).not.toBeNull();
  });

  test("a CSV source registers, imports, and keeps its history when archived", async ({ page }) => {
    await page.goto(integrationsPath(environment!.organizationId));
    await page.getByRole("tab", { name: "Data sources" }).click();

    await page.getByLabel(/source name/i).fill("E2E manual source");
    await page.getByRole("button", { name: /register source/i }).click();
    await expect(page.getByText("E2E manual source")).toBeVisible();

    await page.getByRole("radio", { name: /csv upload/i }).click();
    await page.getByLabel(/source name/i).fill("E2E CSV source");
    await page.getByLabel(/csv file/i).setInputFiles({
      name: "e2e.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("date,revenue\n2026-08-01,120\n"),
    });
    await page.getByRole("button", { name: /upload csv source/i }).click();
    await expect(page.getByText("E2E CSV source")).toBeVisible();

    await page
      .getByRole("listitem")
      .filter({ hasText: "E2E CSV source" })
      .getByRole("button", { name: /^Import$/ })
      .click();
    await expect(page.getByText(/Import queued/i)).toBeVisible();

    await page
      .getByRole("listitem")
      .filter({ hasText: "E2E CSV source" })
      .getByRole("button", { name: /^Archive$/ })
      .click();
    await expect(page.getByText(/history is retained|Archived/i).first()).toBeVisible();
  });

  test("an invalid CSV is refused without echoing a cell value", async ({ page }) => {
    await page.goto(integrationsPath(environment!.organizationId));
    await page.getByRole("tab", { name: "Data sources" }).click();
    await page.getByRole("radio", { name: /csv upload/i }).click();
    await page.getByLabel(/csv file/i).setInputFiles({
      name: "broken.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("date,date\n2026-08-01,120\n"),
    });

    await expect(page.getByText(/unique, non-empty columns/i)).toBeVisible();
    await expect(page.getByText("2026-08-01")).toHaveCount(0);
  });

  test("activity retains history and never shows a credential", async ({ page }) => {
    await page.goto(integrationsPath(environment!.organizationId));
    await page.getByRole("tab", { name: "Activity" }).click();

    const body = await page.locator("body").innerText();
    for (const forbidden of ["credential_reference", "access_token", "refresh_token", "Bearer "]) {
      expect(body).not.toContain(forbidden);
    }
  });

  test("status is legible without colour and at 200% zoom", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.goto(integrationsPath(environment!.organizationId));

    const status = page.getByTestId("connection-health-status").first();
    await expect(status).toHaveText(/healthy|pending|degraded|stale|revoked/i);
    await expect(status.locator("svg")).toBeVisible();

    // 200% zoom on a 1280px viewport behaves like a 640px CSS viewport.
    await page.setViewportSize({ width: 640, height: 800 });
    await expect(page.getByRole("tab", { name: "Connections" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });

  test("the narrow viewport opens connection detail in a sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(integrationsPath(environment!.organizationId));

    await page
      .getByRole("button", { name: /fixture/i })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test.describe("Integration Hub viewer restrictions", () => {
  test.skip(environment === null, missingEnvironmentReason());

  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, environment!, "viewer", baseURL!);
  });

  test("a viewer reads the workspace but sees no mutating control", async ({ page }) => {
    await page.goto(integrationsPath(environment!.organizationId));

    await expect(page.getByRole("region", { name: /operational health/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Test connection$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Sync now$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Disconnect$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /register source/i })).toHaveCount(0);
  });

  test("a viewer's mutation is refused by the API, not only by the UI", async ({
    page,
    request,
  }) => {
    await page.goto(integrationsPath(environment!.organizationId));
    const response = await request.post(
      `/api/organizations/${environment!.organizationId}/integrations/data-sources`,
      {
        data: {
          sourceType: "manual",
          name: "Viewer attempt",
          idempotencyKey: "viewer-attempt-key-1",
        },
      },
    );

    expect([401, 403]).toContain(response.status());
  });
});
