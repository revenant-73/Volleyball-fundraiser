# First milestone verification

Verified locally on 2026-10-09 (Pacific time), Node 22.14.0 / Windows. All data and providers were simulated.

## Results

| Check | Result |
| --- | --- |
| `npm test` | **39 passed**, zero failures: domain transitions, API authorization, local snapshot/idempotency restart checks, simulated Windows failures, and hosted Postgres transaction/cold-request tests |
| `npm run test:e2e` | **7 passed**, zero failures: Chromium desktop and 390×844 browser flows |
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

The initial CLI preview deployed successfully and applied its database migration, with working direct page routes. Its API failed closed with `MissingDatabaseConnectionError` because runtime connection configuration was absent. Git-connected deployment and hosted flow verification remain pending at this checkpoint. No live payment/email service was enabled and no local review data was uploaded.

See [Live_Launch_Checklist.md](Live_Launch_Checklist.md) for account/configuration needs and the explicit live-launch gate.
