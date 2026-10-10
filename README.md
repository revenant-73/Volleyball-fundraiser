# Rally Fund — volleyball fundraiser prototype

Working first milestone for Century High School volleyball and TVVC. The original handoff is preserved in [Project_Brief.md](Project_Brief.md).

**Local simulation only.** No live payment processor, email transport, production webhook, or background delivery service is connected. The server listens on loopback. Sample athletes, contacts, administrator credentials, donations, fees, and emails are fictional. Do not deploy this local prototype or enter real donor/minor information.

## Run locally

Node.js 22.12+ and npm are required. From PowerShell:

```powershell
Set-Location -LiteralPath 'D:\Websites-Apps\volleyball – fundraiser'
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
2. Open **Athletes**, expand Jordan’s row, and open the private setup link. Paste two addresses, including an intentional duplicate. Upload an optional photo, write a message, acknowledge permission, and choose **Save & return later** or **Done**. Progress resumes from the same private link. Twenty contacts is a recommendation; zero or fewer than twenty works.
3. Return to **Athletes**. Record how athlete/guardian authorization was obtained, then approve the public content. The checkbox alone is not an actual authorization record. Profile edits revoke approval. Only approved content appears publicly or in messages.
4. Preview the public athlete/campaign page. Public URLs cannot edit profiles or reveal donor contact lists. Private setup links can be rotated or revoked and expire after 90 real days. Invitation issuance is simulated: coaches copy the link; no athlete invitation is actually emailed.
5. Choose **Launch campaign** in Overview. Only completed, approved athletes enter the queue. One normalized shared donor address receives one Day 1/10/20 sequence with all athlete associations. Launch queues; it does not run an actual delivery service.
6. In **Email & activity**, run the worker, inspect rendered message previews and masked delivery logs, or advance the simulated campaign clock. Simulate a failure/retry, unsubscribe through a preview link, or record a complaint/hard bounce. Pause holds solicitations; resume skips overdue steps. Late contacts receive one current invitation plus remaining future reminders. Dates/timezone lock after launch, while schedules and templates remain editable. Delivered steps never repeat.
7. In the public donor page, choose simulated Stripe. Starting checkout is pending. **Simulate verified payment** creates a signed local server event; the server validates it, confirms once, stops reminders, and creates one thank-you. A browser success screen cannot alter the ledger. The mock fee is illustrative (2.9% + $0.30), not a live processing-price quote. No platform cut is charged.
8. Choose Venmo (TVVC), school portal, or check (Century). First reserve a unique reference, view configurable instructions, then **Report payment sent** with amount and transaction/reference when available. A reference alone does not pause email; the report pauses it indefinitely. No public totals increase until confirmation. The receipt capability resumes within the same browser tab. School portal handoff is a local redirect preview, never a live payment-site redirect.
9. In **Ledger**, review the report, enter actual received amount/method/date and transaction/reference when available, leave unknown fees blank, add an audit note, and confirm. Corrections, full refunds, and credit changes retain before/after audit entries. Duplicate transaction/reference identifiers are rejected within an organization and method. Export the centralized ledger as CSV.
10. Close the campaign. Solicitation ends permanently; existing pending payments still reconcile. New donations cannot begin. Thank-you acknowledgements can still run after close. Unsubscribe stops fundraising messages; non-soliciting donation acknowledgements are transactional. Complaints and hard bounces block all simulated delivery.

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

## Data and architecture

- React/Vite frontend; Express Node server; pure domain functions in `server/domain.js`.
- All amounts use integer cents. Campaign scheduling compares calendar dates in the configured IANA timezone, including DST.
- `.local/snapshot.json` atomically stores local demo data, idempotency records, and issued demo capabilities for authenticated coach review. It is ignored by Git. Private invitation hashes are held in the state; capability URLs appear only to the authenticated administrator/owning athlete, not in activity logs. Earlier prototype `state.json`/`private-links.json` files are migrated on first start and preserved as original local backups.
- Synchronous mutations are rolled back on errors; the single snapshot uses atomic replacement with bounded retries for temporary Windows file locks. This is a **single-process prototype store**, not a production database. Do not run multiple server writers. Protect the local folder as private; no encryption-at-rest or production backup/retention service is provided.
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

Configure verified organization identities/branding, approved external payment destinations/instructions, live Stripe account/webhook, provider-approved contact permission and email delivery, authenticated production admin access, durable database/outbox/jobs, retention/deletion/backups, guardian authorization, and receipt wording. See the launch checklist for the gate. Live payment/email adapters do not exist in this milestone and cannot be enabled with a settings toggle.
