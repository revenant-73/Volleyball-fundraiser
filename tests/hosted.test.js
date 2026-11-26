import test from 'node:test';
import assert from 'node:assert/strict';
import { NetlifyDB } from '@netlify/database-dev';
import pg from 'pg';
import Stripe from 'stripe';
import { createHostedHandler, transactSnapshot } from '../server/hosted.js';
import { createStripeSandboxClient, STRIPE_QA_ORIGIN } from '../server/stripe-client.js';
import { assertStripeQaContext, STRIPE_QA_MODE, STRIPE_QA_SITE } from '../server/stripe-qa.js';
import { QA_COACH, QA_DUES_ADMIN } from '../server/stripe-sandbox.js';

const origin = 'https://review.example.test';
const password = 'fictional-review-password-for-tests';

test('Stripe QA accepts only the published dedicated site and canonical host', () => {
  const context = {
    site: { id: STRIPE_QA_SITE, url: STRIPE_QA_ORIGIN },
    deploy: { context: 'production', published: true },
  };
  assert.doesNotThrow(() => assertStripeQaContext(STRIPE_QA_MODE, context, STRIPE_QA_ORIGIN));
  assert.throws(() => assertStripeQaContext('review', context, STRIPE_QA_ORIGIN));
  assert.throws(() => assertStripeQaContext(STRIPE_QA_MODE, context, origin));
  assert.throws(() =>
    assertStripeQaContext(
      STRIPE_QA_MODE,
      { ...context, site: { ...context.site, id: 'other' } },
      STRIPE_QA_ORIGIN,
    ),
  );
  assert.throws(() =>
    assertStripeQaContext(
      STRIPE_QA_MODE,
      { ...context, deploy: { ...context.deploy, published: false } },
      STRIPE_QA_ORIGIN,
    ),
  );
});

test('hosted API transactions, cold starts, capabilities and access control', async (t) => {
  const database = new NetlifyDB({ logger: () => {} });
  const connectionString = await database.start();
  const pool = new pg.Pool({ connectionString });
  t.after(async () => {
    await pool.end();
    await database.stop();
  });
  await database.applyMigrations('./netlify/database/migrations');
  let cookie = '';
  // A fresh handler/app for every request represents different cold instances.
  const request = (path, method = 'GET', body, extra = {}, options = {}) =>
    createHostedHandler({ pool, password, origins: [origin], ...options })(
      new Request(origin + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Prototype': 'local',
          Origin: origin,
          cookie,
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { ip: '192.0.2.10' },
    );
  const detail = async () => (await (await request('/api/admin')).json()).campaigns[0];

  await t.test(
    'uses separate QA logins, isolated data, and byte-exact Stripe signatures',
    async () => {
      const key = 'sk_test_fixture';
      const webhookSecret = 'whsec_testfixture';
      const stripeSandbox = createStripeSandboxClient({
        key,
        webhookSecret,
        origin: STRIPE_QA_ORIGIN,
      });
      const stripe = new Stripe(key);
      const qaPasswords = {
        [QA_COACH]: 'fictional-qa-coach-password',
        [QA_DUES_ADMIN]: 'fictional-qa-dues-admin-password',
      };
      const qa = createHostedHandler({
        pool,
        qaPasswords,
        origins: [STRIPE_QA_ORIGIN],
        stripeSandbox,
      });
      const qaRequest = (path, method = 'GET', body, extra = {}) =>
        qa(
          new Request(STRIPE_QA_ORIGIN + path, {
            method,
            body,
            headers: {
              'Content-Type': 'application/json',
              'X-Prototype': 'local',
              Origin: STRIPE_QA_ORIGIN,
              ...extra,
            },
          }),
        );
      const signIn = (email, password) =>
        qaRequest('/api/login', 'POST', JSON.stringify({ email, password }));
      assert.equal((await signIn('coach@tvvc.example', qaPasswords[QA_DUES_ADMIN])).status, 401);
      assert.equal((await signIn('dues-admin@tvvc.example', qaPasswords[QA_COACH])).status, 401);
      const login = await signIn('coach@tvvc.example', qaPasswords[QA_COACH]);
      assert.equal(login.status, 200);
      assert.match(login.headers.get('set-cookie'), /Secure/);
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const detail = await (await qaRequest('/api/admin', 'GET', undefined, { cookie })).json();
      assert.equal(detail.qaRole, QA_COACH);
      assert.equal(detail.campaigns.length, 1);
      const [campaign] = detail.campaigns;
      const [player] = campaign.athletes;
      assert.equal(campaign.status, 'draft');
      assert.equal(player.approved, false);
      assert.deepEqual(campaign.contacts, []);
      assert.deepEqual(campaign.ledger, []);
      const base = `/api/admin/campaigns/${campaign.id}`;
      const invitePath = `${base}/athletes/${player.id}/invite`;
      assert.equal((await qaRequest(invitePath, 'POST', '{}', { cookie })).status, 200);
      assert.equal(
        (await qaRequest(`${base}/dues/${player.id}`, 'POST', '{}', { cookie })).status,
        403,
      );
      assert.equal(
        (await qaRequest(`${base}/dues-export`, 'GET', undefined, { cookie })).status,
        403,
      );
      const duesLogin = await signIn('dues-admin@tvvc.example', qaPasswords[QA_DUES_ADMIN]);
      assert.equal(duesLogin.status, 200);
      const duesHeaders = { cookie: duesLogin.headers.get('set-cookie').split(';')[0] };
      const dues = await (await qaRequest('/api/admin', 'GET', undefined, duesHeaders)).json();
      assert.equal(dues.qaRole, QA_DUES_ADMIN);
      assert.equal(dues.campaigns[0].athletes[0].privatePath, undefined);
      assert.equal((await qaRequest(invitePath, 'POST', '{}', duesHeaders)).status, 403);
      assert.equal(
        (await qaRequest(`${base}/stop-donations`, 'POST', '{}', duesHeaders)).status,
        403,
      );
      assert.equal(
        (await qaRequest(`${base}/dues-export`, 'GET', undefined, duesHeaders)).status,
        200,
      );
      assert.equal((await request('/api/admin', 'GET', undefined, { cookie })).status, 401);
      const event =
        '{"id":"evt_fixture","type":"customer.created","livemode":false,"data":{"object":{"id":"cus_fixture","name":"Fictional Á"}}}\n';
      const webhook = '/api/stripe-sandbox/webhook';
      assert.equal(
        (await qaRequest(webhook, 'POST', event, { Origin: '', 'Stripe-Signature': 'invalid' }))
          .status,
        401,
      );
      const signature = stripe.webhooks.generateTestHeaderString({
        payload: event,
        secret: webhookSecret,
      });
      assert.equal(
        (await qaRequest(webhook, 'POST', event, { Origin: '', 'Stripe-Signature': signature }))
          .status,
        200,
      );
    },
  );

  await t.test(
    'fails closed without configured access and rejects foreign/missing origins',
    async () => {
      assert.equal(
        (await request('/api/runtime', 'GET', undefined, {}, { password: '' })).status,
        503,
      );
      assert.equal(
        (await request('/api/login', 'POST', {}, { Origin: 'https://evil.test' })).status,
        403,
      );
      assert.equal((await request('/api/login', 'POST', {}, { Origin: '' })).status, 403);
      assert.equal((await request('/api/admin')).status, 401);
      assert.equal((await request('/api/unknown')).status, 404);
      assert.deepEqual(await (await request('/api/runtime')).json(), {
        hosted: true,
        simulation: true,
      });
    },
  );

  await t.test(
    'hosted password replaces local credentials; secure session survives cold requests',
    async () => {
      assert.equal(
        (
          await request('/api/login', 'POST', {
            email: 'coach@tvvc.example',
            password: 'prototype-only',
          })
        ).status,
        401,
      );
      const response = await request('/api/login', 'POST', {
        email: 'coach@tvvc.example',
        password,
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('set-cookie'), /Secure/);
      assert.match(response.headers.get('set-cookie'), /HttpOnly/);
      assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
      cookie = response.headers.get('set-cookie').split(';')[0];
      assert.equal((await request('/api/session')).status, 200);
      const c = await detail();
      assert.equal(c.orgId, 'tvvc');
      const century = (await (await request('/api/examples')).json()).campaigns.find((x) =>
        x.slug.includes('century'),
      );
      const view = await (await request(`/api/public/${century.slug}`)).json();
      assert.equal(
        (await request(`/api/admin/campaigns/${view.campaign.id}`, 'PATCH', { name: 'intrusion' }))
          .status,
        404,
      );
      const token = c.athletes[0].privatePath.split('/').at(-1);
      assert.equal((await request(`/api/athlete/${token}`)).status, 200);
      assert.equal(
        (await request(`/api/athlete/${c.athletes[0].id}`, 'PATCH', { done: true })).status,
        404,
      );
    },
  );

  await t.test(
    'preparation/launch and payment retry state persist, with one donation/thank-you',
    async () => {
      const c = await detail();
      assert.equal(c.jobs.length, 0);
      assert.equal(
        (await request(`/api/admin/campaigns/${c.id}/action`, 'POST', { action: 'launch' })).status,
        200,
      );
      const live = await detail();
      assert.equal(live.contacts.length, 3);
      assert.equal(live.jobs.filter((job) => job.type === 'solicitation').length, 9);
      const payload = {
        requestId: 'hosted-payment-retry',
        method: 'stripe',
        amount: 25,
        email: 'supporter@example.test',
      };
      const donation = await (
        await request(`/api/public/${c.slug}/donations`, 'POST', payload)
      ).json();
      const retry = await (
        await request(`/api/public/${c.slug}/donations`, 'POST', payload)
      ).json();
      assert.deepEqual(retry, donation);
      const event = { receiptToken: donation.receiptToken, eventId: 'hosted-event-retry' };
      assert.equal((await request('/api/simulator/payments', 'POST', event)).status, 200);
      assert.equal((await request('/api/simulator/payments', 'POST', event)).status, 200);
      const after = await detail();
      assert.equal(after.totals.grossCents, 2500);
      assert.equal(after.ledger.length, 1);
      assert.equal(after.audit.length, 1);
      assert.equal(after.jobs.filter((job) => job.type === 'thank-you').length, 1);
      const publicJSON = JSON.stringify(await (await request(`/api/public/${c.slug}`)).json());
      assert.ok(!publicJSON.includes('supporter@example.test'));
      assert.ok(!publicJSON.includes(donation.receiptToken));
    },
  );

  await t.test(
    'pending external report and reconciliation survive separate invocations',
    async () => {
      const c = await detail();
      const result = await (
        await request(`/api/public/${c.slug}/donations`, 'POST', {
          requestId: 'hosted-venmo',
          method: 'venmo',
          amount: 40,
          email: 'alex-fan@example.test',
        })
      ).json();
      let after = await detail();
      assert.equal(after.totals.grossCents, 2500);
      assert.equal(after.ledger.find((entry) => entry.id === result.donation.id).status, 'pending');
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: c.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const response = await request(
        `/api/admin/campaigns/${c.id}/ledger/${result.donation.id}`,
        'POST',
        {
          requestId: 'hosted-confirm',
          action: 'confirm',
          amount: 40,
          method: 'venmo',
          receivedDate: date,
          transaction: 'HOSTED-FICTIONAL-001',
          fee: '',
          note: 'Fictional hosted review evidence.',
        },
      );
      assert.equal(response.status, 200, await response.text());
      after = await detail();
      assert.equal(after.totals.grossCents, 6500);
      assert.equal(after.audit.length, 2);
      assert.equal(after.ledger.find((entry) => entry.id === result.donation.id).feeCents, null);
    },
  );

  await t.test(
    'transaction exceptions roll back and no response is returned before commit',
    async () => {
      const before = (await pool.query('SELECT snapshot FROM fundraiser_review_state')).rows[0]
        .snapshot;
      await assert.rejects(
        transactSnapshot(
          pool,
          () => {
            throw new Error('unexpected seed');
          },
          async (snapshot) => {
            snapshot.state.ledger.length = 0;
            throw new Error('simulated storage failure');
          },
        ),
        /simulated storage failure/,
      );
      const after = (await pool.query('SELECT snapshot FROM fundraiser_review_state')).rows[0]
        .snapshot;
      assert.deepEqual(after, before);
      const brokenPool = {
        connect: async () => {
          const client = await pool.connect();
          return {
            release: () => client.release(),
            query: (sql, args) => {
              if (sql === 'COMMIT')
                throw Object.assign(new Error('fictional commit failure'), { code: 'TEST_COMMIT' });
              return client.query(sql, args);
            },
          };
        },
      };
      const errors = [];
      const old = console.error;
      console.error = (...args) => errors.push(args);
      try {
        const response = await request('/api/logout', 'POST', {}, {}, { pool: brokenPool });
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('set-cookie'), null);
        assert.equal((await request('/api/session')).status, 200);
        assert.ok(!JSON.stringify(errors).includes(cookie));
      } finally {
        console.error = old;
      }
    },
  );

  await t.test('logout revokes persisted session', async () => {
    assert.equal((await request('/api/logout', 'POST', {})).status, 200);
    assert.equal((await request('/api/admin')).status, 401);
  });

  await t.test(
    'password rotation revokes sessions and failed login throttling survives cold starts',
    async () => {
      const response = await request('/api/login', 'POST', {
        email: 'coach@tvvc.example',
        password,
      });
      cookie = response.headers.get('set-cookie').split(';')[0];
      const rotated = { password: 'a-new-fictional-review-password-for-tests' };
      assert.equal((await request('/api/admin', 'GET', undefined, {}, rotated)).status, 401);
      for (let i = 0; i < 16; i++) {
        assert.equal(
          (
            await request(
              '/api/login',
              'POST',
              {
                email: 'coach@tvvc.example',
                password: rotated.password,
              },
              {},
              rotated,
            )
          ).status,
          200,
        );
      }
      for (let i = 0; i < 16; i++) {
        const failed = await request(
          '/api/login',
          'POST',
          { email: 'coach@tvvc.example', password: 'wrong' },
          {},
          rotated,
        );
        assert.equal(failed.status, i < 15 ? 401 : 429);
      }
    },
  );
});
