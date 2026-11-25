import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import Stripe from 'stripe';
import { createApp } from '../server/app.js';
import { createStripeSandboxClient, stripeSandboxEvents } from '../server/stripe-client.js';
import { createStripeSandboxSeed } from '../server/stripe-sandbox.js';

const key = process.env.RALLYFUND_STRIPE_TEST_KEY;
if (!/^(?:[rs]k|rkcs)_test_[a-zA-Z0-9]+$/.test(key || ''))
  throw new Error('Set a Stripe sandbox test key before running this rehearsal.');
if (!existsSync('dist/index.html'))
  throw new Error('Build RallyFund before running the rehearsal.');

const stripe = new Stripe(key);
const server = createServer();
const directory = `.local/stripe-handoff-rehearsals/${randomUUID()}`;
const cli =
  process.env.RALLYFUND_STRIPE_CLI ||
  (existsSync('.local/stripe-tools/stripe.exe') ? '.local/stripe-tools/stripe.exe' : 'stripe');
const credentials = { email: 'coach@tvvc.example', password: 'prototype-only' };
let browser,
  listener,
  stage = 'starting the isolated sandbox';

async function listenForStripe(origin) {
  listener = spawn(
    cli,
    [
      'listen',
      '--latest',
      '--skip-update',
      '--events',
      stripeSandboxEvents.join(','),
      '--forward-to',
      `${origin}/api/stripe-sandbox/webhook`,
    ],
    { env: { ...process.env, STRIPE_API_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Stripe CLI did not start listening for test events.')),
      15000,
    );
    let buffer = '';
    const receive = (bytes) => {
      buffer = (buffer + bytes.toString()).slice(-8192);
      const secret = buffer.match(/whsec_[a-zA-Z0-9]+/)?.[0];
      if (secret) {
        clearTimeout(timer);
        buffer = '';
        resolve(secret);
      }
    };
    listener.stdout.on('data', receive);
    listener.stderr.on('data', receive);
    for (const event of ['error', 'exit'])
      listener.once(event, () => {
        clearTimeout(timer);
        reject(new Error('Stripe CLI exited before connecting to the sandbox.'));
      });
  });
}

async function checked(response, expected = 200) {
  assert.equal(response.status(), expected);
  return response.json();
}

async function enterTestCard(page, cardholder) {
  const frame = page.frameLocator('iframe[src*="elements-inner-habanero"]');
  const number = frame.getByRole('textbox', { name: 'Card number', exact: true });
  const chooseCard = frame.getByRole('button', { name: 'Card', exact: true });
  await number.or(chooseCard).first().waitFor({ timeout: 20000 });
  if (!(await number.isVisible())) await chooseCard.click();
  await expect(
    frame.getByRole('button', { name: /Klarna|Affirm|Cash App|Pay securely with Link|Bank \$/i }),
  ).toHaveCount(0);
  await number.fill('4242424242424242');
  const expiration = frame.getByRole('textbox', { name: 'Expiration (MM/YY)', exact: true });
  await expiration.fill('12 / 30');
  await expect(expiration).toHaveValue(/12\s*\/\s*30/);
  await frame.getByRole('textbox', { name: 'Security code', exact: true }).fill('123');
  await frame.getByRole('textbox', { name: 'Name on card', exact: true }).fill(cardholder);
  await frame.getByRole('combobox', { name: 'Country', exact: true }).selectOption('US');
  const zip = frame.locator('input[name="postalCode"]');
  if (await zip.isVisible()) await zip.fill('97006');
  const optIn = frame.locator('input[name="linkOptIn"]');
  if ((await optIn.isVisible()) && (await optIn.isChecked())) await optIn.uncheck();
  await frame.getByRole('button', { name: 'Pay', exact: true }).click();
  return frame;
}

try {
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const webhookSecret = await listenForStripe(origin);
  const { app } = createApp({
    directory,
    seed: createStripeSandboxSeed(),
    allowedOrigins: [origin],
    stripeSandbox: createStripeSandboxClient({ key, webhookSecret, origin }),
  });
  server.on('request', app);
  const headers = { Origin: origin, 'X-Prototype': 'local' };
  browser = await chromium.launch({ headless: false });
  const coach = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const player = await browser.newPage({
    viewport: { width: 390, height: 844 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const donor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const admin = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const login = async (page) =>
    checked(await page.request.post(origin + '/api/login', { headers, data: credentials }));
  const campaign = async (page) =>
    (await checked(await page.request.get(origin + '/api/admin'))).campaigns[0];

  stage = 'coach issues the link and approves the fictional player';
  await login(coach);
  const initial = await campaign(coach);
  const athlete = initial.athletes[0];
  await coach.goto(origin + '/admin');
  await coach.getByRole('button', { name: 'Athletes', exact: true }).click();
  await coach.locator('.athlete-detail > summary').click();
  await coach.getByRole('button', { name: 'Issue private setup link', exact: true }).click();
  const invite = await coach.getByLabel(/Private setup URL for/).inputValue();
  await player.goto(invite);
  await expect(player.getByLabel('Paste donor email addresses')).toHaveCount(0);
  await player.getByLabel('Public display name').fill('Sample Jordan K.');
  await player.getByLabel('Your message to supporters').fill('Fictional TVVC handoff rehearsal.');
  await player.getByLabel(/I have athlete\/guardian authorization/).check();
  await player.getByRole('button', { name: 'Done →', exact: true }).click();
  await expect(player.getByRole('heading', { name: 'Waiting for coach approval' })).toBeVisible();
  await expect(player.getByLabel('Public fundraising URL')).toHaveCount(0);
  await coach.reload();
  await coach.getByRole('button', { name: 'Athletes', exact: true }).click();
  await coach.locator('.athlete-detail > summary').click();
  await coach
    .getByLabel(/Coach.s authorization record/)
    .fill('Fictional guardian release TEST-01.');
  await coach.getByRole('button', { name: 'Approve public content', exact: true }).click();
  await expect(coach.getByText('Public profile approved.', { exact: true })).toBeVisible();
  await coach.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await coach.getByRole('button', { name: 'Open test donations', exact: true }).click();
  await expect(
    coach.getByRole('button', { name: 'Stop test donations', exact: true }),
  ).toBeVisible();
  await player.getByRole('button', { name: 'Check approval status', exact: true }).click();
  await player.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(player.getByText('Public link copied.', { exact: true })).toBeVisible();
  const share = await player.evaluate(() => navigator.clipboard.readText());
  assert.equal(share, `${origin}/c/${initial.slug}/a/${athlete.id}`);

  stage = 'donor pays through a verified card-only Stripe Checkout Session';
  assert.equal((await donor.request.get(origin + '/api/admin')).status(), 401);
  await donor.goto(share);
  await expect(donor.getByRole('combobox', { name: 'Fundraising credit' })).toHaveValue(athlete.id);
  await donor.getByLabel('Custom contribution amount in dollars').fill('100');
  await donor.getByLabel('Your name', { exact: true }).fill('Fictional Handoff Donor');
  await donor.getByLabel('Email', { exact: true }).fill(`handoff-${randomUUID()}@example.com`);
  await donor.getByRole('button', { name: /Continue to Stripe test checkout/ }).click();
  await donor.waitForURL('https://checkout.stripe.com/**', { timeout: 20000 });
  const sessionId = new URL(donor.url()).pathname.split('/').at(-1);
  assert.match(sessionId, /^cs_test_/);
  const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
  assert.equal(stripeSession.livemode, false);
  assert.deepEqual(stripeSession.payment_method_types, ['card']);
  assert.equal(stripeSession.wallet_options?.link?.display, 'never');
  const cardForm = await enterTestCard(donor, 'Fictional Handoff Donor');
  try {
    await donor.waitForURL(
      (url) => url.origin === origin && url.pathname === new URL(share).pathname,
      { timeout: 45000, waitUntil: 'domcontentloaded' },
    );
  } catch (error) {
    const fieldState = await cardForm
      .locator('input:visible')
      .evaluateAll((inputs) =>
        inputs.map((input) => [input.name, input.value.length, input.getAttribute('aria-invalid')]),
      )
      .catch(() => []);
    console.error('Stripe form field lengths:', fieldState);
    throw error;
  }

  stage = 'a separate admin session reconciles and posts the dues credit';
  assert.equal((await admin.request.get(origin + '/api/admin')).status(), 401);
  await login(admin);
  const source = async () => (await campaign(admin)).ledger[0];
  const dues = async () => (await campaign(admin)).athletes[0].dues;
  await expect
    .poll(async () => (await source())?.feeCents, { timeout: 30000 })
    .toEqual(expect.any(Number));
  const paid = await source();
  assert.equal(paid.status, 'confirmed');
  const netCents = 10000 - paid.feeCents;
  assert.ok(netCents > 2500);
  await admin.goto(origin + '/admin');
  await admin.getByRole('button', { name: 'Dues', exact: true }).click();
  await admin.getByRole('combobox', { name: 'Contribution', exact: true }).selectOption(paid.id);
  await admin.getByLabel('Amount ($)', { exact: true }).fill((netCents / 100).toFixed(2));
  const reference = admin.getByLabel(/External posting.*reference/);
  await reference.fill(`FICTIONAL-POST-${randomUUID()}`);
  await admin.getByLabel('Dues audit note').fill('Matched the fictional dues statement.');
  await admin.getByRole('button', { name: 'Save dues action', exact: true }).click();
  await expect.poll(async () => (await dues()).appliedCents).toBe(netCents);

  stage = 'admin reconciles the partial refund and records the reversal receipt';
  const refund = await stripe.refunds.create(
    { charge: paid.transaction, amount: 2500 },
    { idempotencyKey: `handoff-refund:${paid.id}` },
  );
  assert.equal(refund.status, 'succeeded');
  await expect
    .poll(async () => (await dues()).awaitingReversalCents, { timeout: 30000 })
    .toBe(2500);
  assert.equal((await dues()).appliedCents, netCents - 2500);
  await admin.reload();
  await admin.getByRole('button', { name: 'Dues', exact: true }).click();
  await admin
    .getByRole('combobox', { name: 'Dues action', exact: true })
    .selectOption('reversal-posted');
  const reversal = (await dues()).entries.find((entry) => entry.type === 'reversal');
  await admin.getByRole('combobox', { name: /reversal/i }).selectOption(reversal.id);
  await reference.fill(`FICTIONAL-REVERSAL-${randomUUID()}`);
  await admin.getByLabel('Dues audit note').fill('Matched the fictional reversal statement.');
  await admin.getByRole('button', { name: 'Save dues action', exact: true }).click();
  await expect.poll(async () => (await dues()).awaitingReversalCents).toBe(0);

  stage = 'stop expires the open session and blocks new checkouts';
  const endpoint = `${origin}/api/public/${initial.slug}/donations`;
  const pledge = {
    requestId: randomUUID(),
    athleteId: athlete.id,
    method: 'stripe',
    amount: '28',
    email: `unpaid-${randomUUID()}@example.com`,
  };
  const open = await checked(await donor.request.post(endpoint, { headers, data: pledge }));
  const openId = new URL(open.checkoutUrl).pathname.split('/').at(-1);
  await coach.getByRole('button', { name: 'Stop test donations', exact: true }).click();
  await expect(coach.getByText('New test donations stopped.', { exact: true })).toBeVisible();
  assert.equal((await stripe.checkout.sessions.retrieve(openId)).status, 'expired');
  assert.equal(
    (
      await donor.request.post(endpoint, { headers, data: { ...pledge, requestId: randomUUID() } })
    ).status(),
    409,
  );
  const final = await campaign(admin);
  assert.equal(final.totals.grossCents, 7500);
  assert.equal(final.athletes[0].dues.appliedCents, netCents - 2500);
  assert.equal(
    final.athletes[0].dues.entries.filter((entry) => entry.type === 'reversal').length,
    1,
  );
  assert.equal(final.contacts.length, 0);
  assert.equal(final.jobs.length, 0);
  console.log(
    JSON.stringify({
      result: 'Coach-to-admin sandbox handoff passed',
      methods: stripeSession.payment_method_types,
      paidCents: 10000,
      feeCents: paid.feeCents,
      postedCents: netCents,
      refundedCents: 2500,
      finalCreditCents: netCents - 2500,
      reversalMatched: true,
      checkoutStopped: true,
      localEvidence: directory,
    }),
  );
} catch (error) {
  const message = String(error.message)
    .replace(/\/(?:join|receipt)\/[a-zA-Z0-9_-]+/g, '/[private path]')
    .replace(/https:\/\/checkout\.stripe\.com\/[^\s]+/g, '[checkout link]')
    .replace(/(?:[rs]k|rkcs|whsec)_[a-zA-Z0-9_]+/g, '[secret]');
  console.error(`Handoff failed while ${stage}: ${message.slice(0, 1000)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  listener?.kill();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
