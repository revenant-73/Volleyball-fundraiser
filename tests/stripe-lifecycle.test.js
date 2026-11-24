import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { createApp } from '../server/app.js';
import { createStripeSandboxClient } from '../server/stripe-client.js';
import { createStripeSandboxSeed } from '../server/stripe-sandbox.js';

test('signed Stripe lifecycle events distinguish declines, expiry, stops and dispute outcomes', async (t) => {
  const key = 'rk_test_fictionalfixture';
  const secret = 'whsec_fictionalcheckoutfixture';
  const stripe = new Stripe(key);
  const sessions = new Map();
  let nextSession = 0;
  let disputeReadAvailable = true;
  const providerFetch = async (url, options) => {
    const { pathname, searchParams } = new URL(url);
    const json = (object) => Response.json(object, { headers: { 'request-id': 'req_fixture' } });
    if (pathname === '/v1/checkout/sessions' && options.method === 'POST') {
      const form = new URLSearchParams(options.body);
      const n = ++nextSession;
      const id = `cs_test_fixture${n}`;
      const amount = Number(form.get('line_items[0][price_data][unit_amount]'));
      const metadata = Object.fromEntries(
        [...form]
          .filter(([key]) => key.startsWith('metadata['))
          .map(([key, value]) => [key.slice(9, -1), value]),
      );
      const charge = {
        id: `ch_fixture${n}`,
        payment_intent: `pi_fixture${n}`,
        metadata,
        livemode: false,
        created: 1795510800,
        currency: 'usd',
        amount_captured: amount,
        amount_refunded: 0,
        captured: true,
        paid: true,
        disputed: false,
        balance_transaction: { currency: 'usd', source: `ch_fixture${n}`, amount, fee: 320 },
      };
      const session = {
        id,
        livemode: false,
        currency: 'usd',
        status: 'open',
        payment_status: 'unpaid',
        amount_total: amount,
        client_reference_id: form.get('client_reference_id'),
        metadata,
        expires_at: Number(form.get('expires_at')),
        url: `https://checkout.stripe.com/c/pay/${id}`,
        payment_intent: {
          id: charge.payment_intent,
          livemode: false,
          status: 'requires_payment_method',
          currency: 'usd',
          amount_received: 0,
          metadata,
          latest_charge: charge,
        },
      };
      sessions.set(id, { session, charge, disputes: [] });
      return json(session);
    }
    const [, sessionId, expire] =
      /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(pathname) || [];
    if (sessionId) {
      const { session } = sessions.get(sessionId);
      if (expire) {
        assert.equal(session.status, 'open');
        session.status = 'expired';
      }
      return json(session);
    }
    if (pathname.startsWith('/v1/charges/')) {
      return json(
        [...sessions.values()].find(({ charge }) => charge.id === pathname.split('/').at(-1))
          .charge,
      );
    }
    if (pathname === '/v1/disputes') {
      if (!disputeReadAvailable)
        return Response.json(
          { error: { message: 'Fixture dispute read unavailable' } },
          { status: 403 },
        );
      const row = [...sessions.values()].find(
        ({ charge }) => charge.id === searchParams.get('charge'),
      );
      return json({ object: 'list', has_more: false, data: row.disputes });
    }
    assert.fail('Unexpected Stripe endpoint: ' + pathname);
  };
  const seed = createStripeSandboxSeed();
  const [campaign] = seed.state.campaigns;
  const [player] = seed.state.athletes;
  Object.assign(player, {
    completed: true,
    approved: true,
    authorization: true,
    approvedProfile: { displayName: 'Fictional Player', photo: '', message: '' },
  });
  campaign.status = 'active';
  const { app } = createApp({
    seed,
    staticFiles: false,
    stripeSandbox: createStripeSandboxClient({
      key,
      webhookSecret: secret,
      origin: 'http://127.0.0.1:5175',
      httpClient: Stripe.createFetchHttpClient(providerFetch),
    }),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  const request = (route, method = 'GET', data) =>
    fetch(base + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Prototype': 'local',
        ...(cookie ? { cookie } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const data = async (response, status = 200) => {
    const r = await response;
    assert.equal(r.status, status);
    return r.json();
  };
  const login = await request('/api/login', 'POST', {
    email: 'coach@tvvc.example',
    password: 'prototype-only',
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const detail = async () => (await data(request('/api/admin'))).campaigns[0];
  const balances = async () => (await detail()).athletes[0].dues;
  const checkoutPath = `/api/public/${campaign.slug}/donations`;
  const pledge = (amount = '100') => ({
    requestId: randomUUID(),
    athleteId: player.id,
    amount,
    email: 'test@example.com',
    method: 'stripe',
  });
  async function start(amount) {
    const created = await data(request(checkoutPath, 'POST', pledge(amount)));
    return {
      ...created,
      ...sessions.get(new URL(created.checkoutUrl).pathname.split('/').at(-1)),
    };
  }
  const receipt = async (checkout) =>
    (await data(request(`/api/receipt/${checkout.receiptToken}`))).donation;
  let nextEvent = 0;
  const event = (type, object) => ({
    id: `evt_fixture${++nextEvent}`,
    type,
    livemode: false,
    data: { object },
  });
  const emit = async (event, status = 200) => {
    const payload = JSON.stringify(event);
    return data(
      fetch(base + '/api/stripe-sandbox/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': stripe.webhooks.generateTestHeaderString({ payload, secret }),
        },
        body: payload,
      }),
      status,
    );
  };
  function pay(row) {
    row.session.status = 'complete';
    row.session.payment_status = 'paid';
    row.session.payment_intent.status = 'succeeded';
    row.session.payment_intent.amount_received = row.session.amount_total;
  }
  const disputed = await start();
  const decline = event('payment_intent.payment_failed', disputed.session.payment_intent);
  await Promise.all([emit(decline), emit(decline)]);
  assert.equal((await receipt(disputed)).status, 'pending');
  assert.equal((await receipt(disputed)).stripeCheckoutState, 'declined');
  assert.equal((await balances()).grossCents, 0);
  pay(disputed);
  await emit(event('checkout.session.completed', disputed.session));
  await emit(event('payment_intent.payment_failed', disputed.session.payment_intent));
  assert.equal((await receipt(disputed)).status, 'confirmed');

  const abandoned = await start('12');
  abandoned.session.status = 'expired';
  await emit(event('checkout.session.expired', abandoned.session));
  assert.equal((await receipt(abandoned)).status, 'rejected');
  assert.equal((await receipt(abandoned)).stripeCheckoutState, 'expired');

  const failed = await start('13');
  failed.session.status = 'complete';
  failed.session.payment_intent.status = 'processing';
  await emit(event('checkout.session.completed', failed.session));
  assert.equal((await receipt(failed)).stripeCheckoutState, 'processing');
  failed.session.payment_intent.status = 'requires_payment_method';
  await emit(event('checkout.session.async_payment_failed', failed.session));
  await emit(event('checkout.session.completed', failed.session));
  assert.equal((await receipt(failed)).status, 'rejected');
  assert.equal((await receipt(failed)).stripeCheckoutState, 'failed');

  const duesPath = `/api/admin/campaigns/${campaign.id}/dues/${player.id}`;
  await data(
    request(duesPath, 'POST', {
      action: 'post',
      requestId: randomUUID(),
      version: (await balances()).version,
      amount: '96.80',
      donationId: disputed.donation.id,
      reference: 'Fictional statement evidence',
      note: 'Posted prior to the dispute.',
    }),
  );
  const setDispute = (id, status, amount = 2500) => {
    disputed.charge.disputed = true;
    const item = {
      id,
      status,
      amount,
      currency: 'usd',
      livemode: false,
      charge: disputed.charge.id,
    };
    const index = disputed.disputes.findIndex((row) => row.id === id);
    if (index < 0) disputed.disputes.push(item);
    else disputed.disputes[index] = item;
    return item;
  };
  const firstDispute = event('charge.dispute.created', setDispute('dp_win1', 'needs_response'));
  disputeReadAvailable = false;
  await emit(firstDispute, 503);
  await emit(firstDispute, 503);
  assert.equal((await balances()).eligibleCents, 0);
  assert.equal((await balances()).appliedCents, 9680);
  assert.equal(
    (await detail()).audit.filter((a) => a.action === 'stripe-sandbox-dispute').length,
    1,
  );
  disputeReadAvailable = true;
  await emit(firstDispute);
  assert.equal((await balances()).disputedCents, 2500);
  assert.equal((await balances()).eligibleCents, 7180);
  assert.equal((await balances()).appliedCents, 9680);
  await emit(event('charge.dispute.closed', setDispute('dp_win1', 'won')));
  assert.equal((await balances()).disputedCents, 0);
  assert.equal((await balances()).eligibleCents, 9680);
  assert.equal((await balances()).awaitingReversalCents, 0);
  const oldDispute = event('charge.dispute.created', setDispute('dp_loss1', 'needs_response'));
  await emit(oldDispute);
  const loss = event('charge.dispute.closed', setDispute('dp_loss1', 'lost'));
  await Promise.all([emit(loss), emit(loss)]);
  await emit(event('charge.dispute.updated', oldDispute.data.object));
  assert.equal((await balances()).appliedCents, 7180);
  assert.equal((await balances()).awaitingReversalCents, 2500);
  assert.equal((await balances()).refundedCents, 2500);
  assert.equal((await balances()).entries.filter((e) => e.type === 'reversal').length, 1);

  const inFlight = await start('40');
  inFlight.session.status = 'complete';
  inFlight.session.payment_intent.status = 'processing';
  await emit(event('checkout.session.completed', inFlight.session));
  const open = await start('41');
  const processingOpen = await start('42');
  processingOpen.session.payment_intent.status = 'processing';
  await data(request(`/api/admin/campaigns/${campaign.id}/stop-donations`, 'POST', {}));
  assert.equal(open.session.status, 'expired');
  assert.equal(processingOpen.session.status, 'open');
  assert.equal((await receipt(processingOpen)).stripeCheckoutState, 'processing');
  assert.equal((await receipt(inFlight)).stripeCheckoutState, 'processing');
  assert.equal((await receipt(inFlight)).status, 'pending');
  assert.equal((await request(checkoutPath, 'POST', pledge())).status, 409);
  pay(inFlight);
  const lateSuccess = event('checkout.session.async_payment_succeeded', inFlight.session);
  await Promise.all([emit(lateSuccess), emit(lateSuccess)]);
  assert.equal((await receipt(inFlight)).status, 'confirmed');
  processingOpen.session.payment_intent.status = 'requires_payment_method';
  await emit(event('payment_intent.payment_failed', processingOpen.session.payment_intent));
  assert.equal(processingOpen.session.status, 'expired');
  assert.equal((await receipt(processingOpen)).stripeCheckoutState, 'expired');
  const result = await balances();
  assert.equal(result.grossCents, 11500);
  assert.equal(result.pendingCents, 0);
  assert.equal(result.appliedCents, 7180);
});
