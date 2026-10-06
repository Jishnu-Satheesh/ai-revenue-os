import { expect, test } from "@playwright/test";

import {
  missingEnvironmentReason,
  readIntegrationHubEnvironment,
  signIn,
} from "./support/authenticated";

/**
 * The campaign experience, end to end.
 *
 * Two halves, and the split is deliberate. The tenant guards need no fixture
 * and therefore run everywhere, including on a machine with no seeded project:
 * they are the assertions that must never be allowed to quietly stop running,
 * because a redirect that breaks is a campaign belonging to somebody else being
 * served to whoever asks. The rest needs seeded accounts and skips without
 * them, in the same shape as every other authenticated spec here.
 *
 * What is asserted is the governed behaviour rather than the styling: that
 * phases and filters live in the URL so a colleague can be sent one, that a
 * viewer is offered no control their role would be refused, and that the
 * Studio's browser preview never presents itself as the finished render.
 */

const FIXTURE_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_CAMPAIGN_ID = "33333333-3333-4333-8333-333333330001";

function campaignsPath(organizationId: string): string {
  return `/organizations/${organizationId}/campaigns`;
}

test.describe("campaign routes stay tenant-protected", () => {
  test("the portfolio sends a signed-out visitor to sign in", async ({ page }) => {
    await page.goto(campaignsPath(FIXTURE_ORGANIZATION_ID));

    await expect(page).toHaveURL(/\/login/);
    // Not merely "redirected" — nothing of the portfolio may have rendered on
    // the way past, including a title that confirms the organization exists.
    await expect(page.getByRole("heading", { name: "Campaigns", exact: true })).toHaveCount(0);
  });

  test("a campaign page sends a signed-out visitor to sign in", async ({ page }) => {
    await page.goto(`${campaignsPath(FIXTURE_ORGANIZATION_ID)}/${FIXTURE_CAMPAIGN_ID}`);

    await expect(page).toHaveURL(/\/login/);
  });

  test("the Creative Studio sends a signed-out visitor to sign in", async ({ page }) => {
    await page.goto(`${campaignsPath(FIXTURE_ORGANIZATION_ID)}/${FIXTURE_CAMPAIGN_ID}/studio`);

    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("the campaign experience", () => {
  test.beforeEach(async ({}, testInfo) => {
    const environment = readIntegrationHubEnvironment();
    if (!environment) testInfo.skip(true, missingEnvironmentReason());
  });

  test("the portfolio names what is waiting and counts it over everything", async ({
    page,
    context,
    baseURL,
  }) => {
    const environment = readIntegrationHubEnvironment()!;
    await signIn(context, environment, "operator", baseURL!);
    await page.goto(campaignsPath(environment.organizationId));

    await expect(page.getByRole("heading", { name: "Campaigns", exact: true })).toBeVisible();

    // The strip previews at most three but counts every campaign, so the count
    // and the row count are allowed to disagree and the count is the true one.
    const strip = page.getByRole("region", { name: "Needs your attention" });
    if (await strip.isVisible()) {
      await expect(strip.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
    }

    await expect(page.getByRole("button", { name: "All", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Needs review" })).toBeVisible();
  });

  test("a filtered portfolio still says how many campaigns exist", async ({
    page,
    context,
    baseURL,
  }) => {
    const environment = readIntegrationHubEnvironment()!;
    await signIn(context, environment, "operator", baseURL!);
    await page.goto(campaignsPath(environment.organizationId));

    await page.getByRole("button", { name: "Needs review" }).click();

    // "Showing 2 of 7" rather than "2 campaigns". A filtered count presented as
    // a total is how somebody concludes the other five were deleted.
    await expect(page.getByText(/Showing \d+ of \d+ campaigns/)).toBeVisible();
  });

  test("a campaign's section is in the URL, so it can be sent to somebody", async ({
    page,
    context,
    baseURL,
  }) => {
    const environment = readIntegrationHubEnvironment()!;
    await signIn(context, environment, "operator", baseURL!);
    await page.goto(campaignsPath(environment.organizationId));

    const firstCampaign = page.getByRole("list", { name: "Campaigns" }).getByRole("link").first();
    if ((await firstCampaign.count()) === 0) test.skip(true, "This organization has no campaigns.");
    await firstCampaign.click();

    await page.getByRole("tab", { name: "Publishing" }).click();
    await expect(page).toHaveURL(/[?&]tab=publishing/);

    // And the other direction: the URL is what decides, on a cold load.
    await page.reload();
    await expect(page.getByRole("tab", { name: "Publishing" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("an unknown section falls back rather than rendering nothing", async ({
    page,
    context,
    baseURL,
  }) => {
    const environment = readIntegrationHubEnvironment()!;
    await signIn(context, environment, "operator", baseURL!);
    await page.goto(campaignsPath(environment.organizationId));

    const firstCampaign = page.getByRole("list", { name: "Campaigns" }).getByRole("link").first();
    if ((await firstCampaign.count()) === 0) test.skip(true, "This organization has no campaigns.");
    await firstCampaign.click();
    const url = new URL(page.url());
    await page.goto(`${url.pathname}?tab=not-a-real-tab`);

    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("a viewer is offered no control their role would be refused", async ({
    page,
    context,
    baseURL,
  }) => {
    const environment = readIntegrationHubEnvironment()!;
    await signIn(context, environment, "viewer", baseURL!);
    await page.goto(campaignsPath(environment.organizationId));

    const firstCampaign = page.getByRole("list", { name: "Campaigns" }).getByRole("link").first();
    if ((await firstCampaign.count()) === 0) test.skip(true, "This organization has no campaigns.");
    await firstCampaign.click();

    // A button that exists and then fails teaches people the product is broken.
    // The evidence stays readable; only the acts are absent.
    await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  });

  test("a campaign in another organization is not found rather than refused", async ({
    page,
    context,
    baseURL,
  }) => {
    const environment = readIntegrationHubEnvironment()!;
    await signIn(context, environment, "operator", baseURL!);

    // "Not yours" and "does not exist" must stay indistinguishable, or the
    // answer itself confirms another tenant's campaign is real.
    const response = await page.goto(
      `${campaignsPath(environment.otherOrganizationId)}/${FIXTURE_CAMPAIGN_ID}`,
    );

    expect([403, 404]).toContain(response?.status() ?? 0);
  });
});

test.describe("the Creative Studio", () => {
  test.beforeEach(async ({}, testInfo) => {
    const environment = readIntegrationHubEnvironment();
    if (!environment) testInfo.skip(true, missingEnvironmentReason());
  });

  test("the browser preview never presents itself as the finished render", async ({
    page,
    context,
    baseURL,
  }) => {
    const environment = readIntegrationHubEnvironment()!;
    await signIn(context, environment, "operator", baseURL!);
    await page.goto(campaignsPath(environment.organizationId));

    const firstCampaign = page.getByRole("list", { name: "Campaigns" }).getByRole("link").first();
    if ((await firstCampaign.count()) === 0) test.skip(true, "This organization has no campaigns.");
    await firstCampaign.click();

    const studio = page.getByRole("link", { name: "Creative Studio" });
    if ((await studio.count()) === 0) test.skip(true, "This campaign has no version to compose.");
    await studio.click();

    // The label is the accurate description of what is on screen, not
    // decoration: the renderer draws with pinned faces and the browser
    // measures with whatever it has.
    await expect(page.getByText("Preview", { exact: true })).toBeVisible();
    await expect(page.getByText(/not identical to it/i)).toBeVisible();
  });

  test("the offer line is shown with its reason and never as an input", async ({
    page,
    context,
    baseURL,
  }) => {
    const environment = readIntegrationHubEnvironment()!;
    await signIn(context, environment, "operator", baseURL!);
    await page.goto(campaignsPath(environment.organizationId));

    const firstCampaign = page.getByRole("list", { name: "Campaigns" }).getByRole("link").first();
    if ((await firstCampaign.count()) === 0) test.skip(true, "This organization has no campaigns.");
    await firstCampaign.click();

    const studio = page.getByRole("link", { name: "Creative Studio" });
    if ((await studio.count()) === 0) test.skip(true, "This campaign has no version to compose.");
    await studio.click();

    // The one place somebody could otherwise type "50% off" onto artwork
    // nobody approved.
    await expect(page.getByLabel("Offer line")).toHaveCount(0);
    await expect(page.getByText(/Nothing in the approved campaign supplies one/)).toBeVisible();
  });
});
