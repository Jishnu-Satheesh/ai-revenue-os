import { test, expect } from "@playwright/test";

test("unauthenticated users are directed to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /sign in to ai revenue os/i })).toBeVisible();
});

test("unauthenticated organization overview access remains tenant-protected", async ({ page }) => {
  await page.goto("/organizations/00000000-0000-4000-8000-000000000000/overview");

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /sign in to ai revenue os/i })).toBeVisible();
  await expect(page.getByText("Intelligence cockpit")).toHaveCount(0);
});
