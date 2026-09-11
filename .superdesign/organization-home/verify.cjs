const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const results = [];
  const check = (name, condition) => { assert.ok(condition, name); results.push(name); };
  try {
    await page.goto('file://' + path.join(__dirname, 'prototype.html'));
    await page.evaluate(() => document.fonts.ready);
    check('Organization identity is the h1', await page.locator('h1').innerText() === 'Juniper Kitchen');
    check('Three real-state campaign fixture presentations', await page.locator('.campaign-card,.third-campaign').count() === 3);
    check('Four asset previews', await page.locator('.asset').count() === 4);
    check('Unreviewed renders stay separate from approved references', (await page.locator('#assets-content').innerText()).includes('Review not recorded') && (await page.locator('#assets-content').innerText()).includes('Approved reference'));
    check('No fake KPI or progress percentage', !(await page.locator('#main').innerText()).includes('%'));
    check('All prototype artwork loaded', await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)));
    await page.screenshot({ path: path.join(__dirname, 'desktop.png') });
    await page.getByRole('button', { name: 'Preview Make room for lunch', exact: true }).click();
    check('Asset opens accessible dialog', await page.getByRole('dialog', { name: 'Make room for lunch' }).isVisible());
    check('Asset metadata includes source and review status', (await page.getByRole('dialog').innerText()).includes('Review not recorded'));
    await page.screenshot({ path: path.join(__dirname, 'asset-detail.png') });
    await page.keyboard.press('Escape');
    check('Escape closes dialog', !(await page.getByRole('dialog').isVisible()));
    check('Focus returns to original asset', await page.getByRole('button', { name: 'Preview Make room for lunch', exact: true }).evaluate(el => el === document.activeElement));
    await page.getByRole('button', { name: 'Review campaign', exact: true }).click();
    check('Campaign destination is scoped', (await page.getByRole('dialog').innerText()).includes('/organizations/{organizationId}/campaigns/example-lunch'));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'View afternoon campaign in Campaigns' }).click();
    check('Unopenable campaign returns to portfolio', (await page.getByRole('dialog').innerText()).includes('/organizations/{organizationId}/campaigns'));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'View goals', exact: true }).click();
    check('Goal distinguishes target from outcome', (await page.getByRole('dialog').innerText()).includes('not a measured result'));
    await page.keyboard.press('Escape');
    await page.getByLabel('Preview state').selectOption('viewer');
    check('Viewer has no create or manage controls', await page.locator('.identity-actions .btn:visible').count() === 0);
    check('Viewer retains campaign read path', await page.getByRole('button', { name: 'View campaign', exact: true }).count() === 2);
    await page.getByLabel('Preview state').selectOption('new');
    check('New organization has no fabricated campaign records', await page.locator('.campaign-card').count() === 0);
    check('New organization has purposeful campaign entry', await page.getByRole('button', { name: 'Create a campaign', exact: true }).isVisible());
    check('New organization has no invented art', await page.locator('#assets-content img').count() === 0);
    await page.locator('#main').evaluate(el => el.scrollTop = 0);
    await page.screenshot({ path: path.join(__dirname, 'new-organization.png') });
    await page.getByLabel('Preview state').selectOption('partial');
    check('Assets failure keeps campaigns visible', await page.locator('.campaign-card').count() === 2);
    check('Assets failure exposes Retry', await page.getByRole('button', { name: 'Retry library' }).isVisible());
    await page.getByRole('button', { name: 'Retry library' }).click();
    check('Prototype retry restores gallery', await page.locator('.asset').count() === 4);
    await page.getByLabel('Preview state').selectOption('no-art');
    check('Missing artwork has explicit fallback', await page.locator('.no-art').count() === 6);
    check('Artwork failure retains campaign links', await page.getByRole('button', { name: 'Review campaign', exact: true }).isVisible());
    await page.getByLabel('Preview state').selectOption('populated');
    for (const width of [1920, 1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 1080 });
      await page.locator('#main').evaluate(el => el.scrollTop = 0);
      check(`No page or main overflow at ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#main').scrollWidth <= document.querySelector('#main').clientWidth));
      check(`Campaign title not clipped at ${width}px`, await page.locator('.campaign-info h3').evaluateAll(nodes => nodes.every(el => el.scrollWidth <= el.clientWidth)));
      if (width === 390) await page.screenshot({ path: path.join(__dirname, 'mobile.png') });
      if (width === 768) await page.screenshot({ path: path.join(__dirname, 'tablet.png') });
      if (width === 320) {
        await page.getByRole('button', { name: 'Preview Make room for lunch', exact: true }).click();
        check('Mobile dialog fits viewport', await page.getByRole('dialog').evaluate(el => el.getBoundingClientRect().width <= innerWidth));
        await page.keyboard.press('Escape');
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    check('Reduced motion removes card transitions', await page.locator('.campaign-card').first().evaluate(el => getComputedStyle(el).transitionDuration === '0s'));
    check('All anchor IDs unique', await page.locator('a').evaluateAll(links => links.every(el => el.id) && new Set(links.map(el => el.id)).size === links.length));
    check('No runtime errors', errors.length === 0);
    fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify({ passed: results.length, checks: results, runtimeErrors: errors, scope: 'Standalone fictional prototype only. No authenticated application, RLS, provider, or staging verification.' }, null, 2) + '\n');
    console.log(`${results.length} prototype checks passed.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
