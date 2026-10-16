# Rally Fund — volleyball fundraiser prototype

Working first milestone for Century High School volleyball and TVVC. The original handoff is preserved in [Project_Brief.md](Project_Brief.md).

**Review simulation only.** No live payment processor, email transport, production webhook, or background delivery service is connected. Sample athletes, contacts, administrator identities, donations, fees, and emails are fictional. Use fictional donor/minor information only. The local server listens on loopback; the Netlify review deployment uses a hosted API and separate transactional database.

## Run locally

Node.js 22.12+ and npm are required. From PowerShell:

```powershell
Set-Location -LiteralPath 'D:\Websites-Apps\RallyFund'
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Vite serves the UI; the Node API runs on port 3100. Both processes run together; Ctrl+C stops them. Server changes restart automatically. All source, application data, and project artifacts stay in this folder.

To review the production build locally:

```powershell
npm run build
npm start
```

Open **http://127.0.0.1:3100**. This still uses simulation adapters only. Do not run both modes against the same data directory simultaneously.

Local demo logins:

| Organization | Fictional administrator email | Demo password |
| --- | --- | --- |
| TVVC | coach@tvvc.example | prototype-only |
| Century | coach@century.example | prototype-only |

The landing page provides the demo organization selector. Login uses scrypt-hashed passwords and expiring HTTP-only, SameSite Strict session cookies. These known demo credentials are unsuitable for deployment.

## Review the full flow

1. Open the TVVC coach workspace. Sample Maya and Alex have completed, approved fictional profiles and share one contact. Jordan has not completed setup. Both sample campaigns start as drafts.
2. Open **Athletes**, expand Jordan’s row, and open the private setup link. **Add athletes** opens manual entry and CSV import. Paste two addresses, including an intentional duplicate. Upload an optional photo, write a message, acknowledge permission, and choose **Save & return later** or **Done**. Progress resumes from the same private link. Twenty contacts is a recommendation; zero or fewer than twenty works.
3. Return to **Athletes**. Record how athlete/guardian authorization was obtained, then approve the public content. The checkbox alone is not an actual authorization record. Profile edits revoke approval. Only approved content appears publicly or in messages.
4. Preview the public athlete/campaign page. Public URLs cannot edit profiles or reveal donor contact lists. Private setup links can be rotated or revoked and expire after 90 real days. Invitation issuance is simulated: coaches copy the link; no athlete invitation is actually emailed.
5. Choose **Launch campaign** on the **Dashboard**. Its attention shortcuts open filtered athlete, payment, or email tasks. Only completed, approved athletes enter the queue. One normalized shared donor address receives one Day 1/10/20 sequence with all athlete associations. Launch queues; it does not run an actual delivery service.
6. In **Campaign Settings → Email & activity**, inspect message previews, delivery logs, suppressions and activity. Expand **Prototype testing** to run the worker or advance the simulated clock. Simulate a failure/retry, unsubscribe through a preview link, or record a complaint/hard bounce. Pause holds solicitations; resume skips overdue steps. Late contacts receive one current invitation plus remaining future reminders. Dates/timezone lock after launch, while schedules and templates remain editable. Delivered steps never repeat.
7. In the public donor page, choose simulated Stripe. Starting checkout is pending. **Simulate verified payment** creates a signed local server event; the server validates it, confirms once, stops reminders, and creates one thank-you. A browser success screen cannot alter the ledger. The mock fee is illustrative (2.9% + $0.30), not a live processing-price quote. No platform cut is charged.
8. Choose Venmo (TVVC), school portal, or check (Century). First reserve a unique reference, view configurable instructions, then **Report payment sent** with amount and transaction/reference when available. A reference alone does not pause email; the report pauses it indefinitely. No public totals increase until confirmation. The receipt capability resumes within the same browser tab. School portal handoff is a local redirect preview, never a live payment-site redirect.
9. In **Donations**, review reported payments first, enter actual received amount/method/date and transaction/reference when available, leave unknown fees blank, add an audit note, and confirm. Fees and net summaries appear here. Corrections, full refunds, credit changes, and each donation’s audit history remain available in its review panel. Duplicate transaction/reference identifiers are rejected within an organization and method. Export the centralized ledger as CSV.
10. Open **Campaign Settings → Campaign management** to close the campaign. Solicitation ends permanently; existing pending payments still reconcile. New donations cannot begin. Thank-you acknowledgements can still run after close. Unsubscribe stops fundraising messages; non-soliciting donation acknowledgements are transactional. Complaints and hard bounces block all simulated delivery. New campaign and duplication controls sit beside the campaign selector.

## What works versus what is simulated

| Working local behavior | Simulated boundary |
| --- | --- |
| Server-enforced org access; separate campaigns, administrators, branding, payment config and data | Two seeded organizations and known local demo passwords; no production identity provider |
| Persistent setup, contact validation/deduplication, secure revocable links, approval records | Coach copies athlete invitation; no actual invitation email |
| Public fundraising pages, campaign/athlete/team credit, correct confirmed totals | Fictional donations only; no money changes hands |
| Reference-first external reporting, reconciliation, fee uncertainty, refunds/corrections/audit, CSV | Administrators enter mock statement evidence; no Venmo/school/check reconciliation integration |
| Idempotent mock events, unique transaction checks, one thank-you per donation | HMAC-verified **local mock** event; no Stripe SDK/webhook or real verification |
| Queue/state rules, timezone calendar days, template previews, suppression, failure/retry, activity log | Explicit Run/Advance controls; no actual sends or autonomous cron |
| Copy link, native device share when available, Facebook share URL, QR PNG download | Local loopback URLs; Instagram posting is manual; no social automation |

Only `confirmed` ledger entries contribute to totals; `pending`, `rejected`, and `refunded` do not. Known fees are shown independently. Known net is a subtotal of entries with known fees; unknown fees are not silently treated as zero. Athlete attribution changes fundraising credit, never the organization receiving money.

## Hosted review on Netlify

The review site is https://volleyball-fundraiser.netlify.app/. `netlify.toml` builds Vite assets, bundles the API function and serves direct app links. `netlify/functions/api.mjs` runs the existing Express/domain API. Netlify Database provisions Postgres and applies the committed migration on deploy. Database compute/bandwidth/storage may consume account credits; no plan upgrade is performed by this project.

Hosted administrators use the same two fictional email identities as the local demo, with a private owner review password. The published `prototype-only` password is rejected on the hosted site. Run `npm run configure:review` with the authenticated Windows Netlify CLI to configure the function-only secret. Credentials are saved in ignored `.local/hosted-review-credentials.json`; do not commit/share this file publicly. Other systems can set `NETLIFY_CLI_ENTRY` to the CLI's `bin/run.js`. Changing the password requires a redeploy and revokes prior hosted sessions.

The hosted database starts from fresh sample data, without uploading `.local` files. Its state persists between function invocations and deployments. All mutations, idempotency records and hashed sessions commit under a Postgres row lock. Responses and cookies are returned only after commit; a failed commit returns a retryable error. Origin checks require a trusted HTTPS Netlify URL, and administrator cookies are Secure/HttpOnly/SameSite=Strict. Unconfigured storage or review access fails closed.

This is an owner-operated review environment, not a public sandbox: the owner password gives access to both fictional administrator identities. Public sample pages and simulated donor controls are publicly reachable. Never enter real donor contacts or minor information. Hosted previews use isolated database branches, which may initially copy review data; all review data must stay fictional.

For this milestone, a single JSONB snapshot transaction intentionally retains the tested domain model. It serializes requests and embeds uploaded images, so it is appropriate for a small review dataset, not a scaled fundraising launch. Production still needs normalized ledger/outbox constraints, private media storage, real administrator provisioning/recovery, and operational retention/backup controls. Platform requests/responses have size limits; use small review photos. Email workers remain explicit simulator controls, without cron or delivery credentials.

After local checks, commit and push to `main` for the connected Netlify build. Verify the deployed commit, API JSON, login, direct private/public links and simulated transactions before sharing. Keep `.netlify/`, `.local/`, secrets and generated test artifacts out of Git.

Run `node scripts/verify-hosted-review.mjs` to exercise the hosted review with a real Chromium window, a 390px viewport and simultaneous requests. It reads the ignored credentials file, creates fictional verification data, and closes its own test campaign. Results/screenshots go under ignored `artifacts/hosted-review/`. It preserves the seeded review campaigns. This is hosted API/browser verification, not physical-device testing. Use Git deployment for the hosted API: the first standalone CLI draft provisioned a database but lacked runtime connection configuration.

## Data and architecture

- React/Vite frontend; Express Node server; pure domain functions in `server/domain.js`.
- All amounts use integer cents. Campaign scheduling compares calendar dates in the configured IANA timezone, including DST.
- `.local/snapshot.json` atomically stores local demo data, idempotency records, and issued demo capabilities for authenticated coach review. It is ignored by Git. Private invitation hashes are held in the state; capability URLs appear only to the authenticated administrator/owning athlete, not in activity logs. Earlier prototype `state.json`/`private-links.json` files are migrated on first start and preserved as original local backups.
- Local synchronous mutations are rolled back on errors; the local snapshot uses atomic replacement with bounded retries for temporary Windows file locks. This is a **single-process local store**. Do not run multiple local server writers. Hosted requests use the separate transactional Postgres store. Protect the local folder as private; no production backup/retention service is provided.
- No donor information or private invitation URLs are persisted in browser localStorage. A receipt token alone is held in sessionStorage for same-tab donor resumption. Other athletes see only contacts they themselves submitted. Public API responses contain no private contacts, invitation hashes, payment capabilities, or ledger/audit details.
- Message bodies with donor-choice/opt-out capabilities are accessible only to the authenticated coach in preview mode. Application activity logs use masked addresses and contain no private setup tokens. Browser tracing is disabled to avoid recording capabilities.
- API contract: [docs/API_Contract.md](docs/API_Contract.md). Review checks: [docs/Verification.md](docs/Verification.md). Live needs: [docs/Live_Launch_Checklist.md](docs/Live_Launch_Checklist.md).

Local state is preserved across restarts. To start another isolated demo, set `PROTOTYPE_DATA_DIR` to a new child folder inside this project before starting. Do not delete state to reset a real campaign. Existing prototype data remains untouched. Browser tests use `.local-e2e` and separate ports 5174/3101 so they do not change the review database.

## Verification commands

```powershell
npm test
npm run build
npm run format:check
npx playwright install chromium
npm run test:e2e
npm audit
```

The browser suite uses Chromium with a real 390px browser viewport and desktop views. It decodes the downloaded QR graphic to check its exact public destination. It is not physical-phone or Safari validation. It can be rerun: campaigns created by it remain isolated under `.local-e2e` and contacts stay fictional.

## Remaining live-service work

The separate TVVC production-foundation pilot now has a Turso relational schema and individual owner/admin access. It remains in preparation with public fundraising, payments and email blocked. The existing review environment is preserved. Setup, recovery, verification, deployment boundaries and remaining limitations are documented in [TVVC Pilot Foundation](docs/TVVC_Pilot_Foundation.md).

Configure verified organization identities/branding, approved external payment destinations/instructions, live Stripe account/webhook, provider-approved contact permission and email delivery, authenticated production admin access, durable database/outbox/jobs, retention/deletion/backups, guardian authorization, and receipt wording. See the launch checklist for the gate. Live payment/email adapters do not exist in this milestone and cannot be enabled with a settings toggle.
