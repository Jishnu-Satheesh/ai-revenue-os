import { expect, test } from "@playwright/test";

/**
 * The invitation route is the one page in the product a signed-out stranger is
 * meant to reach, so these run unauthenticated on purpose.
 *
 * Every one of them asserts the same property from a different angle: a link
 * that is not valid, or not yours, reveals nothing and admits nobody.
 */

const WELL_FORMED_UNKNOWN_TOKEN = "A".repeat(43);

test("an unknown invitation link is refused with a recovery, not a dead end", async ({ page }) => {
  await page.goto(`/invitations/${WELL_FORMED_UNKNOWN_TOKEN}`);

  await expect(page.getByRole("heading", { name: /no longer valid/i })).toBeVisible();
  await expect(page.getByText(/ask the person who invited you/i)).toBeVisible();
});

test("a malformed link is indistinguishable from an unknown one", async ({ page }) => {
  await page.goto("/invitations/not-a-real-token");

  await expect(page.getByRole("heading", { name: /no longer valid/i })).toBeVisible();
});

test("the invitation route is reachable without signing in", async ({ page }) => {
  // Unlike every organization route, this must not bounce to /login: being
  // signed out is the expected first state for a recipient.
  await page.goto(`/invitations/${WELL_FORMED_UNKNOWN_TOKEN}`);

  await expect(page).not.toHaveURL(/\/login/);
});

test("an invalid link names no agency and offers no way in", async ({ page }) => {
  await page.goto(`/invitations/${WELL_FORMED_UNKNOWN_TOKEN}`);

  await expect(page.getByRole("button", { name: /^join/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /email me a sign-in link/i })).toHaveCount(0);
});

test("reduced-motion browsers still reach a navigable invitation boundary", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/invitations/${WELL_FORMED_UNKNOWN_TOKEN}`);

  await expect(page.getByRole("heading", { name: /no longer valid/i })).toBeVisible();
});

test("the invitation page is legible on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/invitations/${WELL_FORMED_UNKNOWN_TOKEN}`);

  await expect(page.getByRole("heading", { name: /no longer valid/i })).toBeVisible();

  // The card must not force the page to scroll sideways on a phone.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
});

test("accepting an unknown link through the API is refused opaquely", async ({ request }) => {
  const response = await request.post(`/api/invitations/${WELL_FORMED_UNKNOWN_TOKEN}/accept`);

  expect(response.ok()).toBe(false);
  const body = await response.json();
  // Signed out, so this is an authentication refusal -- and it still says
  // nothing about whether the token exists.
  expect(JSON.stringify(body)).not.toContain("expired");
  expect(JSON.stringify(body)).not.toContain("revoked");
});

test("previewing an unknown link through the API reveals nothing", async ({ request }) => {
  const response = await request.get(`/api/invitations/${WELL_FORMED_UNKNOWN_TOKEN}`);

  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.preview.state).toBe("invalid");
  expect(body.preview.accountName).toBeNull();
  expect(body.preview.invitedEmail).toBeNull();
  expect(body.preview.inviterName).toBeNull();
});

test("creating an invitation requires a session", async ({ request }) => {
  const response = await request.post("/api/account/invitations", {
    data: { email: "stranger@example.com", accountRole: "member", defaultOrganizationRole: "viewer" },
  });

  expect(response.status()).toBe(401);
});
