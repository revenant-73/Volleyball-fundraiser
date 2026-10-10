import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const base = 'http://127.0.0.1:5173';
await page.goto(base);
await page.getByRole('button', { name: 'Open administration →' }).click();
await page.getByRole('button', { name: 'Dashboard', exact: true }).waitFor();
const data = await page.evaluate(async () => await (await fetch('/api/admin')).json());
const campaign = data.campaigns[0];
for (const section of ['Athletes', 'Donations', 'Campaign Settings']) {
  await page.getByRole('button', { name: section, exact: true }).click();
  await page.screenshot({
    path: `artifacts/design-review/${section.toLowerCase().replaceAll(/[^a-z]+/g, '-')}-phone.png`,
    fullPage: true,
    mask: section === 'Email & activity' ? [page.locator('.summary-row')] : [],
  });
  console.log(
    section,
    await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      smallTargets: [...document.querySelectorAll('button,a')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.height > 0 && r.height < 32;
        })
        .map((el) => ({
          text: el.textContent,
          height: Math.round(el.getBoundingClientRect().height),
          size: getComputedStyle(el).fontSize,
        })),
      activeButtons: [...document.querySelectorAll('nav button.active')].map((el) => ({
        text: el.textContent,
        pressed: el.getAttribute('aria-pressed'),
        current: el.getAttribute('aria-current'),
      })),
    })),
  );
}
await page.goto(base + '/c/' + campaign.slug + '/a/' + campaign.athletes[0].id);
await page.locator('.public-heading').waitFor();
await page.screenshot({ path: 'artifacts/design-review/public-athlete-phone.png', fullPage: true });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.screenshot({
  path: 'artifacts/design-review/public-athlete-desktop.png',
  fullPage: true,
});
const button = page.getByRole('button', { name: 'Copy link', exact: true });
console.log('hover-before', await button.evaluate((el) => getComputedStyle(el).backgroundColor));
await button.hover();
console.log('hover-after', await button.evaluate((el) => getComputedStyle(el).backgroundColor));
await page.keyboard.press('Tab');
console.log('focusable', await page.evaluate(() => document.activeElement?.tagName));
await browser.close();
