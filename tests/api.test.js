import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createSeed } from '../server/domain.js';

test('HTTP authentication, organization isolation, private/public access and validation', async (t) => {
  const { app, service } = createApp({ seed: createSeed('2026-10-10T12:00:00Z') });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = (url, method = 'GET', body, headers = {}) =>
    fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Prototype': 'local', cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  assert.equal((await request('/api/admin')).status, 401);
  assert.equal(
    (await request('/api/login', 'POST', { email: 'coach@tvvc.example', password: 'wrong' }))
      .status,
    401,
  );
  const login = await request('/api/login', 'POST', {
    email: 'coach@tvvc.example',
    password: 'prototype-only',
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  const admin = await (await request('/api/admin')).json();
  assert.equal(admin.campaigns.length, 1);
  assert.equal(admin.organization.id, 'tvvc');
  const c = admin.campaigns[0];
  const century = service.state.campaigns.find((c) => c.orgId === 'century');
  const centuryAthlete = service.state.athletes.find((a) => a.campaignId === century.id);
  const foreignRequests = [
    [`/api/admin/campaigns/${century.id}`, 'PATCH', { name: 'intrusion' }],
    [`/api/admin/campaigns/${century.id}/action`, 'POST', { action: 'launch' }],
    [`/api/admin/campaigns/${century.id}/athletes/${centuryAthlete.id}/invite`, 'POST', {}],
    [
      `/api/admin/campaigns/${century.id}/athletes/${centuryAthlete.id}/approve`,
      'POST',
      { approved: false },
    ],
    [`/api/admin/campaigns/${century.id}/export`, 'GET'],
    [
      `/api/admin/campaigns/${century.id}/suppress`,
      'POST',
      { email: 'supporter@example.test', reason: 'unsubscribe' },
    ],
  ];
  for (const args of foreignRequests) assert.equal((await request(...args)).status, 404);
  assert.equal(
    (
      await request(
        `/api/admin/campaigns/${c.id}/action`,
        'POST',
        { action: 'launch' },
        { Origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  const invalid = await request(`/api/admin/campaigns/${c.id}`, 'PATCH', {
    name: 'Must roll back',
    color: 'invalid',
  });
  assert.equal(invalid.status, 400);
  assert.equal(service.state.campaigns.find((x) => x.id === c.id).name, c.name);
  const result = await (
    await request(`/api/admin/campaigns/${c.id}/import`, 'POST', {
      csv: 'name,team\nValid,JV\n,JV',
    })
  ).json();
  assert.equal(result.imported.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(service.state.athletes.filter((a) => a.campaignId === c.id).length, 3);
  const publicView = await (
    await request(`/api/public/${c.slug}?athlete=${c.athletes[0].id}`)
  ).json();
  assert.equal(publicView.publicPath, `/c/${c.slug}/a/${c.athletes[0].id}`);
  assert.ok(!JSON.stringify(publicView).includes('supporter@example.test'));
  assert.equal(
    (await request(`/api/athlete/${c.athletes[0].id}`, 'PATCH', { done: true })).status,
    404,
  );
  const privatePath = c.athletes[0].privatePath;
  assert.equal((await request(`/api/athlete/${privatePath.split('/').at(-1)}`)).status, 200);
  await request(`/api/admin/campaigns/${c.id}/athletes/${c.athletes[0].id}/invite`, 'POST', {
    revoke: true,
  });
  assert.equal((await request(`/api/athlete/${privatePath.split('/').at(-1)}`)).status, 404);
  await request('/api/logout', 'POST', {});
  assert.equal((await request('/api/admin')).status, 401);
});

test('persistent state retains ledger/event idempotency across app restarts', async (t) => {
  const directory = mkdtempSync(path.resolve('.local-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve('.') + path.sep + '.local-test-'));
    rmSync(resolved, { recursive: true, force: true });
  });
  const first = createApp({ directory, seed: createSeed('2026-10-10T12:00:00Z') });
  const c = first.service.state.campaigns.find((c) => c.orgId === 'tvvc');
  first.service.action(c.orgId, c.id, { action: 'launch' });
  const input = {
    requestId: 'durable-request',
    amount: 50,
    email: 'durable@example.test',
    method: 'stripe',
  };
  const donation = first.service.createDonation(c.slug, input);
  first.service.simulatorEvent(donation.receiptToken, 'durable-event');
  first.persist();
  const next = createApp({ directory });
  assert.deepEqual(next.service.createDonation(c.slug, input), donation);
  next.service.simulatorEvent(donation.receiptToken, 'durable-event');
  assert.equal(next.service.totals(c.id).grossCents, 5000);
  assert.equal(next.service.state.audit.length, 1);
  const privateToken = Object.values(
    JSON.parse(readFileSync(path.join(directory, 'snapshot.json'), 'utf8')).links,
  )[0]
    .split('/')
    .at(-1);
  assert.ok(!JSON.stringify(next.service.state.activity).includes(privateToken));
});
