# Stripe sandbox rehearsal

This is an isolated local mode. It binds to loopback, uses its own snapshot in `.local/stripe-sandbox`, and seeds one fictional TVVC player with a $1,000 season account. The normal review and hosted TVVC pilot keep their current service gates. Use test cards and fictional donor details only.

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

1. Run `npm run dev:stripe-sandbox` and open http://127.0.0.1:5175. Open the fictional TVVC campaign and then the player link. Use a fictional email at `example.com` or `example.test` and submit a test contribution through Stripe Checkout.
2. On return, refresh the payment status if Stripe has yet to deliver the event. The local receipt and campaign totals reflect the verified notification. A return page cannot confirm a contribution.
3. Sign in with the local demo TVVC account and open **Dues**. Wait for the original charge's actual balance transaction fee. Until then, the verified gross is visible but no credit can be posted. Apply the available net amount with a fictional external posting reference.
4. Issue a partial refund in the same Stripe sandbox. Once Stripe reports the refund succeeded, inspect **Dues**. The original contribution and processing fee remain in the audit history. Net funds and posted credit fall where necessary, and any required external reversal remains open for administrator reconciliation.
5. Repeat the same signed event, or run `npm test` for the automated replay and restart checks. An event ID, Checkout request ID and dues posting request ID each have separate durable replay records. Distinct events for the same refund reconcile against the cumulative successful refund total, so there is only one financial effect.

The Stripe SDK verifies the raw webhook signature. The server matches Checkout Session, payment intent, charge, USD amount and fictional player attribution. The original processing fee comes from the charge's balance transaction. Pending or failed refunds do not decrease credit. Unpaid or abandoned Checkout Sessions stay pending in this rehearsal. TVVC billing, fundraising email and public production campaigns remain gated.

## Verified on November 24, 2026

Stripe-hosted Checkout accepted a $100 test card contribution from the fictional player's link. The Stripe CLI forwarded the signed payment event, and RallyFund read a $3.20 fee from the original charge. An administrator posted $96.80 to the fictional dues account. Stripe then reported a successful $25 partial refund. The applied credit fell to $71.80 and RallyFund recorded one $25 reversal awaiting external reconciliation.

Replaying the genuine payment and refund events twice each did not add ledger entries or change credits. The automated regression also checks invalid signatures, live-event rejection, delayed fees, duplicate notifications racing each other, stale refund totals and replay after a server restart.
