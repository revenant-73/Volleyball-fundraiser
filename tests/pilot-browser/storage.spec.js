import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { storageCipher } from '../../server/pilot/encryption.js';
import { readBundle } from '../../server/pilot/cloud-backup.js';

test.use({ viewport: { width: 390, height: 844 } });
test('owner uploads a private image, verifies an encrypted backup, downloads it, and revokes image access', async ({
  page,
  browser,
}) => {
  await page.goto('/admin');
  await page.getByLabel('Administrator email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fictional-owner-password');
  await page.getByRole('button', { name: 'Open administration' }).click();
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  const png = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#39c6b0' } })
    .png()
    .toBuffer();
  await page
    .getByLabel('Private image file')
    .setInputFiles({ name: 'fictional-logo.png', mimeType: 'image/png', buffer: png });
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/media') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Upload private image', exact: true }).click();
  const asset = await (await response).json();
  await expect(
    page.getByText('Image saved privately. It has not been published.', { exact: true }),
  ).toBeVisible();
  const card = page.locator('article').filter({ has: page.locator(`img[src="${asset.url}"]`) });
  await expect(card.getByRole('img')).toBeVisible();
  await expect
    .poll(() => card.getByRole('img').evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(`http://127.0.0.1:5174${asset.url}`)).status()).toBe(401);
  await anonymous.close();
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  await page.getByLabel('Your password for backup').fill('fictional-owner-password');
  const backupResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/backups') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Run backup now', exact: true }).click();
  const receipt = await (await backupResponse).json();
  await expect(
    page.getByText('Encrypted cloud backup created and verified.', { exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator(`a[href="/api/admin/backups/${receipt.id}/download"]`).click();
  const download = await downloadPromise;
  mkdirSync('artifacts/pilot-storage', { recursive: true });
  const destination = `artifacts/pilot-storage/${receipt.id}.enc`;
  await download.saveAs(destination);
  const cipher = storageCipher(readFileSync('.local-e2e/pilot/storage-key.txt', 'utf8'));
  const bundle = readBundle(readFileSync(destination, 'utf8'), receipt.id, cipher);
  expect(bundle.databaseBackup.snapshot.state.mediaAssets.some((a) => a.id === asset.id)).toBe(
    true,
  );
  expect(bundle.media.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/pilot-storage/operations-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await page
    .locator('article')
    .filter({ has: page.locator(`img[src="${asset.url}"]`) })
    .getByRole('button', { name: 'Hide image' })
    .click();
  await expect(
    page.getByText('Image hidden. Its preview is no longer accessible.', { exact: true }),
  ).toBeVisible();
  expect((await page.request.get(asset.url)).status()).toBe(404);
});
