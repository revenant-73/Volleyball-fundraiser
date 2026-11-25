# Stripe sandbox rehearsal

This is an isolated local mode. It binds to loopback and seeds one draft TVVC campaign with one fictional player and a $1,000 season account. The invite-only rehearsal uses `.local/stripe-invite-rehearsal`. Earlier checkout rehearsals remain in `.local/stripe-sandbox`. Use test cards and fictional donor details only.

## Run the rehearsal

Use a dedicated Stripe sandbox and a sandbox restricted key with Checkout Session write/read and payment, refund, and dispute read access. Use the Stripe CLI to forward the events below and take the signing secret from that listener. The operator running test refunds or submitting test dispute evidence needs the corresponding write permission.

```powershell
$events = @(
  'checkout.session.completed', 'checkout.session.expired',
  'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'payment_intent.payment_failed', 'charge.updated', 'charge.refunded',
  'refund.created', 'refund.updated', 'refund.failed',
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed',
  'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated'
) -join ','
stripe listen --latest --events $events --forward-to http://127.0.0.1:3102/api/stripe-sandbox/webhook
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

The Stripe SDK verifies the raw webhook signature. The server matches Checkout Session, payment intent, charge, USD amount and fictional player attribution. The original processing fee comes from the charge's balance transaction. A declined card can be retried while its Checkout Session stays open. Stripe-confirmed expiration and final asynchronous failure close the pending donation without funds or dues credit. A payment already submitted and processing can settle after the campaign stops.

An open dispute reduces the credit available to post. When Stripe reports a win, the hold lifts. A loss reduces the confirmed funds and reverses any posted credit that now exceeds the net contribution. Successful refunds and dispute losses are tracked separately at the provider level and capped at the original contribution. If Stripe flags a dispute but its details cannot be read, the app holds the remaining credit and keeps the webhook eligible for retry.

## Coach-to-admin handoff

Use the fictional campaign and a separate browser session for each role. The local sandbox uses a demo coach account. This exercises the handoff, while named administrator access is tested separately in the TVVC preparation pilot.

| Role       | Rehearsal action                                                                                                                                                         | What to hand off or verify                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coach      | Issue the private setup link, record the fictional guardian authorization, approve the profile, and open test donations.                                                 | Campaign and player label, approval reference, and the public donation link. Keep the setup link with the player.                                                      |
| Donor      | Open the shared link in a fresh session and submit a $100 test payment.                                                                                                  | The RallyFund donation reference. The recipient page should select the correct player.                                                                                 |
| Dues admin | Match the signed Stripe confirmation and actual fee to the donation. Record the net credit using **Record reconciled credit posting** and a fictional billing reference. | Stripe charge ID, gross, fee, applied credit, and billing reference. An unknown fee or open dispute leaves the affected credit unavailable.                            |
| Dues admin | Reconcile a $25 partial refund. Use **Reconcile external credit reversal** after matching the reversal to a fictional billing reference.                                 | Original gift and fee, updated applied credit, Stripe refund reference, and one reversal receipt. If the fee is $3.20, the applied credit falls from $96.80 to $71.80. |
| Coach      | Leave an unpaid checkout open, then choose **Stop test donations**.                                                                                                      | New checkout requests fail, Stripe expires the open session, and a previously completed payment still reconciles when its signed event arrives.                        |

Record the expected result, actual result, and any unresolved item for each role. The automated suites can check the state transitions and repeat deliveries with fictional fixtures. A provider rehearsal adds the Stripe references and outcomes observed in the sandbox. A separate coach or admin running these steps without prompts is the check that the instructions are usable by another operator.

To run the automated handoff, install Playwright Chromium and use a Stripe sandbox key with Checkout, charge, and refund access in the ignored environment file. The runner starts a loopback app and its own Stripe CLI listener. If Stripe CLI is installed elsewhere, set `RALLYFUND_STRIPE_CLI` to its executable path.

```powershell
npm run rehearse:stripe-handoff
```

The runner uses four independent browser sessions and creates one fictional campaign in a new local data directory per run. It verifies the methods Stripe actually enables, pays with a test card, posts net dues credit, issues a partial refund, records the reversal receipt, and stops a second checkout. The coach and dues admin sessions use the same demo account in this sandbox.

New sandbox Checkout Sessions allow only cards and disable Link. RallyFund checks that Stripe returned those settings before it gives the donor a Checkout URL. Delayed bank settlement remains unverified with the current provider sandbox, and the first proposed family release uses cards. Complete provider dispute resolution in a sandbox with dispute access before live collection.

## Verified on November 24, 2026

Stripe-hosted Checkout accepted a $100 test card contribution from the fictional player's link. The Stripe CLI forwarded the signed payment event, and RallyFund read a $3.20 fee from the original charge. An administrator posted $96.80 to the fictional dues account. Stripe then reported a successful $25 partial refund. The applied credit fell to $71.80 and RallyFund recorded one $25 reversal awaiting external reconciliation.

Replaying the genuine payment and refund events twice each did not add ledger entries or change credits. The automated regression also checks invalid signatures, live-event rejection, delayed fees, duplicate notifications racing each other, stale refund totals and replay after a server restart.

The invite-only rehearsal passed from coach link issuance through approval and sharing into a separate iPhone-sized WebKit browser. Stripe confirmed one test card payment. The stop control expired a second, still-open Stripe Checkout Session, blocked new and repeated checkout requests, and preserved the confirmed payment. The regression also checks a checkout being created concurrently with the stop and a failed expiration retried after restarting.

The provider rehearsal verified a real test card decline and an expired unpaid session, with no dues credit for either. A $45 test payment completed at Stripe before the campaign stopped and was reconciled after its signed notification was released. An open $28 checkout expired during the same stop. A real test dispute placed the remaining credit on hold when the temporary key could not read its details.

The lifecycle regression uses signed webhook deliveries and fictional Stripe API responses for delayed payment success and failure, dispute wins and losses, API permission errors, and repeated or out-of-order events. The temporary Stripe sandbox has no ACH capability and its key cannot read dispute details. Rehearse real delayed bank settlement and dispute resolution in a sandbox with those capabilities before launch.

## Verified on November 25, 2026

The automated handoff verified that Stripe returned only `card` with Link disabled. The fictional donor paid $100, the admin posted $96.80 after the $3.20 Stripe fee, and the $25 refund reduced the credit to $71.80. The admin recorded the reversal receipt. The coach's stop expired a second, unpaid checkout and blocked a fresh checkout request.

An existing TVVC Stripe test credential could list disputes. The temporary rehearsal key returned a permission error. Dashboard sign-in is needed to confirm whether the TVVC credential belongs to a dedicated sandbox and whether that environment can submit dispute evidence. No disputes were modified in the TVVC test environment.
