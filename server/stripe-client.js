import Stripe from 'stripe';
import { AppError } from './domain.js';

const sessionEvents = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);
const chargeEvents = new Set(['charge.updated', 'charge.refunded']);
const refundEvents = new Set(['refund.created', 'refund.updated', 'refund.failed']);
const disputeEvents = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
]);
const failedPaymentEvent = 'payment_intent.payment_failed';
export const stripeSandboxEvents = Object.freeze([
  ...sessionEvents,
  ...chargeEvents,
  ...refundEvents,
  ...disputeEvents,
  failedPaymentEvent,
]);
const providerId = (value) => (typeof value === 'string' ? value : value?.id);
const usdCents = (value) => Number.isSafeInteger(value) && value >= 0;

export function createStripeSandboxClient({ key, webhookSecret, origin, httpClient }) {
  if (
    !/^(?:[rs]k|rkcs)_test_[a-zA-Z0-9]+$/.test(key || '') ||
    !/^whsec_[a-zA-Z0-9]+$/.test(webhookSecret || '')
  )
    throw new Error('Stripe sandbox mode requires a test API key and a webhook signing secret.');
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== origin)
    throw new Error('Stripe sandbox Checkout must return to the local RallyFund app.');
  const stripe = new Stripe(key, { maxNetworkRetries: 2, timeout: 10000, httpClient });
  return {
    async createCheckout(donation, campaignSlug) {
      const metadata = {
        rallyfund_donation_id: donation.id,
        rallyfund_campaign_id: donation.campaignId,
        rallyfund_athlete_id: donation.athleteId,
      };
      const returnUrl = new URL(
        `/c/${encodeURIComponent(campaignSlug)}/a/${encodeURIComponent(donation.athleteId)}`,
        origin,
      ).href;
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          allowed_payment_method_types: ['card'],
          wallet_options: { link: { display: 'never' } },
          client_reference_id: donation.id,
          customer_email: donation.email,
          metadata,
          payment_intent_data: { metadata },
          line_items: [
            {
              price_data: {
                currency: 'usd',
                unit_amount: donation.amountCents,
                product_data: { name: 'Fictional TVVC player dues contribution' },
              },
              quantity: 1,
            },
          ],
          adaptive_pricing: { enabled: false },
          integration_identifier: 'rallyfund_sandbox_fybkwmph',
          expires_at: Math.floor(donation.checkoutReservedAt / 1000) + 3600,
          success_url: returnUrl,
          cancel_url: returnUrl,
        },
        { idempotencyKey: `rallyfund-sandbox-checkout:${donation.id}` },
      );
      if (
        session.livemode !== false ||
        !session.id?.startsWith('cs_test_') ||
        !session.url ||
        new URL(session.url).origin !== 'https://checkout.stripe.com'
      )
        throw new AppError('Stripe did not return an eligible sandbox Checkout Session.', 502);
      const cardOnly =
        session.payment_method_types?.length === 1 &&
        session.payment_method_types[0] === 'card' &&
        session.wallet_options?.link?.display === 'never';
      if (!cardOnly) {
        const expired = await stripe.checkout.sessions.expire(session.id).catch(() => null);
        return {
          id: session.id,
          expiresAt: session.expires_at,
          url: null,
          cardOnly: false,
          ...(expired?.status === 'expired' ? { terminalStatus: 'expired' } : {}),
        };
      }
      return { id: session.id, url: session.url, expiresAt: session.expires_at, cardOnly: true };
    },
    async expireCheckout(id) {
      if (!id.startsWith('cs_test_'))
        throw new AppError('Only a Stripe test checkout can be expired here.', 400);
      let session = await stripe.checkout.sessions.retrieve(id, { expand: ['payment_intent'] });
      if (session.livemode !== false || session.id !== id)
        throw new AppError('This checkout is outside the Stripe sandbox.', 409);
      if (session.status === 'open') {
        if (
          ['processing', 'succeeded', 'requires_capture'].includes(session.payment_intent?.status)
        )
          return 'processing';
        try {
          session = await stripe.checkout.sessions.expire(id);
        } catch {
          // A payer can complete Checkout between the read and expiration request.
          session = await stripe.checkout.sessions.retrieve(id);
        }
      }
      if (session.livemode !== false || session.id !== id)
        throw new AppError('This checkout is outside the Stripe sandbox.', 409);
      return session.status;
    },
    verifyWebhook(raw, signature) {
      let event;
      try {
        event = stripe.webhooks.constructEvent(raw, signature, webhookSecret);
      } catch {
        throw new AppError('Invalid Stripe webhook signature.', 401);
      }
      if (event.livemode !== false || event.account || !/^evt_[a-z0-9]+$/i.test(event.id || ''))
        throw new AppError('Only events from this Stripe sandbox are allowed.', 400);
      if (!event.data?.object?.id)
        throw new AppError('Stripe webhook event has no resource identity.', 400);
      return event;
    },
    async paymentForEvent(event, findDonation) {
      const object = event.data.object;
      let donationId = object.metadata?.rallyfund_donation_id;
      let incomingChargeId = null;
      const failedAttempt = event.type === failedPaymentEvent;
      const disputeEvent = disputeEvents.has(event.type);
      if (chargeEvents.has(event.type)) {
        incomingChargeId = object.id;
      } else if (refundEvents.has(event.type) || disputeEvent) {
        incomingChargeId = providerId(object.charge);
        if (!incomingChargeId) return null;
        const charge = await stripe.charges.retrieve(incomingChargeId);
        donationId = charge.metadata?.rallyfund_donation_id;
      } else if (!sessionEvents.has(event.type) && !failedAttempt) return null;

      const d = findDonation(donationId);
      if (!d) return null;
      if (!d.stripeCheckout)
        throw new AppError('Wait for the checkout reservation to finish.', 503);
      if (sessionEvents.has(event.type) && object.id !== d.stripeCheckout.id)
        throw new AppError('Stripe event belongs to a different Checkout Session.', 409);

      // Read the current provider state instead of trusting the arrival order of snapshots.
      const session = await stripe.checkout.sessions.retrieve(d.stripeCheckout.id, {
        expand: ['payment_intent.latest_charge.balance_transaction'],
      });
      if (
        session.livemode !== false ||
        session.currency !== 'usd' ||
        session.amount_total !== d.amountCents ||
        session.client_reference_id !== d.id ||
        session.metadata?.rallyfund_donation_id !== d.id ||
        session.metadata?.rallyfund_campaign_id !== d.campaignId ||
        session.metadata?.rallyfund_athlete_id !== d.athleteId
      )
        throw new AppError('Stripe Checkout details do not match the donation.', 409);
      const intent = session.payment_intent;
      const reservation = {
        donationId: d.id,
        sessionId: session.id,
        campaignId: d.campaignId,
        athleteId: d.athleteId,
        amountCents: d.amountCents,
      };
      if (session.payment_status !== 'paid') {
        if (session.status === 'expired') return { ...reservation, checkoutState: 'expired' };
        if (session.status === 'complete') {
          if (['canceled', 'requires_payment_method'].includes(intent?.status))
            return { ...reservation, checkoutState: 'failed' };
          return { ...reservation, checkoutState: 'processing' };
        }
        if (
          failedAttempt &&
          intent?.id === object.id &&
          intent.status === 'requires_payment_method'
        )
          return { ...reservation, checkoutState: 'declined' };
        return null;
      }

      const charge = intent?.latest_charge;
      if (!charge || typeof charge !== 'object')
        throw new AppError('Stripe has not finished recording the charge. Retry this event.', 503);
      if (
        intent.livemode !== false ||
        intent.status !== 'succeeded' ||
        intent.currency !== 'usd' ||
        intent.amount_received !== d.amountCents ||
        charge.livemode !== false ||
        charge.currency !== 'usd' ||
        !charge.paid ||
        !charge.captured ||
        charge.amount_captured !== d.amountCents ||
        (d.stripeCheckout.cardOnly && charge.payment_method_details?.type !== 'card') ||
        providerId(charge.payment_intent) !== intent.id ||
        (incomingChargeId && incomingChargeId !== charge.id)
      )
        throw new AppError('Stripe charge details do not match the paid Checkout Session.', 409);

      const balance = charge.balance_transaction;
      let feeCents = null;
      if (balance && typeof balance === 'object') {
        if (
          balance.currency !== 'usd' ||
          balance.amount !== d.amountCents ||
          providerId(balance.source) !== charge.id ||
          !usdCents(balance.fee)
        )
          throw new AppError('Stripe processing fee does not match the original charge.', 409);
        feeCents = balance.fee;
      }

      let refundedCents = 0;
      if (charge.amount_refunded > 0 || refundEvents.has(event.type))
        for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 })) {
          if (refund.status !== 'succeeded') continue;
          if (
            providerId(refund.charge) !== charge.id ||
            refund.currency !== 'usd' ||
            !usdCents(refund.amount)
          )
            throw new AppError('Stripe refund does not match the original charge.', 409);
          refundedCents += refund.amount;
        }
      if (refundedCents > d.amountCents)
        throw new AppError('Stripe refunds exceed the captured contribution.', 409);
      const disputes = [];
      let disputeVerificationPending = false;
      if (
        charge.disputed ||
        disputeEvent ||
        d.stripeDisputeNeedsReview ||
        Object.keys(d.stripeDisputes || {}).length
      ) {
        try {
          for await (const dispute of stripe.disputes.list({ charge: charge.id, limit: 100 })) {
            if (
              dispute.livemode !== false ||
              providerId(dispute.charge) !== charge.id ||
              dispute.currency !== 'usd' ||
              !usdCents(dispute.amount) ||
              !/^du_[a-z0-9]+$/i.test(dispute.id || '')
            )
              throw new AppError('Stripe dispute does not match the original charge.', 409);
            disputes.push({ id: dispute.id, status: dispute.status, amountCents: dispute.amount });
          }
          disputeVerificationPending =
            (disputeEvent && !disputes.some((d) => d.id === object.id)) ||
            ((charge.disputed || d.stripeDisputeNeedsReview) && disputes.length === 0);
        } catch (error) {
          if (!error.type?.startsWith('Stripe')) throw error;
          // The charge is confirmed, but only the Disputes API can clear the credit hold.
          disputeVerificationPending = true;
        }
      }
      return {
        ...reservation,
        chargeId: charge.id,
        paymentIntentId: intent.id,
        feeCents,
        refundedCents,
        disputes: disputeVerificationPending ? [] : disputes,
        disputeVerificationPending,
        receivedDate: new Date(charge.created * 1000).toISOString().slice(0, 10),
      };
    },
  };
}
