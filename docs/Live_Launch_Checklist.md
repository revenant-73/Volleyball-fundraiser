# Before connecting live services

Milestone one is a local and hosted review prototype, with simulated payments/email only. This list gates live fundraising, not review hosting. It does not claim that legal, school, provider, payment, or authorization requirements have been verified. The hosted owner password and transactional snapshot support review; they do not complete production administrator provisioning, media, ledger/outbox, retention or recovery requirements.

## Organization configuration

- Confirm Century’s approved school payment URL, check payee, mailing address, reference instructions, administrative authority, and school-approved receipt wording. Current values are empty placeholders.
- Confirm TVVC’s Stripe account and Venmo **Business Profile**, settlement/reconciliation access, and payment instructions. TVVC is for-profit: no charitable tax receipts or charitable tax-deductibility claims.
- Supply authorized branding/logo, sender identity/contact details, campaign goals/purpose/calendar/timezone, and accountable organization administrators. Logo upload is configurable in the prototype; no official logo has been invented.
- Review sample public display-name defaults. Publish only the approved minimum athlete information. Confirm who may approve campaigns and athlete content.

## Email/provider/permission gate

- Obtain written confirmation from the chosen email provider that the specific **athlete-uploaded contact fundraising** workflow is permitted. No provider has been selected or approved here.
- Establish the applicable recipient permission requirements, collection evidence, sender identification, unsubscribe handling, complaints, bounce handling, retention, deletion, and applicable school/organization obligations. Athlete entry of an email address must not be treated as proof of recipient consent.
- Approve organization-sent templates and a separate transactional thank-you policy. Configure verified sending domains, sender identity, authenticated provider events, delivery monitoring, and opt-out suppression persistence. Unsubscribe should not require an account.
- Implement test-recipient allowlisting and a separate production send gate. Verify no real recipients can be contacted during rehearsals. Confirm whether transactional acknowledgements remain permitted for unsubscribed contacts; hard bounce/complaint suppression must prevent further delivery.

## Athlete/guardian authorization process

1. Before collection/publication, give athlete and guardian the exact proposed public display name, photo/message usage, fundraising purpose, publication period, and withdrawal contact.
2. Record affirmative athlete/guardian authorization by the school/club’s approved process. Store a dated record/evidence reference, who reviewed it, scope of permitted use, and any expiry/withdrawal. Do not assume the prototype checkbox alone meets this process.
3. Administrator reviews the actual submitted content and records the authorization reference before approval. Editing the public content requires another review; the prototype invalidates approval automatically.
4. Document withdrawal, unpublishing, deletion/retention and access rules, including how archived emails/exports/backups are handled. Avoid collecting unnecessary birth dates, full legal names, addresses or other public minor information.

This proposed workflow must be approved by the relevant organization; it is not a verified authorization/legal policy.

## Payments and operations

Foundation progress (2026-10-16): a separate TVVC preparation pilot now uses a dedicated Turso schema with relational constraints, individual owner/admin accounts, revocation, operator recovery and a verified manual backup/restore rehearsal. The existing review remains separate. Pilot requests still load the complete domain model under a serialized transaction; worker claims, private media, retention/deletion and automated off-device backup operations remain incomplete. See [TVVC Pilot Foundation](TVVC_Pilot_Foundation.md). No live service gate is cleared by this progress note.

- Build live Stripe checkout server-side, verify signed webhook events and amount/currency/account/campaign matching, handle asynchronous settlement/failure/refund/dispute events, and persist provider event IDs transactionally. Prototype HMAC events are mock events only.
- Configure approved portal and Venmo instructions/reference handling. Establish actual received-date/transaction evidence requirements and a no-reference duplicate-review process. Match reported amounts to real funds before confirmation. Rehearse simultaneous/duplicate reports and admin confirmations.
- Define processing/hosting/email costs, unknown fees, refunds (including partial refunds/non-returned processing fees), chargebacks, settlement timing, and organization-specific acknowledgements. The prototype handles full ledger refunds and illustrative mock Stripe fees only.
- Complete production ledger/outbox/idempotency constraints, jobs/locks, real admin provisioning and recovery, least-privilege roles, private media storage, and audit retention. Hosted review already has HTTPS, a transactional Postgres snapshot, function-only owner password and secure durable sessions; the local single-process store and known local passwords remain local-only. The owner-operated snapshot does not replace a production schema or administrator lifecycle.
- Implement approved contact/data deletion and retention controls, backup/recovery verification, abuse/rate controls, monitoring and operational shutdown. Do not publish private capabilities in request/access/error logs or analytics.
- Deploy an HTTPS public domain so shared/QR URLs work on recipients’ devices. Review on physical phones/tablets and Safari; test real device-native sharing/clipboard and QR scanning on another device.
- Review the complete prototype, run provider/account test mode with only approved testers, and obtain explicit live-launch authorization before enabling any real payment or outbound fundraising email adapter.
