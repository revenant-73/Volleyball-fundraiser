import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const base = 'http://127.0.0.1:5173';
await fs.mkdir('artifacts/design-review', { recursive: true });
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
async function capture(name) {
  await page.screenshot({ path: `artifacts/design-review/${name}.png`, fullPage: true });
  const info = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    h1: document.querySelector('h1')?.textContent,
    unlabeled: [...document.querySelectorAll('input,textarea,select')].filter(
      (x) => !x.closest('label') && !x.getAttribute('aria-label') && !x.labels?.length,
    ).length,
  }));
  console.log(name, JSON.stringify(info));
}
await page.goto(base);
await page.getByRole('heading', { name: 'Find your rally.' }).waitFor();
await capture('landing-desktop');
await page.getByLabel('Demo organization').selectOption('coach@tvvc.example');
await page.getByLabel('Demo password').fill('prototype-only');
await page.getByRole('button', { name: 'Open administration →' }).click();
await page.getByRole('button', { name: 'Dashboard', exact: true }).waitFor();
const data = await page.evaluate(async () => await (await fetch('/api/admin')).json());
const campaign = data.campaigns.find((c) => c.slug === 'tvvc-fall-rally') || data.campaigns[0];
await capture('admin-desktop');
for (const w of [768, 390, 375]) {
  await page.setViewportSize({ width: w, height: 844 });
  await capture(`admin-${w}`);
}
await page.getByRole('button', { name: 'Campaign Settings', exact: true }).click();
await capture('settings-phone');
const athlete = campaign.athletes.find((a) => !a.completed && a.privatePath);
if (athlete) {
  await page.goto(base + athlete.privatePath);
  await page.locator('textarea').first().waitFor();
  await capture('athlete-phone');
}
await page.goto(base + '/c/' + campaign.slug);
await page.locator('.progress-track').first().waitFor();
await capture('public-phone');
await page.setViewportSize({ width: 768, height: 1024 });
await capture('public-tablet');
await page.setViewportSize({ width: 1440, height: 1000 });
await capture('public-desktop');
const examples = await page.evaluate(async () => await (await fetch('/api/examples')).json());
const century = examples.campaigns.find((c) => c.organizationName.includes('Century'));
if (century) {
  await page.goto(base + '/c/' + century.slug);
  await page.locator('.progress-track').first().waitFor();
  await capture('century-desktop');
}
console.log('page-errors', errors);
await browser.close();
