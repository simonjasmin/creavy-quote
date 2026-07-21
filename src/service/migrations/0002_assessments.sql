-- 0002_assessments.sql — stage-2 (2b) assessment rows, keyed to a quote.
-- NO email / PII column, by construction (treaty T4 — PII lives only in Netlify Forms).
-- One assessment per quote is enforced at the DB level (unique index) — belt-and-suspenders
-- for the #32 A7 "one model call per quote, ever" rule.

CREATE TABLE IF NOT EXISTS assessments (
  id                 TEXT PRIMARY KEY,                 -- as_...
  quote_id           TEXT NOT NULL REFERENCES quotes(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL DEFAULT 'pending',  -- pending|streaming|completed|unavailable
  content_readiness  TEXT NOT NULL,                    -- ready|partial|none (never a pricing input)
  model              TEXT,

  -- PUBLIC (GET /quote/:id/assessment)
  prose_chunks       JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_addons   JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- INTERNAL — never returned on any wire (#24 default-deny, #32)
  complexity         TEXT,
  complexity_factors JSONB,
  review_note        TEXT,
  confidence         TEXT,
  flagged_for_review BOOLEAN,
  reason             TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assessments_quote   ON assessments (quote_id);
CREATE INDEX        IF NOT EXISTS idx_assessments_created ON assessments (created_at);
