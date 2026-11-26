import { STRIPE_QA_ORIGIN } from './stripe-client.js';

export const STRIPE_QA_SITE = '9cecbf1f-c416-4ec5-9550-16a261ba2aed';
export const STRIPE_QA_MODE = 'stripe-qa';

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
