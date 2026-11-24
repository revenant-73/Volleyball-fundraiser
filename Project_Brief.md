# Volleyball fundraiser — project handoff

Build a mobile-friendly fundraising application for Century High School volleyball and Tualatin Valley Volleyball Club (TVVC).

The primary purpose for the coming TVVC Girls Club season is to help individual players and families raise money toward their season dues. Participation is optional. Club-wide and team-wide campaigns organize and summarize those individual efforts; the family's season costs are the primary fundraising outcome. Century requires its own school-approved allocation rules rather than automatically inheriting TVVC's policy.

The goal is to reproduce the useful parts of Snap! Raise: athletes provide donor contacts once, and the platform manages fundraising pages, invitations, reminders, and donation tracking. Charge no platform percentage. Payment processing, hosting, and email delivery still have costs.

## FIRST MILESTONE

Build a working prototype with sample data and simulated payments and email delivery. Make the complete athlete, donor, and administrator flows reviewable before connecting live services.

Inspect the workspace and follow its repository instructions. Reuse an existing suitable stack if present. Otherwise choose a straightforward, maintainable stack. Proceed with routine implementation decisions; ask only about missing information that blocks necessary work.

## ORGANIZATIONS AND CAMPAIGNS

Support separate organizations with their own branding, administrators, campaigns, payment settings, and data.

Initially:

* Century: school online payment portal and mailed checks.
* TVVC: Stripe card payments and direct payments to its Venmo Business Profile.

Do not invent payment URLs, Venmo handles, mailing addresses, school check instructions, logos, or credentials. Make these configurable and use clearly labeled placeholders in the prototype.

Administrators configure campaign name, purpose, fundraising goal, start/end dates, timezone, branding, payment methods, and email schedule. Support duplicating a previous campaign.

Default campaign length: 21 days.

Each participating player has a season-specific family dues account and an administrator-approved fundraising target based on eligible outstanding season dues. Keep the public fundraising target separate from the private dues balance. Team/club totals roll up contributions without counting a contribution again when its dues credit is applied. General club support must be an explicit donor choice with a stated purpose; do not silently spread player-directed contributions across teammates.

## PROPOSED TVVC DUES-CREDIT DEFAULTS

The owner approved these defaults on 2026-10-17 for implementation and rehearsal with fictional data. The heading remains stable for existing document links. The implemented simulation is described in [Family Dues Workflow](docs/Family_Dues_Workflow.md). This approval does not authorize real collection, billing changes or live services. Confirm the policy against TVVC's season agreement, accounting process and payment-provider requirements before live use. Keep all existing live-service gates in place.

| Topic | Recommended default |
| --- | --- |
| Dues credits | Attribute a contribution to one selected player/season, with money received by TVVC. Make credit eligible only after receipt is confirmed and actual processing fees are known. Apply credit up to the account's current eligible outstanding dues, through an administrator-reviewed, auditable posting. Pending, rejected, refunded or disputed funds cannot provide new spendable credit. |
| Processing fees | Credit the confirmed amount less actual transaction processing fees. No platform percentage or automatic hosting/email deduction. Unknown fees remain unknown and the affected credit stays awaiting fee reconciliation; do not use estimated fees as final charges. Record verified zero fees explicitly. Start without an added donor fee or automatic fee gross-up. |
| Excess funds | Stop new player-directed contributions and future solicitation for that player when the reconciled target is covered. For overages caused by concurrent payments or a reduced dues balance, hold the excess unapplied and default to refunding that portion to the original donor. An owner may instead record the donor's affirmative agreement to redirect it to stated general club support. No automatic redistribution, next-season carryover, or family cash payout. |
| Family withdrawal or season cancellation | Stop the player's fundraising and new credit postings promptly. Reconcile confirmed funds against only the eligible dues still owed under the approved season/withdrawal agreement. Retain/reapply credits only to that obligation; reverse credits exceeding it and return unused contributions to their original donors. No automatic forfeiture to the club or payment to the family. Unresolved cases stay on hold for owner review. |
| Refunds and disputes | Link every refund, dispute hold and credit reversal to the original contribution and dues posting. Freeze the affected available credit during a dispute; reverse affected credit for a completed refund or lost dispute, and release a hold only on verified resolution. Any restored family balance follows the season agreement and owner review, not an automatic new charge. TVVC absorbs non-returned processor/refund costs by default rather than silently reducing a promised donor refund or adding a new family fee. |

For example, a fictional confirmed $100 contribution with an actual $3 processing fee makes $97 eligible for dues credit. A pending $100 payment makes $0 eligible. If fees are unknown, show the confirmed $100 gross separately with credit awaiting reconciliation. If only $60 of eligible dues remains, apply no more than $60 and hold the remainder for the excess-funds process; refund costs must be reconciled separately.

The initial live workflow may use an administrator-reviewed export and manual posting to TVVC's dues system. Record the external posting reference and reconcile it before marking credit applied. Do not imply a live connection to the separate TVVC website, edit that site, or automatically change installment charges in this project.

Store donation attribution, eligible credit, applied credit, reversals and excess disposition separately. Use integer cents and durable idempotency so retries, repeated imports, webhooks or concurrent administrators cannot post the same credit twice. Preserve the original attribution and append corrections; moving fundraising credit after application requires coordinated dues reversal/reposting. Family payments and fundraising credits must reconcile to the same season balance without double counting.

## ATHLETE EXPERIENCE

Athletes receive a unique, secure invitation link. No password or account creation.

One mobile-friendly setup flow:

1. Add donor email addresses.
2. Upload a photo.
3. Write a personal message visible to potential donors.
4. Click Done.

Twenty email addresses is a recommendation, not a requirement or limit. Allow pasting multiple addresses, validate them, and identify duplicates.

Save progress so interrupted setup can resume. After the coach approves the completed public profile, show the athlete’s public fundraising link and sharing controls. Athletes can return through their secure link to add more contacts.

Provide authorized families with a private season summary showing their target, confirmed gross contributions, actual fees, credit awaiting reconciliation, applied dues credits, pending payments, unapplied excess and remaining dues with an as-of date. Verify guardian/account access independently; possession of an athlete setup link alone must not expose family financial records. Public progress must not reveal invoices, payment plans or the family's remaining dues.

Keep private setup links separate from public donation links. Private links must be revocable and protected against guessing. Administrator access requires authentication.

Separate athlete preparation from campaign launch. Completing setup must not send donor invitations before launch. After launch, newly completed athletes and newly added contacts can enter the remaining email sequence without receiving a backlog of missed reminders.

## DONOR EXPERIENCE

Public athlete pages show organization branding, campaign purpose, athlete photo and personal message, confirmed fundraising progress, deadline, and enabled payment methods.

Allow contributions toward a selected player's season dues as well as an explicitly labeled general campaign purpose. Money goes to the organization. Player attribution identifies the intended dues beneficiary; a separate reconciled dues-credit record establishes what has actually been applied to the family's account.

Before payment, explain the recipient, selected player/season, processing-fee treatment, excess-funds and withdrawal/refund rules. Use wording such as “Help cover this player's TVVC season dues.” Do not imply funds are paid directly to the family or promise full-dollar dues credit when processing fees are deducted. Label confirmed gross fundraising progress distinctly from net dues credit; unconfirmed payments must not advance either confirmed measure.

Payment behavior:

* Stripe: confirmation comes from verified server-side payment events, not the browser’s success screen.
* Venmo: show the configured business profile, a unique donation reference, and instructions to include it with payment.
* School portal: redirect to the configured URL and display the reference/instructions where supported.
* Check: display configured payee, mailing address, and reference instructions.

For external methods, donors can report payment and provide an amount/reference. Treat this as pending verification, not confirmed revenue.

Provide copy-link and device-native sharing where available. Support Facebook sharing and an Instagram-friendly downloadable graphic with a QR code. Do not promise automatic Instagram posting.

## EMAIL AUTOMATION

Default schedule:

* Day 1: invitation.
* Day 10: reminder.
* Day 20: final reminder.

Administrators can edit templates and timing and enable optional additional messages.

Messages should identify the organization, feature the athlete’s approved personal message, and link to the fundraising page. Make automated follow-ups clearly organization-sent; do not imply athletes personally wrote them.

Rules:

* Confirmed donations stop campaign fundraising reminders to that donor.
* Reported external payments pause reminders pending verification.
* Pending payments remain paused until an administrator resolves them; never resume automatically merely because time passes.
* Unsubscribes, complaints, and hard bounces suppress further fundraising emails.
* Deduplicate normalized email addresses within each campaign.
* If several athletes submit the same address, send one campaign sequence. Preserve all athlete associations and let the donor choose attribution.
* Pause/resume controls must not generate a burst of overdue messages.
* Closing a campaign stops solicitation emails. Pending donations can still be reconciled.
* Send one thank-you per confirmed donation.
* Retried jobs and repeated payment events must not create duplicate emails or donations.

Use a preview/test mode. The prototype must simulate sends and expose an activity log without contacting real recipients.

## ADMINISTRATOR EXPERIENCE

Provide:

* Campaign creation, preview, launch, pause, resume, and close.
* Athlete entry and CSV import with validation.
* Invitation status and onboarding completion.
* Confirmed gross donations, known fees, known net proceeds, donation count, and progress.
* Athlete/team fundraising totals.
* Private player/season dues accounts, eligible charges, family payments, approved targets, reconciled credit postings/reversals, unapplied excess and remaining balances.
* Owner-reviewed excess-funds and withdrawal cases, donor refund/redirection evidence, and dues export/posting reconciliation.
* Pending external payments and manual reconciliation.
* Email delivery, suppression, failures, and upcoming messages.
* CSV export of the donation ledger.

External payment confirmation requires an amount, method, received date, and transaction/reference when available. Prevent double entry. Keep an audit trail of confirmations, corrections, refunds, and attribution changes. Do not assume unknown fees are zero.

Maintain a centralized ledger with distinct pending, confirmed, rejected, and refunded statuses. Only confirmed, non-refunded amounts contribute to public totals.

## PRIVACY AND LAUNCH REQUIREMENTS

Keep donor contacts private from other athletes and the public. Enforce organization separation on the server.

Use minimal public information for minors, configurable display names, and a documented athlete/guardian authorization process for photos and personal messages. Do not expose private contact lists or invitation tokens in logs.

Before live launch, verify the chosen email provider permits the uploaded-contact fundraising workflow and establish the applicable permission, unsubscribe, sender-identification, retention, and deletion requirements. Do not assume an athlete uploading an email address establishes recipient consent.

TVVC is a for-profit organization. Do not label its contributions tax-deductible or issue charitable tax receipts. Make receipt wording organization-specific.

## FIRST-MILESTONE ACCEPTANCE CHECKS

Demonstrate that:

* An athlete completes setup on a phone with fewer than 20 contacts.
* No donor messages send during preparation.
* Launch queues the correct invitation sequence.
* A shared contact receives only one sequence.
* Confirmed payment stops reminders and updates totals once.
* Reported Venmo payment pauses reminders without increasing totals.
* Manual confirmation updates totals and records an audit entry.
* Unsubscribe blocks queued and future solicitations.
* Pause, resume, late contacts, and campaign close behave correctly.
* One organization cannot access another’s private data.
* Public links cannot grant athlete editing access.
* Sharing links and QR codes resolve to the correct public page.

Test the state transitions and duplicate-processing behavior, not just the screen rendering.

Before family-focused live launch, also demonstrate that confirmed contributions and dues credits remain distinct; unknown fees block final credit; duplicate/concurrent postings cannot over-credit a balance; family payments reduce available dues before credit is applied; target completion stops new player-directed fundraising without blocking other players; excess and withdrawal cases preserve donor intent; partial refunds and disputes adjust credit once; and unauthorized users cannot read family balances. These are additional acceptance checks, not claims about the existing milestone-one implementation. Shared contacts must retain one campaign email sequence and existing pending-payment holds when one associated player stops fundraising.

## DELIVERABLES

Provide the working prototype, setup instructions, meaningful test results, and a short list of remaining live-service configuration needs.

Clearly distinguish working features from simulations. Keep real payments and outbound fundraising emails disabled until the prototype is reviewed and the live accounts and launch requirements are configured.

## Workspace direction

The project was initialized in `D:\Websites-Apps\volleyball – fundraiser` (en dash surrounded by spaces). At the owner's request, the entire project was moved to `D:\Websites-Apps\RallyFund` on 2026-10-16, including its Git repository, local data, private review credentials and Netlify settings. Keep all project files inside `D:\Websites-Apps\RallyFund`.
