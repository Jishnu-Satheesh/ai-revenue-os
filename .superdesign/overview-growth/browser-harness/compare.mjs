// TEST-ONLY Task 6 harness: builds side-by-side and 50%-opacity overlay
// artifacts from the untouched approved PNGs and the browser renders. The
// approved images are never modified; they are only <img> sources.
// Usage: node .superdesign/overview-growth/browser-harness/compare.mjs [behind|ahead]
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const which = process.argv[2] === "ahead" ? "ahead" : "behind";
const approved = readFileSync(`.superdesign/overview-growth/approved-${which}.png`).toString("base64");
const rendered = readFileSync(`docs/verification/overview-growth/task6-${which}.png`).toString("base64");
const OUT = "docs/verification/overview-growth";

const browser = await chromium.launch();
try {
  // Side by side: approved left, browser render right, tops aligned.
  {
    const page = await browser.newPage({ viewport: { width: 1672 * 2 + 24, height: 940 } });
    await page.setContent(
      `<body style="margin:0;display:flex;gap:24px;background:#fff">` +
        `<img src="data:image/png;base64,${approved}" width="1672" height="940"/>` +
        `<img src="data:image/png;base64,${rendered}" width="1672" height="940"/>` +
        `</body>`,
    );
    await page.screenshot({ path: `${OUT}/task6-${which}-side-by-side.png` });
    console.log(`wrote ${OUT}/task6-${which}-side-by-side.png`);
    await page.close();
  }
  // Overlay: approved at full opacity, render at 50% on top, card top-left aligned.
  {
    const page = await browser.newPage({ viewport: { width: 1672, height: 940 } });
    await page.setContent(
      `<body style="margin:0;position:relative;width:1672px;height:940px;background:#fff">` +
        `<img src="data:image/png;base64,${approved}" width="1672" height="940" style="position:absolute;left:0;top:0"/>` +
        `<img src="data:image/png;base64,${rendered}" width="1672" height="940" style="position:absolute;left:0;top:0;opacity:0.5"/>` +
        `</body>`,
    );
    await page.screenshot({ path: `${OUT}/task6-${which}-overlay.png` });
    console.log(`wrote ${OUT}/task6-${which}-overlay.png`);
    await page.close();
  }
} finally {
  await browser.close();
}
