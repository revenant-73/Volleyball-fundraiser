import test from 'node:test';
import assert from 'node:assert/strict';
import { Fundraiser, createSeed, parseAthleteCSV, ledgerCSV } from '../server/domain.js';
const NOW = '2026-10-10T12:00:00.000Z';
function setup() {
  const seed = createSeed(NOW);
  const s = new Fundraiser(seed.state, 'test-event-secret');
  const c = s.state.campaigns.find((c) => c.orgId === 'tvvc');
  const athletes = s.state.athletes.filter((a) => a.campaignId === c.id);
  return { s, c, athletes, links: seed.links };
}
const launch = (s, c) => s.action(c.orgId, c.id, { action: 'launch' });
const donate = (s, c, overrides = {}) =>
  s.createDonation(c.slug, {
    requestId: 'request_0001',
    amount: '100',
    email: 'supporter@example.test',
    donorName: 'Demo donor',
    method: 'stripe',
    ...overrides,
  });
const confirm = (s, c, d, overrides = {}) =>
  s.reconcile(
    c.orgId,
    c.id,
    d.id,
    {
      action: 'confirm',
      requestId: 'confirm_0001',
      amount: '100',
      method: 'venmo',
      receivedDate: c.now.slice(0, 10),
      transaction: 'VENMO-EXAMPLE-1',
      note: 'Matched demo statement',
      ...overrides,
    },
    'test-admin',
  );

test('athlete saves and completes with fewer than 20 contacts; draft never queues', () => {
  const { s, c, athletes, links } = setup();
  const a = athletes.find((a) => !a.completed);
  const raw = links[a.id].split('/').at(-1);
  const saved = s.saveAthlete(raw, {
    emails: 'Friend@example.test, friend@example.test; another@example.test nope',
    message: 'Go team!',
    authorization: true,
  });
  assert.equal(saved.contactResult.added.length, 2);
  assert.equal(saved.contactResult.duplicates.length, 1);
  assert.deepEqual(saved.contactResult.invalid, ['nope']);
  assert.equal(s.athleteView(s.athleteByToken(raw)).contacts.length, 2);
  s.saveAthlete(raw, { done: true });
  assert.equal(a.completed, true);
  assert.equal(s.state.jobs.length, 0);
  s.run(c);
  assert.equal(s.state.jobs.length, 0);
});
test('launch deduplicates shared normalized contact into one 1/10/20 sequence', () => {
  const { s, c, athletes } = setup();
  launch(s, c);
  const shared = s.state.contacts.find(
    (x) => x.campaignId === c.id && x.email === 'supporter@example.test',
  );
  assert.equal(shared.athleteIds.length, 2);
  const jobs = s.state.jobs.filter((j) => j.contactId === shared.id);
  assert.deepEqual(
    jobs.map((j) => j.day),
    [1, 10, 20],
  );
  s.run(c);
  s.run(c);
  assert.equal(jobs.filter((j) => j.status === 'sent').length, 1);
  const preview = s.renderJob(c, jobs[0]);
  assert.match(preview.body, /organization fundraising message/);
  assert.match(preview.body, /Maya & Alex/);
  assert.match(preview.body, /Every practice/);
  const view = s.publicView(c.slug, undefined, shared.publicToken);
  assert.equal(view.associations.length, 2);
  assert.equal(view.email, undefined);
});
test('unapproved completion after launch queues only after recorded admin approval', () => {
  const { s, c, athletes, links } = setup();
  launch(s, c);
  const a = athletes.find((a) => !a.completed);
  const raw = links[a.id].split('/').at(-1);
  s.saveAthlete(raw, {
    emails: 'new@example.test',
    message: 'Hello',
    authorization: true,
    done: true,
  });
  const contact = s.state.contacts.find((x) => x.email === 'new@example.test');
  assert.equal(s.state.jobs.filter((j) => j.contactId === contact.id).length, 0);
  assert.throws(() => s.approve(c.orgId, c.id, a.id, { approved: true }), /authorization record/);
  s.approve(c.orgId, c.id, a.id, {
    approved: true,
    authorizationNote: 'Sample approval documented',
  });
  assert.equal(s.state.jobs.filter((j) => j.contactId === contact.id).length, 3);
});
test('profile changes invalidate approval and keep new content out of public view', () => {
  const { s, c, athletes, links } = setup();
  const a = athletes[0];
  s.saveAthlete(links[a.id].split('/').at(-1), { message: 'Unreviewed changed message' });
  const view = s.publicView(c.slug, a.id);
  assert.equal(view.athlete.message, '');
  assert.equal(a.approved, false);
});
test('browser success cannot confirm; signed mock event updates once and blocks reminders', () => {
  const { s, c } = setup();
  launch(s, c);
  const r = donate(s, c);
  assert.equal(s.totals(c.id).grossCents, 0);
  const badEvent = {
    id: 'evt_0001',
    donationId: r.donation.id,
    amountCents: 10000,
    type: 'mock.payment_confirmed',
  };
  assert.throws(() => s.paymentEvent(badEvent, 'forged'), /signature/);
  assert.throws(
    () =>
      s.paymentEvent({ ...badEvent, amountCents: 1 }, s.signEvent({ ...badEvent, amountCents: 1 })),
    /does not match/,
  );
  s.simulatorEvent(r.receiptToken, 'evt_0001');
  s.simulatorEvent(r.receiptToken, 'evt_0001');
  s.simulatorEvent(r.receiptToken, 'evt_0002');
  assert.equal(s.totals(c.id).grossCents, 10000);
  assert.equal(s.totals(c.id).donationCount, 1);
  assert.equal(s.state.audit.length, 1);
  const contact = s.state.contacts.find(
    (x) => x.email === 'supporter@example.test' && x.campaignId === c.id,
  );
  assert.ok(
    s.state.jobs
      .filter((j) => j.contactId === contact.id && j.type === 'solicitation')
      .every((j) => j.status === 'blocked'),
  );
  s.run(c);
  s.run(c);
  assert.equal(s.state.jobs.filter((j) => j.type === 'thank-you' && j.status === 'sent').length, 1);
});
test('request retries return same donation; changed request payload conflicts', () => {
  const { s, c } = setup();
  launch(s, c);
  const r = donate(s, c);
  assert.deepEqual(donate(s, c), r);
  assert.equal(s.state.ledger.length, 1);
  assert.throws(() => donate(s, c, { amount: 101 }), /different details/);
});
test('external report pauses forever until resolved without raising totals', () => {
  const { s, c } = setup();
  launch(s, c);
  const r = donate(s, c, { method: 'venmo' });
  const contact = s.state.contacts.find(
    (x) => x.campaignId === c.id && x.email === 'supporter@example.test',
  );
  assert.equal(s.contactState(contact), 'pending');
  s.action(c.orgId, c.id, { action: 'advance', days: 9 });
  assert.equal(s.totals(c.id).grossCents, 0);
  assert.equal(s.contactState(contact), 'pending');
  assert.equal(
    s.state.jobs.filter((j) => j.contactId === contact.id && j.status === 'sent').length,
    0,
  );
  s.action(c.orgId, c.id, { action: 'advance', days: 40 });
  assert.equal(s.contactState(contact), 'pending');
  assert.equal(c.status, 'closed');
  assert.throws(() => s.simulatorEvent(r.receiptToken, 'external-event'), /Only mock Stripe/);
});
test('manual confirmation after close records audit, unknown fees, and one thank-you', () => {
  const { s, c } = setup();
  launch(s, c);
  const r = donate(s, c, { method: 'venmo' });
  s.action(c.orgId, c.id, { action: 'close' });
  confirm(s, c, r.donation);
  confirm(s, c, r.donation);
  assert.equal(s.state.audit.length, 1);
  assert.equal(s.totals(c.id).grossCents, 10000);
  assert.equal(s.totals(c.id).unknownFeeCount, 1);
  assert.equal(s.totals(c.id).knownNetCents, 0);
  s.run(c);
  assert.equal(s.state.jobs.filter((j) => j.type === 'thank-you' && j.status === 'sent').length, 1);
});
test('invalid reconciliation requires amount, date, method, audit note', () => {
  const { s, c } = setup();
  launch(s, c);
  const r = donate(s, c, { method: 'venmo' });
  for (const override of [
    { amount: '' },
    { receivedDate: '' },
    { method: 'other' },
    { method: 'stripe' },
    { note: '' },
    { fee: 101 },
    { receivedDate: '2099-01-01' },
  ])
    assert.throws(() => confirm(s, c, r.donation, override));
  assert.equal(s.state.ledger[0].status, 'pending');
  assert.equal(s.state.audit.length, 0);
});
test('duplicate transaction prevents double entry across organization campaigns', () => {
  const { s, c } = setup();
  launch(s, c);
  const first = donate(s, c, { method: 'venmo', transaction: 'shared-transaction' });
  confirm(s, c, first.donation, { transaction: 'shared-transaction' });
  assert.throws(
    () =>
      donate(s, c, {
        requestId: 'request_0002',
        method: 'venmo',
        transaction: ' SHARED-TRANSACTION ',
      }),
    /already exists/,
  );
});
test('correction, attribution and refund retain audit and correct totals', () => {
  const { s, c, athletes } = setup();
  launch(s, c);
  const r = donate(s, c, { method: 'venmo', athleteId: athletes[0].id });
  confirm(s, c, r.donation);
  s.reconcile(
    c.orgId,
    c.id,
    r.donation.id,
    {
      action: 'correct',
      requestId: 'correct_0001',
      amount: 120,
      fee: 2,
      method: 'venmo',
      receivedDate: c.now.slice(0, 10),
      transaction: 'corrected-transaction',
      note: 'Corrected statement amount',
    },
    'test-admin',
  );
  assert.equal(s.totals(c.id).grossCents, 12000);
  assert.equal(s.totals(c.id).knownNetCents, 11800);
  s.reconcile(
    c.orgId,
    c.id,
    r.donation.id,
    {
      action: 'attribute',
      athleteId: athletes[1].id,
      requestId: 'attribute_0001',
      note: 'Donor chose Alex',
    },
    'test-admin',
  );
  assert.equal(s.totals(c.id, athletes[0].id).grossCents, 0);
  assert.equal(s.totals(c.id, athletes[1].id).grossCents, 12000);
  s.reconcile(
    c.orgId,
    c.id,
    r.donation.id,
    { action: 'refund', requestId: 'refund_0001', note: 'Refunded mock donation' },
    'test-admin',
  );
  assert.equal(s.totals(c.id).grossCents, 0);
  assert.equal(s.state.audit.length, 4);
  assert.equal(s.state.audit.at(-1).before.status, 'confirmed');
  assert.equal(s.state.audit.at(-1).after.status, 'refunded');
  assert.equal(s.state.jobs.filter((j) => j.type === 'thank-you').length, 1);
});
test('unsubscribe blocks queued and future fundraising across same organization', () => {
  const { s, c, athletes } = setup();
  launch(s, c);
  const contact = s.state.contacts.find(
    (x) => x.campaignId === c.id && x.email === 'supporter@example.test',
  );
  s.unsubscribe(contact.publicToken);
  s.run(c);
  assert.ok(
    s.state.jobs.filter((j) => j.contactId === contact.id).every((j) => j.status === 'blocked'),
  );
  assert.equal(s.contactState(contact), 'suppressed');
  s.addContacts(athletes[1], 'supporter@example.test');
  assert.equal(s.state.jobs.filter((j) => j.contactId === contact.id).length, 3);
  const other = s.duplicate(c.orgId, c.id, { name: 'Next campaign' });
  const added = s.addAthlete(c.orgId, other.id, { name: 'Demo' });
  const a = s.findAthlete(other.id, added.athlete.id);
  a.completed = true;
  a.approved = true;
  a.approvedProfile = { displayName: 'Demo', message: '', photo: '' };
  s.addContacts(a, contact.email);
  launch(s, other);
  assert.equal(s.state.jobs.filter((j) => j.campaignId === other.id).length, 0);
});
test('complaints and hard bounces stop fundraising and cannot be retried', () => {
  for (const reason of ['complaint', 'hard_bounce']) {
    const { s, c } = setup();
    launch(s, c);
    const contact = s.state.contacts.find((x) => x.campaignId === c.id);
    const j = s.state.jobs.find((j) => j.contactId === contact.id);
    s.jobAction(c.orgId, c.id, j.id, 'fail');
    s.suppress(c.orgId, c.id, contact.email, reason);
    assert.equal(j.status, 'blocked');
    assert.throws(() => s.jobAction(c.orgId, c.id, j.id, 'retry'));
  }
});
test('pause/resume skips overdue; late contacts get one invitation and remaining steps', () => {
  const { s, c, athletes } = setup();
  launch(s, c);
  s.run(c);
  s.action(c.orgId, c.id, { action: 'pause' });
  s.action(c.orgId, c.id, { action: 'advance', days: 12 });
  assert.equal(s.state.jobs.filter((j) => j.campaignId === c.id && j.status === 'sent').length, 3);
  s.action(c.orgId, c.id, { action: 'resume' });
  s.run(c);
  assert.ok(
    s.state.jobs
      .filter((j) => j.campaignId === c.id && j.day === 10)
      .every((j) => j.status === 'skipped'),
  );
  s.addContacts(athletes[0], 'late@example.test');
  const late = s.state.contacts.find((x) => x.email === 'late@example.test');
  const jobs = s.state.jobs.filter((j) => j.contactId === late.id);
  assert.deepEqual(
    jobs.map((j) => j.day),
    [1, 20],
  );
  s.run(c);
  assert.equal(jobs.filter((j) => j.status === 'sent').length, 1);
  s.action(c.orgId, c.id, { action: 'advance', days: 7 });
  assert.equal(jobs.filter((j) => j.status === 'sent').length, 2);
});
test('contacts added while paused queue on resume without missed reminder backlog', () => {
  const { s, c, athletes } = setup();
  launch(s, c);
  s.action(c.orgId, c.id, { action: 'pause' });
  s.action(c.orgId, c.id, { action: 'advance', days: 12 });
  s.addContacts(athletes[0], 'paused@example.test');
  const contact = s.state.contacts.find((x) => x.email === 'paused@example.test');
  assert.equal(s.state.jobs.filter((j) => j.contactId === contact.id).length, 0);
  s.action(c.orgId, c.id, { action: 'resume' });
  assert.deepEqual(
    s.state.jobs.filter((j) => j.contactId === contact.id).map((j) => j.day),
    [1, 20],
  );
});
test('reject pending payment resumes only remaining messages, never backlog', () => {
  const { s, c } = setup();
  launch(s, c);
  const r = donate(s, c, { method: 'venmo' });
  s.action(c.orgId, c.id, { action: 'advance', days: 12 });
  s.reconcile(
    c.orgId,
    c.id,
    r.donation.id,
    { action: 'reject', requestId: 'reject_0001', note: 'No matching payment' },
    'test-admin',
  );
  const contact = s.state.contacts.find(
    (x) => x.email === 'supporter@example.test' && x.campaignId === c.id,
  );
  assert.equal(s.contactState(contact), 'active');
  s.run(c);
  assert.ok(
    s.state.jobs
      .filter((j) => j.contactId === contact.id && j.day < 20)
      .every((j) => j.status === 'skipped'),
  );
});
test('closing stops solicitation and new payments; pending still reconciles', () => {
  const { s, c } = setup();
  launch(s, c);
  const r = donate(s, c, { method: 'venmo' });
  s.action(c.orgId, c.id, { action: 'close' });
  s.run(c);
  assert.ok(
    s.state.jobs.filter((j) => j.type === 'solicitation').every((j) => j.status === 'blocked'),
  );
  assert.throws(() => donate(s, c, { requestId: 'request_0002' }), /not accepting/);
  assert.throws(() => s.action(c.orgId, c.id, { action: 'resume' }));
  confirm(s, c, r.donation);
  assert.equal(s.totals(c.id).grossCents, 10000);
});
test('failed jobs retry once without duplicate simulated delivery', () => {
  const { s, c } = setup();
  launch(s, c);
  const job = s.state.jobs[0];
  s.jobAction(c.orgId, c.id, job.id, 'fail');
  s.run(c);
  assert.equal(job.status, 'failed');
  s.jobAction(c.orgId, c.id, job.id, 'retry');
  s.jobAction(c.orgId, c.id, job.id, 'retry');
  assert.equal(job.status, 'sent');
  assert.equal(s.state.activity.filter((a) => a.type === 'email-simulated').length, 3);
});
test('organization scoping, private link rotation and public data minimization', () => {
  const { s, c, athletes, links } = setup();
  assert.throws(() => s.detail('century', c.id), /not found/);
  assert.throws(() => s.issueInvite('century', c.id, athletes[0].id), /not found/);
  const raw = links[athletes[0].id].split('/').at(-1);
  const fresh = s.issueInvite(c.orgId, c.id, athletes[0].id);
  assert.throws(() => s.athleteByToken(raw), /revoked/);
  assert.equal(s.athleteByToken(fresh.split('/').at(-1)).id, athletes[0].id);
  const ownView = s.athleteView(s.athleteByToken(fresh.split('/').at(-1)));
  assert.ok(ownView.contacts.includes('maya-fan@example.test'));
  assert.ok(!ownView.contacts.includes('alex-fan@example.test'));
  assert.throws(() => s.athleteByToken(athletes[0].id), /revoked/);
  assert.throws(() => s.athleteByToken(c.slug), /revoked/);
  const json = JSON.stringify(s.publicView(c.slug, athletes[0].id));
  for (const secret of [
    'inviteHash',
    'publicToken',
    'supporter@example.test',
    'passwordHash',
    'receiptHash',
  ])
    assert.ok(!json.includes(secret));
  assert.ok(!JSON.stringify(s.state.activity).includes(raw));
});
test('duplication copies settings only; no athletes, contacts, money or jobs', () => {
  const { s, c } = setup();
  launch(s, c);
  donate(s, c);
  const next = s.duplicate(c.orgId, c.id, {});
  const d = s.detail(c.orgId, next.id);
  assert.equal(d.status, 'draft');
  assert.equal(d.athletes.length, 0);
  assert.equal(d.ledger.length, 0);
  assert.equal(d.contacts.length, 0);
  assert.equal(d.jobs.length, 0);
  assert.notEqual(next.slug, c.slug);
  assert.equal(next.endDate, '2026-10-30');
});
test('campaign timezone calendar schedule and deadlines survive DST changes', () => {
  const { s, c } = setup();
  s.updateCampaign(c.orgId, c.id, { startDate: '2026-10-25', endDate: '2026-11-14' });
  c.now = '2026-10-25T12:00:00Z';
  launch(s, c);
  const day10 = s.state.jobs.find((j) => j.day === 10);
  assert.equal(day10.dueDate, '2026-11-03');
  c.now = '2026-11-03T07:30:00Z';
  s.run(c);
  assert.equal(day10.status, 'queued');
  c.now = '2026-11-03T08:30:00Z';
  s.run(c);
  assert.equal(day10.status, 'sent');
});
test('CSV validates whole import and neutralizes formula injection in exports', () => {
  const csv = parseAthleteCSV('name,displayName,team\r\n"Doe, Jane",Jane,Varsity\r\n,Missing,JV');
  assert.equal(csv.athletes[0].name, 'Doe, Jane');
  assert.equal(csv.errors.length, 1);
  assert.equal(csv.errors[0].row, 3);
  assert.throws(() => parseAthleteCSV('name,unexpected\nA,B'), /headers/);
  assert.throws(() => parseAthleteCSV('name\n"unclosed'), /unclosed/);
  const output = ledgerCSV([
    {
      reference: 'RALLY-TEST',
      donorName: '=HYPERLINK("evil")',
      amountCents: 10000,
      feeCents: null,
    },
  ]);
  assert.match(output, /'=HYPERLINK/);
  assert.match(output, /unknown/);
});
