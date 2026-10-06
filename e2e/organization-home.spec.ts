import { expect, test } from "@playwright/test";

import {
  missingEnvironmentReason,
  readIntegrationHubEnvironment,
  signIn,
} from "./support/authenticated";

const unknownOrganizationId = "00000000-0000-4000-8000-000000000000";
const unknownCampaignId = "00000000-0000-4000-8000-000000000001";

function overviewPath(organizationId: string): string {
  return `/organizations/${organizationId}/overview`;
}

/** Markers that must never leak through a refusal body. */
const FORBIDDEN_REFUSAL_MARKERS = [
  "signedUrl",
  "signed_url",
  "storage_path",
  "credential_reference",
  "internalCause",
  "supabase",
];

/**
 * Boundary coverage that needs no seeded tenant. These must pass in every
 * environment, including one with no database.
 */
test.describe("Organization home route protection", () => {
  test("an unauthenticated visitor is sent to sign in", async ({ page }) => {
    await page.goto(overviewPath(unknownOrganizationId));

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /sign in to ai revenue os/i })).toBeVisible();
  });

  test("unauthenticated API callers are refused without leaking artwork state", async ({
    request,
  }) => {
    const routes: Array<{ method: "get" | "post"; path: string }> = [
      { method: "get", path: `/api/organizations/${unknownOrganizationId}/campaigns` },
      {
        method: "get",
        path: `/api/organizations/${unknownOrganizationId}/campaigns/${unknownCampaignId}`,
      },
      { method: "get", path: `/api/organizations/${unknownOrganizationId}/assets` },
    ];
    for (const route of routes) {
      const response = await request[route.method](route.path, { data: {} });
      expect(response.status()).toBe(401);
      const body = await response.text();
      for (const marker of FORBIDDEN_REFUSAL_MARKERS) {
        expect(body).not.toContain(marker);
      }
    }
  });

  test("reduced-motion visitors still reach a navigable boundary", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(overviewPath(unknownOrganizationId));

    await expect(page.getByRole("heading", { name: /sign in to ai revenue os/i })).toBeVisible();
  });
});

/**
 * Authenticated home acceptance. Reuses the Integration Hub E2E fixture
 * names (no home-specific seed exists and none is created here):
 *
 * - `E2E_INTEGRATION_ORGANIZATION_ID` — an organization the accounts belong to
 * - `E2E_OTHER_ORGANIZATION_ID` — an organization the accounts do NOT belong to
 * - `E2E_OPERATOR_EMAIL` / `E2E_OPERATOR_PASSWORD`
 * - `E2E_VIEWER_EMAIL` / `E2E_VIEWER_PASSWORD`
 * - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
 *
 * Until those exist these skip with the reason instead of failing. Nothing
 * here creates campaigns, uploads artwork, or seeds records: a staging
 * project without qualifying artwork must show the truthful empty state, and
 * these tests assert exactly that instead of manufacturing fixtures.
 */
const environment = readIntegrationHubEnvironment();

test.describe("Organization home operator experience", () => {
  test.skip(environment === null, missingEnvironmentReason());

  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, environment!, "operator", baseURL!);
  });

  test("identity renders the saved name with its context row", async ({ page }) => {
    await page.goto(overviewPath(environment!.organizationId));

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    expect(((await heading.textContent()) ?? "").trim().length).toBeGreaterThan(0);
    await expect(page.locator('[aria-label="Organization context"]')).toBeVisible();
  });

  test("campaigns sit in exactly one truthful state with org-scoped links", async ({ page }) => {
    await page.goto(overviewPath(environment!.organizationId));
    const organizationId = environment!.organizationId;

    const section = page.locator("#home-campaigns");
    if ((await section.count()) === 0) {
      // Campaigns gate off for this organization: the section renders nothing,
      // and no campaign identifier may appear anywhere on the page.
      const body = await page.locator("body").innerText();
      expect(body).not.toContain("Campaign image");
      return;
    }

    const failed = page.getByText("Campaigns could not be loaded");
    if ((await failed.count()) > 0) {
      await expect(page.getByRole("button", { name: /^Retry$/ }).first()).toBeVisible();
      return;
    }

    if ((await page.getByText("No campaigns yet").count()) > 0) {
      await expect(page.getByRole("link", { name: "All campaigns", exact: true })).toHaveAttribute(
        "href",
        `/organizations/${organizationId}/campaigns`,
      );
      return;
    }

    // Ready: every campaign link stays inside this organization, and every
    // call to action uses the composed wording verbatim.
    const links = section.getByRole("link");
    expect(await links.count()).toBeGreaterThan(0);
    const allowedLabels = [
      "Review campaign",
      "Continue draft",
      "View campaign",
      "View in Campaigns",
    ];
    for (const link of await links.all()) {
      const href = (await link.getAttribute("href")) ?? "";
      expect(href.startsWith(`/organizations/${organizationId}/`)).toBe(true);
      const name = ((await link.textContent()) ?? "").trim();
      if (name !== "All campaigns") {
        expect(allowedLabels).toContain(name);
      }
      const version = new URL(href, "http://localhost").searchParams.get("version");
      if (href.includes("?version=")) {
        // Exact-version poster sources pin a real bundle version, never blank.
        expect((version ?? "").trim().length).toBeGreaterThan(0);
      }
      if (name === "View in Campaigns") {
        // A record without an openable version links to the portfolio, never
        // to a detail page that cannot load.
        expect(href).toBe(`/organizations/${organizationId}/campaigns`);
      }
    }
    // State, objective, and the absolute update date read without hovering.
    await expect(section.locator("time[datetime]").first()).toBeVisible();
  });

  test("blocked artwork falls back locally without losing labels or sources", async ({ page }) => {
    await page.goto(overviewPath(environment!.organizationId));

    const frames = page.locator("#home-campaigns img, #home-library img, header img");
    if ((await frames.count()) === 0) {
      // Truthful empty/metadata state: no artwork staged, so there is
      // nothing to fall back — the home still reads honestly.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("region", { name: "For your attention" })).toBeVisible();
      return;
    }

    await page.route("**/*", (route) =>
      route.request().resourceType() === "image" ? route.abort() : route.continue(),
    );
    await page.reload();

    await expect(page.getByText("Preview unavailable").first()).toBeVisible();
    // Labels and source links survive the image-only failure.
    await expect(
      page.getByRole("link", { name: /All campaigns|Asset Library/ }).first(),
    ).toBeVisible();
  });

  test("the gallery shows at most four items and its dialog opens and closes", async ({ page }) => {
    await page.goto(overviewPath(environment!.organizationId));

    const thumbnails = page.locator('#home-library button[aria-haspopup="dialog"]');
    const count = await thumbnails.count();
    expect(count).toBeLessThanOrEqual(4);

    if (count === 0) {
      // Truthful empty/failed/disabled state, never a seeded tile.
      const section = page.locator("#home-library");
      if ((await section.count()) === 0) return;
      await expect(
        page.getByText(
          "No saved work yet|Recent work could not be loaded|Some recent work could not be loaded",
        ),
      ).toBeVisible();
      return;
    }

    const first = thumbnails.first();
    await first.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const source = dialog.getByRole("link", { name: /Open source/ });
    await expect(source).toHaveAttribute(
      "href",
      new RegExp(`^/organizations/${environment!.organizationId}/`),
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(first).toBeFocused();
  });

  test("goals and locations dialogs read saved state without inventing any", async ({ page }) => {
    await page.goto(overviewPath(environment!.organizationId));

    const contextRow = page.locator('[aria-label="Organization context"]');
    if ((await contextRow.getByRole("button", { name: /locations?$/ }).count()) > 0) {
      await contextRow.getByRole("button", { name: /locations?$/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Locations" })).toBeVisible();
      await expect(dialog.getByText("Saved locations for this organization.")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    } else {
      await expect(
        contextRow.getByText(/Branchless organization|No locations on file/),
      ).toBeVisible();
    }

    if ((await page.getByRole("button", { name: /View goals|view all goals/ }).count()) > 0) {
      await page
        .getByRole("button", { name: /View goals|view all goals/ })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByText("Every saved goal with the scope it was set for."),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    } else {
      await expect(
        page.getByText(/What are you working towards\?|No goals on file yet\.|Plus [0-9]+ more/),
      ).toBeVisible();
    }
    // No progress bars, percentages, or timelines anywhere on this surface.
    expect(await page.locator("#home-goals").innerText()).not.toMatch(/%/);
    await expect(page.locator("#home-goals [role='progressbar']")).toHaveCount(0);
  });

  test("destination gates link inside the organization and leave no placeholders", async ({
    page,
  }) => {
    await page.goto(overviewPath(environment!.organizationId));

    const section = page.locator("#home-destinations");
    if ((await section.count()) === 0) return; // Fully gated viewer/rollout: silent, no cells.

    const links = section.getByRole("link");
    expect(await links.count()).toBeGreaterThan(0);
    const allowed = new Map([
      ["Channels", "See channel performance and explore your reports."],
      ["Growth Intelligence", "Explore findings, recommendations and your actions."],
      ["Business Memory", "Keep your business knowledge and decisions together."],
      ["Integration Hub", "Manage sources and bring in your latest reports."],
    ]);
    for (const link of await links.all()) {
      const href = (await link.getAttribute("href")) ?? "";
      expect(href.startsWith(`/organizations/${environment!.organizationId}/`)).toBe(true);
      const text = await link.innerText();
      const label = [...allowed.keys()].find((candidate) => text.includes(candidate));
      expect(label).toBeDefined();
      await expect(link).toContainText(allowed.get(label!)!);
    }
  });

  test("activity lists at most five rows with labels, never raw payloads", async ({ page }) => {
    await page.goto(overviewPath(environment!.organizationId));

    const section = page.getByRole("region", { name: "Recent activity" });
    await expect(section).toBeVisible();
    expect(await section.locator("li").count()).toBeLessThanOrEqual(5);
    const text = await section.innerText();
    expect(text).not.toContain("published");
    expect(text).not.toContain("payload");
    for (const marker of ["actor_id", "storage_path"]) {
      expect(text).not.toContain(marker);
    }
  });

  test("attention captions its count and never mixes partial with all-clear", async ({ page }) => {
    await page.goto(overviewPath(environment!.organizationId));

    const section = page.getByRole("region", { name: "For your attention" });
    await expect(section).toBeVisible();
    const rows = await section.locator("li").count();
    expect(rows).toBeLessThanOrEqual(3);
    if (rows > 0) {
      await expect(section.getByText(`${rows} shown`)).toBeVisible();
    }
    const partial = "Not everything could be checked just now";
    const clear = "Nothing in the recent work shown needs attention.";
    if ((await section.getByText(partial).count()) > 0) {
      await expect(section.getByText(clear)).toHaveCount(0);
    }
  });

  test("an operator reaches management and the creation route; a viewer would not", async ({
    page,
  }) => {
    await page.goto(overviewPath(environment!.organizationId));

    const manage = page.getByRole("link", { name: "Manage organization", exact: true });
    await expect(manage).toHaveAttribute("href", "#organization-management");
    await expect(page.getByRole("link", { name: "New campaign", exact: true })).toHaveAttribute(
      "href",
      `/organizations/${environment!.organizationId}/campaigns/new`,
    );

    await manage.click();
    await expect(page.locator("#organization-management")).toBeVisible();
  });

  test("the home holds its layout across seven widths with the shell intact", async ({ page }) => {
    const widths = [1920, 1440, 1280, 1024, 768, 390, 320];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(overviewPath(environment!.organizationId));

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("banner")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflow).toBe(false);
    }

    // Sidebar expanded + collapsed where the shell supports it.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(overviewPath(environment!.organizationId));
    const toggle = page.getByRole("button", { name: "Toggle Sidebar" });
    if ((await toggle.count()) > 0) {
      await toggle.click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const collapsedOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(collapsedOverflow).toBe(false);
      await toggle.click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("session A cannot read tenant B campaigns or previews", async ({ page }) => {
    // RLS plus the application membership filter are both on the path: the
    // request carries session A's cookies against organization B's rows.
    const other = environment!.otherOrganizationId;
    for (const path of [
      `/api/organizations/${other}/campaigns`,
      `/api/organizations/${other}/campaigns/${unknownCampaignId}`,
      `/api/organizations/${other}/assets`,
    ]) {
      const response = await page.request.get(path);
      expect([401, 403, 404]).toContain(response.status());
      const body = await response.text();
      expect(body).not.toContain(environment!.organizationId);
      for (const marker of FORBIDDEN_REFUSAL_MARKERS) {
        expect(body).not.toContain(marker);
      }
    }
  });

  test("an organization the operator does not belong to shows no home content", async ({
    page,
  }) => {
    await page.goto(overviewPath(environment!.otherOrganizationId));

    // Absence asserted directly — not just a redirect: no title, no records,
    // no private previews from the foreign tenant.
    for (const id of [
      "#home-campaigns",
      "#home-library",
      "#home-attention",
      "#home-goals",
      "#home-activity",
    ]) {
      await expect(page.locator(id)).toHaveCount(0);
    }
    await expect(page.locator('img[src*="supabase"], img[src*="storage"]')).toHaveCount(0);

    const url = page.url();
    const atLogin = /\/login/.test(url);
    if (!atLogin) {
      await expect(page.getByText("Organization overview could not be loaded")).toBeVisible();
    }
  });
});

test.describe("Organization home viewer restrictions", () => {
  test.skip(environment === null, missingEnvironmentReason());

  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, environment!, "viewer", baseURL!);
  });

  test("a viewer reads the home but sees no creation or management surface", async ({ page }) => {
    await page.goto(overviewPath(environment!.organizationId));

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "For your attention" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New campaign", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Manage organization", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("your organization details")).toHaveCount(0);
  });

  test("a viewer's campaign write is refused by the API, not only by the UI", async ({ page }) => {
    await page.goto(overviewPath(environment!.organizationId));
    // page.request carries the viewer session cookies, so this is genuinely
    // viewer-scoped — unlike the shared unauthenticated request fixture.
    const response = await page.request.post(
      `/api/organizations/${environment!.organizationId}/campaigns`,
      {
        data: {
          title: "Viewer attempt",
          objective: "Refused before any row exists",
          idempotencyKey: "viewer-home-attempt-key-1",
        },
      },
    );

    expect([401, 403, 422]).toContain(response.status());
    expect(await response.text()).not.toContain("internalCause");
  });
});

/**
 * Owner/admin flows need owner/admin fixture accounts. The shared E2E
 * fixtures only wire operator and viewer accounts, so these record their
 * skip reason instead of failing — a skip is not a pass.
 */
test.describe("Organization home owner and admin flows", () => {
  test.skip(
    true,
    "No owner/admin E2E fixture accounts are wired (E2E_OPERATOR_* and E2E_VIEWER_* only); owner create/manage flows stay unverified.",
  );

  test("an owner sees Review campaign wording and full management access", async () => {});
  test("an admin sees Review campaign wording and management access", async () => {});
});
