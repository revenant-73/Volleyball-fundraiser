import test from 'node:test';
import assert from 'node:assert/strict';
import { Fundraiser, createSeed } from '../server/domain.js';
function setup() {
  const { state } = createSeed('2026-10-10T12:00:00Z');
  const s = new Fundraiser(state);
  const c = state.campaigns.find((c) => c.orgId === 'tvvc');
  s.action(c.orgId, c.id, { action: 'launch' });
  s.run(c);
  return { s, c };
}
test('editing launched templates/timing queues optional future messages without repeated deliveries', () => {
  const { s, c } = setup();
  s.action(c.orgId, c.id, { action: 'advance', days: 11 });
  const schedule = structuredClone(c.schedule);
  schedule[1].day = 14;
  schedule[1].subject = 'Updated reminder';
  schedule.push({
    id: 'extra',
    day: 15,
    enabled: true,
    subject: 'Team update',
    body: '{{organization}}: {{link}}',
  });
  s.updateCampaign(c.orgId, c.id, { schedule });
  assert.equal(s.state.jobs.filter((j) => j.day === 1 && j.status === 'sent').length, 3);
  assert.equal(s.state.jobs.filter((j) => j.stepId === 'extra').length, 3);
  // A previously skipped reminder stays skipped rather than being replayed.
  assert.ok(
    s.state.jobs.filter((j) => j.stepId === 'reminder').every((j) => j.status === 'skipped'),
  );
  s.action(c.orgId, c.id, { action: 'advance', days: 3 });
  assert.equal(s.state.jobs.filter((j) => j.stepId === 'extra' && j.status === 'sent').length, 3);
  s.run(c);
  assert.equal(s.state.jobs.filter((j) => j.stepId === 'extra' && j.status === 'sent').length, 3);
});
test('queued step timing moves, can disable/re-enable future steps, and removed preview is safe', () => {
  const { s, c } = setup();
  let schedule = structuredClone(c.schedule);
  schedule[1].day = 12;
  schedule[1].enabled = false;
  s.updateCampaign(c.orgId, c.id, { schedule });
  assert.ok(
    s.state.jobs.filter((j) => j.stepId === 'reminder').every((j) => j.status === 'skipped'),
  );
  schedule[1].enabled = true;
  s.updateCampaign(c.orgId, c.id, { schedule });
  assert.ok(
    s.state.jobs
      .filter((j) => j.stepId === 'reminder')
      .every((j) => j.status === 'queued' && j.dueDate === '2026-10-21'),
  );
  schedule = schedule.filter((s) => s.id !== 'final');
  s.updateCampaign(c.orgId, c.id, { schedule });
  assert.ok(
    s
      .detail(c.orgId, c.id)
      .jobs.filter((j) => j.stepId === 'final')
      .every((j) => j.subject === 'Removed message'),
  );
});
test('thank-you is a non-soliciting acknowledgement; unsubscribe blocks fundraising only', () => {
  const { s, c } = setup();
  const contact = s.state.contacts.find(
    (x) => x.email === 'supporter@example.test' && x.campaignId === c.id,
  );
  s.unsubscribe(contact.publicToken);
  const r = s.createDonation(c.slug, {
    requestId: 'thanks-unsub',
    amount: 25,
    email: contact.email,
    method: 'stripe',
  });
  s.simulatorEvent(r.receiptToken, 'thankyou-event');
  s.run(c);
  const thanks = s.state.jobs.find((j) => j.type === 'thank-you');
  assert.equal(thanks.status, 'sent');
  assert.ok(!thanks.preview.body.includes('/c/'));
  assert.ok(
    s.state.jobs
      .filter((j) => j.contactId === contact.id && j.type === 'solicitation' && j.day !== 1)
      .every((j) => j.status === 'blocked'),
  );
});
