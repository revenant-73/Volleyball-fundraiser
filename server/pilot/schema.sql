-- Dedicated RallyFund pilot database only. No review data is imported.
CREATE TABLE pilot_metadata (
  id TEXT PRIMARY KEY CHECK (id = 'rallyfund-tvvc-pilot'),
  version INTEGER NOT NULL CHECK (version = 1)
);
CREATE TABLE organizations (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE users (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE CHECK(email = lower(trim(email))),
  role TEXT NOT NULL CHECK(role IN ('owner','admin')),
  active INTEGER NOT NULL CHECK(active IN (0,1)), credential_version INTEGER NOT NULL,
  salt TEXT NOT NULL, password_hash TEXT NOT NULL,
  UNIQUE(id, org_id)
);
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
  slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('draft','active','paused','closed')),
  goal_cents INTEGER NOT NULL CHECK(typeof(goal_cents)='integer' AND goal_cents > 0),
  data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(id, org_id)
);
CREATE TABLE athletes (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(id, campaign_id),
  FOREIGN KEY(campaign_id,org_id) REFERENCES campaigns(id,org_id)
);
CREATE TABLE contacts (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
  email TEXT NOT NULL CHECK(email = lower(trim(email))),
  data TEXT NOT NULL CHECK(json_valid(data)),
  UNIQUE(campaign_id,email), UNIQUE(id,campaign_id),
  FOREIGN KEY(campaign_id,org_id) REFERENCES campaigns(id,org_id)
);
CREATE TABLE contact_athletes (
  contact_id TEXT NOT NULL, athlete_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
  PRIMARY KEY(contact_id,athlete_id),
  FOREIGN KEY(contact_id,campaign_id) REFERENCES contacts(id,campaign_id),
  FOREIGN KEY(athlete_id,campaign_id) REFERENCES athletes(id,campaign_id)
);
CREATE TABLE donations (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE, email TEXT NOT NULL CHECK(email=lower(trim(email))),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents > 0),
  fee_cents INTEGER CHECK(fee_cents IS NULL OR (typeof(fee_cents)='integer' AND fee_cents >= 0)),
  method TEXT NOT NULL CHECK(method IN ('stripe','venmo','school','check')),
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected','refunded')),
  transaction_key TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
  UNIQUE(id,campaign_id),
  FOREIGN KEY(campaign_id,org_id) REFERENCES campaigns(id,org_id)
);
CREATE UNIQUE INDEX donation_transaction_unique ON donations(org_id,method,transaction_key)
  WHERE transaction_key <> '' AND status <> 'rejected';
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  contact_id TEXT NOT NULL, donation_id TEXT,
  type TEXT NOT NULL CHECK(type IN ('solicitation','thank-you')),
  status TEXT NOT NULL CHECK(status IN ('queued','sent','failed','blocked','skipped')),
  data TEXT NOT NULL CHECK(json_valid(data)),
  FOREIGN KEY(contact_id,campaign_id) REFERENCES contacts(id,campaign_id),
  FOREIGN KEY(donation_id,campaign_id) REFERENCES donations(id,campaign_id)
);
CREATE UNIQUE INDEX one_thankyou_per_donation ON jobs(donation_id) WHERE type='thank-you';
CREATE INDEX jobs_ready ON jobs(status,campaign_id);
CREATE TABLE activity (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE TABLE ledger_audit (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, donation_id TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  FOREIGN KEY(donation_id,campaign_id) REFERENCES donations(id,campaign_id)
);
CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
  data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE TABLE suppressions (
  org_id TEXT NOT NULL REFERENCES organizations(id), email TEXT NOT NULL CHECK(email=lower(trim(email))),
  data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(org_id,email)
);
CREATE TABLE idempotency_requests (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE payment_events (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
CREATE TABLE private_links (athlete_id TEXT PRIMARY KEY REFERENCES athletes(id), capability TEXT NOT NULL);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, org_id TEXT NOT NULL, expires INTEGER NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  FOREIGN KEY(user_id,org_id) REFERENCES users(id,org_id)
);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE login_attempts (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TRIGGER ledger_audit_no_update BEFORE UPDATE ON ledger_audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
CREATE TRIGGER ledger_audit_no_delete BEFORE DELETE ON ledger_audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
CREATE TRIGGER admin_audit_no_update BEFORE UPDATE ON admin_audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
CREATE TRIGGER admin_audit_no_delete BEFORE DELETE ON admin_audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
