-- Separate review data; no existing website database or tables are touched.
CREATE TABLE fundraiser_review_state (
  id text PRIMARY KEY,
  snapshot jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
