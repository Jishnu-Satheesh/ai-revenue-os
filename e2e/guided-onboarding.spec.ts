import { expect, test } from "@playwright/test";

test("unauthenticated onboarding access remains protected", async ({ page }) => {
  await page.goto("/organizations/00000000-0000-0000-0000-000000000000/onboarding");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /sign in to ai revenue os/i })).toBeVisible();
});

test("reduced-motion browsers still receive a navigable sign-in boundary", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/organizations/00000000-0000-0000-0000-000000000000/onboarding");
  await expect(page.getByRole("heading", { name: /sign in to ai revenue os/i })).toBeVisible();
});
