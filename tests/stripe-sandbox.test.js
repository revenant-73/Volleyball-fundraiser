import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';
import { createApp } from '../server/app.js';
import { createStripeSandboxClient } from '../server/stripe-client.js';
import { createStripeSandboxSeed } from '../server/stripe-sandbox.js';

test('invite-only Stripe sandbox preserves payment, refund, and stop state across retries', async (t) => {
  const webhookSecret = 'whsec_fictionalsignaturefixture';
  const key = 'rk_test_fictionalfixture';
  const options = { key, webhookSecret, origin: 'http://127.0.0.1:5175' };
  const stripe = new Stripe(key);
  const { verifyWebhook } = createStripeSandboxClient(options);
  assert.throws(
    () => createStripeSandboxClient({ ...options, key: key.replace('_test_', '_live_') }),
    /test API key/,
  );
  const seed = createStripeSandboxSeed();
  const [campaign] = seed.state.campaigns;
  const [player] = seed.state.athletes;
  const folder = mkdtempSync(path.resolve('.local-test-stripe-'));
  let sessionCreations = 0;
  let creationPaused;
  let expireAttempts = 0;
  let expiryAvailable = false;
  let feeCents = null;
  let refundedCents = 0;
  const checkout = {
    id: 'cs_test_fictionalfixture',
    url: 'https://checkout.stripe.com/c/pay/cs_test_fictionalfixture',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
  const stripeSandbox = {
    verifyWebhook,
    async createCheckout() {
      sessionCreations++;
      if (creationPaused) {
        creationPaused.notify();
        await creationPaused.wait;
      }
      return sessionCreations === 1
        ? checkout
        : { ...checkout, id: `${checkout.id}${sessionCreations}` };
    },
    async expireCheckout(id) {
      expireAttempts++;
      if (id === `${checkout.id}2`) return 'complete';
      if (!expiryAvailable) throw new Error('Simulated Stripe outage');
      return 'expired';
    },
    async paymentForEvent(event, findDonation) {
      const d = findDonation(event.data.object.metadata.rallyfund_donation_id);
      return {
        donationId: d.id,
        sessionId: d.stripeCheckout.id,
        campaignId: d.campaignId,
        athleteId: d.athleteId,
        amountCents: d.amountCents,
        chargeId: `ch_fixture_${d.stripeCheckout.id}`,
        paymentIntentId: `pi_fixture_${d.stripeCheckout.id}`,
        receivedDate: '2026-11-24',
        feeCents,
        refundedCents,
      };
    },
  };

  let origin, server, cookie;
  async function start() {
    const runtime = createApp({ directory: folder, seed, stripeSandbox, staticFiles: false });
    server = runtime.app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  const stop = () => new Promise((resolve) => server.close(resolve));
  await start();
  t.after(stop);
  const request = (route, method = 'GET', body, headers = {}) =>
    fetch(origin + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Prototype': 'local',
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const donationPath = `/api/public/${campaign.slug}/donations`;
  const pledge = {
    requestId: randomUUID(),
    athleteId: player.id,
    method: 'stripe',
    donorName: 'Fictional donor',
    email: 'donor@example.com',
    amount: '100',
  };
  const base = `/api/admin/campaigns/${campaign.id}`;
  const publicPath = `/api/public/${campaign.slug}?athlete=${player.id}`;
  const stopPath = `${base}/stop-donations`;
  assert.deepEqual(await (await request('/api/examples')).json(), { campaigns: [] });
  assert.equal((await request(publicPath)).status, 404);
  assert.equal((await request(donationPath, 'POST', pledge)).status, 409);
  assert.equal((await request(stopPath, 'POST', {})).status, 401);
  const login = await request('/api/login', 'POST', {
    email: 'coach@tvvc.example',
    password: 'prototype-only',
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const detail = async () => (await (await request('/api/admin')).json()).campaigns[0];
  const balances = async () => (await detail()).athletes[0].dues;
  assert.equal((await detail()).athletes[0].privatePath, undefined);
  assert.equal((await request('/api/admin/campaigns', 'POST', {})).status, 403);
  assert.equal((await request(`${base}/duplicate`, 'POST', {})).status, 403);
  assert.equal((await request(`${base}/action`, 'POST', { action: 'launch' })).status, 409);
  const invite = await request(`${base}/athletes/${player.id}/invite`, 'POST', {});
  assert.equal(invite.status, 200);
  const privatePath = '/api/athlete/' + (await invite.json()).privatePath.split('/').at(-1);
  const setup = { message: 'Fictional test player', authorization: true, done: true };
  assert.equal(
    (await request(privatePath, 'PATCH', { ...setup, emails: 'fake@example.test' })).status,
    403,
  );
  const completed = await request(privatePath, 'PATCH', setup);
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).publicPath, undefined);
  assert.equal((await request(publicPath)).status, 404);
  const approved = await request(`${base}/athletes/${player.id}/approve`, 'POST', {
    approved: true,
    authorizationNote: 'Fictional guardian approved this profile.',
  });
  assert.equal(approved.status, 200);
  assert.ok((await (await request(privatePath)).json()).publicPath);
  assert.equal((await request(publicPath)).status, 200);
  assert.equal((await request(donationPath, 'POST', pledge)).status, 409);
  assert.equal((await request(`${base}/action`, 'POST', { action: 'launch' })).status, 200);
  const firstResponse = await request(donationPath, 'POST', pledge);
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.donation.status, 'pending');
  assert.equal(first.checkoutUrl, checkout.url);
  assert.deepEqual(await (await request(donationPath, 'POST', pledge)).json(), first);
  assert.equal(sessionCreations, 1);
  assert.equal((await request(donationPath, 'POST', { ...pledge, amount: '110' })).status, 409);
  assert.equal(
    (
      await request('/api/simulator/payments', 'POST', {
        receiptToken: first.receiptToken,
        eventId: randomUUID(),
      })
    ).status,
    400,
  );

  const event = (id, type, livemode = false) => ({
    id,
    type,
    livemode,
    data: {
      object: { id: checkout.id, metadata: { rallyfund_donation_id: first.donation.id } },
    },
  });
  const webhook = (payload, signed = true) =>
    fetch(origin + '/api/stripe-sandbox/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signed
          ? stripe.webhooks.generateTestHeaderString({
              payload: JSON.stringify(payload),
              secret: webhookSecret,
            })
          : 'not-signed',
      },
      body: JSON.stringify(payload),
    });
  const paid = event('evt_paid1', 'checkout.session.completed');
  assert.equal((await webhook(paid, false)).status, 401);
  assert.equal((await webhook(event('evt_live1', 'checkout.session.completed', true))).status, 400);
  assert.equal((await balances()).pendingCents, 10000);
  const duplicates = await Promise.all([webhook(paid), webhook(paid)]);
  assert.ok(duplicates.every((response) => response.status === 200));
  assert.equal((await balances()).availableCents, 0);
  assert.equal((await balances()).awaitingFeeCents, 10000);

  feeCents = 320;
  assert.equal((await webhook(event('evt_fee1', 'charge.updated'))).status, 200);
  const ready = await balances();
  assert.equal(ready.availableCents, 9680);
  const duesPath = `/api/admin/campaigns/${campaign.id}/dues/${player.id}`;
  const post = {
    action: 'post',
    requestId: randomUUID(),
    version: ready.version,
    amount: '96.80',
    donationId: first.donation.id,
    reference: 'Fictional statement posting',
    note: 'Matched fictional ledger.',
  };
  assert.equal((await request(duesPath, 'POST', post)).status, 200);
  assert.equal((await request(duesPath, 'POST', post)).status, 200);

  refundedCents = 2500;
  const refund = event('evt_refund1', 'refund.created');
  const refundDeliveries = await Promise.all([
    webhook(refund),
    webhook(refund),
    webhook(event('evt_refund2', 'charge.refunded')),
  ]);
  assert.ok(refundDeliveries.every((response) => response.status === 200));

  const finishedAtStripe = await request(donationPath, 'POST', {
    ...pledge,
    amount: '20',
    requestId: randomUUID(),
  });
  assert.equal(finishedAtStripe.status, 200);
  const delayed = (await finishedAtStripe.json()).donation;
  let resumeCreation;
  let notifyCreation;
  const creationStarted = new Promise((resolve) => {
    notifyCreation = resolve;
  });
  creationPaused = {
    notify: notifyCreation,
    wait: new Promise((resolve) => {
      resumeCreation = resolve;
    }),
  };
  const racing = request(donationPath, 'POST', { ...pledge, requestId: randomUUID() });
  await creationStarted;
  const stopping = request(stopPath, 'POST', {});
  try {
    for (let attempt = 0; attempt < 20 && !(await detail()).donationsStoppedAt; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok((await detail()).donationsStoppedAt);
    assert.equal((await request(donationPath, 'POST', pledge)).status, 409);
  } finally {
    resumeCreation();
  }
  assert.equal((await racing).status, 409);
  const stopped = await stopping;
  assert.equal(stopped.status, 200);
  assert.equal((await stopped.json()).checkoutsToClose, 1);
  assert.equal(expireAttempts, 2);
  await stop();
  await start();
  expiryAvailable = true;
  assert.equal(
    (await request(donationPath, 'POST', { ...pledge, requestId: randomUUID() })).status,
    409,
  );
  const retried = await request(stopPath, 'POST', {});
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).checkoutsToClose, 0);
  assert.equal(expireAttempts, 3);
  assert.equal((await request(`${base}/action`, 'POST', { action: 'launch' })).status, 409);
  assert.equal((await (await request(publicPath)).json()).donationsStopped, true);
  assert.equal((await webhook(paid)).status, 200);
  assert.equal((await webhook(refund)).status, 200);
  refundedCents = 0;
  assert.equal((await webhook(event('evt_old1', 'charge.updated'))).status, 200);
  const final = await balances();
  assert.equal(final.grossCents, 7500);
  assert.equal(final.refundedCents, 2500);
  assert.equal(final.appliedCents, 7180);
  assert.equal(final.remainingCents, 92820);
  assert.equal(final.awaitingReversalCents, 2500);
  assert.equal(final.entries.filter((e) => e.type === 'credit').length, 1);
  assert.equal(final.entries.filter((e) => e.type === 'reversal').length, 1);
  const campaignAfter = await detail();
  assert.equal(campaignAfter.contacts.length, 0);
  assert.equal(campaignAfter.jobs.length, 0);
  assert.equal(campaignAfter.ledger.filter((d) => d.status === 'confirmed').length, 1);
  assert.equal(campaignAfter.ledger.filter((d) => d.status === 'rejected').length, 1);
  assert.equal(campaignAfter.audit.filter((a) => a.action === 'stripe-sandbox-refund').length, 1);
  assert.equal(campaignAfter.ledger.find((d) => d.id === delayed.id).status, 'pending');
  const delayedEvent = event('evt_delayed1', 'checkout.session.completed');
  delayedEvent.data.object = {
    id: `${checkout.id}2`,
    metadata: { rallyfund_donation_id: delayed.id },
  };
  assert.equal((await webhook(delayedEvent)).status, 200);
  assert.equal((await webhook(delayedEvent)).status, 200);
  assert.equal((await balances()).grossCents, 9500);
  assert.equal((await balances()).appliedCents, 7180);
});
