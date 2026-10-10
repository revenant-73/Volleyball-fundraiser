# Volleyball fundraiser workspace

Read Project_Brief.md and README.md before changes. Keep all project files inside this folder. Do not modify the separate TVVC website.

This is milestone-one simulation. The user authorized a Netlify hosted review with durable data, and commit/push/deploy to the fundraiser site. Real payments, outbound fundraising email, live payment/email credentials and external payment navigation remain disabled until a later explicit request and completed launch requirements in docs/Live_Launch_Checklist.md. Use fictional data only in local and hosted review environments.

Keep organization authorization on the server. Never expose donor contacts or private invitation tokens in public responses/logs. Protect existing state. Amounts are integer cents; unknown fees stay unknown. Preserve pending/confirmed/rejected/refunded distinctions, per-campaign normalized contact uniqueness, explicit indefinite pending-payment holds, and durable idempotency. Reuse current stack; avoid unrelated refactors.

Tests must cover state transitions and duplicate processing. Run npm test and npm run build for domain/UI changes; npm run test:e2e for flows. Browser test data is isolated on ports 5174/3101 under .local-e2e. No live contacts or actual minor information in fixtures.
