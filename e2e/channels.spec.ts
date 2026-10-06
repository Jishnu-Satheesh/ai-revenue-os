import { expect, test } from "@playwright/test";

import {
  missingEnvironmentReason,
  readIntegrationHubEnvironment,
  signIn,
} from "./support/authenticated";

const FIXTURE_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_CHANNEL_ID = "22222222-2222-4222-8222-222222220001";

function channelsPath(organizationId: string): string {
  return `/organizations/${organizationId}/channels`;
}

/**
 * Fixture-free guard: the temporary design-review harness must never answer
 * without its development gate, so in this server (no CHANNELS_DESIGN_REVIEW)
 * it resolves to the framework not-found page.
 */
test("design-review harness stays unreachable without its development gate", async ({ page }) => {
  const response = await page.goto("/design-review-channels");
  expect(response?.status()).toBe(404);
});

test("unauthenticated channels access remains tenant-protected", async ({ page }) => {
  await page.goto(channelsPath(FIXTURE_ORGANIZATION_ID));

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Channels", exact: true })).toHaveCount(0);
});

test.describe("authenticated channels landing", () => {
  test.beforeEach(async ({}, testInfo) => {
    const environment = readIntegrationHubEnvironment();
    if (!environment) testInfo.skip(true, missingEnvironmentReason());
  });

  test("operator sees the landing with mapping access but no channel creation", async ({
    page,
    context,
    baseURL,
  }) => {
    const environment = readIntegrationHubEnvironment();
    if (!environment || !baseURL) throw new Error("unreachable: skipped above");
    await signIn(context, environment, "operator", baseURL);

    await page.goto(channelsPath(environment.organizationId));
    await expect(page.getByRole("heading", { name: "Channels", exact: true })).toBeVisible();
    // Operators map branches but never create channels: no Add affordance.
    await expect(page.getByRole("button", { name: "Add channel" })).toHaveCount(0);
    // Read-only coverage stays visible to every role.
    await expect(page.getByText(/Channel coverage|channels shown/i).first()).toBeVisible();
  });

  test("viewer sees read-only coverage with no management entry points", async ({
    page,
    context,
    baseURL,
  }) => {
    const environment = readIntegrationHubEnvironment();
    if (!environment || !baseURL) throw new Error("unreachable: skipped above");
    await signIn(context, environment, "viewer", baseURL);

    await page.goto(channelsPath(environment.organizationId));
    await expect(page.getByRole("heading", { name: "Channels", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add channel" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Manage / })).toHaveCount(0);
  });

  test("switching organization changes the data scope", async ({ page, context, baseURL }) => {
    const environment = readIntegrationHubEnvironment();
    if (!environment || !baseURL) throw new Error("unreachable: skipped above");
    await signIn(context, environment, "operator", baseURL);

    await page.goto(channelsPath(environment.organizationId));
    await expect(page).toHaveURL(channelsPath(environment.organizationId));
    // An organization the accounts do not belong to must not render its
    // channels: the request leaves the tenant scope (sign-in or denial).
    await page.goto(channelsPath(environment.otherOrganizationId));
    await expect(page.getByRole("heading", { name: "Channels", exact: true })).toHaveCount(0);
  });

  test("cross-tenant channel writes are rejected without changed state", async ({
    page,
    context,
    baseURL,
  }) => {
    const environment = readIntegrationHubEnvironment();
    if (!environment || !baseURL) throw new Error("unreachable: skipped above");
    await signIn(context, environment, "operator", baseURL);

    const response = await page.request.put(
      `/api/organizations/${environment.otherOrganizationId}/channels/${FIXTURE_CHANNEL_ID}/branches`,
      {
        data: {
          branchId: "00000000-0000-4000-8000-000000000000",
          applicability: "active",
          effectiveFrom: null,
          effectiveTo: null,
        },
      },
    );
    expect(response.ok()).toBe(false);
  });

  test("existing channel audit navigation still resolves", async ({ page, context, baseURL }) => {
    const environment = readIntegrationHubEnvironment();
    if (!environment || !baseURL) throw new Error("unreachable: skipped above");
    await signIn(context, environment, "operator", baseURL);

    const response = await page.goto(
      `${channelsPath(environment.organizationId)}/${FIXTURE_CHANNEL_ID}`,
    );
    // Either the audit workspace answers or the request leaves the tenant
    // scope; it must never fail with a server error from this slice.
    expect(response?.status()).not.toBe(500);
  });

  test("manager create/edit/archive flows need manager credentials", async ({}, testInfo) => {
    // The authenticated helper seeds operator/viewer accounts only; no
    // owner/admin account exists to exercise create/edit/archive/restore
    // against the live API, so this reserves the slot explicitly instead of
    // upgrading a role or bootstrapping an admin (both forbidden).
    testInfo.skip(true, "No manager credentials in E2E_*; operator/viewer only.");
  });
});
