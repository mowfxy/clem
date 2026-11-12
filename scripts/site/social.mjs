// The website's social image and the README banner: the opening screen, without the page around it.
// Needs the dev server on :5173.   node scripts/site/social.mjs
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
for (const [width, height, path] of [[1200, 630, "public/site/og.png"], [1280, 640, "docs/assets/banner.png"]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto("http://localhost:5173/");
  await page.addStyleTag({ content: ".o-bar,.o-open-line .o-btn{display:none!important}.o-site .o-open{padding-top:44px}.o-site .o-open-line p{font-size:30px}" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path });
  await page.close();
}
await browser.close();
