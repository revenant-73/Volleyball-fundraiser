import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

// Run only on this project's hosted simulation, with fictional fixtures.
const base = new URL(process.argv[2] || 'https://volleyball-fundraiser.netlify.app').origin;
assert.ok(
  /^https:\/\/(?:[a-f0-9]{24}--)?volleyball-fundraiser\.netlify\.app$/.test(base),
  'Wrong review host.',
);
const credentials = JSON.parse(readFileSync('.local/hosted-review-credentials.json', 'utf8'));
const headers = { 'Content-Type': 'application/json', 'X-Prototype': 'local', Origin: base };
let cookie = '';
let campaign;
let stage = 'initial API checks';
const runKey = randomUUID().slice(0, 8);
const sharedEmail = `shared-${runKey}@example.test`;
const oneEmail = `one-${runKey}@example.test`;
const secondEmail = `second-${runKey}@example.test`;
const lateEmail = `late-${runKey}@example.test`;
const results = [];
const record = (message) => {
  results.push(message);
  console.log('PASS:', message);
};
async function raw(path, method = 'GET', body, extra = {}) {
  return fetch(base + path, {
    method,
    redirect: 'manual',
    headers: { ...headers, cookie, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function api(path, method = 'GET', body) {
  const response = await raw(path, method, body);
  assert.ok(response.ok, `Hosted API ${method} returned ${response.status}.`);
  return response.json();
}
async function detail() {
  return (await api('/api/admin')).campaigns.find((c) => c.id === campaign.id);
}
async function action(value, extra = {}) {
  return api(`/api/admin/campaigns/${campaign.id}/action`, 'POST', { action: value, ...extra });
}
async function add(name) {
  return api(`/api/admin/campaigns/${campaign.id}/athletes`, 'POST', {
    name,
    displayName: name,
    team: 'Review team',
  });
}
async function approve(a) {
  return api(`/api/admin/campaigns/${campaign.id}/athletes/${a.athlete.id}/approve`, 'POST', {
    approved: true,
    authorizationNote: 'Synthetic adult test fixture; no actual minor or guardian information.',
  });
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', () => pageErrors.push('Browser script error'));
mkdirSync('artifacts/hosted-review', { recursive: true });
try {
  assert.equal((await api('/api/runtime')).hosted, true);
  assert.equal((await raw('/api/admin')).status, 401);
  assert.equal((await raw('/api/unknown')).status, 404);
  assert.equal(
    (await raw('/api/login', 'POST', {}, { Origin: 'https://evil.example.test' })).status,
    403,
  );
  assert.equal(
    (await raw('/api/login', 'POST', { email: 'coach@tvvc.example', password: 'prototype-only' }))
      .status,
    401,
  );
  const login = await raw('/api/login', 'POST', {
    email: credentials.emails[0],
    password: credentials.password,
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /Secure/);
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await raw('/api/session')).status, 200);
  record('Hosted authentication, secure persistent session, origin gate and JSON 404.');

  campaign = await api('/api/admin/campaigns', 'POST', {
    name: `Hosted verification ${randomUUID().slice(0, 8)}`,
    purpose: 'Fictional test campaign for hosted prototype verification.',
    goal: 5000,
    startDate: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
    timezone: 'America/Los_Angeles',
  });
  const first = await add('Review One');
  const second = await add('Review Two');
  await page.goto(base + first.privatePath);
  await page
    .getByLabel('Paste donor email addresses')
    .fill(`${sharedEmail.toUpperCase()}; ${sharedEmail}; ${oneEmail}`);
  await page.getByRole('button', { name: 'Save progress', exact: true }).click();
  await expect(page.getByText('2 contacts saved')).toBeVisible();
  const photo = new PNG({ width: 16, height: 16 });
  photo.data.fill(255);
  await page.getByLabel(/^Athlete photo/).setInputFiles({
    name: 'fictional-photo.png',
    mimeType: 'image/png',
    buffer: PNG.sync.write(photo),
  });
  await page
    .getByLabel('Your message to supporters')
    .fill('Fictional review: thank you for helping our team train.');
  await page.getByLabel(/I have athlete\/guardian authorization/).check();
  await page.getByRole('button', { name: 'Save & return later', exact: true }).click();
  await expect(page.getByText('Progress saved.', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Your message to supporters')).toHaveValue(
    'Fictional review: thank you for helping our team train.',
  );
  await page.getByRole('button', { name: 'Done →', exact: true }).click();
  const publicPath = `/c/${campaign.slug}/a/${first.athlete.id}`;
  await expect(page.getByLabel('Public fundraising URL')).toHaveValue(base + publicPath);
  assert.equal((await detail()).jobs.length, 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: 'artifacts/hosted-review/athlete-mobile.png', fullPage: true });
  await approve(first);
  await api(`/api/athlete/${second.privatePath.split('/').at(-1)}`, 'PATCH', {
    emails: `${sharedEmail}; ${secondEmail}`,
    message: 'Fictional team message.',
    authorization: true,
    done: true,
  });
  await approve(second);
  assert.equal((await detail()).jobs.length, 0);
  record(
    '390px athlete saves/reloads photo and message, completes with two contacts; preparation sends nothing.',
  );

  await action('launch');
  let d = await detail();
  assert.equal(d.contacts.length, 3);
  assert.equal(d.jobs.length, 9);
  assert.equal(d.contacts.find((c) => c.email === sharedEmail).athleteIds.length, 2);
  record(
    'Launch queues one Day 1/10/20 sequence per normalized contact, preserving shared athlete associations.',
  );

  const payload = {
    requestId: randomUUID(),
    amount: 25,
    method: 'stripe',
    email: sharedEmail,
    athleteId: first.athlete.id,
  };
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, () => api(`/api/public/${campaign.slug}/donations`, 'POST', payload)),
  );
  assert.equal(new Set(concurrent.map((r) => r.donation.id)).size, 1);
  assert.equal(new Set(concurrent.map((r) => r.receiptToken)).size, 1);
  await Promise.all(
    Array.from({ length: 6 }, () =>
      api('/api/simulator/payments', 'POST', {
        receiptToken: concurrent[0].receiptToken,
        eventId: 'concurrent-' + payload.requestId,
      }),
    ),
  );
  d = await detail();
  assert.equal(d.totals.grossCents, 2500);
  assert.equal(d.ledger.length, 1);
  assert.equal(d.audit.length, 1);
  assert.equal(d.jobs.filter((j) => j.type === 'thank-you').length, 1);
  assert.equal(d.contacts.find((c) => c.email === sharedEmail).state, 'donated');
  record(
    'Six simultaneous donation requests and six repeated payment events produce one entry, audit and thank-you.',
  );

  const external = await api(`/api/public/${campaign.slug}/donations`, 'POST', {
    requestId: randomUUID(),
    amount: 40,
    method: 'venmo',
    email: secondEmail,
    intent: true,
  });
  assert.equal((await detail()).contacts.find((c) => c.email === secondEmail).state, 'active');
  await api(`/api/receipt/${external.receiptToken}/report`, 'POST', {
    requestId: randomUUID(),
    amount: 40,
    transaction: 'FICTIONAL-' + external.donation.id,
  });
  d = await detail();
  assert.equal(d.totals.grossCents, 2500);
  assert.equal(d.contacts.find((c) => c.email === secondEmail).state, 'pending');
  record('Reported Venmo pauses reminders without increasing confirmed revenue.');

  const oneContact = d.contacts.find((c) => c.email === oneEmail);
  const unsubscribePath = d.jobs
    .find((j) => j.contactId === oneContact.id)
    .body.match(/Unsubscribe: (\/unsubscribe\/[^\s]+)/)[1];
  await api('/api' + unsubscribePath, 'POST', {});
  await action('pause');
  await action('advance', { days: 11 });
  d = await detail();
  assert.equal(d.contacts.find((c) => c.email === secondEmail).state, 'pending');
  assert.equal(d.contacts.find((c) => c.id === oneContact.id).state, 'suppressed');
  await action('resume');
  await api(`/api/athlete/${first.privatePath.split('/').at(-1)}`, 'PATCH', { emails: lateEmail });
  d = await detail();
  const late = d.contacts.find((c) => c.email === lateEmail);
  assert.deepEqual(
    d.jobs
      .filter((j) => j.contactId === late.id)
      .map((j) => j.day)
      .sort((a, b) => a - b),
    [1, 20],
  );
  assert.ok(
    d.jobs.filter((j) => j.contactId === oneContact.id).every((j) => j.status === 'blocked'),
  );
  record(
    'Unsubscribe persists; pause/resume and late contact avoid an overdue reminder burst; pending stays paused.',
  );

  await page.goto(base + publicPath);
  stage = 'public donor form';
  await expect(page.getByLabel('Card · simulated Stripe', { exact: true })).toBeChecked();
  await page.getByLabel('Your name', { exact: true }).fill('Fictional hosted donor');
  await page.getByLabel('Email', { exact: true }).fill('browser-hosted@example.test');
  await page
    .getByRole('button', { name: 'Start simulated card contribution →', exact: true })
    .click();
  await expect(page.getByText('Simulated checkout ready.')).toBeVisible();
  stage = 'simulated card confirmation';
  await page.getByRole('button', { name: 'Simulate verified payment', exact: true }).click();
  await expect(page.getByText('Your demo contribution is confirmed.')).toBeVisible();
  const publicURL = await page.getByLabel('Public fundraising URL').inputValue();
  assert.equal(publicURL, base + publicPath);
  assert.equal(
    new URL(
      await page.getByRole('link', { name: 'Facebook', exact: true }).getAttribute('href'),
    ).searchParams.get('u'),
    publicURL,
  );
  const download = page.waitForEvent('download');
  stage = 'QR graphic download';
  await page.getByRole('button', { name: 'Instagram QR graphic ↓', exact: true }).click();
  await (await download).saveAs('artifacts/hosted-review/instagram-qr.png');
  const graphic = PNG.sync.read(readFileSync('artifacts/hosted-review/instagram-qr.png'));
  const qr = jsQR(new Uint8ClampedArray(graphic.data), graphic.width, graphic.height);
  assert.equal(qr?.data, publicURL);
  assert.equal((await fetch(publicURL)).status, 200);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: 'artifacts/hosted-review/donor-mobile.png', fullPage: true });
  record(
    'Hosted donor UI confirms simulated card payment; public/Facebook links and decoded QR target the correct HTTPS page.',
  );

  await page.goto(base + '/admin');
  stage = 'administrator browser sign-in';
  await page.getByLabel('Review password').fill(credentials.password);
  await page.getByRole('button', { name: 'Open administration →', exact: true }).click();
  await page.getByRole('combobox', { name: 'Campaign', exact: true }).selectOption(campaign.id);
  const adminNav = page.getByRole('navigation', { name: 'Administrator sections' });
  await expect(adminNav.getByRole('button')).toHaveCount(4);
  for (const name of ['Dashboard', 'Athletes', 'Donations', 'Campaign Settings'])
    await expect(adminNav.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close campaign', exact: true })).toBeHidden();
  await page.screenshot({ path: 'artifacts/hosted-review/dashboard-mobile.png', fullPage: true });
  stage = 'administrator ledger';
  await page.getByRole('button', { name: /^Review reported payments/ }).click();
  await expect(page.getByText(external.donation.reference, { exact: true })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: 'artifacts/hosted-review/admin-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Athletes', exact: true }).click();
  await expect(page.getByLabel('CSV roster')).toBeHidden();
  await page.getByRole('button', { name: 'Campaign Settings', exact: true }).click();
  await page.getByText('Email & activity', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run email worker', exact: true })).toBeHidden();
  await page.getByText('Prototype testing', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run email worker', exact: true })).toBeVisible();
  const century = (await api('/api/examples')).campaigns.find((c) =>
    c.organizationName.includes('Century'),
  );
  const centuryView = await api(`/api/public/${century.slug}`);
  assert.equal(
    (await raw(`/api/admin/campaigns/${centuryView.campaign.id}`, 'PATCH', { name: 'intrusion' }))
      .status,
    404,
  );
  assert.equal(
    (await raw(`/api/athlete/${first.athlete.id}`, 'PATCH', { done: true })).status,
    404,
  );
  const publicData = JSON.stringify(await api(`/api/public/${campaign.slug}`));
  assert.ok(!publicData.includes(sharedEmail) && !publicData.includes(first.privatePath));
  record(
    '390px four-section admin, reported-payment shortcut, collapsed roster import and prototype tools work; org/public-ID isolation holds.',
  );

  await action('close');
  const confirmation = {
    requestId: randomUUID(),
    action: 'confirm',
    method: 'venmo',
    amount: 40,
    fee: '',
    receivedDate: campaign.startDate,
    transaction: 'FICTIONAL-' + external.donation.id,
    note: 'Fictional hosted verification evidence. No money received.',
  };
  await api(
    `/api/admin/campaigns/${campaign.id}/ledger/${external.donation.id}`,
    'POST',
    confirmation,
  );
  await api(
    `/api/admin/campaigns/${campaign.id}/ledger/${external.donation.id}`,
    'POST',
    confirmation,
  );
  d = await detail();
  assert.equal(d.totals.grossCents, 11500);
  assert.equal(d.audit.length, 3);
  assert.equal(d.totals.unknownFeeCount, 1);
  assert.ok(
    d.jobs
      .filter((j) => j.type === 'solicitation')
      .every((j) => ['sent', 'skipped', 'blocked'].includes(j.status)),
  );
  assert.equal(
    (
      await raw(`/api/public/${campaign.slug}/donations`, 'POST', {
        ...payload,
        requestId: randomUUID(),
      })
    ).status,
    400,
  );
  const csv = await raw(`/api/admin/campaigns/${campaign.id}/export`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.equal(pageErrors.length, 0);
  record(
    'Closed campaign stops solicitations; pending manual confirmation remains retry-safe, audited and fee-unknown; CSV export works.',
  );
  writeFileSync(
    'artifacts/hosted-review/results.json',
    JSON.stringify(
      { base, at: new Date().toISOString(), publicPath, campaignStatus: d.status, results },
      null,
      2,
    ),
  );
  console.log(
    'Hosted verification passed. Fictional verification campaign is closed; sample campaigns remain untouched.',
  );
} catch (error) {
  // Avoid assertion dumps, URLs, bodies or capabilities in command output.
  console.error(
    'Hosted verification failed at',
    stage,
    ':',
    error.name,
    error.message.split('\n')[0].replaceAll(credentials.password, '[redacted]'),
  );
  await page
    .screenshot({ path: 'artifacts/hosted-review/failure.png', fullPage: true })
    .catch(() => {});
  if (campaign) await action('close').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
