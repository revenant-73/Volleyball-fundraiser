import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { Fundraiser, createSeed } from '../server/domain.js';
import {
  changeDues,
  createDuesRehearsal,
  duesSummary,
  familySummary,
  duesExport,
} from '../server/dues.js';
import { migratePilot, transactPilot } from '../server/pilot/store.js';
import { exportPilot, restorePilotToEmpty } from '../server/pilot/backup.js';
import { createApp } from '../server/app.js';
import { addAdmin } from '../server/pilot/admin.js';

function fixture() {
  const s = new Fundraiser(createSeed().state);
  const { campaignId } = createDuesRehearsal(
    s,
    'tvvc',
    { requestId: randomUUID() },
    'fictional-owner',
    false,
  );
  const c = s.campaign('tvvc', campaignId),
    a = s.state.athletes.find((a) => a.campaignId === campaignId);
  const ds = () => s.state.ledger.filter((d) => d.athleteId === a.id);
  const act = (action, fields = {}) =>
    changeDues(
      s,
      'tvvc',
      c.id,
      a.id,
      {
        requestId: randomUUID(),
        version: a.dues?.entries.length || 0,
        action,
        note: 'Fictional statement review',
        ...fields,
      },
      'fictional-owner',
    );
  const summary = () => duesSummary(s, a);
  return { s, c, a, ds, act, summary };
}
const post = (f, amount = '97', extra = {}) =>
  f.act('post', { donationId: f.ds()[0].id, amount, reference: randomUUID(), ...extra });

test('net dues credit stays separate from gross, unknown fees and pending receipts; explicit zero fees unlock credit', () => {
  const f = fixture();
  assert.equal(f.summary().grossCents, 15000);
  assert.equal(f.summary().availableCents, 9700);
  assert.equal(f.summary().pendingCents, 2500);
  assert.equal(f.summary().unknownFeeCount, 1);
  assert.throws(() => post(f, '98'), /exceeds/);
  assert.throws(() => post(f, '1', { donationId: f.ds()[1].id }), /exceeds/);
  assert.throws(() => post(f, '1', { donationId: f.ds()[2].id }), /exceeds/);
  post(f);
  assert.equal(f.summary().appliedCents, 9700);
  assert.equal(f.summary().remainingCents, 90300);
  assert.equal(f.s.totals(f.c.id).grossCents, 30000); // two fictional players
  f.act('fee', { donationId: f.ds()[1].id, amount: '0' });
  assert.equal(f.summary().unknownFeeCount, 0);
  assert.equal(f.summary().availableCents, 5000);
  assert.throws(() => f.act('fee', { donationId: f.ds()[1].id, amount: '-1' }), /nonnegative/);
  assert.throws(() => post(f, '0.001'), /decimal/);
});

test('posting replay is durable, changed payload and stale accounts conflict, external references are unique', () => {
  const f = fixture();
  const input = {
    requestId: randomUUID(),
    version: f.a.dues.entries.length,
    action: 'post',
    amount: '50',
    donationId: f.ds()[0].id,
    reference: 'EXTERNAL-POST-001',
    note: 'Synthetic posting',
  };
  changeDues(f.s, 'tvvc', f.c.id, f.a.id, input, 'owner');
  const restarted = new Fundraiser(JSON.parse(JSON.stringify(f.s.state)));
  changeDues(restarted, 'tvvc', f.c.id, f.a.id, input, 'owner');
  assert.equal(duesSummary(restarted, restarted.findAthlete(f.c.id, f.a.id)).appliedCents, 5000);
  assert.throws(
    () => changeDues(f.s, 'tvvc', f.c.id, f.a.id, { ...input, amount: '51' }, 'owner'),
    /different details/,
  );
  assert.throws(() => post(f, '1', { version: 1 }), /changed/);
  assert.throws(() => post(f, '1', { reference: 'external-post-001' }), /already been/);
  const history = duesExport(f.s, 'tvvc', f.c.id);
  assert.match(history, /EXTERNAL-POST-001/);
  assert.match(history, /5000/);
});

test('family payments cap credit, fee corrections reverse newest credit and require external reconciliation', () => {
  const f = fixture();
  f.act('obligation', { charges: '100', target: '100' });
  post(f, '97');
  f.act('family-payment', { amount: '80', reference: 'FICTIONAL-FAMILY-PAYMENT' });
  assert.equal(f.summary().appliedCents, 2000);
  assert.equal(f.summary().awaitingReversalCents, 7700);
  assert.equal(f.summary().remainingCents, 0);
  assert.throws(() => post(f, '1'), /reversals/);
  const reversal = f.a.dues.entries.find((e) => e.type === 'reversal');
  f.act('reversal-posted', { reversalId: reversal.id, reference: 'FICTIONAL-REVERSAL' });
  assert.equal(f.summary().awaitingReversalCents, 0);
  assert.throws(
    () => f.act('reversal-posted', { reversalId: reversal.id, reference: 'FICTIONAL-REVERSAL-2' }),
    /outstanding/,
  );
  f.act('fee', { donationId: f.ds()[0].id, amount: '90' });
  assert.equal(f.summary().appliedCents, 1000);
  assert.equal(f.summary().awaitingReversalCents, 1000);
});

test('direct-payment corrections append reversals, cannot be repeated and never automatically reopen fundraising', () => {
  const f = fixture();
  f.act('family-payment', { amount: '1000', reference: 'FAMILY-PAID-IN-FULL' });
  assert.equal(f.summary().fundraisingOpen, false);
  const payment = f.a.dues.entries.find((e) => e.type === 'family-payment');
  f.act('reverse-family-payment', {
    paymentId: payment.id,
    amount: '1000',
    reference: 'FAMILY-REVERSED',
  });
  assert.equal(f.summary().familyPaidCents, 0);
  assert.equal(f.summary().fundraisingOpen, false);
  assert.throws(
    () =>
      f.act('reverse-family-payment', {
        paymentId: payment.id,
        amount: '1',
        reference: 'FAMILY-REVERSED-TWICE',
      }),
    /unreversed/,
  );
  f.act('resume-fundraising');
  assert.equal(f.summary().fundraisingOpen, true);
  f.act('withdraw', { charges: '100' });
  f.act('withdrawal-post', {
    donationId: f.ds()[0].id,
    amount: '97',
    reference: 'WITHDRAWAL-OBLIGATION',
  });
  assert.equal(f.summary().remainingCents, 300);
  assert.equal(f.summary().fundraisingOpen, false);
});

test('setting up an already funded player closes fundraising until owner review even after a refund', () => {
  const f = fixture();
  delete f.a.dues; // Account setup against existing fictional donation history.
  f.act('setup', { season: 'Fictional existing campaign', charges: '50', target: '50' });
  assert.equal(f.summary().fundraisingOpen, false);
  f.act('refund', { donationId: f.ds()[0].id, amount: '100', reference: 'MOCK-EXISTING-REFUND' });
  assert.equal(f.summary().fundraisingOpen, false);
});

test('attributing a confirmed contribution closes a covered target until explicit review', () => {
  const f = fixture();
  const other = f.s.state.athletes.find((a) => a.campaignId === f.c.id && a.id !== f.a.id);
  const donation = f.s.state.ledger.find((d) => d.athleteId === other.id && d.feeCents === 300);
  const attribute = (athleteId) =>
    f.s.reconcile(
      'tvvc',
      f.c.id,
      donation.id,
      { action: 'attribute', athleteId, requestId: randomUUID(), note: 'Fictional correction' },
      'owner',
    );
  f.act('obligation', { charges: '1000', target: '150' });
  attribute(f.a.id);
  assert.equal(f.summary().fundraisingOpen, false);
  assert.throws(() => f.act('resume-fundraising'), /target is already covered/);
  attribute(other.id);
  assert.equal(f.summary().fundraisingOpen, false);
  f.act('resume-fundraising');
  assert.equal(f.summary().fundraisingOpen, true);
});

test('partial/full refunds reduce gross once, reverse affected credit, retain fees and never resume donor solicitation', () => {
  const f = fixture();
  post(f);
  f.act('refund', { donationId: f.ds()[0].id, amount: '40', reference: 'MOCK-REFUND-1' });
  assert.equal(f.summary().appliedCents, 5700);
  assert.equal(f.summary().awaitingReversalCents, 4000);
  assert.equal(f.ds()[0].status, 'confirmed');
  assert.equal(f.s.totals(f.c.id, f.a.id).grossCents, 11000);
  f.act('refund', { donationId: f.ds()[0].id, amount: '60', reference: 'MOCK-REFUND-2' });
  assert.equal(f.ds()[0].status, 'refunded');
  assert.equal(f.summary().appliedCents, 0);
  assert.equal(f.summary().knownFeeCents, 300);
  assert.equal(f.s.totals(f.c.id, f.a.id).grossCents, 5000);
  assert.equal(f.s.totals(f.c.id, f.a.id).knownFeeCents, 300);
  assert.equal(f.s.totals(f.c.id, f.a.id).knownNetCents, -300);
  assert.equal(f.ds()[0].everConfirmed, true);
  assert.throws(
    () => f.act('refund', { donationId: f.ds()[0].id, amount: '1', reference: 'MOCK-REFUND-3' }),
    /confirmed/,
  );
});

test('disputes freeze funds without silently undoing applied credit; won/lost results do not double reverse', () => {
  const f = fixture();
  post(f);
  f.act('dispute', { donationId: f.ds()[0].id, amount: '100' });
  assert.equal(f.summary().appliedCents, 9700);
  assert.equal(f.summary().availableCents, 0);
  assert.equal(f.summary().awaitingReversalCents, 0);
  f.act('dispute-won', { donationId: f.ds()[0].id });
  assert.equal(f.summary().appliedCents, 9700);
  f.act('dispute', { donationId: f.ds()[0].id, amount: '50' });
  f.act('dispute-lost', { donationId: f.ds()[0].id });
  assert.equal(f.summary().appliedCents, 4700);
  assert.equal(f.summary().awaitingReversalCents, 5000);
  assert.throws(() => f.act('dispute-lost', { donationId: f.ds()[0].id }), /No open dispute/);
});

test('excess cannot be silently redirected, withdrawals preserve obligations and family links are independent and revocable', () => {
  const f = fixture();
  f.act('obligation', { charges: '60', target: '60' });
  assert.equal(f.summary().excessCents, 3700);
  assert.equal(f.summary().fundraisingOpen, false);
  assert.throws(() => f.act('redirect', { donationId: f.ds()[0].id, amount: '37' }), /consent/);
  f.act('redirect', {
    donationId: f.ds()[0].id,
    amount: '37',
    consent: 'Fictional donor agreed to general club support',
  });
  assert.equal(f.summary().excessCents, 0);
  f.act('undo-redirect', {
    donationId: f.ds()[0].id,
    amount: '37',
    consent: 'Fictional donor and owner reviewed reversal before refund',
  });
  assert.equal(f.summary().redirectedCents, 0);
  assert.equal(f.summary().excessCents, 3700);
  f.act('refund', { donationId: f.ds()[0].id, amount: '37', reference: 'MOCK-EXCESS-REFUND' });
  post(f, '60');
  const issued = f.act('family-link');
  const raw = issued.privatePath.split('/').at(-1);
  const family = familySummary(f.s, raw);
  assert.equal(family.appliedCents, 6000);
  f.a.dues.summaryExpiresAt = new Date(0).toISOString();
  assert.throws(() => familySummary(f.s, raw), /expired/);
  f.a.dues.summaryExpiresAt = new Date(Date.now() + 60000).toISOString();
  for (const key of ['entries', 'sources', 'email', 'summaryHash'])
    assert.equal(key in family, false);
  assert.equal(JSON.stringify(f.s.publicView(f.c.slug)).includes('remainingCents'), false);
  const setupLink = f.s.issueInvite('tvvc', f.c.id, f.a.id).split('/').at(-1);
  assert.throws(() => familySummary(f.s, setupLink), /expired/);
  assert.equal(JSON.stringify(f.s.athleteView(f.a)).includes('chargesCents'), false);
  f.act('withdraw', { charges: '20' });
  assert.equal(f.summary().appliedCents, 2000);
  assert.equal(f.summary().awaitingReversalCents, 4000);
  assert.equal(f.summary().status, 'withdrawn');
  assert.throws(() => post(f, '1'), /Withdrawn/);
  assert.throws(() => familySummary(f.s, raw), /expired/);
});

test('completed players stop accepting donations and leave shared-contact deduplication and pending holds intact', () => {
  const s = new Fundraiser(createSeed().state);
  const c = s.state.campaigns.find((c) => c.orgId === 'tvvc');
  const [a, other] = s.state.athletes.filter((a) => a.campaignId === c.id);
  s.action('tvvc', c.id, { action: 'launch' });
  changeDues(
    s,
    'tvvc',
    c.id,
    a.id,
    {
      requestId: randomUUID(),
      version: 0,
      action: 'setup',
      note: 'Synthetic account',
      charges: '100',
      target: '100',
      season: 'Fictional season',
    },
    'owner',
  );
  changeDues(
    s,
    'tvvc',
    c.id,
    a.id,
    {
      requestId: randomUUID(),
      version: 1,
      action: 'family-payment',
      note: 'Synthetic family payment',
      amount: '100',
      reference: 'FAKE-PAID',
    },
    'owner',
  );
  const shared = s.state.contacts.find(
    (x) => x.campaignId === c.id && x.email === 'supporter@example.test',
  );
  assert.deepEqual(
    s.eligible(shared).map((a) => a.id),
    [other.id],
  );
  assert.equal(s.state.jobs.filter((j) => j.contactId === shared.id).length, 3);
  assert.throws(
    () =>
      s.createDonation(c.slug, {
        requestId: randomUUID(),
        amount: '10',
        email: 'test@example.test',
        method: 'venmo',
        athleteId: a.id,
      }),
    /no longer accepting/,
  );
  s.createDonation(c.slug, {
    requestId: randomUUID(),
    amount: '10',
    email: shared.email,
    method: 'venmo',
    athleteId: other.id,
  });
  assert.equal(s.contactState(shared), 'pending');
  s.run(c);
  assert.equal(
    s.state.jobs.filter((j) => j.contactId === shared.id && j.status === 'sent').length,
    0,
  );
});

test('pilot persists dues and append-only history across transactions, rolls back failures and recovers balances without family capabilities', async (t) => {
  const folder = mkdtempSync(path.resolve('.local-test-pilot-'));
  const client = createClient({ url: `file:${path.join(folder, 'dues.db')}` });
  const target = createClient({ url: `file:${path.join(folder, 'recovered.db')}` });
  t.after(() => {
    client.close();
    target.close();
  });
  await migratePilot(client);
  let cid, aid, raw;
  await transactPilot(client, ({ state }) => {
    const s = new Fundraiser(state);
    cid = createDuesRehearsal(s, 'tvvc', { requestId: randomUUID() }, 'owner', true).campaignId;
    const a = state.athletes.find((a) => a.campaignId === cid);
    aid = a.id;
    const d = state.ledger.find((d) => d.athleteId === aid);
    changeDues(
      s,
      'tvvc',
      cid,
      aid,
      {
        action: 'post',
        requestId: randomUUID(),
        version: 1,
        amount: '97',
        donationId: d.id,
        reference: 'MOCK-EXTERNAL',
        note: 'Synthetic posting',
      },
      'owner',
    );
    raw = changeDues(
      s,
      'tvvc',
      cid,
      aid,
      {
        action: 'family-link',
        requestId: randomUUID(),
        version: 2,
        note: 'Verified fictional guardian',
      },
      'owner',
    )
      .privatePath.split('/')
      .at(-1);
  });
  await assert.rejects(
    transactPilot(client, ({ state }) => {
      state.athletes.find((a) => a.id === aid).dues.entries[0].note = 'overwrite';
    }),
    /append-only/,
  );
  await transactPilot(client, ({ state }) =>
    assert.equal(
      duesSummary(
        new Fundraiser(state),
        state.athletes.find((a) => a.id === aid),
      ).appliedCents,
      9700,
    ),
  );
  const backup = await exportPilot(client);
  await restorePilotToEmpty(target, backup);
  await transactPilot(target, ({ state }) => {
    assert.equal(
      duesSummary(
        new Fundraiser(state),
        state.athletes.find((a) => a.id === aid),
      ).appliedCents,
      9700,
    );
    assert.throws(() => familySummary(new Fundraiser(state), raw), /expired/);
  });
});

test('HTTP pilot rehearsal requires owner and organization access, keeps payment/email/public gates closed and supports independent family summaries', async (t) => {
  const { createPilotState } = await import('../server/pilot/admin.js');
  const seed = createPilotState();
  addAdmin(
    seed.state,
    { orgId: 'tvvc', role: 'owner', userId: 'bootstrap' },
    { email: 'owner@example.test', password: 'fictional-owner-password', role: 'owner' },
  );
  addAdmin(
    seed.state,
    { orgId: 'tvvc', role: 'owner', userId: 'bootstrap' },
    { email: 'admin@example.test', password: 'fictional-admin-password', role: 'admin' },
  );
  const runtime = createApp({ seed, pilot: true });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = (url, body) =>
    fetch(base + url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Prototype': 'local', cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal(
    (await request('/api/admin/dues-rehearsal', { requestId: randomUUID() })).status,
    401,
  );
  const login = async (email, password) => {
    cookie = (await request('/api/login', { email, password })).headers
      .get('set-cookie')
      .split(';')[0];
  };
  await login('admin@example.test', 'fictional-admin-password');
  assert.equal(
    (await request('/api/admin/dues-rehearsal', { requestId: randomUUID() })).status,
    403,
  );
  await login('owner@example.test', 'fictional-owner-password');
  const response = await request('/api/admin/dues-rehearsal', { requestId: randomUUID() });
  assert.equal(response.status, 200);
  const { campaignId } = await response.json();
  const a = runtime.service.state.athletes.find((a) => a.campaignId === campaignId);
  const route = `/api/admin/campaigns/${campaignId}/dues/${a.id}`;
  const donation = runtime.service.state.ledger.find((d) => d.athleteId === a.id);
  const racing = await Promise.all(
    [1, 2].map((n) =>
      request(route, {
        action: 'post',
        requestId: randomUUID(),
        version: 1,
        donationId: donation.id,
        amount: '10',
        reference: `MOCK-RACING-${n}`,
        note: 'Concurrent synthetic credit',
      }),
    ),
  );
  assert.deepEqual(racing.map((r) => r.status).sort(), [200, 409]);
  const link = await (
    await request(route, {
      action: 'family-link',
      requestId: randomUUID(),
      version: 2,
      note: 'Fictional guardian',
    })
  ).json();
  const raw = link.privatePath.split('/').at(-1);
  cookie = '';
  const view = await (await request(`/api/family/${raw}`)).json();
  assert.equal(view.remainingCents, 99000);
  assert.equal('sources' in view, false);
  assert.equal((await request(route, { action: 'post' })).status, 401);
  assert.equal(
    (await request(`/api/public/${runtime.service.campaign('tvvc', campaignId).slug}`)).status,
    403,
  );
  assert.equal((await request('/api/simulator/payments', {})).status, 403);
  const mode = await (await request('/api/runtime')).json();
  assert.equal(mode.paymentsEnabled, false);
  assert.equal(mode.emailEnabled, false);
});
