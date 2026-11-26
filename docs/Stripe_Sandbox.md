# Stripe sandbox rehearsal

The local rehearsal binds to loopback and seeds one draft TVVC campaign with one fictional player and a $1,000 season account. The invite-only rehearsal uses `.local/stripe-invite-rehearsal`. Earlier checkout rehearsals remain in `.local/stripe-sandbox`. Use test cards and fictional donor details only.

## Hosted dress rehearsal

The [RallyFund TVVC QA site](https://rallyfund-tvvc-qa.netlify.app/admin) uses its own Netlify project and Postgres database. The server accepts the QA mode only on the published canonical site and verifies that the test key belongs to the dedicated RallyFund QA Stripe account. The single fictional campaign is unlisted and only the approved player link opens its donation page. Donor contact uploads and email delivery are disabled.

Set `RALLYFUND_MODE` to `stripe-qa` for the QA project's production Functions context. Configure `RALLYFUND_QA_COACH_PASSWORD`, `RALLYFUND_QA_DUES_PASSWORD`, `RALLYFUND_STRIPE_TEST_KEY`, and `RALLYFUND_STRIPE_WEBHOOK_SECRET` as Functions-only secrets. The Stripe test webhook targets `/api/stripe-sandbox/webhook` on the canonical QA host and listens to the events listed below. The hosted key can create and expire Checkout Sessions and read the payment and dispute details needed for reconciliation. Operators use a separate sandbox credential for test refunds and dispute evidence.

The [two-phone runbook](TVVC_QA_Two_Phone_Rehearsal.md) uses separate coach and dues-admin accounts and an on-screen QR code. The fresh draft is stored separately from the original stopped rehearsal. To run the automated handoff instead, use `node scripts/verify-stripe-handoff.mjs --hosted-qa` with a RallyFund QA operator test key in the process environment and private role credentials in `.local/hosted-stripe-qa-phone`. Run it against a fresh QA campaign. Stopping test donations leaves the campaign closed for readback.

On November 26, 2026, the hosted rehearsal confirmed that the player could share the donation link only after coach approval. A donor opened it in a separate mobile browser session and paid $100 by test card. Stripe offered cards only and Link was disabled. The dues admin posted $96.80 after the $3.20 fee. A $25 refund reduced the credit to $71.80, and the admin reconciled the reversal. The coach's stop expired another unpaid Stripe Checkout Session and rejected a new checkout request. The QA ledger held no donor contacts or email jobs.

## Run the rehearsal

Use TVVC's dedicated **RallyFund QA** sandbox and a sandbox restricted key with Checkout Session write/read and payment, refund, and dispute read access. Use the Stripe CLI to forward the events below and take the signing secret from that listener. The operator running test refunds or submitting test dispute evidence needs the corresponding write permission.

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

New sandbox Checkout Sessions allow only cards and disable Link. RallyFund checks that Stripe returned those settings before it gives the donor a Checkout URL. Delayed bank settlement remains unverified, and the first proposed family release uses cards.

## Verified on November 24, 2026

Stripe-hosted Checkout accepted a $100 test card contribution from the fictional player's link. The Stripe CLI forwarded the signed payment event, and RallyFund read a $3.20 fee from the original charge. An administrator posted $96.80 to the fictional dues account. Stripe then reported a successful $25 partial refund. The applied credit fell to $71.80 and RallyFund recorded one $25 reversal awaiting external reconciliation.

Replaying the genuine payment and refund events twice each did not add ledger entries or change credits. The automated regression also checks invalid signatures, live-event rejection, delayed fees, duplicate notifications racing each other, stale refund totals and replay after a server restart.

The invite-only rehearsal passed from coach link issuance through approval and sharing into a separate iPhone-sized WebKit browser. Stripe confirmed one test card payment. The stop control expired a second, still-open Stripe Checkout Session, blocked new and repeated checkout requests, and preserved the confirmed payment. The regression also checks a checkout being created concurrently with the stop and a failed expiration retried after restarting.

The provider rehearsal verified a real test card decline and an expired unpaid session, with no dues credit for either. A $45 test payment completed at Stripe before the campaign stopped and was reconciled after its signed notification was released. An open $28 checkout expired during the same stop. A real test dispute placed the remaining credit on hold when the temporary key could not read its details.

The lifecycle regression uses signed webhook deliveries and fictional Stripe API responses for delayed payment success and failure, dispute wins and losses, API permission errors, and repeated or out-of-order events. The temporary Stripe sandbox has no ACH capability and its key cannot read dispute details. Rehearse real delayed bank settlement and dispute resolution in a sandbox with those capabilities before launch.

## Verified on November 25, 2026

The automated handoff verified that Stripe returned only `card` with Link disabled. The fictional donor paid $100, the admin posted $96.80 after the $3.20 Stripe fee, and the $25 refund reduced the credit to $71.80. The admin recorded the reversal receipt. The coach's stop expired a second, unpaid checkout and blocked a fresh checkout request.

An existing TVVC Stripe test credential could list disputes. The temporary rehearsal key returned a permission error.

## Verified on November 26, 2026

TVVC's Stripe Dashboard showed only its standard Test mode and zero dedicated sandboxes. The existing TVVC test credential matched that environment and could read disputes and submit simulated evidence. The rehearsal used two new fictional gifts and a local dues ledger.

- **Won dispute.** Stripe opened a $100 dispute and RallyFund held the entire gift. A Stripe close event released the hold and restored $96.80 in eligible credit after the $3.20 processing fee.
- **Lost dispute.** RallyFund posted $96.80 from a separate $100 gift. A $25 partial refund reduced the posted credit to $71.80 and triggered a dispute on the remaining $75. Stripe closed that dispute as lost. RallyFund reduced posted credit to $0 and recorded one $71.80 dispute reversal alongside the earlier $25 refund reversal. Replaying the Stripe close event twice added no entries. Both reversals awaited external reconciliation in the fictional ledger.

The rehearsal exposed a validation error on Stripe's `du_` dispute IDs. After correcting it, replaying the original Checkout event through the local webhook recovered the hold from Stripe's current state. The dispute closures then reached RallyFund through the Stripe CLI listener.

### Dedicated RallyFund QA sandbox

Created **RallyFund QA** under TVVC with live-account copying turned off. The local verifier checked that the test key belonged to the new sandbox before running the rehearsals.

- **Card-only handoff.** Stripe returned `card` as the sole payment method and Link disabled. The $100 gift posted $96.80 after fees. A $25 refund reduced the posted credit to $71.80, and the admin recorded the reversal receipt. Stopping donations expired a separate unpaid checkout and blocked new checkout requests.
- **Won dispute.** Stripe closed a $100 dispute as won. RallyFund lifted the hold and restored $96.80 in eligible credit.
- **Lost dispute.** The $25 refund on a separate $100 gift left $71.80 posted and triggered a $75 dispute. Stripe closed the dispute as lost. RallyFund reversed the remaining $71.80, leaving $0 posted. Two replays of the close event added no reversal.
