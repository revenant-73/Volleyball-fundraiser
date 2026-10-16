CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  campaign_id TEXT,
  athlete_id TEXT,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','hidden')),
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  UNIQUE(org_id,request_id),
  FOREIGN KEY(campaign_id,org_id) REFERENCES campaigns(id,org_id),
  FOREIGN KEY(athlete_id,campaign_id) REFERENCES athletes(id,campaign_id),
  FOREIGN KEY(created_by,org_id) REFERENCES users(id,org_id),
  CHECK(athlete_id IS NULL OR campaign_id IS NOT NULL)
);
CREATE INDEX media_by_organization ON media_assets(org_id,status);
CREATE TABLE pilot_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT INTO pilot_migrations(version,applied_at) VALUES (2,datetime('now'));
