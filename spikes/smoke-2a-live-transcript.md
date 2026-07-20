# Phase 2a — LIVE staging smoke transcript

- **Staging URL:** https://creavy-quote-production.up.railway.app
- **Scanned ICP URL:** https://toituresmarcelpouliot.com/
- **Result:** 5/5 behaviours passed ✅

| # | behaviour | expected | actual | result |
|---|---|---|---|:--:|
| | 1. scanned → terminal via poll (real ICP URL) | status∈{completed,failed} via poll, indicative:true, contract-shaped result (https://toituresmarcelpouliot.com/) | status=completed {"quote_id":"qt_600aa681b2b1","status":"completed","basis":"scanned","result":{"bundle":{"tier":"standard","addons":[],"modifiers":[]},"reasons":["cheapest_bundle"],"currency":"CAD","confidence":"low","core_pages":4,"analysis_details":[{"item":"pages","value":4},{"item":"language"," | ✅ |
| | 2. no-site declared → completed | status:completed, basis:declared, result.bundle.tier + indicative_total | {"quote_id":"qt_951a1c7e61eb","status":"completed","basis":"declared","result":{"bundle":{"tier":"standard","addons":["bilingual","booking"],"modifiers":[]},"reasons":["cheapest_bundle","bilingual_addon","declared_basis"],"currency":"CAD","indicative_total":407000,"suggested_addons":[],"care_plan_mo | ✅ |
| | 3. rate-limit burst → 429 + Retry-After | a 429 with Retry-After≥1 within the burst | 429 after 19 POSTs, Retry-After=54s | ✅ |
| | 4. CORS #33 (preview allowed, evil blocked) | preview origin echoed; evil.com → no ACAO | prod=https://creavy.netlify.app (echoed); preview=https://deploy-preview-7--creavy.netlify.app; evil=(none) | ✅ |
| | 5. /health | 200 {status:ok} | 200 {"status":"ok","env":"staging"} | ✅ |

> Relay this file + the staging URL + the resolved `ALLOWED_ORIGIN` to the gate.
