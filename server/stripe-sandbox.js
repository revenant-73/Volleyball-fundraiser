import { randomUUID } from 'node:crypto';
import { AppError, createSeed, Fundraiser, hash } from './domain.js';
import { changeDues, synchronizeDues } from './dues.js';

export const STRIPE_SANDBOX = 'stripe-sandbox';

export function createStripeSandboxSeed() {
  const { state } = createSeed();
  const campaign = state.campaigns.find((c) => c.orgId === 'tvvc');
  const player = state.athletes.find((a) => a.campaignId === campaign.id && a.approved);
  Object.assign(campaign, {
    name: 'Fictional TVVC invite-only campaign',
    purpose: 'Try a test contribution toward a fictional player’s season dues.',
    goalCents: 100000,
  });
  for (const [method, settings] of Object.entries(campaign.paymentSettings))
    settings.enabled = method === 'stripe';
  state.organizations = state.organizations.filter((o) => o.id === 'tvvc');
  state.users = state.users.filter((u) => u.orgId === 'tvvc');
  state.campaigns = [campaign];
  Object.assign(player, {
    inviteHash: null,
    invitationStatus: 'not_issued',
    completed: false,
    approved: false,
    approvedProfile: null,
    authorization: false,
    authorizationNote: '',
    message: '',
  });
  state.athletes = [player];
  state.contacts = [];
  changeDues(
    new Fundraiser(state),
    'tvvc',
    campaign.id,
    player.id,
    {
      action: 'setup',
      version: 0,
      requestId: randomUUID(),
      season: 'Fictional Stripe test season',
      charges: '1000',
      target: '1000',
      note: 'Fictional Stripe sandbox setup.',
    },
    'sandbox-setup',
  );
  return { state, links: {}, mode: STRIPE_SANDBOX };
}

export function reserveCheckout(service, slug, input) {
  const campaign = service.publicCampaign(slug);
  assertSandboxDonationsOpen(campaign);
  const player = service.findAthlete(campaign.id, input.athleteId);
  if (
    campaign.orgId !== 'tvvc' ||
    !player.approved ||
    player.dues?.season !== 'Fictional Stripe test season' ||
    input.method !== 'stripe'
  )
    throw new AppError('Choose the approved fictional TVVC player.', 400);
  if (
    typeof input.email !== 'string' ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@example\.(com|test)$/i.test(input.email.trim())
  )
    throw new AppError('Use a fictional donor email at example.com or example.test.', 400);
  return service.createDonation(
    slug,
    {
      requestId: input.requestId,
      athleteId: player.id,
      method: 'stripe',
      email: input.email,
      donorName: input.donorName,
      amount: input.amount,
    },
    STRIPE_SANDBOX,
  );
}

export function assertSandboxDonationsOpen(campaign) {
  if (campaign.donationsStoppedAt || campaign.status !== 'active')
    throw new AppError('This campaign is closed to new test donations.', 409);
}

export function stopSandboxDonations(service, campaign) {
  if (campaign.donationsStoppedAt) return;
  campaign.donationsStoppedAt = new Date().toISOString();
  service.log(campaign, 'donations-stopped', 'The coach stopped new Stripe test donations.');
}

export function pendingSandboxCheckouts(service, campaignId) {
  return service.state.ledger.filter(
    (d) =>
      d.campaignId === campaignId &&
      d.paymentProvider === STRIPE_SANDBOX &&
      d.status === 'pending' &&
      d.stripeCheckout &&
      !d.stripeCheckout.terminalStatus,
  );
}

export function recordSandboxCheckoutClosure(service, donationId, terminalStatus) {
  const d = checkoutRecord(service, donationId);
  if (!['complete', 'expired'].includes(terminalStatus))
    throw new AppError('Stripe still has this checkout open.', 502);
  d.stripeCheckout.terminalStatus = terminalStatus;
  if (terminalStatus !== 'expired' || d.status !== 'pending') return;
  const before = service.auditSnapshot(d);
  d.status = 'rejected';
  const campaign = service.campaign(d.orgId, d.campaignId);
  service.audit(
    campaign,
    d,
    'stripe-sandbox-expired',
    'stripe-sandbox',
    before,
    'Stripe confirmed that this unpaid checkout expired.',
  );
}

export function sandboxDonation(service, id) {
  return service.state.ledger.find((d) => d.paymentProvider === STRIPE_SANDBOX && d.id === id);
}

export function checkoutRecord(service, id) {
  const d = sandboxDonation(service, id);
  if (!d) throw new AppError('Sandbox checkout reservation not found.', 404);
  return d;
}

export function attachCheckout(service, id, session) {
  const d = checkoutRecord(service, id);
  if (d.stripeCheckout && d.stripeCheckout.id !== session.id)
    throw new AppError('A different Checkout Session is already bound to this donation.', 409);
  d.stripeCheckout ||= session;
  return d;
}

export function stripeEventRecord(event) {
  return {
    key: `stripe-sandbox:${event.id}`,
    fingerprint: hash(JSON.stringify([event.type, event.data.object.id])),
  };
}

export function stripeEventProcessed(service, record) {
  const saved = service.state.events[record.key];
  if (saved && saved !== record.fingerprint) throw new AppError('Stripe event ID conflict.', 409);
  return Boolean(saved);
}

export function reconcileStripePayment(service, record, payment) {
  if (stripeEventProcessed(service, record)) return;
  const d = checkoutRecord(service, payment.donationId);
  if (
    d.stripeCheckout?.id !== payment.sessionId ||
    d.amountCents !== payment.amountCents ||
    d.campaignId !== payment.campaignId ||
    d.athleteId !== payment.athleteId ||
    (d.transaction && d.transaction !== payment.chargeId) ||
    (d.stripePaymentIntent && d.stripePaymentIntent !== payment.paymentIntentId)
  )
    throw new AppError('Stripe payment does not match its donation reservation.', 409);
  const c = service.campaign(d.orgId, d.campaignId);
  const before = service.auditSnapshot(d);
  const firstConfirmation = !d.everConfirmed;
  const newFee = d.feeCents === null && payment.feeCents !== null;
  const refunded = Math.max(d.refundedCents || 0, payment.refundedCents);
  const newRefund = refunded > (d.refundedCents || 0);

  if (firstConfirmation || newFee || newRefund) {
    service.uniqueTransaction(d.orgId, d.method, payment.chargeId, d.id);
    Object.assign(d, {
      status: refunded === d.amountCents ? 'refunded' : 'confirmed',
      everConfirmed: true,
      receivedDate: payment.receivedDate,
      transaction: payment.chargeId,
      stripePaymentIntent: payment.paymentIntentId,
      feeCents: newFee ? payment.feeCents : d.feeCents,
      refundedCents: refunded,
    });
    service.audit(
      c,
      d,
      newRefund
        ? 'stripe-sandbox-refund'
        : firstConfirmation
          ? 'stripe-sandbox-confirm'
          : 'stripe-sandbox-fee',
      'stripe-sandbox',
      before,
      newRefund
        ? 'Reconciled successful Stripe sandbox refunds.'
        : 'Verified Stripe sandbox payment details.',
    );
    synchronizeDues(
      service,
      service.findAthlete(c.id, d.athleteId),
      'stripe-sandbox',
      newRefund ? 'Stripe refund reduced the available dues credit.' : 'Stripe payment reconciled.',
    );
  }
  service.state.events[record.key] = record.fingerprint;
}
