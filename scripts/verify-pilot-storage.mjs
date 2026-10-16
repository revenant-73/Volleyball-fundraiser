import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from '@playwright/test';
import { createClient } from '@libsql/client';
import { storageCipher } from '../server/pilot/encryption.js';
import { restoreCloudBackupToEmpty } from '../server/pilot/cloud-backup.js';
import { fileObjectStore } from '../server/pilot/object-store.js';

const TARGET_URL = 'https://rallyfund-tvvc-pilot.netlify.app';
const credentialsPath = path.resolve(process.argv[2] || '');
if (!credentialsPath.startsWith(path.resolve('.local/pilot') + path.sep))
  throw new Error('Choose the private pilot owner credentials.');
const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
let cookie = '';
const call = (route, method = 'GET', body) =>
  fetch(TARGET_URL + route, {
    method,
    headers: {
      Origin: TARGET_URL,
      'X-Prototype': 'local',
      'Content-Type': 'application/json',
      cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const login = await call('/api/login', 'POST', credentials);
assert.equal(login.status, 200, 'Pilot owner login');
cookie = login.headers.get('set-cookie').split(';')[0];
const png = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#39c6b0' } })
  .png()
  .toBuffer();
const uploaded = await call('/api/admin/media', 'POST', {
  purpose: 'organization-logo',
  contentType: 'image/png',
  base64: png.toString('base64'),
  requestId: randomUUID(),
});
assert.equal(
  uploaded.status,
  200,
  `Private image upload: ${uploaded.status !== 200 ? await uploaded.text() : ''}`,
);
const asset = await uploaded.json();
const image = await call(asset.url);
assert.equal(image.status, 200);
assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format, 'webp');
assert.equal((await fetch(TARGET_URL + asset.url)).status, 401);
const requestId = randomUUID();
const backup = await call('/api/admin/backups', 'POST', {
  currentPassword: credentials.password,
  requestId,
});
assert.equal(
  backup.status,
  200,
  `Encrypted backup: ${backup.status !== 200 ? await backup.text() : ''}`,
);
const receipt = await backup.json();
assert.ok(receipt.mediaCount >= 1);
const download = await call(`/api/admin/backups/${receipt.id}/download`);
assert.equal(download.status, 200);
const envelope = await download.text();
const savedFile = path.resolve('.local/pilot', `${receipt.id}.enc`);
writeFileSync(savedFile, envelope, { flag: 'wx', mode: 0o600 });
const recoveryDirectory = path.resolve('.local/pilot', `hosted-recovery-${Date.now()}`);
mkdirSync(recoveryDirectory, { recursive: true });
const restored = createClient({ url: `file:${path.join(recoveryDirectory, 'restored.db')}` });
let recovery;
try {
  recovery = await restoreCloudBackupToEmpty({
    client: restored,
    mediaStore: fileObjectStore(path.join(recoveryDirectory, 'private-media')),
    envelope,
    id: receipt.id,
    cipher: storageCipher(process.env.RALLYFUND_STORAGE_KEY),
  });
  assert.equal(recovery.integrity, 'ok');
} finally {
  restored.close();
}
assert.equal((await call(asset.url, 'PATCH', { action: 'hide' })).status, 200);
assert.equal((await call(asset.url)).status, 404);
assert.equal((await call('/api/simulator/payments', 'POST', {})).status, 403);
assert.equal((await call('/api/public/anything/donations', 'POST', {})).status, 403);
await call('/api/logout', 'POST', {});

mkdirSync('artifacts/pilot-storage', { recursive: true });
const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(TARGET_URL + '/admin');
  await page.getByLabel('Administrator email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Open administration' }).click();
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  await page.locator(`a[href="/api/admin/backups/${receipt.id}/download"]`).waitFor();
  await page.screenshot({
    path: 'artifacts/pilot-storage/hosted-operations-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: 'artifacts/pilot-storage/hosted-operations-mobile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
} finally {
  await browser.close();
}
assert.deepEqual(
  await (await fetch('https://volleyball-fundraiser.netlify.app/api/runtime')).json(),
  { hosted: true, simulation: true },
);
writeFileSync(
  'artifacts/pilot-storage/hosted-verification.json',
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      backupId: receipt.id,
      recovery,
      reviewSimulation: true,
    },
    null,
    2,
  ),
);
console.log(
  `PASS: hosted private image upload/read/hide, anonymous denial, encrypted database+${receipt.mediaCount} image recovery, 390px/desktop Operations, disabled payments, original review preserved. Recovery file saved privately: ${savedFile}`,
);
