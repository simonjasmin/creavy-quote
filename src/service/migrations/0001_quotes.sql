-- 0001_quotes.sql — the quotes table + event log, RECONCILED with Phase 0 §8.
-- Phase 0 wins on collision; the deltas below are flagged per the tour.
--
-- FLAGGED DIFFERENCES vs Phase 0 §8:
--   * url: Phase 0 was NOT NULL. Relaxed to NULL — the no_site declared path (#29.3,
--     ratified AFTER Phase 0) carries no url. [Phase-0 vs #29.3]
--   * page_count INTEGER cannot hold "30+"; the authoritative core_pages lives in
--     crawl_facts (jsonb). page_count holds the numeric value, NULL when "30+". [flag]
--   * tier: Phase 0 wrote essential|standard|pro; ratified pricing is
--     presence|standard|pro(_custom). Column stores the #27 tier verbatim. [flag]
--   * Added (tour): normalized_url, answers_hash, no_site, fresh_scan, page_content,
--     mapper_output, response, reason, event_log. crawl_facts + claude_assessment KEPT
--     (invariant #2 — never trimmed; claude_assessment stays NULL until 2b).
--   * The flat analytics columns (tier/price_min/max/detected_platform/page_count/...)
--     are present for the repricing + conversion loops but stay NULL in 2a; everything
--     is recoverable from crawl_facts + mapper_output (jsonb).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id                TEXT PRIMARY KEY,           -- qt_...
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- input
  url               TEXT,                       -- NULL for no_site (#29.3 relaxes Phase 0's NOT NULL)
  normalized_url    TEXT,                        -- normalize() identity; cache key (#25-A step 7)
  answers_hash      TEXT,                        -- (normalized_url, answers_hash) = A7 stage-2 key (2b)
  no_site           BOOLEAN NOT NULL DEFAULT false,
  answers           JSONB NOT NULL,
  persona           TEXT,                        -- conversion funnel (Phase 0)

  -- processing
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending|completed|failed
  fresh_scan        BOOLEAN NOT NULL DEFAULT false,   -- did this job enqueue a real crawl? (ceiling)
  used_browser      BOOLEAN NOT NULL DEFAULT false,   -- Phase 0
  confidence        TEXT,                             -- Phase 0

  -- crawl facts (repricing feedback loop — invariant #2, never trimmed)
  detected_platform TEXT,
  page_count        INTEGER,                     -- numeric core_pages; NULL when "30+"
  template_estimate INTEGER,                     -- Phase 0 (stage-2 era; NULL in 2a)
  crawl_facts       JSONB,                       -- the decision-#8 ScanResult (tour "scan_result")
  page_content      JSONB,                       -- #32 A1 retained Option-C content

  -- claude assessment (stage 2 / 2b — NULL in 2a; invariant #2 column kept)
  claude_assessment JSONB,

  -- output (OUR rules — #27 mapper)
  mapper_output     JSONB,                       -- full #27 TierResult
  tier              TEXT,                        -- #27 tier (presence|standard|pro|pro_custom)
  price_min         INTEGER,
  price_max         INTEGER,
  currency          TEXT DEFAULT 'CAD',
  suggested_addons  JSONB,
  response          JSONB,                       -- built contract body, cached for GET
  reason            TEXT,                        -- failure reason (§5)

  -- #24 event spine (appended in order with seq)
  event_log         JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- conversion tracking (Phase 0)
  booked_call       BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes (created_at);
CREATE INDEX IF NOT EXISTS idx_quotes_status     ON quotes (status);
CREATE INDEX IF NOT EXISTS idx_quotes_persona    ON quotes (persona);
CREATE INDEX IF NOT EXISTS idx_quotes_norm_url   ON quotes (normalized_url, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_fresh_scan ON quotes (fresh_scan, created_at);
