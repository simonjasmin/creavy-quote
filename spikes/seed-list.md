# Acceptance seed list — real ICP URLs (organic + founder-curated)

Real sites for the golden swap + the outcome sweep. Diagnosed via `spikes/diagnose-site.mjs`
(one polite pass, CreavyQuoteBot UA, robots respected). When the founder's full 8–10 list
lands: harvest under the standing rules, complete the synthetic-golden swap, re-run
`spikes/corpus-sweep.mjs`, and fill the per-URL engine table below (register · reason code ·
price/range) for the acceptance CSV.

## Per-URL engine table (paste-ready for the acceptance CSV engine columns)

| # | URL | core | register | reason_code | price / range (cents) | needs_browser |
|---|---|--:|---|---|---|:--:|
| 1 | sltoiture.com | 30+ | *(review, no price)* | `out_of_scope_30_plus` | — (book-a-call) | no |
| 2 | toitureshogue.com | 31 | *(review, no price)* | `review_unusual_size` | — (book-a-call) | no |

## Cause chains

**1. sltoiture.com** — diagnosed 2026-07-20 (live, one polite pass).
- canonical `https://www.sltoiture.com`; **30+ core**; Duda (high); bilingual (hreflang, en/fr);
  flags `under_construction`, `pairing_evidence:hreflang`; `needs_browser: false`; `partial: false`.
- `assessable(): false` → mapTier `out_of_scope_30_plus` (30+ → out-of-scope, book-a-call).
- **Not a browser-fallback case** — no `needs_browser` datum for the deferred priority.

**2. toitureshogue.com** — already documented (§1 of `corpus-outcome-sweep.md`); **no re-scan**.
- 31 core, WordPress, bilingual; `partial` (sitemap children capped) → `review_unusual_size`
  (partial excludes the #35 band). `needs_browser: false`.

## Notes

- **Both seeds are large** (30+/31) → they land in the review path, not the ≤6 flat or 7–12
  band. They **don't cover** the small/mid shapes the swap needs; the full list should include
  ≤6-core and 7–12-core sites so the band + flat paths get real coverage.
- **needs_browser count so far: 0/2.** The browser-fallback priority (v1.1, deferred) has no
  live datum yet — watch for it as seeds accumulate.
