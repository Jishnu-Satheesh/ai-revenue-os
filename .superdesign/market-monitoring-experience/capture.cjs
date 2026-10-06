const {chromium}=require('@playwright/test');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const button=name=>page.getByRole('button',{name,exact:true});
  const boot=async()=>{await page.goto('file://'+path.join(__dirname,'prototype.html'),{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.marketWatchPreview&&window.marketWatchReport);await page.evaluate(()=>document.fonts.ready);};
  const capture=async name=>{
    await page.waitForFunction(()=>[...document.querySelectorAll('iconify-icon')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.top<innerHeight&&r.bottom>0;}).every(e=>!!e.shadowRoot?.querySelector('svg')));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.screenshot({path:path.join(__dirname,name)});
  };
  await boot();await capture('01-market-watch-desktop.png');
  await button('New research').click();await capture('02-new-research-desktop.png');
  await page.getByRole('button',{name:'Try an event brief',exact:true}).click();await button('Continue').click();
  await page.getByLabel('Business location',{exact:true}).selectOption('downtown');
  for(const name of ['Rival Kitchen','Neighbour Table']){
    await button('Add a competitor').click();await page.getByLabel('Competitor name',{exact:true}).fill(name);await page.getByLabel('Website Optional',{exact:true}).fill('https://example.com');await page.getByLabel('Location hint Optional',{exact:true}).fill('Downtown');await button('Save competitor').click();
  }
  await capture('03-research-scope-desktop.png');await button('Continue').click();
  await page.getByRole('radio',{name:'Keep monitoring Receive fresh reports as the market changes.'}).check();
  await page.getByLabel('Frequency',{exact:true}).selectOption('weekly');await page.getByLabel('Stop monitoring on Optional',{exact:true}).fill('2026-12-03');
  await capture('04-review-brief-desktop.png');await button('Start research').click();await capture('05-research-progress-desktop.png');await button('Close').click();
  await button('Review report').click();await capture('06-report-summary-desktop.png');
  await button('Competitors').click();await capture('07-report-estimate-desktop.png');
  await button('Summary').click();await page.locator('[data-mwr-advice="offer-finding"]').check();
  await button('Draft advice').click();await page.locator('[data-mwr-advice="bundle"]').check();await page.locator('[data-mwr-advice="capacity"]').check();await capture('08-draft-advice-desktop.png');
  await button('Review selection (3)').click();await capture('09-accept-items-desktop.png');await button('Accept selected items').click();await button('View Recommendations').click();await capture('10-recommendations-handoff-desktop.png');
  await page.setViewportSize({width:390,height:844});await boot();await capture('11-market-watch-mobile.png');
  await button('New research').click();await capture('12-new-research-mobile.png');await page.keyboard.press('Escape');
  await button('Review report').click();await capture('13-report-mobile.png');
  const close=await page.locator('[aria-label="Close research dialog"]').boundingBox();if(close.x<0||close.x+close.width>390)throw new Error('Phone close control is outside the viewport');
  console.log('Captured 13 desktop and phone review views with resolved icons.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
