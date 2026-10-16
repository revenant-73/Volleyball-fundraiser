# TVVC pilot foundation

This is a separate preparation environment. It is not accepting donations or sending email. Use fictional campaign, donor and athlete information for rehearsals. The owner account is the explicitly authorized individual account; no review identities or sample campaigns are copied into the pilot.

## Environments

| Environment | URL | Storage | Access |
| --- | --- | --- | --- |
| Existing review | https://volleyball-fundraiser.netlify.app | Existing Netlify Postgres review snapshot | Existing private review password; fictional identities |
| TVVC pilot preparation | https://rallyfund-tvvc-pilot.netlify.app/admin | Dedicated Turso database `rallyfund-tvvc-pilot` | Individual owner/admin accounts |

Pilot Netlify site ID: `042b91a6-50e0-4f18-9d67-0ca7f789cfa9`. The repository's existing `.netlify/state.json` still points to the review site. `.netlify/`, `.env.pilot`, owner credentials, backups and browser artifacts remain ignored. Always use the explicit pilot site ID when configuring or deploying the pilot. Do not replace the review site's settings or database.

The pilot is manually deployed from branch `codex/tvvc-pilot-foundation`. It does not yet have Git continuous deployment. A push to that branch alone does not publish the pilot. The original review deployment remains on its existing version.

## Database structure

`server/pilot/schema.sql` defines the version-one schema. Initialization requires an empty dedicated database, creates only TVVC, and installs a database identity marker. Subsequent initialization verifies that marker without replacing existing records. The remote URL validator requires the RallyFund pilot database name prefix and a Turso hostname.

Organizations, individual users, campaigns, athletes, normalized donor contacts, contact/athlete associations, donations, jobs, ledger audit, administrator audit, suppression, request idempotency, payment event identities, private capabilities, sessions and login attempts have dedicated tables. Financial amounts, statuses, organization/campaign references, user credentials and indexed identity fields are stored in columns. Remaining display/configuration/domain details use per-record JSON, rather than a database-wide snapshot.

Constraints enforce campaign contact uniqueness, transaction/reference uniqueness within organization and method, integer cents, nullable unknown fees, one thank-you job per donation and cross-campaign/organization relationships. Ledger and administrator audit records are append-only. Domain rules still enforce state transitions, indefinite pending-payment holds and replay fingerprints. Browser responses and login cookies are returned only after the entire database transaction commits.

This intentionally reuses the tested domain engine: each request loads the relational records into the domain model under a write transaction and persists changed rows. Requests are still serialized and currently load all pilot records. This is a foundation for a small pilot, not a high-volume architecture. Scoped queries, pagination and independently claimed worker jobs are follow-up work before scaling. No autonomous delivery worker exists.

## Administrator access

The owner email was supplied explicitly by the project owner. The bootstrap password is randomly generated and saved only in `.local/pilot/bootstrap-<timestamp>.json`; it is not committed or printed. Passwords use salted scrypt hashes. Sessions use hashed bearer cookies, expire after eight hours, and use Secure/HttpOnly/SameSite Strict on HTTPS. The pilot has no published default credentials, self-service signup or shared review password.

The Account section lets each person change their password, signing out every session for that account. Owners can create named administrators/owners and disable or re-enable accounts after re-entering their own password. Administrators cannot manage accounts. Disabling an account revokes its sessions, and every subsequent authenticated request checks active status and credential version. Self-disable and disabling the last active owner are rejected. Account creation and credential/access changes have dated actor records. Account creation sends no email; deliver credentials directly and have the recipient replace the password.

Recovery is an operator action using the database-scoped credential, not an unauthenticated endpoint. From the project root:

```powershell
npm run pilot:control -- status
npm run pilot:control -- recover-owner
```

`recover-owner` targets the existing TVVC owner named in `RALLYFUND_OWNER_EMAIL` in `.env.pilot`, generates a new password, enables that owner if necessary, revokes their sessions, records an audit event, and saves a new private credential file. It does not change other administrators or send email. Protect the operator token and credential files as account-recovery secrets.

## Service gates

Pilot mode blocks public campaign/athlete/receipt access, donation creation, mock payment events, payment reporting/reconciliation, campaign launch/resume and simulator workers on the server. Draft payment methods start disabled and cannot be enabled through the API. Public campaign discovery is empty. Pilot navigation exposes draft preparation and Account controls; athlete onboarding and public fundraising are deferred. Photo/logo upload is disabled until private media handling is implemented. The underlying review simulator remains functional in review mode.

There is no switch for enabling live fundraising in this milestone. Stripe and email transports are not implemented. No payment/email credentials, external payment navigation, donor email or invitation email have been configured. Completing this milestone does not satisfy the remaining [live launch checklist](Live_Launch_Checklist.md).

## Setup and operations

Copy `.env.example` to ignored `.env.pilot` and supply only the dedicated database URL/token and the named owner email. Do not put secrets in `VITE_*` variables or committed configuration. A 30-day database-only read/write token was created with explicit approval on 2026-10-16; replace it before expiration. Hosted function credentials and the local operator configuration must both be updated when rotating it. Existing sessions do not extend database credential lifetime.

```powershell
npm run pilot:control -- init
npm run pilot:control -- bootstrap
node --env-file=.env.pilot scripts/configure-pilot-host.mjs
npm run build
node "$env:APPDATA/npm/node_modules/netlify-cli/bin/run.js" deploy --site 042b91a6-50e0-4f18-9d67-0ca7f789cfa9 --prod --no-build --skip-functions-cache
```

Initialization refuses a nonempty unrelated database. Bootstrap refuses to replace any existing administrator. Host configuration verifies the fixed pilot site identity, uses function-only production secrets, and does not relink the checkout. The pilot requires its configured HTTPS canonical hostname; deploy previews/permalinks fail closed instead of connecting to pilot data. `RALLYFUND_MODE` defaults to review, so the existing review configuration is unchanged.

## Backups and recovery rehearsal

```powershell
npm run pilot:control -- backup
npm run pilot:control -- verify-recovery .local/pilot/backup-<timestamp>.json
```

Backups contain private data, password hashes and capability values. They are ignored local files and must be protected; the checksum detects accidental corruption, not deliberate modification. A rehearsal restores into a new local database, verifies the content checksum, SQLite integrity and foreign keys, and never overwrites the live database. Restored sessions and login lockouts are discarded. Restoring a real environment requires a separate controlled cutover; no in-place restore command is provided. Automated backup scheduling, encrypted off-device copies and retention policy remain launch requirements.

## Verification

- `npm test`: domain/API/hosted-review/storage tests plus relational pilot transitions, duplicate replay, rollback, account roles/revocation/password replacement/recovery, login throttling, launch gates and backup recovery.
- `npm run test:e2e`: existing 14 review flows.
- `npm run test:e2e:pilot`: 390px owner creates an administrator, restricted administrator access, owner disables/re-enables access, session revocation, and administrator password change followed by sign-in with the replacement password. Pilot browser data stays under `.local-e2e/pilot` on ports 5174/3101; do not run the two browser suites simultaneously.
- `npm run build`, `npm run format:check`, `npm audit`.
- `node scripts/verify-pilot.mjs .local/pilot/bootstrap-<timestamp>.json`: hosted owner login, concurrent durable sessions, secure cookie flags, logout, foreign-origin rejection, service gates, 390px/desktop Account UI and unchanged review runtime mode. Screenshots are under ignored `artifacts/pilot`.

Physical-phone/Safari testing, MFA, private media, approved retention/deletion, scheduled off-device backups, provider integrations and a live-launch decision remain outstanding. Do not collect real donor or athlete information yet.
