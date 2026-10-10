# First milestone verification

Verified locally on 2026-10-09 (Pacific time), Node 22.14.0 / Windows. All data and providers were simulated.

## Results

| Check | Result |
| --- | --- |
| `npm test` | **39 passed**, zero failures: domain transitions, API authorization, local snapshot/idempotency restart checks, simulated Windows failures, and hosted Postgres transaction/cold-request tests |
| `npm run test:e2e` | **14 passed**, zero failures: original athlete/donor flows plus dashboard shortcuts, approval/import, reported-payment filtering, settings preservation, lifecycle controls, held-message counts and collapsed-field validation |
| `npm run build` | Passed; Vite production assets generated |
| `npm run format:check` | Passed; JavaScript, JSX, CSS, scripts and configuration use consistent Prettier formatting |
| `node --check` on server/domain, server/app and dev launcher | Passed |
| `npm audit` | Zero reported vulnerabilities (runtime and development dependencies) at verification time |
| Independent design review | PASS; no horizontal document overflow at 1440, 768, 390 or 375px; no observed page JS errors. Same-model independent review was used because a different-provider evaluator was unavailable. |

No TypeScript or separate semantic lint tool is configured in this JavaScript prototype. Prettier checks code formatting; Node parser checks and the production JSX build validate syntax; the state/API/browser suites verify behavior. Playwright may print a terminal color-environment warning; it does not affect the results.

## Acceptance evidence

| Requested demonstration | Evidence |
| --- | --- |
| Athlete finishes on a phone with fewer than 20 contacts | 390px browser test pastes two unique contacts plus duplicate, saves, uploads a PNG, writes message, acknowledges authorization, reloads, and completes. No physical phone was used. |
| No donor messages during preparation | Domain test and mobile flow assert zero jobs/sends for draft setup. |
| Launch queues correct sequence | Shared completed/approved athletes produce exactly one Day 1, 10 and 20 sequence per contact. Launch queues only; Run simulates sending. |
| Shared contact gets one sequence with all associations | Domain and browser assertions check one normalized contact, two athlete associations, three jobs and one invitation delivery. Public donor-choice capability returns both associations without email data. |
| Confirmed payment stops reminders and counts once | Invalid mock signature/mismatched amount rejected. Repeated same and different mock event IDs for a confirmed donation yield one donation, one audit confirmation, one thank-you and blocked reminders. Browser verifies progress refresh. |
| Reported Venmo holds reminders without increasing total | Reference reservation keeps reminders active; report sets indefinite pending hold and zero public increase. Clock advances past deadline do not auto-clear the hold. |
| Manual confirmation updates totals and audit | Domain and browser tests confirm received amount/method/date/reference and audit note. Missing/invalid fields and duplicate transactions rejected. Unknown fee stays unknown in dashboard/export. |
| Unsubscribe blocks queued and future fundraising | Public opt-out flow blocks remaining jobs; org-wide suppression persists into new campaigns. Complaints/hard bounces block simulated deliveries and retry. Non-soliciting thank-you acknowledgements are separate. |
| Pause/resume, late contacts, campaign close | Domain tests hold paused jobs, skip missed windows, queue one current late invitation plus remaining reminders, stop soliciting after close, reject new donations, and permit post-close reconciliation. |
| Organization separation on server | Authenticated TVVC HTTP session receives 404 on Century mutation, invitation, approval, export, and suppression requests. Public response/private-token checks also cover data minimization. |
| Other athletes/public cannot access private setup | Athlete private response includes only their own submitted contacts. Public ID/slug cannot edit an athlete. Rotated/revoked links fail. Public response has no contacts, invitation hashes or receipt capabilities. |
| Share/QR destination correct | Browser asserts public URL and Facebook sharer destination. Downloads actual Instagram PNG and decodes its QR pixels with jsQR to exactly the public athlete page; destination served successfully. |
| Retried jobs/events do not duplicate | Sent job retry remains sent; duplicate job worker runs produce no extra delivery. Payment/request idempotency survives application restart. Browser deliberately loses a donation response after server commit; retry creates one ledger entry. |
| Interrupted local writes preserve prior data | Tests inject transient Windows locks, a persistent lock, and a disk failure. Transient locks retry; persistent failures leave the prior snapshot intact and roll back both invitation hash and issued capability. The expected synthetic disk-error diagnostic contains no request/recipient/token data. |
| Template/timing changes safe after launch | Schedule tests preserve sent/skipped steps, update future timing, enable/disable/remove optional steps, and create future steps. Browser saves an invitation template on an active campaign. |
| External school portal stays simulated | Browser configures a clearly fictional test URL, previews its local handoff, and asserts no outbound payment anchor/navigation exists. |

## Review artifacts

- [Administrator desktop](screenshots/admin-desktop.png)
- [Administrator phone layout](screenshots/admin-mobile.png)
- [Athlete phone layout](screenshots/athlete-mobile.png)
- [Donor phone layout](screenshots/donor-mobile.png)
- [Decoded Instagram QR graphic](screenshots/instagram-qr.png)

Screenshots were generated by isolated browser tests on localhost port 5174. Their sample page paths belong to the isolated test database; generate a fresh graphic from the review instance for sharing. All sample email addresses are fictional. Browser traces are disabled to avoid recording private capabilities.

## Scope remaining

Live Stripe webhook/settlement, Venmo/school/check matching, real email transport/provider events, production identity/normalized ledger/outbox/job infrastructure, real guardian authorization, legal/provider permission and retention/deletion requirements remain unverified and unconnected. Physical phone, Safari and cross-device QR/native-share behavior remain to test. Hosted review has a separate transactional Postgres snapshot and private owner password; these do not complete the live-launch gate.

## Hosted review adaptation

Local hosted tests use Netlify's in-memory Postgres-compatible emulator with the actual migration and HTTP adapter. They verify secure cookies, session continuity/revocation across fresh app instances, hosted-password replacement, persistent login throttling, organization isolation, public/private access, donation/event idempotency, pending reconciliation, and rollback on failed commit. This emulator is not a real concurrent Postgres load test.

The initial CLI preview deployed successfully and applied its database migration, with working direct page routes. Its API failed closed with `MissingDatabaseConnectionError` because runtime connection configuration was absent. The Git-connected production review deployment provisioned the correct runtime connection and now serves the API. Use Git deployment for this site; standalone CLI draft database connectivity remains unverified.

Hosted API/browser verification **passed** against `https://volleyball-fundraiser.netlify.app` on 2026-10-09 Pacific, application commit `b8489d9`, Netlify deploy `6ac9b8d46a59be0008f2e3da`. The Git-connected deployment uses the production review database; this is fictional review data, not live fundraising.

`node scripts/verify-hosted-review.mjs` verified:

- Authenticated owner login, rejected local demo password, trusted-Origin enforcement, Secure/HttpOnly cookie, persisted sessions, JSON 401/404 and direct page routing.
- 390px athlete uploads a synthetic PNG, saves/reloads message, completes with two unique contacts plus a duplicate, and gets the correct public link. Preparation creates no jobs.
- Shared-contact launch yields three contacts and nine Day 1/10/20 jobs, with both athlete associations preserved.
- Six simultaneous identical donation requests and six repeated payment events against real hosted Postgres produce one ledger entry, one audit confirmation and one thank-you. Confirmed payment stops solicitation.
- External reference alone leaves reminders active; reported Venmo pauses them with no revenue increase. Eleven simulated days do not clear the pending hold.
- Unsubscribe, pause/resume, and late-contact timing persist across requests, without overdue reminder bursts.
- Hosted donor browser completes simulated Stripe; progress updates. Facebook/public links and the decoded downloadable QR target the exact HTTPS athlete page.
- 390px administrator browser signs in and opens the ledger. Foreign-organization mutation and public-athlete-ID editing return 404; public JSON excludes contacts and private setup links.
- Closing stops solicitations. The pending Venmo entry can still be confirmed; retry adds no audit or revenue duplicate. Unknown fee stays unknown. CSV export succeeds.
- No observed browser script errors or document overflow in the hosted athlete, donor and administrator phone layouts. This remains browser viewport testing, not a physical phone/Safari/native-share test.

Results and screenshots are in ignored `artifacts/hosted-review/`. Verification campaigns remain as closed, auditable fictional records; seeded Century/TVVC campaigns remain draft. The initial incomplete browser fixture is also closed, with its fictional pending report retained for review. No data was deleted. The deployed state remains intact across Git deployments.

Browser review found JSONB key reordering changed the default payment method; payment display/default order now uses the explicit supported-method order, covered by a browser regression test. Successful logins clear failed-attempt counters, while repeated failed logins remain throttled across function instances. No live payment/email service was enabled and no local review data was uploaded.

See [Live_Launch_Checklist.md](Live_Launch_Checklist.md) for account/configuration needs and the explicit live-launch gate.

## Admin simplification

The approved admin layout now has Dashboard, Athletes, Donations and Campaign Settings. The dashboard prioritizes confirmed progress and actionable outstanding tasks. Donation fees/net stay in Donations; reported external payments appear before history. Settings, delivery details and prototype controls remain available through disclosures. New/duplicate campaign controls sit beside the selector, and closing is under Campaign Settings → Campaign management.

On 2026-10-09, the complete local browser suite passed **14/14**, with the **39/39** state/API/storage checks, production build and formatting checks also passing. Six added browser cases verify:

- At 390px, athlete-story and unfinished-setup shortcuts filter actual roster rows; approval and collapsed CSV import remain usable; preparation still creates no email jobs.
- Reported-payment shortcuts exclude unused references; manual confirmation preserves unknown fees, known-net subtotal and an audit record.
- Unsaved settings survive navigation to failed deliveries and a retry; simulated worker retries do not duplicate sends.
- Launch, pause, resume, cancelled close, confirmed close, and post-close reconciliation work through the revised controls.
- Upcoming-message counts distinguish pending-payment holds from sendable messages and organization suppression; pending reports do not increase totals.
- Saving invalid values inside collapsed settings opens all containing disclosures, focuses the invalid field and preserves the corrected input. Mobile template expanders meet the 44px target.

The initial design review identified hidden invalid fields and undersized email-template expanders. These were repaired; the resulting first-edit regression was reproduced and fixed before the final suite passed. The independent [second design review](Admin_Design_Evaluation_2.md) returned **PASS**, verifying all four sections at 1440, 768, 390 and 375px, keyboard navigation, tap targets and validation/correction/save. Only the available same-provider reviewer could be used. Current screenshots cover desktop and 390px administration. This remains Chromium viewport testing rather than a physical phone/Safari test. No backend or stored-data migration was needed, and live payment/email services remain disabled.

The updated application was committed/pushed as `e0910ab5f20594429cb6f6da4fa1f34089604eab` and published by Git-connected Netlify deploy `6ac9d1cac3af350008988038`. On 2026-10-09 Pacific, the refreshed hosted verification script passed all nine API/browser/concurrency result groups, including the four admin sections, reported-payment shortcut, collapsed roster import and prototype tools. The 390px hosted dashboard was also visually inspected. Authentication, secure persistent sessions, org isolation, public/private separation, repeated concurrent payments, email timing/holds/suppression, post-close reconciliation and public/Facebook/QR destinations remain verified. The script's fictional test campaign is closed, while seeded sample campaigns remain untouched. Detailed results/screenshots are retained in ignored `artifacts/hosted-review/`. A subsequent documentation-only commit records these results without changing the tested application.
