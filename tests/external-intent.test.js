import test from 'node:test';
import assert from 'node:assert/strict';
import { Fundraiser, createSeed } from '../server/domain.js';
test('reference exists before external payment; only report pauses; retry safe after close', () => {
  const { state } = createSeed('2026-10-10T12:00:00Z');
  const s = new Fundraiser(state);
  const c = state.campaigns.find((c) => c.orgId === 'tvvc');
  s.action(c.orgId, c.id, { action: 'launch' });
  const r = s.createDonation(c.slug, {
    requestId: 'intent_0001',
    amount: 60,
    email: 'supporter@example.test',
    method: 'venmo',
    intent: true,
  });
  const contact = state.contacts.find(
    (x) => x.email === 'supporter@example.test' && x.campaignId === c.id,
  );
  assert.match(r.donation.reference, /^RALLY-/);
  assert.equal(r.donation.reported, false);
  assert.equal(s.contactState(contact), 'active');
  assert.equal(s.totals(c.id).grossCents, 0);
  s.action(c.orgId, c.id, { action: 'close' });
  const input = { requestId: 'report_0001', amount: 60, transaction: 'venmo-reported-001' };
  const reported = s.reportPayment(r.receiptToken, input);
  assert.equal(reported.donation.reported, true);
  assert.equal(s.contactState(contact), 'pending');
  assert.deepEqual(s.reportPayment(r.receiptToken, input), reported);
  assert.equal(state.ledger.length, 1);
  assert.equal(s.totals(c.id).grossCents, 0);
});
