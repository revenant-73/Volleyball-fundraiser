import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const TARGET_URL = 'https://rallyfund-tvvc-pilot.netlify.app';
const credentialsPath = path.resolve(process.argv[2] || '');
if (!credentialsPath.startsWith(path.resolve('.local/pilot') + path.sep))
  throw new Error('Choose the private owner credentials inside .local/pilot.');
const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
const request = (route, method = 'GET', body, cookie = '') =>
  fetch(TARGET_URL + route, {
    method,
    headers: {
      Origin: TARGET_URL,
      'Content-Type': 'application/json',
      'X-Prototype': 'local',
      cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const runtime = await (await request('/api/runtime')).json();
assert.deepEqual(runtime, {
  hosted: true,
  simulation: false,
  mode: 'pilot',
  paymentsEnabled: false,
  emailEnabled: false,
});
assert.equal((await request('/api/admin')).status, 401);
const sessions = await Promise.all(
  Array.from({ length: 3 }, () => request('/api/login', 'POST', credentials)),
);
for (const response of sessions) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /Secure/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const admin = await (await request('/api/admin', 'GET', undefined, cookie)).json();
  assert.equal(admin.organization.id, 'tvvc');
  assert.equal(admin.administrator.email, credentials.email);
  assert.equal(admin.administrator.role, 'owner');
  assert.equal(JSON.stringify(admin).includes('passwordHash'), false);
  assert.equal((await request('/api/logout', 'POST', {}, cookie)).status, 200);
  assert.equal((await request('/api/admin', 'GET', undefined, cookie)).status, 401);
}
for (const route of [
  '/api/public/anything/donations',
  '/api/simulator/payments',
  '/api/receipt/anything/report',
])
  assert.equal((await request(route, 'POST', {})).status, 403);
assert.equal((await request('/api/public/anything')).status, 403);
const foreign = await fetch(TARGET_URL + '/api/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Prototype': 'local',
    Origin: 'https://foreign.example.test',
  },
  body: JSON.stringify(credentials),
});
assert.equal(foreign.status, 403);

mkdirSync('artifacts/pilot', { recursive: true });
const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(TARGET_URL + '/admin');
  await page.getByLabel('Administrator email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Open administration' }).click();
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('heading', { name: 'Your account', exact: true }).waitFor();
  await page.getByRole('listitem').filter({ hasText: credentials.email }).waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({ path: 'artifacts/pilot/hosted-account-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'artifacts/pilot/hosted-account-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Administrator email', { exact: true }).waitFor();
} finally {
  await browser.close();
}
const review = await (await fetch('https://volleyball-fundraiser.netlify.app/api/runtime')).json();
assert.deepEqual(review, { hosted: true, simulation: true });
console.log(
  'PASS: hosted TVVC owner login, concurrent sessions, logout, secure cookies, foreign-origin rejection, payment/email gates, 390px/desktop account UI, original review simulation.',
);
