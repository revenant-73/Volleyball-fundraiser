import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { migratePilot, transactPilot, validatePilotUrl } from '../server/pilot/store.js';
import { addAdmin, replacePassword } from '../server/pilot/admin.js';
import { Fundraiser } from '../server/domain.js';
import { createPilotHandler } from '../server/pilot/handler.js';
import { exportPilot, restorePilotToEmpty } from '../server/pilot/backup.js';

const origin = 'https://pilot.example.test';
const owner = { email: 'owner@example.test', password: 'fictional-owner-password', role: 'owner' };
async function database(t) {
  const directory = mkdtempSync(path.resolve('.local-test-pilot-'));
  const client = createClient({ url: `file:${path.join(directory, 'test.db')}` });
  t.after(() => client.close());
  await migratePilot(client);
  return client;
}

test('pilot initializes only a dedicated database, repeat initialization preserves data', async (t) => {
  const client = await database(t);
  await migratePilot(client);
  await transactPilot(client, ({ state }) => {
    assert.deepEqual(
      state.organizations.map((o) => o.id),
      ['tvvc'],
    );
    assert.equal(state.users.length, 0);
    assert.equal(state.campaigns.length, 0);
    addAdmin(state, { orgId: 'tvvc', role: 'owner', userId: 'bootstrap' }, owner);
  });
  await migratePilot(client);
  await transactPilot(client, ({ state }) => assert.equal(state.users.length, 1));
  const other = createClient({
    url: `file:${path.join(mkdtempSync(path.resolve('.local-test-pilot-')), 'other.db')}`,
  });
  t.after(() => other.close());
  await other.execute('CREATE TABLE existing_data (id TEXT)');
  await assert.rejects(migratePilot(other), /dedicated/);
  for (const url of [
    'http://example.com',
    'libsql://other.example.com',
    'https://user:secret@db.turso.io',
    'https://db.turso.io/?token=secret',
  ])
    assert.throws(() => validatePilotUrl(url));
});

test('pilot backup restores into an empty database, rejects corruption and never restores sessions', async (t) => {
  const client = await database(t);
  await transactPilot(client, (snapshot) => {
    const user = addAdmin(
      snapshot.state,
      { orgId: 'tvvc', role: 'owner', userId: 'bootstrap' },
      owner,
    );
    snapshot.auth.sessions.push([
      'hashed-session',
      { userId: user.id, orgId: 'tvvc', credentialVersion: 1, expires: Date.now() + 60000 },
    ]);
  });
  const backup = await exportPilot(client);
  assert.deepEqual(backup.snapshot.auth, { sessions: [], attempts: [] });
  const target = createClient({
    url: `file:${path.join(mkdtempSync(path.resolve('.local-test-pilot-')), 'restored.db')}`,
  });
  t.after(() => target.close());
  const corrupted = structuredClone(backup);
  corrupted.snapshot.state.users[0].active = false;
  await assert.rejects(restorePilotToEmpty(target, corrupted), /damaged/);
  assert.equal((await restorePilotToEmpty(target, backup)).integrity, 'ok');
  await assert.rejects(restorePilotToEmpty(target, backup), /empty database/);
  assert.equal((await exportPilot(target)).checksum, backup.checksum);
});

test('relational pilot persists domain transitions, pending holds, duplicate processing and atomic rollback', async (t) => {
  const client = await database(t);
  let campaign, athlete, receipt;
  await transactPilot(client, (snapshot) => {
    const service = new Fundraiser(snapshot.state);
    campaign = service.createCampaign(
      'tvvc',
      {
        name: 'Fictional rehearsal',
        purpose: 'Synthetic testing only',
        goal: 100,
        startDate: '2026-10-16',
      },
      '2026-10-16T12:00:00Z',
    );
    const result = service.addAthlete('tvvc', campaign.id, {
      name: 'Sample',
      displayName: 'Sample',
      team: 'Test',
    });
    snapshot.links[result.athlete.id] = result.privatePath;
    athlete = snapshot.state.athletes[0];
    athlete.completed = true;
    athlete.approved = true;
    athlete.approvedProfile = { displayName: 'Sample', message: 'Synthetic', photo: '' };
    service.addContacts(athlete, 'Shared@example.test shared@example.test');
    service.action('tvvc', campaign.id, { action: 'launch' });
    receipt = service.createDonation(campaign.slug, {
      requestId: 'request-payment-001',
      email: 'shared@example.test',
      amount: '12.50',
      method: 'venmo',
    });
  });
  await transactPilot(client, (snapshot) => {
    const service = new Fundraiser(snapshot.state);
    const contact = snapshot.state.contacts[0];
    assert.equal(snapshot.state.contacts.length, 1);
    assert.equal(service.contactState(contact), 'pending');
    const replay = service.createDonation(campaign.slug, {
      requestId: 'request-payment-001',
      email: 'shared@example.test',
      amount: '12.50',
      method: 'venmo',
    });
    assert.equal(replay.receiptToken, receipt.receiptToken);
    assert.equal(snapshot.state.ledger.length, 1);
    service.reconcile(
      'tvvc',
      campaign.id,
      receipt.donation.id,
      {
        action: 'confirm',
        amount: '12.50',
        method: 'venmo',
        receivedDate: '2026-10-16',
        transaction: 'TEST-001',
        fee: '',
        note: 'Synthetic confirmation',
        requestId: 'confirmation-001',
      },
      'fictional-admin',
    );
  });
  await transactPilot(client, (snapshot) => {
    const service = new Fundraiser(snapshot.state);
    assert.equal(snapshot.state.ledger[0].feeCents, null);
    assert.equal(snapshot.state.ledger[0].status, 'confirmed');
    assert.equal(snapshot.state.audit.length, 1);
    assert.equal(snapshot.state.jobs.filter((j) => j.type === 'thank-you').length, 1);
    service.reconcile(
      'tvvc',
      campaign.id,
      receipt.donation.id,
      {
        action: 'confirm',
        amount: '12.50',
        method: 'venmo',
        receivedDate: '2026-10-16',
        transaction: 'TEST-001',
        fee: '',
        note: 'Synthetic confirmation',
        requestId: 'confirmation-001',
      },
      'fictional-admin',
    );
    assert.equal(snapshot.state.audit.length, 1);
  });
  await assert.rejects(
    transactPilot(client, (snapshot) => {
      snapshot.state.contacts.push({ ...snapshot.state.contacts[0], id: 'duplicate' });
      snapshot.state.campaigns[0].name = 'Must roll back';
    }),
    /UNIQUE/,
  );
  await transactPilot(client, ({ state }) =>
    assert.equal(state.campaigns[0].name, 'Fictional rehearsal'),
  );
  const auditId = (await client.execute('SELECT id FROM ledger_audit')).rows[0].id;
  await assert.rejects(
    client.execute({ sql: 'DELETE FROM ledger_audit WHERE id=?', args: [auditId] }),
    /append-only/,
  );
  await assert.rejects(
    client.execute({
      sql: 'UPDATE donations SET amount_cents=12.5 WHERE id=?',
      args: [receipt.donation.id],
    }),
    /CHECK/,
  );
  await assert.rejects(
    client.execute({
      sql: 'INSERT INTO contact_athletes(contact_id,athlete_id,campaign_id) VALUES (?,?,?)',
      args: ['missing', 'missing', 'missing'],
    }),
    /FOREIGN KEY/,
  );
});

test('individual pilot accounts survive cold starts; role, revocation, recovery, throttles and launch gates are enforced', async (t) => {
  const client = await database(t);
  let ownerId;
  await transactPilot(client, ({ state }) => {
    ownerId = addAdmin(state, { orgId: 'tvvc', role: 'owner', userId: 'bootstrap' }, owner).id;
  });
  let cookie = '';
  const request = (path, method = 'GET', body, headers = {}) =>
    createPilotHandler({ client, origins: [origin] })(
      new Request(origin + path, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Prototype': 'local',
          cookie,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  async function login(credentials) {
    const response = await request('/api/login', 'POST', credentials);
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  }
  assert.equal((await request('/api/admin')).status, 401);
  assert.equal(
    (
      await request('/api/login', 'POST', {
        email: 'coach@tvvc.example',
        password: 'prototype-only',
      })
    ).status,
    401,
  );
  const signedIn = await login(owner);
  const ownerCookie = cookie;
  assert.match(signedIn.headers.get('set-cookie'), /Secure/);
  assert.equal((await request('/api/admin')).status, 200);
  const current = await (await request('/api/admin')).json();
  assert.equal(current.administrator.id, ownerId);
  assert.equal(current.campaigns.length, 0);
  assert.equal(JSON.stringify(current).includes('passwordHash'), false);
  assert.equal(
    (await request('/api/login', 'POST', owner, { Origin: 'https://foreign.test' })).status,
    403,
  );
  const create = await request('/api/admin/accounts', 'POST', {
    email: 'coach@example.test',
    password: 'fictional-coach-password',
    currentPassword: owner.password,
  });
  assert.equal(create.status, 200);
  const coach = await create.json();
  assert.equal(
    (
      await request('/api/admin/accounts', 'POST', {
        email: 'COACH@example.test',
        password: 'fictional-coach-password',
        currentPassword: owner.password,
      })
    ).status,
    409,
  );
  await login({ email: coach.email, password: 'fictional-coach-password' });
  const coachCookie = cookie;
  assert.equal((await request('/api/admin/accounts')).status, 403);
  assert.equal(
    (
      await request('/api/admin/accounts', 'POST', {
        email: 'intruder@example.test',
        password: 'fictional-new-password',
        role: 'owner',
        currentPassword: 'fictional-coach-password',
      })
    ).status,
    403,
  );
  cookie = ownerCookie;
  assert.equal(
    (
      await request(`/api/admin/accounts/${ownerId}`, 'PATCH', {
        active: false,
        currentPassword: owner.password,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/api/admin/accounts/${coach.id}`, 'PATCH', {
        active: false,
        currentPassword: owner.password,
      })
    ).status,
    200,
  );
  cookie = coachCookie;
  assert.equal((await request('/api/admin')).status, 401);
  assert.equal(
    (
      await request('/api/login', 'POST', {
        email: coach.email,
        password: 'fictional-coach-password',
      })
    ).status,
    401,
  );
  cookie = ownerCookie;
  const campaignResponse = await request('/api/admin/campaigns', 'POST', {
    name: 'Fictional draft',
    purpose: 'Synthetic rehearsal',
    goal: 100,
  });
  assert.equal(campaignResponse.status, 200);
  const c = await campaignResponse.json();
  assert.ok(Object.values(c.paymentSettings).every((m) => !m.enabled));
  for (const action of ['launch', 'resume', 'run', 'advance'])
    assert.equal(
      (await request(`/api/admin/campaigns/${c.id}/action`, 'POST', { action, days: 21 })).status,
      403,
    );
  for (const suffix of ['action/', 'ACTION', 'AcTiOn/'])
    assert.equal(
      (await request(`/api/admin/campaigns/${c.id}/${suffix}`, 'POST', { action: 'launch' }))
        .status,
      403,
    );
  assert.equal(
    (await request('/API/login', 'POST', owner, { Origin: 'https://foreign.test' })).status,
    403,
  );
  for (const path of [
    '/api/public/anything/donations',
    '/api/simulator/payments',
    '/api/receipt/anything/report',
  ])
    assert.equal((await request(path, 'POST', {})).status, 403);
  assert.equal((await request(`/api/public/${c.slug}`)).status, 403);
  assert.equal(
    (
      await request(`/api/admin/campaigns/${c.id}`, 'PATCH', {
        paymentSettings: { stripe: { enabled: true } },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/api/admin/password', 'POST', {
        currentPassword: 'wrong',
        password: 'replacement-owner-password',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request('/api/admin/password', 'POST', {
        currentPassword: owner.password,
        password: 'replacement-owner-password',
      })
    ).status,
    200,
  );
  assert.equal((await request('/api/admin')).status, 401);
  await login({ email: owner.email, password: 'replacement-owner-password' });
  // Offline owner recovery uses the same transactional password/session rules.
  await transactPilot(client, (snapshot) => {
    const sessions = new Map(snapshot.auth.sessions);
    replacePassword(
      snapshot.state,
      sessions,
      { userId: 'operator-recovery', orgId: 'tvvc' },
      snapshot.state.users.find((u) => u.id === ownerId),
      'recovered-owner-password',
    );
    snapshot.auth.sessions = [...sessions];
  });
  assert.equal((await request('/api/admin')).status, 401);
  await login({ email: owner.email, password: 'recovered-owner-password' });
  for (let n = 0; n < 15; n++)
    assert.equal(
      (await request('/api/login', 'POST', { email: 'absent@example.test', password: 'wrong' }))
        .status,
      401,
    );
  assert.equal(
    (await request('/api/login', 'POST', { email: 'absent@example.test', password: 'wrong' }))
      .status,
    429,
  );
});
