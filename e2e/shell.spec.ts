import { test, expect } from "@playwright/test";

test("unauthenticated users are directed to sign in", async ({ page }) => {
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /sign in to ai revenue os/i })).toBeVisible();
});
