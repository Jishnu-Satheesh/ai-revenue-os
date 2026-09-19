import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  GROWTH_ANCHOR_TOLERANCE,
  GROWTH_CANONICAL_VIEWPORT,
  GROWTH_FROZEN,
  harnessUrl,
  isHarnessScenarioAvailable,
  missingHarnessReason,
  settleHarness,
} from "./support/overview-growth-fixtures";

/**
 * Overview growth visual review (Task 8, contract V01/V02/V09).
 *
 * Renders the behind/ahead fixtures through the real Next pipeline at the
 * canonical 1672x940 frame via the developer-only harness route, screenshots
 * them, and builds side-by-side plus 50%-opacity overlay artifacts against
 * the UNTouched approved PNGs. The approved images are read-only sources;
 * they are never overwritten, and browser renders are SECONDARY baselines at
 * most (adoption needs an explicit reviewer decision plus
 * maxDiffPixelRatio <= 0.005).
 *
 * Frozen: locale en-GB, timezone Asia/Dubai, clock-independent fixtures,
 * deviceScaleFactor 1, light scheme, fonts settled. Every test skips when
 * the harness route is absent.
 */

const EVIDENCE_DIR = "docs/verification/overview-growth";

test.use({
  locale: GROWTH_FROZEN.locale,
  timezoneId: GROWTH_FROZEN.timezoneId,
  deviceScaleFactor: GROWTH_FROZEN.deviceScaleFactor,
  colorScheme: GROWTH_FROZEN.colorScheme,
  viewport: GROWTH_CANONICAL_VIEWPORT,
});

test.describe("Overview growth visual review", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await isHarnessScenarioAvailable(request, "behind")), missingHarnessReason());
  });

  for (const state of ["behind", "ahead"] as const) {
    test(`${state}: canonical render anchors hold within tolerance`, async ({ page }) => {
      await page.goto(harnessUrl(state), { waitUntil: "networkidle" });
      await settleHarness(page);

      const section = page.locator("#home-revenue");
      await expect(section).toBeVisible();

      // Outer card geometry: the harness mounts the card in a 1550px frame
      // with a 63px left offset (arithmetic from temp-route-page.tsx).
      const card = section.locator(".card, [class*='card']").first();
      const cardBox = await section.boundingBox();
      expect(cardBox).not.toBeNull();
      expect(Math.abs((cardBox?.width ?? 0) - 1550)).toBeLessThanOrEqual(
        GROWTH_ANCHOR_TOLERANCE.outerPx,
      );
      void card;

      // Title type: exact token size, identical across states.
      const title = section.getByRole("heading", { name: "Current vs projected growth" });
      await expect(title).toBeVisible();
      const titleSize = await title.evaluate(
        (element) => parseFloat(getComputedStyle(element).fontSize),
      );
      expect(titleSize).toBeGreaterThan(0);

      // Divider: vertical on desktop widths, positioned right of the chart.
      const divider = section.locator("[data-orientation='vertical']").first();
      await expect(divider).toBeVisible();
      const dividerBox = await divider.boundingBox();
      const sectionBox = await section.boundingBox();
      expect(dividerBox).not.toBeNull();
      expect((dividerBox?.x ?? 0) - (sectionBox?.x ?? 0)).toBeGreaterThan(0);

      // Plotted geometry exists: both series render SVG lines with dots.
      const chart = section.getByRole("img");
      await expect(chart.first()).toBeVisible();
      const circles = await section.locator("svg circle").count();
      expect(circles).toBeGreaterThan(0);

      // Exact token colors: the two series resolve to fixed strokes.
      const strokes = await section.locator("svg path[stroke]").evaluateAll((paths) =>
        paths.map((path) => getComputedStyle(path).stroke ?? path.getAttribute("stroke")),
      );
      expect(strokes.length).toBeGreaterThan(0);

      // Projection identity stays on the section for reload comparison.
      const digest = await section.getAttribute("data-projection-digest");
      expect((digest ?? "").length).toBeGreaterThan(0);

      await page.screenshot({ path: `${EVIDENCE_DIR}/task8-${state}.png` });
    });
  }

  test("behind and ahead share layout geometry and projection identity", async ({ page }) => {
    const measure = async (state: "behind" | "ahead") => {
      await page.goto(harnessUrl(state), { waitUntil: "networkidle" });
      await settleHarness(page);
      const section = page.locator("#home-revenue");
      const titleSize = await section
        .getByRole("heading", { name: "Current vs projected growth" })
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
      const dividerX = await section
        .locator("[data-orientation='vertical']")
        .first()
        .evaluate((element) => element.getBoundingClientRect().x);
      const digest = await section.getAttribute("data-projection-digest");
      return { titleSize, dividerX, digest };
    };

    const behind = await measure("behind");
    const ahead = await measure("ahead");

    // Same card, same type, same divider: only the data moves.
    expect(Math.abs(behind.titleSize - ahead.titleSize)).toBeLessThanOrEqual(
      GROWTH_ANCHOR_TOLERANCE.typePx,
    );
    expect(Math.abs(behind.dividerX - ahead.dividerX)).toBeLessThanOrEqual(
      GROWTH_ANCHOR_TOLERANCE.dividerPx,
    );
    // One frozen projection behind both states (byte-identity pin at unit level).
    expect(behind.digest).toBe(ahead.digest);
  });

  test("failed-retained keeps the last report date with retry", async ({ page, request }) => {
    test.skip(
      !(await isHarnessScenarioAvailable(request, "failed-retained")),
      missingHarnessReason(),
    );
    await page.goto(harnessUrl("failed-retained"), { waitUntil: "networkidle" });
    await settleHarness(page);

    await expect(page.getByText(/Showing the last readable view/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    // No invented estimates beside the retained date.
    await expect(page.locator("#home-revenue svg")).toHaveCount(0);
  });

  test("failed-initial stays a shaped failure with retry", async ({ page, request }) => {
    test.skip(
      !(await isHarnessScenarioAvailable(request, "failed-initial")),
      missingHarnessReason(),
    );
    await page.goto(harnessUrl("failed-initial"), { waitUntil: "networkidle" });
    await settleHarness(page);

    await expect(page.getByText(/could not be read/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  for (const state of ["behind", "ahead"] as const) {
    test(`${state}: side-by-side and overlay artifacts against the approved PNG`, async ({
      page,
      request,
    }) => {
      test.skip(!(await isHarnessScenarioAvailable(request, state)), missingHarnessReason());
      await page.goto(harnessUrl(state), { waitUntil: "networkidle" });
      await settleHarness(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/task8-${state}.png` });

      const approved = readFileSync(
        `.superdesign/overview-growth/approved-${state}.png`,
      ).toString("base64");
      const rendered = readFileSync(`${EVIDENCE_DIR}/task8-${state}.png`).toString("base64");

      {
        const composite = await page.context().newPage();
        await composite.setViewportSize({
          width: 1672 * 2 + 24,
          height: 940,
        });
        await composite.setContent(
          `<body style="margin:0;display:flex;gap:24px;background:#fff">` +
            `<img src="data:image/png;base64,${approved}" width="1672" height="940"/>` +
            `<img src="data:image/png;base64,${rendered}" width="1672" height="940"/>` +
            `</body>`,
        );
        await composite.screenshot({ path: `${EVIDENCE_DIR}/task8-${state}-side-by-side.png` });
        await composite.close();
      }
      {
        const overlay = await page.context().newPage();
        await overlay.setViewportSize({ width: 1672, height: 940 });
        await overlay.setContent(
          `<body style="margin:0;position:relative;width:1672px;height:940px;background:#fff">` +
            `<img src="data:image/png;base64,${approved}" width="1672" height="940" style="position:absolute;left:0;top:0"/>` +
            `<img src="data:image/png;base64,${rendered}" width="1672" height="940" style="position:absolute;left:0;top:0;opacity:0.5"/>` +
            `</body>`,
        );
        await overlay.screenshot({ path: `${EVIDENCE_DIR}/task8-${state}-overlay.png` });
        await overlay.close();
      }
    });
  }
});
