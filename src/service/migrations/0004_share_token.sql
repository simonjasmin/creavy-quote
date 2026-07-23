-- 0004_share_token.sql — ENG-04 schema foundation ONLY. Nullable, UNUSED in v1.
-- Reserved as the PORTAL-PHASE credential: a revocable, high-entropy share token for
-- soumission links (the v1 soumission is served by quote_id behind the GET rate-limiter +
-- 30-day expiry — see SPEC §2.18 enumeration math). Minting, auth, and the T4/PII amendment
-- for the portal are OUT of scope here and FOUNDER-GATED. No code reads or writes this yet.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_share_token ON quotes (share_token) WHERE share_token IS NOT NULL;
