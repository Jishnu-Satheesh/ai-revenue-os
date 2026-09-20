import { expect, test } from "@playwright/test";

import {
  FORBIDDEN_GROWTH_MARKERS,
  GROWTH_FROZEN,
  GROWTH_VIEWPORT_MATRIX,
  harnessUrl,
  isHarnessScenarioAvailable,
  missingHarnessReason,
  overviewPath,
  settleHarness,
  showReadyMonthChart,
} from "./support/overview-growth-fixtures";
import {
  missingEnvironmentReason,
  readIntegrationHubEnvironment,
  signIn,
} from "./support/authenticated";

/**
 * Overview growth functional review (Task 8, contracts V07/V09 + AC07/AC12).
 *
 * Three layers, each honest about what it proves:
 *
 * - Route protection runs everywhere, seeded or not: unauthenticated
 *   visitors redirect, unauthenticated API callers are refused, and no
 *   refusal body leaks artwork/storage markers.
 * - Authenticated operator/viewer/nonmember routes reuse the Integration Hub
 *   E2E fixture names (no growth-specific seed exists and none is created
 *   here). Without that environment they skip with the reason; the live
 *   acceptance gate stays open and fixture rendering is never claimed as
 *   authenticated acceptance.
 * - The V09 matrix (viewports, zoom, reduced motion, keyboard, touch,
 *   contrast, tooltip) runs against the developer-only harness card and
 *   skips when it is absent. Full-route sidebar expanded/collapsed at 1440
 *   needs the live route with the flag on, so it is recorded as a
 *   live-acceptance gate, not asserted here.
 */

const unknownOrganizationId = "00000000-0000-4000-8000-000000000000";

test.describe("Overview growth route protection", () => {
  test("an unauthenticated visitor is sent to sign in", async ({ page }) => {
    await page.goto(overviewPath(unknownOrganizationId));

    await expect(page).toHaveURL(/\/login/);
    // The sign-in heading copy drifts with peer work; the gate is the
    // redirect plus a visible level-1 heading, not the product name.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("unauthenticated API callers are refused without leaking markers", async ({ request }) => {
    const response = await request.get(`/api/organizations/${unknownOrganizationId}/campaigns`);
    expect(response.status()).toBe(401);
    const body = await response.text();
    for (const marker of FORBIDDEN_GROWTH_MARKERS) {
      expect(body).not.toContain(marker);
    }
  });

  test("reduced-motion visitors still reach a navigable boundary", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(overviewPath(unknownOrganizationId));

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

const environment = readIntegrationHubEnvironment();

test.describe("Overview growth authenticated routes", () => {
  test.skip(environment === null, missingEnvironmentReason());

  test("operator loads the overview without raw error markers", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, environment!, "operator", baseURL!);
    await page.goto(overviewPath(environment!.organizationId));

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const body = await page.locator("body").innerText();
    for (const marker of FORBIDDEN_GROWTH_MARKERS) {
      expect(body).not.toContain(marker);
    }
  });

  test("viewer sees the same growth section state as the operator", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, environment!, "viewer", baseURL!);
    await page.goto(overviewPath(environment!.organizationId));

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Viewer invariance is a unit-proven composition rule; live, the gate is
    // that the viewer is neither redirected nor shown a denial the operator
    // does not see. No fixture content is asserted as acceptance here.
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("nonmember accounts cannot read another organization", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, environment!, "operator", baseURL!);
    await page.goto(overviewPath(environment!.otherOrganizationId));

    // Either a sign-in bounce or a member-only refusal — never the org home.
    const url = page.url();
    const forbidden = page.getByText(/not a member|no longer have access|does not exist/i);
    const bounced = /\/login/.test(url);
    expect(bounced || ((await forbidden.count()) > 0)).toBe(true);
  });
});

test.describe("Overview growth V09 matrix (isolated card)", () => {
  test.use({
    locale: GROWTH_FROZEN.locale,
    timezoneId: GROWTH_FROZEN.timezoneId,
    deviceScaleFactor: GROWTH_FROZEN.deviceScaleFactor,
    colorScheme: GROWTH_FROZEN.colorScheme,
  });

  test.beforeEach(async ({ request }) => {
    test.skip(!(await isHarnessScenarioAvailable(request, "behind")), missingHarnessReason());
  });

  for (const viewport of GROWTH_VIEWPORT_MATRIX) {
    test(`behind card at ${viewport.label} (${viewport.width}x${viewport.height}) never scrolls sideways`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(harnessUrl("behind"), { waitUntil: "networkidle" });
      await settleHarness(page);

      const section = page.locator("#home-revenue");
      await expect(section).toBeVisible();
      const overflow = await section.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          right: rect.right,
          viewportWidth: window.innerWidth,
        };
      });
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
      expect(overflow.right).toBeLessThanOrEqual(overflow.viewportWidth + 1);
    });
  }

  test("horizon switch is keyboard-operable with a polite announcement", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(harnessUrl("behind"), { waitUntil: "networkidle" });
    await settleHarness(page);

    // Fixtures default to the ready 1M horizon; switching to 3M exercises the
    // announcement and the pressed-once invariant from a real change.
    const threeMonths = page.getByRole("button", { name: "3 months" });
    await threeMonths.focus();
    await expect(threeMonths).toBeFocused();
    await page.keyboard.press("Enter");
    const announcement = page.getByTestId("growth-horizon-announcement");
    await expect(announcement).not.toBeEmpty();
    // The horizon control stays pressed exactly once.
    await expect(page.getByRole("button", { name: "3 months" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("hovering a plotted point opens the same-date comparison tooltip", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(harnessUrl("behind"), { waitUntil: "networkidle" });
    await settleHarness(page);
    await showReadyMonthChart(page);

    const dots = page.locator("#home-revenue svg circle");
    expect(await dots.count()).toBeGreaterThan(0);
    await dots.first().hover({ force: true });
    await expect(page.locator("#growth-chart-tooltip")).toBeVisible();
  });

  test("200% zoom keeps the card readable without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.goto(harnessUrl("behind"), { waitUntil: "networkidle" });
    await settleHarness(page);

    // Half the CSS width at the same layout approximates a 200% zoom frame.
    const section = page.locator("#home-revenue");
    await expect(section).toBeVisible();
    const overflow = await section.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    await expect(
      section.getByRole("heading", { name: "Current vs projected growth" }),
    ).toBeVisible();
  });

  test("reduced motion still renders the full card", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(harnessUrl("behind"), { waitUntil: "networkidle" });
    await settleHarness(page);
    await showReadyMonthChart(page);

    const section = page.locator("#home-revenue");
    await expect(
      section.getByRole("heading", { name: "Current vs projected growth" }),
    ).toBeVisible();
    expect(await section.locator("svg circle").count()).toBeGreaterThan(0);
  });

  test.describe("touch", () => {
    test.use({ hasTouch: true });

    // FINDING (Task 8, real Chromium touch): a touchscreen tap on a plotted
    // point fires touchstart/touchend plus synthesized mouseenter but opens
    // no tooltip, while a mouse click on the same glyph does. Task 7 touch
    // coverage is jsdom fireEvent-level only. Encoded as expected-fail until
    // the chart's touch path is proven in a real browser; the fix is outside
    // the Task 8 narrow file map.
    test.fail("tap on a plotted point pins its comparison", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(harnessUrl("behind"), { waitUntil: "networkidle" });
      await settleHarness(page);
      await showReadyMonthChart(page);

      const dots = page.locator("#home-revenue svg circle");
      expect(await dots.count()).toBeGreaterThan(0);
      const center = await dots.first().evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      await page.touchscreen.tap(center.x, center.y);
      await expect(page.locator("#growth-chart-tooltip")).toBeVisible();
    });
  });

  test("forced colors keep the section heading and retry reachable", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(harnessUrl("failed-initial"), { waitUntil: "networkidle" });
    await settleHarness(page);

    await expect(page.getByText(/could not be read/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("full-route sidebar expanded/collapsed at 1440 stays a live gate", async ({ request }) => {
    // The harness renders the isolated card without the route shell, so the
    // sidebar matrix cannot run here. Recorded as an open live-acceptance
    // item in the Task 8 report, not silently dropped.
    test.skip(!(await isHarnessScenarioAvailable(request, "behind")), missingHarnessReason());
    test.skip(true, "sidebar expanded/collapsed needs the live overview route with the flag on");
  });
});
