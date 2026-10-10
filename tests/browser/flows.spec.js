import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
const headers = { 'X-Prototype': 'local' };
const calendarDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
async function fixture(request, organization = 'tvvc') {
  const login = await request.post('/api/login', {
    headers,
    data: { email: `coach@${organization}.example`, password: 'prototype-only' },
  });
  expect(login.ok()).toBeTruthy();
  const r = await request.post('/api/admin/campaigns', {
    headers,
    data: {
      name: `Browser review ${randomUUID().slice(0, 8)}`,
      purpose: 'Sample training fundraiser for browser acceptance tests.',
      goal: 5000,
      startDate: calendarDate(),
      timezone: 'America/Los_Angeles',
    },
  });
  expect(r.ok()).toBeTruthy();
  return r.json();
}
async function addAthlete(request, c, name) {
  const r = await request.post(`/api/admin/campaigns/${c.id}/athletes`, {
    headers,
    data: { name, displayName: name, team: 'Varsity' },
  });
  expect(r.ok()).toBeTruthy();
  return r.json();
}
async function detail(request, id) {
  return (await (await request.get('/api/admin')).json()).campaigns.find((c) => c.id === id);
}
const noOverflow = async (page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
test('390px athlete setup saves photo/message and two contacts, resumes and completes without sending', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const c = await fixture(page.request);
  const a = await addAthlete(page.request, c, 'Taylor');
  await page.goto(a.privatePath);
  await page
    .getByLabel('Paste donor email addresses')
    .fill('Fan@example.test, fan@example.test; family@example.test');
  await page.getByRole('button', { name: 'Save progress', exact: true }).click();
  await expect(page.getByText('2 contacts saved')).toBeVisible();
  await expect(page.getByText(/2 added; 1 duplicate/)).toBeVisible();
  const png = new PNG({ width: 16, height: 16 });
  png.data.fill(255);
  await page
    .getByLabel(/^Athlete photo/)
    .setInputFiles({ name: 'test-photo.png', mimeType: 'image/png', buffer: PNG.sync.write(png) });
  await page
    .getByLabel('Your message to supporters')
    .fill('Thank you for helping us train together.');
  await page.getByLabel(/I have athlete\/guardian authorization/).check();
  await page.getByRole('button', { name: 'Save & return later', exact: true }).click();
  await expect(page.getByText('Progress saved.', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Your message to supporters')).toHaveValue(
    'Thank you for helping us train together.',
  );
  await expect(page.getByAltText('Your uploaded profile preview')).toBeVisible();
  await page.getByRole('button', { name: 'Done →', exact: true }).click();
  await expect(page.getByLabel('Public fundraising URL')).toHaveValue(
    new RegExp(`/c/${c.slug}/a/${a.athlete.id}`),
  );
  const d = await detail(page.request, c.id);
  expect(d.athletes[0].completed).toBe(true);
  expect(d.contacts).toHaveLength(2);
  expect(d.jobs).toHaveLength(0);
  await noOverflow(page);
  mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/athlete-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('donor simulated Stripe confirms once, visibly refreshes progress, QR decodes to public page', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const c = await fixture(page.request);
  const a = await addAthlete(page.request, c, 'Sam');
  await page.request.post(`/api/admin/campaigns/${c.id}/action`, {
    headers,
    data: { action: 'launch' },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const publicPath = `/c/${c.slug}/a/${a.athlete.id}`;
  await page.goto(publicPath);
  await page.getByLabel('Your name', { exact: true }).fill('Demo donor');
  await page.getByLabel('Email', { exact: true }).fill('browser-donor@example.test');
  await page
    .getByRole('button', { name: 'Start simulated card contribution →', exact: true })
    .click();
  await expect(page.getByText('Simulated checkout ready.')).toBeVisible();
  let d = await detail(page.request, c.id);
  expect(d.totals.grossCents).toBe(0);
  await page.getByRole('button', { name: 'Simulate verified payment', exact: true }).click();
  await expect(page.getByText('Your demo contribution is confirmed.')).toBeVisible();
  await expect(page.getByText('1 confirmed donations')).toBeVisible();
  d = await detail(page.request, c.id);
  expect(d.totals.grossCents).toBe(5000);
  expect(d.ledger).toHaveLength(1);
  const share = page.getByLabel('Public fundraising URL');
  const url = await share.inputValue();
  expect(url).toBe(new URL(publicPath, page.url()).href);
  const facebook = page.getByRole('link', { name: 'Facebook', exact: true });
  expect(new URL(await facebook.getAttribute('href')).searchParams.get('u')).toBe(url);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Instagram QR graphic ↓', exact: true }).click();
  const file = await download;
  mkdirSync('docs/screenshots', { recursive: true });
  const graphicPath = 'docs/screenshots/instagram-qr.png';
  await file.saveAs(graphicPath);
  const png = PNG.sync.read(readFileSync(graphicPath));
  const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(qr?.data).toBe(url);
  expect((await page.request.get(new URL(qr.data).pathname)).ok()).toBeTruthy();
  await noOverflow(page);
  await page.screenshot({ path: 'docs/screenshots/donor-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('external reference before report; report pending; admin confirms and CSV exports', async ({
  page,
}) => {
  const c = await fixture(page.request);
  await page.request.post(`/api/admin/campaigns/${c.id}/action`, {
    headers,
    data: { action: 'launch' },
  });
  await page.goto(`/c/${c.slug}`);
  await page.getByLabel('Email', { exact: true }).fill('external-browser@example.test');
  await page.getByLabel('Venmo Business', { exact: true }).check();
  await page.getByRole('button', { name: 'Get payment reference →', exact: true }).click();
  await expect(page.getByLabel('Unique donation reference')).toHaveValue(/^RALLY-/);
  let d = await detail(page.request, c.id);
  expect(d.ledger[0].reported).toBe(false);
  expect(d.totals.grossCents).toBe(0);
  const reservedReference = await page.getByLabel('Unique donation reference').inputValue();
  await page.reload();
  await expect(page.getByLabel('Unique donation reference')).toHaveValue(reservedReference);
  await page.getByRole('button', { name: 'Report payment sent →', exact: true }).click();
  await expect(page.getByText(/Pending verification/).first()).toBeVisible();
  d = await detail(page.request, c.id);
  expect(d.ledger[0].reported).toBe(true);
  expect(d.contacts[0].state).toBe('pending');
  await page.goto('/admin');
  await page.getByRole('combobox', { name: 'Campaign', exact: true }).selectOption(c.id);
  await page.getByRole('button', { name: 'Ledger', exact: true }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByLabel('Reason / audit note').fill('Matched sample Venmo statement.');
  await page.getByRole('button', { name: 'Save ledger action', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  d = await detail(page.request, c.id);
  expect(d.totals.grossCents).toBe(5000);
  expect(d.totals.unknownFeeCount).toBe(1);
  expect(d.audit).toHaveLength(1);
  const csv = await page.request.get(`/api/admin/campaigns/${c.id}/export`);
  expect(csv.ok()).toBeTruthy();
  expect(await csv.text()).toContain('"confirmed"');
  expect(await csv.text()).toContain('"unknown"');
});
test('post-launch template editing and configured school redirect remain local simulations', async ({
  page,
}) => {
  const c = await fixture(page.request, 'century');
  const configuredURL = 'https://payments.example.test/approved-placeholder';
  await page.request.patch(`/api/admin/campaigns/${c.id}`, {
    headers,
    data: {
      paymentSettings: {
        school: {
          enabled: true,
          url: configuredURL,
          instructions: 'Sample reference instruction; not real school policy.',
        },
      },
    },
  });
  await page.request.post(`/api/admin/campaigns/${c.id}/action`, {
    headers,
    data: { action: 'launch' },
  });
  await page.goto('/admin');
  await page.getByRole('combobox', { name: 'Campaign', exact: true }).selectOption(c.id);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.template-item').first().locator('summary').click();
  await page.getByLabel('Subject', { exact: true }).first().fill('Updated organization invitation');
  await page.getByRole('button', { name: 'Save campaign settings', exact: true }).click();
  await expect(page.getByText('Campaign settings saved.', { exact: true })).toBeVisible();
  expect((await detail(page.request, c.id)).schedule[0].subject).toBe(
    'Updated organization invitation',
  );
  await page.goto(`/c/${c.slug}`);
  await page.getByRole('button', { name: 'Preview school portal handoff', exact: true }).click();
  await expect(page.getByText(/Simulated redirect/)).toBeVisible();
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
  expect(await page.locator('a[href="' + configuredURL + '"]').count()).toBe(0);
});
test('desktop admin launches, deduplicates shared contacts, simulates and unsubscribes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const c = await fixture(page.request);
  const sharedEmail = `shared-${c.id}@example.test`;
  for (const name of ['Pat', 'Lee']) {
    const a = await addAthlete(page.request, c, name);
    const raw = a.privatePath.split('/').at(-1);
    await page.request.patch(`/api/athlete/${raw}`, {
      headers,
      data: {
        emails: sharedEmail,
        message: 'Sample message approved for review.',
        authorization: true,
        done: true,
      },
    });
    await page.request.post(`/api/admin/campaigns/${c.id}/athletes/${a.athlete.id}/approve`, {
      headers,
      data: { approved: true, authorizationNote: 'Synthetic athlete authorization for test.' },
    });
  }
  await page.goto('/admin');
  await page.getByRole('combobox', { name: 'Campaign', exact: true }).selectOption(c.id);
  await page.getByRole('button', { name: 'Launch campaign →', exact: true }).click();
  await expect(page.getByText('launch complete.')).toBeVisible();
  let d = await detail(page.request, c.id);
  expect(d.contacts).toHaveLength(1);
  expect(d.contacts[0].athleteIds).toHaveLength(2);
  expect(d.jobs).toHaveLength(3);
  await noOverflow(page);
  mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/admin-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Email & activity', exact: true }).click();
  await page.getByRole('button', { name: 'Run email worker', exact: true }).click();
  d = await detail(page.request, c.id);
  expect(d.jobs.filter((j) => j.status === 'sent')).toHaveLength(1);
  const unsubscribePath = d.jobs[0].body.match(/\/unsubscribe\/[^\s<>]+/)[0];
  await page.goto(unsubscribePath);
  await page.getByRole('button', { name: 'Unsubscribe', exact: true }).click();
  await expect(page.getByText(/You are unsubscribed/)).toBeVisible();
  d = await detail(page.request, c.id);
  expect(d.contacts[0].state).toBe('suppressed');
  expect(d.jobs.filter((j) => j.status === 'blocked')).toHaveLength(2);
  expect(errors).toEqual([]);
});
test('Century placeholders, organization login and 390px admin have no overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const c = await fixture(page.request, 'century');
  await page.goto(`/c/${c.slug}`);
  await expect(
    page.getByText('Century High School Volleyball', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByLabel('School payment portal', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Mailed check', { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.goto('/admin');
  await page.getByRole('combobox', { name: 'Campaign', exact: true }).selectOption(c.id);
  await expect(page.locator('.admin-sidebar h2')).toHaveText('Century High School Volleyball');
  await noOverflow(page);
  await page.screenshot({ path: 'docs/screenshots/admin-mobile.png', fullPage: true });
});
test('retry after a lost donation response reuses request ID and creates one ledger entry', async ({
  page,
}) => {
  const c = await fixture(page.request);
  await page.request.post(`/api/admin/campaigns/${c.id}/action`, {
    headers,
    data: { action: 'launch' },
  });
  await page.goto(`/c/${c.slug}`);
  await page.getByLabel('Email', { exact: true }).fill('lost-response@example.test');
  let dropped = false;
  await page.route(`**/api/public/${c.slug}/donations`, async (route) => {
    if (!dropped) {
      dropped = true;
      const result = await route.fetch();
      expect(result.ok()).toBeTruthy();
      await route.abort('failed');
    } else await route.continue();
  });
  await page
    .getByRole('button', { name: 'Start simulated card contribution →', exact: true })
    .click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await detail(page.request, c.id)).ledger).toHaveLength(1);
  await page
    .getByRole('button', { name: 'Start simulated card contribution →', exact: true })
    .click();
  await expect(page.getByText('Simulated checkout ready.')).toBeVisible();
  expect((await detail(page.request, c.id)).ledger).toHaveLength(1);
});
