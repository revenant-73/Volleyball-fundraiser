# Volleyball fundraiser — project handoff

Build a mobile-friendly fundraising application for Century High School volleyball and Tualatin Valley Volleyball Club (TVVC).

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

## ATHLETE EXPERIENCE

Athletes receive a unique, secure invitation link. No password or account creation.

One mobile-friendly setup flow:

1. Add donor email addresses.
2. Upload a photo.
3. Write a personal message visible to potential donors.
4. Click Done.

Twenty email addresses is a recommendation, not a requirement or limit. Allow pasting multiple addresses, validate them, and identify duplicates.

Save progress so interrupted setup can resume. After completion, show the athlete’s public fundraising link and sharing controls. Athletes can return through their secure link to add more contacts.

Keep private setup links separate from public donation links. Private links must be revocable and protected against guessing. Administrator access requires authentication.

Separate athlete preparation from campaign launch. Completing setup must not send donor invitations before launch. After launch, newly completed athletes and newly added contacts can enter the remaining email sequence without receiving a backlog of missed reminders.

## DONOR EXPERIENCE

Public athlete pages show organization branding, campaign purpose, athlete photo and personal message, confirmed fundraising progress, deadline, and enabled payment methods.

Allow donations to the overall campaign as well as through an athlete page. Athlete attribution is fundraising credit; money goes to the organization.

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

## DELIVERABLES

Provide the working prototype, setup instructions, meaningful test results, and a short list of remaining live-service configuration needs.

Clearly distinguish working features from simulations. Keep real payments and outbound fundraising emails disabled until the prototype is reviewed and the live accounts and launch requirements are configured.

## Workspace direction

Initialize a local Git repository in the existing volleyball-fundraiser folder on D:. Keep all project files in this folder. The existing folder is named `D:\Websites-Apps\volleyball – fundraiser` (en dash surrounded by spaces).
