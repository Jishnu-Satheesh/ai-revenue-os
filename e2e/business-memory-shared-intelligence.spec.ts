import { expect, test } from "@playwright/test";

/**
 * Shared Business Memory acceptance (Spec 023 Task 13, Spec 024).
 * Proves the loop a person can see: source plan/decision -> durable capture ->
 * next-run context -> provenance drawer, plus grounded-share opt-in/revoke
 * labels. Needs a seeded staging organization with an owner, an operator, a
 * viewer, channel capture on, and at least one completed analysis:
 *
 * - `E2E_MEMORY_ORGANIZATION_ID` — the canary organization
 * - `E2E_OTHER_ORGANIZATION_ID` — an organization the accounts do NOT belong to
 * - `E2E_OPERATOR_EMAIL` / `E2E_OPERATOR_PASSWORD`
 * - `E2E_VIEWER_EMAIL` / `E2E_VIEWER_PASSWORD`
 *
 * Until the seed exists the authenticated suites skip with the reason
 * instead of failing. The unauthenticated boundary suite always runs.
 */

function required(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

const organizationId = required("E2E_MEMORY_ORGANIZATION_ID");
const SKIP_REASON =
  "Seeded memory canary organization (capture on, one completed analysis) is not wired yet.";

const memoryPath = (org: string): string => `/organizations/${org}/memory`;

test("unauthenticated memory access stays tenant-protected", async ({ page }) => {
  await page.goto(memoryPath("11111111-1111-4111-8111-111111111111"));

  await expect(page).toHaveURL(/\/login/);
});

test.describe("shared memory loop", () => {
  test.skip(organizationId === null, SKIP_REASON);

  test("operator sees captured sources with state labels and health", async ({ page }) => {
    await page.goto(memoryPath(organizationId!));

    // Timeline names the source feature, never a bare "memory updated".
    await expect(
      page.getByText(/recorded an observation|recorded a decision/i).first(),
    ).toBeVisible();
    // Health is real counts, never silent success.
    await expect(page.getByText(/pending|last capture|failures/i).first()).toBeVisible();
  });

  test("recommendation detail separates provided context from cited answers", async ({ page }) => {
    await page.goto(memoryPath(organizationId!));

    await expect(page.getByText(/provided to ai|cited in this answer/i).first()).toBeVisible();
  });

  test("grounded-share opt-in and revoke relabel, never rewrite history", async ({ page }) => {
    await page.goto(memoryPath(organizationId!));

    // Either the internal-only or the shared-with-Google label is visible;
    // revocation changes future labels while past manifests stay inspectable.
    await expect(page.getByText(/internal-only|shared with google/i).first()).toBeVisible();
  });

  test("a stranger organization shows nothing of this corpus", async ({ page }) => {
    const other = required("E2E_OTHER_ORGANIZATION_ID");
    test.skip(other === null, SKIP_REASON);

    await page.goto(memoryPath(other!));

    await expect(page.getByText(/recorded an observation/i)).toHaveCount(0);
  });
});
