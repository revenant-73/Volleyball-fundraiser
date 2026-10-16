# Automated backups and private media

Implemented for the separate TVVC pilot only. Payments, email, public campaigns, public athlete pages and athlete onboarding remain disabled. Rehearsals still use fictional images and campaign/contact/athlete information.

## Daily encrypted recovery files

The Netlify `pilot-backup` scheduled function checks hourly. It creates one immutable daily recovery file for the period beginning at **12:00 UTC** (5 AM Pacific during daylight time; 4 AM during standard time). Hourly checks verify an existing daily file or retry after a transient failure; they do not create 24 database snapshots a day. Owners can create an additional recovery file immediately from **Operations → Run backup now**, after re-entering their password.

Each recovery file includes a consistent Turso domain snapshot, immutable request/payment-event identities, administrator password hashes, audit records, media metadata and the encrypted bytes for **every stored image**, including hidden images. Session cookies and login lockouts are excluded. Missing or damaged images fail the backup instead of producing a successful incomplete archive.

Backups are encrypted with AES-256-GCM before entering the site-scoped Netlify Blobs store `rallyfund-pilot-encrypted-backups-v1`. Private image objects use the separate store `rallyfund-pilot-private-media-v1`. HKDF derives different keys for media and backups from one random 32-byte recovery key. Authenticated associated data binds each encrypted object to its expected key. The recovery files are off-device and independent of Turso; they remain in the same Netlify account as the application.

Objects use new-only writes and strong reads. A backup is downloaded, decrypted and checked—including all media checksums—before its immutable verification receipt is recorded. Failed attempts do not overwrite verified recovery files. The **Operations** page shows verified files, missing/stale coverage (older than 36 hours) and unresolved failures. Routine checks have no donor or credential payloads in logs. There are no notification emails.

There is **no automatic deletion** in this milestone. Files remain until an approved retention/deletion policy is implemented; hiding media does not erase historical backups. Storage and function usage may consume existing Netlify account credits. No plan upgrade was performed.

## Recovery key

The production key is configured as the function-only, production-context secret `RALLYFUND_STORAGE_KEY`. A private recovery copy is saved at:

`.local/pilot/storage-recovery-key-v1.json`

**Keep a secure offline copy of that file and an encrypted recovery download.** Do not commit it, send it through chat/email or store it beside a publicly shared recovery file. Losing both the hosted and recovery copies makes the encrypted data unrecoverable. The key is never returned by an application API. `configure-pilot-storage.mjs` refuses to replace a previously saved key with a different key. Key rotation needs an explicit re-encryption/key-preservation plan; changing the environment value alone is not a safe rotation.

The database token still expires on **2026-11-15**. Rotate that existing database-scoped token and update local/hosted configuration before expiration so scheduled backups can continue. The recovery encryption key itself has no automatic expiry.

## Private image library

**Media** is available to signed-in organization administrators. Uploads are private staged assets, not published branding or athlete profiles. The pilot's existing Campaign Settings logo upload remains disabled until an approved publication workflow is built.

- Only PNG, JPEG and WebP, up to 2 MB per source image. The server verifies the actual decoded format and rejects malformed images, SVG, animations, excessive dimensions and more than 16 megapixels.
- Sharp decodes, orients, resizes to fit within 1600 × 1600 and re-encodes as WebP. EXIF/GPS, camera metadata and original filenames are not retained.
- The normalized bytes are encrypted before storage. Metadata, organization/optional campaign/athlete relationships, checksums, creator and idempotency identities live in the relational `media_assets` table.
- Reads require a current, active organization administrator session and matching organization ownership. Responses are `image/webp`, `no-store`, `nosniff`, without public CDN URLs, signed sharing links or CORS grants. Raw object keys are not accepted from callers.
- **Hide image** revokes its authenticated preview URL and records an audit entry. It does not destroy stored bytes or recovery history. Upload/hide operations are idempotent; changing content under an existing upload request ID is rejected.
- Preparation limit: 100 images and 4 MB total normalized bytes, including hidden images. The complete recovery bundle is bounded at 12 MB before outer encryption. These are deliberate small-pilot limits, not a general upload platform.

The library does not enable real-minor collection or replace athlete/guardian authorization. There are no public image-serving routes in this milestone.

## Environment and deployment boundaries

Both API storage and the scheduled function require the fixed pilot site ID `042b91a6-50e0-4f18-9d67-0ca7f789cfa9`, canonical pilot URL, `RALLYFUND_MODE=pilot`, and a published production deploy. Review sites, previews, wrong hosts and unpublished deploys cannot open the pilot stores. Scheduled functions are not public HTTP endpoints. Only TVVC owners can access whole-database backup operations/downloads; ordinary administrators and other organizations are denied.

The additive feature migration creates `media_assets`, indexes and the version-two `pilot_migrations` record. The original version-one identity marker and all existing domain tables stay intact. A private pre-migration schema/data archive was saved under `.local/pilot`. Previous database-only recovery files remain supported, with an empty media library after restore.

```powershell
npm run pilot:control -- init
node --env-file=.env.pilot scripts/configure-pilot-storage.mjs
npm run prepare:pilot-runtime
npm run build
node "$env:APPDATA/npm/node_modules/netlify-cli/bin/run.js" deploy --site 042b91a6-50e0-4f18-9d67-0ca7f789cfa9 --prod --no-build --skip-functions-cache
```

`prepare:pilot-runtime` supplies Sharp's Linux optional packages when deploying from Windows, preserving the Windows packages for local tests. Linux builders use their normal npm installation. `.netlify/state.json` remains linked to the review project; explicit pilot site IDs are required. Pilot deployment remains manual from `codex/tvvc-pilot-foundation`.

## Recovery rehearsal

Download an encrypted file from **Operations**, then place it under `.local/pilot` with its original `daily-YYYY-MM-DD.enc` or `manual-<requestId>.enc` filename. With the matching key in ignored `.env.pilot`:

```powershell
npm run pilot:control -- verify-cloud-recovery .local/pilot/manual-<requestId>.enc
```

This decrypts/authenticates the complete bundle, verifies each media checksum, restores the database into a **new** local directory, writes recovered encrypted media into its separate empty directory, and checks database integrity, foreign keys, domain contents and media bytes. It never overwrites the active database or cloud store. Do not promote a recovery directory unless the entire rehearsal succeeds. A real recovery cutover remains an operator-controlled operation.

`npm run pilot:control -- backup` remains an explicitly database-only local export. Use the encrypted cloud recovery files when private images must also be recovered.

## Verification

`npm test` covers metadata stripping and image bounds, malformed uploads, organization access, durable upload replay, revocation, encryption/tamper/wrong-key rejection, complete database/media recovery, failed-backup preservation/retry, legacy migration/recovery, API authentication and deployment isolation. `npm run test:e2e:pilot` covers mobile media upload/preview, anonymous denial, manual backup, encrypted download/decryption and image hiding, in addition to individual account management. The existing `npm run test:e2e` review flows remain separate and use the same isolated ports.

Hosted verification:

```powershell
node --env-file=.env.pilot scripts/verify-pilot-storage.mjs .local/pilot/bootstrap-<timestamp>.json
```

It uses a synthetic image, exercises the actual Netlify/Turso/Blobs pipeline, downloads an encrypted backup, restores database and images into a new local directory, hides its test image, checks 390px/desktop Operations and confirms the original review still runs in simulation mode. Artifacts are ignored under `artifacts/pilot-storage` and `.local/pilot`. The scheduled function can also be tested with **Netlify → Functions → pilot-backup → Run now**; verify a `Pilot backup verified` entry and a daily recovery file in Operations.

Recorded verification on 2026-10-16: 51 tests passed, both pilot browser flows passed, all 14 review browser flows passed, build/format checks passed, and npm audit reported zero vulnerabilities. Hosted database/media recovery passed. Two dashboard invocations of the deployed scheduled function both verified the same `daily-2026-10-16` object, confirming retry reuse without a duplicate daily archive.

Remaining before live data: approve retention/deletion (including originals and backups), secure the offline recovery copy, rehearse the real cutover procedure, and complete the remaining launch checklist. Physical-device/Safari validation and independent external failure alerts are still outstanding.
