import { randomUUID } from 'node:crypto';
import { STRIPE_QA_ORIGIN } from './stripe-client.js';
import { createStripeSandboxSeed, QA_COACH, QA_DUES_ADMIN } from './stripe-sandbox.js';

export const STRIPE_QA_SITE = '9cecbf1f-c416-4ec5-9550-16a261ba2aed';
export const STRIPE_QA_MODE = 'stripe-qa';
export const STRIPE_QA_PHONE_SNAPSHOT = 'stripe-qa-phone-v1';
export const stripeQaAccounts = [
  { email: 'coach@tvvc.example', role: QA_COACH },
  { email: 'dues-admin@tvvc.example', role: QA_DUES_ADMIN },
];

export function createStripeQaPhoneSeed() {
  const snapshot = createStripeSandboxSeed();
  const { state } = snapshot;
  state.campaigns[0].name = 'Fictional TVVC two-phone rehearsal';
  Object.assign(state.athletes[0], { name: 'Sample Riley', displayName: 'Sample Riley' });
  state.users = stripeQaAccounts.map((account) => ({
    ...account,
    id: randomUUID(),
    orgId: 'tvvc',
  }));
  return snapshot;
}

export function assertStripeQaContext(mode, context, origin) {
  if (
    mode !== STRIPE_QA_MODE ||
    context.site?.id !== STRIPE_QA_SITE ||
    context.deploy?.context !== 'production' ||
    context.deploy?.published === false ||
    origin !== STRIPE_QA_ORIGIN ||
    context.site?.url?.replace(/^http:/, 'https:').replace(/\/$/, '') !== STRIPE_QA_ORIGIN
  )
    throw new Error('The published RallyFund QA site is required.');
}
