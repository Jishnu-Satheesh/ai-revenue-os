// TEST-ONLY Task 6 harness: screenshots the behind/ahead fixtures through the
// real Next pipeline at the canonical 1672x940 frame. Requires `pnpm dev` on
// :3000 plus the uncommitted temp route src/app/overview-growth-harness (see
// task-6-report.md). Writes docs/verification/overview-growth/task6-*.png.
// Usage: node .superdesign/overview-growth/browser-harness/render.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.HARNESS_BASE_URL ?? "http://localhost:3000";
const OUT = "docs/verification/overview-growth";

for (const state of ["behind", "ahead"]) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1672, height: 940 },
      deviceScaleFactor: 1,
    });
    await page.goto(`${BASE}/overview-growth-harness?state=${state}`, {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/task6-${state}.png` });
    console.log(`wrote ${OUT}/task6-${state}.png`);
  } finally {
    await browser.close();
  }
}
