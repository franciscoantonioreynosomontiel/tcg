const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 800, height: 1280 }); // Portrait

  try {
    await page.goto('http://localhost:8080/public.html?store=TCG%20Dual');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'verification/tablet_portrait_public.png' });

    await page.setViewportSize({ width: 1280, height: 800 }); // Landscape
    await page.screenshot({ path: 'verification/tablet_landscape_public.png' });
  } catch (e) {
    console.error(e);
  }

  await browser.close();
})();
