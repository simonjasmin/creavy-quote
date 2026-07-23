-- 0003_origin.sql — #24 provenance (founder-ratified 2026-07-23). Store the POST `Origin`
-- HEADER VALUE only (e.g. "https://creavy.netlify.app") — NO IP, NO User-Agent, NO Referer.
-- Provenance, not PII (#24 intact). Nullable; written on POST /quote; never returned by any
-- projection. Lets a stale-answer leak be dated to a deploy origin going forward.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS origin TEXT;
