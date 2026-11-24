# Stripe sandbox rehearsal

This is an isolated local mode. It binds to loopback and seeds one draft TVVC campaign with one fictional player and a $1,000 season account. The invite-only rehearsal uses `.local/stripe-invite-rehearsal`. Earlier checkout rehearsals remain in `.local/stripe-sandbox`. Use test cards and fictional donor details only.

## Run the rehearsal

Use a dedicated Stripe sandbox and a sandbox restricted key with Checkout Session write/read and payment and refund read access. Use the Stripe CLI to forward the events below and take the signing secret from that listener. An operator issuing a test refund needs separate refund write access.

```powershell
stripe listen --latest --events checkout.session.completed,checkout.session.async_payment_succeeded,charge.updated,charge.refunded,refund.created,refund.updated,refund.failed --forward-to http://127.0.0.1:3102/api/stripe-sandbox/webhook
```

Create the ignored `.env.stripe-sandbox` file in the project folder. Put the test key and listener secret in that local file and keep them out of source, logs and chat.

```dotenv
RALLYFUND_MODE=stripe-sandbox
PROTOTYPE_API_PORT=3102
PROTOTYPE_WEB_PORT=5175
RALLYFUND_STRIPE_TEST_KEY=
RALLYFUND_STRIPE_WEBHOOK_SECRET=
```

1. Run `npm run dev:stripe-sandbox` and sign in with the local demo TVVC coach account at http://127.0.0.1:5175/admin. Under **Athletes**, expand the fictional player and choose **Issue private setup link**. Open it in a separate session. The setup form accepts the public profile and guardian acknowledgement. The API rejects donor contact uploads.
2. Save and complete setup. Record the fictional guardian authorization and approve the profile as the coach. On the setup page, choose **Check approval status** to reveal the donation link. The dashboard's **Open test donations** control requires approval. The campaign is unlisted. Donors use the link the player shares.
3. From the shared link, use a fictional email at `example.com` or `example.test` and submit a test contribution through Stripe Checkout. On return, refresh the receipt if Stripe has yet to deliver the signed event. In **Dues**, wait for the original charge's fee and record the available net credit with a fictional posting reference.
4. Issue a partial refund in the same Stripe sandbox and confirm that the credit and required reversal adjust. Repeat the payment and refund notifications to check that they have no additional effect.
5. Leave a second Stripe Checkout open and press **Stop test donations** on the coach dashboard. The app records the stop before it contacts Stripe, blocks fresh requests and retries, and expires open Checkout Sessions. Stripe sessions already completed can still confirm or reconcile through signed events. If Stripe cannot confirm closure of some sessions, the dashboard provides a retry. The stop survives a restart and is final for the campaign.

The Stripe SDK verifies the raw webhook signature. The server matches Checkout Session, payment intent, charge, USD amount and fictional player attribution. The original processing fee comes from the charge's balance transaction. Pending or failed refunds do not decrease credit. Natural abandonment remains pending unless the coach stops donations and Stripe confirms expiration. TVVC billing, fundraising email and public production campaigns remain gated.

## Verified on November 24, 2026

Stripe-hosted Checkout accepted a $100 test card contribution from the fictional player's link. The Stripe CLI forwarded the signed payment event, and RallyFund read a $3.20 fee from the original charge. An administrator posted $96.80 to the fictional dues account. Stripe then reported a successful $25 partial refund. The applied credit fell to $71.80 and RallyFund recorded one $25 reversal awaiting external reconciliation.

Replaying the genuine payment and refund events twice each did not add ledger entries or change credits. The automated regression also checks invalid signatures, live-event rejection, delayed fees, duplicate notifications racing each other, stale refund totals and replay after a server restart.

The invite-only rehearsal passed from coach link issuance through approval and sharing into a separate iPhone-sized WebKit browser. Stripe confirmed one test card payment. The stop control expired a second, still-open Stripe Checkout Session, blocked new and repeated checkout requests, and preserved the confirmed payment. The regression also checks a checkout being created concurrently with the stop and a failed expiration retried after restarting.
