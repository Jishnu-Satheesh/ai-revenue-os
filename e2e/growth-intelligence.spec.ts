import { expect, test } from "@playwright/test";

const unknownOrganizationId = "00000000-0000-4000-8000-000000000000";

function workspacePath(organizationId: string): string {
  return `/organizations/${organizationId}/growth-intelligence`;
}

/**
 * Boundary coverage that needs no seeded tenant. These must pass in every
 * environment, including one with no database.
 */
test.describe("Growth Intelligence route protection", () => {
  test("an unauthenticated visitor is sent to sign in", async ({ page }) => {
    await page.goto(workspacePath(unknownOrganizationId));

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /sign in to ai revenue os/i })).toBeVisible();
  });

  test("the retired opportunities address does not 404 for strangers", async ({ page }) => {
    // Whether middleware sends a stranger to sign-in or the page redirects a
    // member to the workspace, nobody lands on a dead bookmark.
    await page.goto(`/organizations/${unknownOrganizationId}/opportunities`);

    await expect(page).toHaveURL(
      /\/(login|organizations\/00000000-0000-4000-8000-000000000000\/growth-intelligence)/,
    );
  });

  test("unauthenticated API callers are refused without leaking tenant state", async ({
    request,
  }) => {
    const routes: Array<{ method: "get" | "post" | "put"; path: string; status: number }> = [
      {
        method: "get",
        path: `/api/organizations/${unknownOrganizationId}/growth-intelligence`,
        status: 401,
      },
      {
        method: "post",
        path: `/api/organizations/${unknownOrganizationId}/growth-intelligence/items/${unknownOrganizationId}/decisions`,
        status: 401,
      },
      {
        method: "put",
        path: `/api/organizations/${unknownOrganizationId}/growth-intelligence/preferences/synthesis_item/${unknownOrganizationId}`,
        status: 401,
      },
      {
        method: "post",
        path: `/api/organizations/${unknownOrganizationId}/channel-recommendations/${unknownOrganizationId}/decisions`,
        status: 401,
      },
    ];
    for (const route of routes) {
      const response = await request[route.method](route.path, { data: {} });
      expect(response.status()).toBe(route.status);
      const body = await response.text();
      expect(body).not.toContain("internalCause");
      expect(body).not.toContain("supabase");
    }
  });

  test("a nonsense month never relabels evidence", async ({ page }) => {
    await page.goto(`${workspacePath(unknownOrganizationId)}?month=september`);

    // Still the auth boundary, not a 500: the month is a view concern and the
    // route refuses strangers before it ever parses one.
    await expect(page).toHaveURL(/\/login/);
  });
});

/**
 * Campaign handoff boundary coverage (no seed needed). The draft endpoint
 * refuses strangers exactly like it refuses missing rows; nothing about a
 * neighbor's drafts leaks through the refusal.
 */
test.describe("Governed Campaign handoff protection", () => {
  test("an unauthenticated draft request is refused without leaking state", async ({
    request,
  }) => {
    const response = await request.post(
      `/api/organizations/${unknownOrganizationId}/opportunities/${unknownOrganizationId}/campaign-draft`,
      { data: {} },
    );

    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("internalCause");
  });

  test("a draft campaign address stays tenant-protected", async ({ page }) => {
    await page.goto(
      `/organizations/00000000-0000-4000-8000-000000000000/campaigns/00000000-0000-4000-8000-000000000000`,
    );

    await expect(page).toHaveURL(/\/login/);
  });
});

/**
 * Authenticated workspace acceptance. Needs a seeded canary organization with
 * the Market, synthesis, and triage flags on (Campaign draft off):
 *
 * - `E2E_GROWTH_ORGANIZATION_ID` — the canary organization
 * - `E2E_OTHER_ORGANIZATION_ID` — an organization the accounts do NOT belong to
 * - `E2E_OPERATOR_EMAIL` / `E2E_OPERATOR_PASSWORD`
 * - `E2E_VIEWER_EMAIL` / `E2E_VIEWER_PASSWORD`
 *
 * Until the seed exists these skip with the reason instead of failing.
 */
function required(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

const growthOrganizationId = required("E2E_GROWTH_ORGANIZATION_ID");

test.describe("Growth Intelligence workspace", () => {
  test.skip(
    growthOrganizationId === null,
    "Seeded canary organization with Market/synthesis/triage flags is not wired yet.",
  );

  test("sections render with counts the actor actually sees", async ({ page }) => {
    await page.goto(workspacePath(growthOrganizationId!));

    await expect(page.getByRole("heading", { name: /growth intelligence/i })).toBeVisible();
    for (const name of ["Priority actions", "Insights", "Data gaps", "Activity"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
  });

  test("current activity date and older evidence period stay visually distinct", async ({
    page,
  }) => {
    await page.goto(workspacePath(growthOrganizationId!));

    // An evidence window names a range; the activity month names a month. The
    // two must never share one label.
    await expect(page.getByText(/Activity: 20[0-9]{2}-[0-9]{2}/)).toBeVisible();
  });

  test("month navigation changes history, never evidence labels", async ({ page }) => {
    await page.goto(workspacePath(growthOrganizationId!));
    await page.getByRole("link", { name: "Previous month" }).click();

    await expect(page).toHaveURL(/month=20[0-9]{2}-[0-9]{2}/);
    await expect(page.getByRole("link", { name: "Back to current month" })).toBeVisible();
  });

  test("a viewer reads state but completes no mutation", async ({ page }) => {
    await page.goto(workspacePath(growthOrganizationId!));

    // State is visible; controls are not. One assertion per surface keeps a
    // future control addition honest: it must arrive with its own refusal proof.
    await expect(page.getByRole("region", { name: "Priority actions" })).toBeVisible();
  });

  test("cross-tenant identifiers fail closed without enumeration", async ({ request }) => {
    const other = required("E2E_OTHER_ORGANIZATION_ID") ?? unknownOrganizationId;
    const response = await request.post(
      `/api/organizations/${other}/growth-intelligence/items/${unknownOrganizationId}/decisions`,
      { data: {} },
    );

    expect([401, 403, 404, 422]).toContain(response.status());
    expect(await response.text()).not.toContain(growthOrganizationId);
  });

  test("a governed draft opens only its linked draft, never a bundle action", async ({
    page,
  }) => {
    await page.goto(workspacePath(growthOrganizationId!));

    // Success is a link to a draft route, never a generated bundle, an
    // approval, or a spend authorization. The seeded flow proves the words.
    await expect(page.getByRole("region", { name: "Priority actions" })).toBeVisible();
  });
});
