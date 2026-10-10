# Admin simplification

Approved direction: simplify existing Rally Fund administration for a coach checking progress and completing the next task. Keep the existing dark navy, teal and cream style, system typography and court motifs, but use compact headers, restrained panels and clear everyday labels. No new images or dependencies. Use existing React/Vite, src/App.jsx and src/styles.css. All files stay in this repository.

Four primary sections: Dashboard, Athletes, Donations, Campaign Settings. Campaign selection stays obvious. New Campaign and Duplicate belong near the selector; Close Campaign belongs in campaign management, retains confirmation, and must not become the primary action. Campaign preview remains accessible. Preserve switching organizations/sign out.

Dashboard: compact campaign header with confirmed progress, deadline/status and context-appropriate Launch/Pause/Resume. Three key metrics: confirmed donations (gross and count), athletes ready, reported payments awaiting verification. Known fees/net move to Donations, preserving unknown-fee semantics. Needs attention gives actionable counts for completed unapproved athlete stories, reported pending external payments, incomplete athlete setup, and failed emails. Buttons go directly to the relevant section/task and should focus/filter the relevant list where practical. Adapt to draft preparation checklist, active/paused monitoring, and closed final totals/reconciliation. Summarize upcoming fundraising delivery status clearly, separating held/blocked from sendable jobs; email detail logs remain accessible. Team totals can be secondary/collapsible.

Athletes: compact roster rows show name, team, setup/approval status and fundraising amount. Open details for content approval/guardian authorization, private invitation links and revocation, contacts, photo/message and existing controls. Add athletes panel starts closed, includes manual entry and CSV import. Retain validation and all secure server behavior.

Donations: pending reported payments first, then donation history; optional filters. Keep reserved/unreported references accurately distinct from payments needing review. Fee/net summaries remain available and accurate. Per-donation review preserves corrections, refunds, attribution changes, audit notes and audit history; CSV export remains accessible.

Campaign Settings: clear expandable groups for basics/branding, payments and email templates/schedule. Embed existing email/activity details under an expandable section or internal view accessible from Dashboard. Group run-worker/clock controls in a closed Prototype testing panel; simulation banner stays visible at all times. Email activity/suppressions/failures/previews/retry remain fully functional. Preserve save behavior when moving between campaign details and email details.

Use direct labels and remove oversized decorative admin slogans/repeated organization/campaign headers. 390px mobile should have compact usable navigation, 44px touch targets, readable rows and no horizontal page overflow. Keyboard/focus semantics and inline feedback must remain accessible. Avoid changing donor/athlete setup flows or backend data model.

Existing rules are mandatory: no real payments/emails, approved athlete public content, indefinite pending-payment holds, organization separation, idempotency, audit trails, unknown fees are not zero. Read AGENTS.md, Project_Brief.md, README.md before editing.

Implementation owns only src/App.jsx and src/styles.css. Root owns tests, docs, verification scripts and deploy. Report new labels/selectors and useful browser assertions. Do not commit or deploy. Evaluation uses current rendered desktop and 390px mobile pages, not source-only review.
