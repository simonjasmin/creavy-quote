# Creavy Quote API — contract v0.7

> **Canonical home:** this file (`contracts/quote-api-contract.md` in `creavy-quote`).
> creavy-site keeps a **synced copy** and never reads `SPEC.md`. Machine enums only;
> all FR/EN labels are **site-owned**. Amounts are **integer cents, `currency:"CAD"`**
> (#20) — the site divides for display.
>
> **A version bump is complete only when this file is copied into `creavy-site/design/` AND
> the staging `/health` reports the matching `contract_version`.** (E2 incident: site copy was
> v0.1 while staging served v0.5 — the skew was silent because the treaty had no transport.)
>
> **Sole authority:** the ratified decisions in `SPEC.md` (§2 #1–#29) + the pricing
> config. Consumer requirements from creavy-site are inputs to validate, not authority.
> Every field cites a decision ID; anything unsettled is **⚠ FOUNDER DECISION** or
> **§ PROVISIONAL**, collected in §10. Zero silent inventions.

## 1. Header / traceability

- **Version:** 0.7 (2026-07-20). **Status:** draft for creavy-site E1; indicative only.
- **Changelog v0.6 → v0.7 (stage-2 assessment delivery — `stage2-treaty-v07.md`):**
  - **Additive only** — every stage-1 shape, both registers, reason codes, `analysis_details`
    are **unchanged.** The site can ship stage-1 behavior as-is and layer stage 2 on.
  - New `POST /quote/:id/assess` (body `{content_readiness}` only, **no PII**) and
    `GET /quote/:id/assessment` (public projection). §11.
  - `assessment_*` events ride the **existing** since-`seq` event route (§8/§24). Internal
    assessment fields (`complexity_factors`, `review_note`, `confidence`,
    `flagged_for_review`) are **never** on any wire.
- **Changelog v0.5 → v0.6 (#35 size-estimation band):**
  - Appended `size_estimation_band` to the `reason_code` enum (§2a). Clean **7–12-core** sites
    now return `register:"estimation"` with a `range` (was pure review). **No shape change** —
    the estimation shape (§4b) already exists.
  - **Site re-sync non-urgent** (tolerate-unknown-codes rule, §2a): an un-synced site renders
    the estimation range with a generic reason line until it adds the label.
- **Changelog v0.4 → v0.5 (#33 CORS, ratified):**
  - §7 rewritten to **#33 as implemented**: the exact production origin **plus** the anchored,
    **https-only** deploy-preview pattern `^https://[a-z0-9-]+--creavy\.netlify\.app$` (live —
    no mock adapter). **Supersedes #30.4.** No other changes. Site re-syncs its copy.
- **Changelog v0.3 → v0.4 (amendment #31, consumer-driven « Détails de l'analyse » panel):**
  - New optional `analysis_details: [{item, value}]` on **completed** quotes (§4d-bis) —
    a **narrow whitelisted exception** to stored-never-returned (#31). Whitelist:
    `platform | pages | language | ecommerce | https`.
  - **`https` is true-only** (omit when absent — a `false` never reads as critique);
    **`booking` is not in the whitelist** (no scan-side detector).
  - Inclusion rule: high detection confidence only; below → omitted, **no confidence field
    on the wire**. Field **absent entirely** on `no_site` quotes and when nothing qualifies.
- **Changelog v0.2 → v0.3 (30.5 / 30.6, now live in the engine):**
  - `reasons[]` are now a **stable, append-only `reason_code` enum** (§2a) — **still
    optional to render** (the site owns FR/EN labels). Prose moved to internal
    `reason_text`, never on the API (30.5).
  - `suggested_addons` is now **populated** `[{id, amount}]` (was present-and-empty):
    `has_brand_assets:false` → `logo_refresh`; blog below threshold → `seo_migration`
    (30.6).
- **Changelog v0.1 → v0.2 (amendment #30):**
  - `component: none|booking|listings|both` replaces the `needs_booking_or_listings`
    boolean (30.2).
  - Declared-vs-scanned page-band disagreement → `estimation` register over the union
    need-set (30.1); resolves ⚠-1/§P-3.
  - `suggested_addons` → `[{id, amount}]`, amounts integer cents from config (30.3).
  - CORS: production origin only; previews use the mock adapter — ratified (30.4).
  - Answers schema founder-verified against the site object (30.8); ⚠-2 resolved by the
    enum. §P-1 (reason codes) + §P-5 (suggestion emission) deferred to the next quote-side
    tour (30.5/30.6).
- **Base:** `POST /quote` (create) · `GET /quote/:id` (poll) — async-capable contract
  from Phase 0 §7, sync-hold 8 s (#1) with polling fallback.
- **Two-stage + price/assessment split (#25C, #29):**
  - **Stage 1** — scan (crawl + fingerprint), free + ungated, cached by normalized URL.
  - **Stage 1½** — **deterministic indicative price**, public, **zero-PII, no contact
    field** (#29.1). This is what this contract returns.
  - **Stage 2** — Claude assessment + written quote, **behind email capture** (#25C,
    #29.2). **Not in this contract** (§8).
- **Binding (#29.5):** nothing binds until founder sign-off. Every response carries
  `indicative: true` (machine flag, never localized text).
- **Traceability tags used below:** `[#n]` = SPEC §2 decision; `[cfg]` = pricing config;
  `⚠` = founder decision; `§P` = provisional.

## 2. Conventions

| Concept | Rule | Trace |
|---|---|---|
| Money | integer **cents**, `currency:"CAD"` always explicit | #20 |
| Enums | machine values only; **no localized strings in any response** | #24 default-deny; site owns FR/EN |
| Priced bundle | `bundle:{tier, addons[]}` — the #27 mapper output; `addons[]` are **priced** (reflected in `indicative_total`) | #27 |
| Suggested add-ons | `suggested_addons: [{id, amount}]` — **unpriced upsells** with the config price in **integer cents**; site renders labels + formats money, **never hardcodes a price**. `id` = verbatim config add-on ID. **Populated by the engine** (30.6): `has_brand_assets:false`→`logo_refresh`, blog<threshold→`seo_migration` | [cfg], #20/#22, #27.4/27.5, 30.3/30.6 |
| Price kinds | `flat` (cents) · `percent_modifier` · `human_quote` | #20 |
| Tiers | `presence` · `standard` · `pro` · `pro_custom` | [cfg], naming §2 |
| Confidence | `platform` appears **only at high confidence**, else `"unknown"` | #23 |
| Page count | `core_pages` from the decision-#8 object (int or `"30+"`) | #8 |
| Indicative flag | `indicative: true` on every response | #29.5 |
| Basis | `"scanned"` (URL crawled) · `"declared"` (answers-only, `no_site`) | #29.3 |
| Register | `"flat"` (single `indicative_total`) · `"estimation"` (`range{min,max}`+`confidence`) | #29.4 |
| Never returned | `crawl_facts`, `claude_assessment`, `signals_matched`, review flags, scoring, event-log content — **stored, never returned** (sole exception: the `analysis_details` whitelist, §4e) | #24, #8, #31 |

**Add-on IDs (from config, verbatim — not retyped from memory):** `extra_page`,
`copywriting_per_page`, `logo_refresh`, `bilingual`, `booking`, `ecommerce`
(human_quote), `photo_sourcing`, `seo_migration`, `rush_delivery` (percent_modifier),
`extra_revision`. [cfg]

### 2a. `reason_code` enum (30.5 — stable, append-only, live in the engine)

`reasons[]` are **stable snake_case codes**; **still optional to render** (the site owns
FR/EN labels). Prose lives in the engine's internal `reason_text` and **never crosses the
API**. **Append-only:** a code is never renamed once published — renaming is a breaking
change; **deprecation is a changelog line**, not an edit. The site must **tolerate unknown
codes** (render a generic line or nothing).

| code | meaning |
|---|---|
| `cheapest_bundle` | the selected least-expensive valid bundle (27.3) |
| `bilingual_addon` | bilingual priced as a Standard add-on |
| `bilingual_included_pro` | bilingual covered flat by Pro |
| `listings_needs_pro` | listings has no Standard add-on → only Pro covers it |
| `blog_migration_included` | blog ≥ threshold → SEO migration audit in the bundle (27.5) |
| `blog_migration_suggested` | blog below threshold (but present) → SEO migration suggested |
| `ecommerce_human_quote` | e-commerce → sur mesure (human_quote, #21) → review |
| `bilingual_suspected_review` | bilingual suspected — human confirms scope |
| `needs_closer_look` | JS-heavy / `needs_browser` → review |
| `robots_blocked` | robots `Disallow: /` — limited view → review |
| `partial_scan` | scan hit the budget → partial → review |
| `anti_bot_challenge` | anti-bot challenge encountered → review |
| `review_unusual_size` | ≥ 7 core pages — a human decides (no auto-bundle) |
| `out_of_scope_30_plus` | `core_pages == "30+"` — out of scope |
| `greenfield_no_price` | greenfield (parked / no_html / no_owned_site) — nothing to price |
| `review_no_clean_bundle` | no clean bundle covers the shape |
| `declared_scan_conflict` | declared vs scanned page-band disagreement (30.1, reconciliation layer — not the #27 mapper) |
| `size_estimation_band` | clean 7–12 core → instant estimation `range`, exact price human-confirmed (#35) |

**Flag line (contracts must not collide):** this "no localized strings" rule does **not**
apply to the #24 **event-stream** endpoint, whose server-side FR/EN templates are
separately ratified. That endpoint is out of scope here (§8). [#24]

## 3. `POST /quote`

**Request body:**
```jsonc
{
  "url": "https://example-plombier.ca",   // optional; omit iff no_site=true
  "no_site": false,                        // optional, default false (#29.3 declared basis)
  "answers": {                             // REQUIRED — all 4 keys, no partial requests
    "pages": "3_4",                        // enum "1_2" | "3_4" | "5_plus"
    "component": "listings",               // enum "none"|"booking"|"listings"|"both" (30.2)
    "languages": "fr_en",                  // enum "fr" | "fr_en"
    "has_brand_assets": false              // boolean
  }
  // honeypot + Turnstile token: transport-level (#25A), added at the endpoint layer — §P
}
```

**Answers schema (consumer-fixed; site owns labels).** Per key: type · allowed values ·
role · `no_site` interplay.

| key | type / values | role | `no_site` interplay | trace |
|---|---|---|---|---|
| `pages` | enum `1_2`\|`3_4`\|`5_plus` | **tier_input** (page band) | **only key that changes meaning:** current-site pages when scanned; pages **needed** when `no_site` (site swaps the label; API sees one field) | #27.2 · **30.1** reconciliation (disagreement → estimation) |
| `component` | enum `none`\|`booking`\|`listings`\|`both` | **tier_input** | mode-independent — *desired* functionality the crawl can't see | #27.4 · 30.2 · `booking`→$590 add-on path, `listings`→Pro trigger, `both`→enumerator decides |
| `languages` | enum `fr`\|`fr_en` (room for future `en`) | **tier_input** (bilingual) | mode-independent — *desired* delivered language(s) | #18 (bilingual pricing) · #26/#28 |
| `has_brand_assets` | boolean | **addon_signal only** (never tier) | mode-independent | #27 addon · `logo_refresh` $490 [cfg] |

**Validation:** any **missing key** or **out-of-enum** value → **`400`** (§5 shape). `url`
absent while `no_site=false` → `400`. Answers are all-or-nothing (client submits once).

**Reconciliation — declared vs scanned (30.1).** When both `url` (→ scanned `core_pages`)
and `answers.pages` are present:
- **bands agree** → `register:"flat"`, `basis:"scanned"`.
- **bands disagree** → `register:"estimation"`, `range` = the #27.3 bundle-set bounds over
  the **union** of both readings' need-sets; `confidence` lowered; `review_required:true`
  (an enumerated estimation trigger, #29.4).
- **Scanned facts (bilingual, blog_posts, platform, components) always apply as needs** —
  declared answers **add** needs, never erase evidence.

**Legacy `needs_booking_or_listings:true`** (pre-30.2 site adapters) → `register:
"estimation"`, `range` = [cheapest booking bundle … Pro] — never a silent under-price
(30.2). Adapters should migrate to `component`.

**Response (sync-hold ≤ 8 s, #1):** `202`-style body
```jsonc
{ "quote_id": "qt_a1b2c3", "status": "pending" }   // or "completed" with result (§4) if fast
```
`429` (rate-limited, #25A) with **`Retry-After`** header. `400` on validation (§5).

## 4. `GET /quote/:id` — poll / retrieve

`status ∈ "pending" | "completed" | "failed"`. Shapes:

### 4a. `completed` — scanned, **flat** register
```jsonc
{
  "quote_id": "qt_a1b2c3",
  "status": "completed",
  "indicative": true,                 // #29.5
  "basis": "scanned",                 // #29.3
  "register": "flat",                 // #29.4
  "review_required": false,           // #27.6
  "result": {
    "bundle": { "tier": "standard", "addons": [] },  // #27; addons here are PRICED
    "indicative_total": 279000,       // cents = tier + priced addons, #20/#29.4
    "currency": "CAD",
    "suggested_addons": [{ "id": "logo_refresh", "amount": 49000 }], // unpriced upsells, cents (30.3)
    "care_plan_monthly": 5900,        // cents, [cfg] (attached at render, #27.8)
    "reasons": ["cheapest_bundle"],   // stable codes (§2a); optional to render (30.5)
    "core_pages": 4,                  // #8 (int | "30+")
    "detected_platform": "wordpress", // high-conf only, else "unknown" (#23)
    "confidence": "high"              // #23
  }
}
```

### 4b. `completed` — scanned, **estimation** register (softened confidence, #29.4)
```jsonc
{
  "quote_id": "qt_x", "status": "completed", "indicative": true,
  "basis": "scanned", "register": "estimation", "review_required": true,
  "result": {
    "range": { "min": 279000, "max": 429000 },  // bounds of the #27.3 valid-bundle set
    "currency": "CAD", "confidence": "medium",   // #29.4 enum
    "suggested_addons": [], "reasons": ["needs_closer_look"],
    "core_pages": 5, "detected_platform": "wix", "confidence_platform": "high"
  }
}
```

### 4c. `completed` — **declared** basis (`no_site`) — **omits** crawl-derived fields
```jsonc
{
  "quote_id": "qt_y", "status": "completed", "indicative": true,
  "basis": "declared", "register": "flat", "review_required": false,
  "result": {
    "bundle": { "tier": "standard", "addons": ["bilingual", "booking"] },
    "indicative_total": 407000, "currency": "CAD",
    "suggested_addons": [], "care_plan_monthly": 5900,
    "reasons": ["cheapest_bundle", "declared_basis"]
    // NO core_pages / detected_platform / bilingual_mirror — omitted, not nulled (#29.3)
  }
}
```

### 4d. `completed` — **review-required, no auto price** (hard block → email-capture)
```jsonc
{
  "quote_id": "qt_z", "status": "completed", "indicative": true,
  "basis": "scanned", "review_required": true,
  "result": {
    "reason_code": "out_of_scope",   // enum (§5 list) — site shows "get your full analysis"
    "currency": "CAD", "reasons": ["out_of_scope"]
    // no register / indicative_total / range — nothing to auto-price (#27.6)
  }
}
```

### 4e. `analysis_details` — optional detection-facts panel (#31)

On **completed** quotes, an optional `analysis_details: [{item, value}]` may accompany
`result`, feeding the site's collapsed « Détails de l'analyse » panel. **Machine
enums/typed values only** (site owns FR/EN labels). A **narrow whitelisted exception** to
the stored-never-returned rule (§8) — detection-adapter facts only, ~zero tokens.

- **Inclusion:** an item appears **only at high detection confidence** (#23). Below that →
  **omitted**; **no confidence field crosses the wire — absence IS the signal.**
- **`https` is true-only** — present only when HTTPS is confirmed; omitted otherwise (a
  `false` never reads as critique, #24). **`booking` is not whitelisted** (no detector).
- **Absent entirely** on `no_site` quotes and when nothing qualifies — the site renders
  nothing (absent-tolerant).
- **Never** carries theme/generator, versions, scores, recommendations, or anything from
  the Claude assessment (#24, #31).

| item | value type | source |
|---|---|---|
| `platform` | string enum (`wordpress`\|`wix`\|`shopify`\|`squarespace`\|`duda`\|…) | #8 `detected_platform`, high-conf (#23) |
| `pages` | integer | #8 `core_pages` |
| `language` | enum `fr`\|`fr_en` | #8 `languages` / `bilingual_mirror` |
| `ecommerce` | boolean `true` | Shopify platform (no WooCommerce) |
| `https` | boolean `true` | fetched URL scheme (**true-only**) |

Example (fragment appended to a `completed` `result`):
```json
"analysis_details":[
  {"item":"platform","value":"wordpress"},
  {"item":"pages","value":4},
  {"item":"language","value":"fr_en"},
  {"item":"https","value":true}
]
```

## 5. Failure semantics

`failed` and hard-blocks carry a **machine `reason` / `reason_code` enum** drawn from
ratified outcomes. Every terminal state is renderable — no dead ends (Phase 0 invariant).

| enum | meaning | trace |
|---|---|---|
| `unreachable` | DNS/refused/timeout/TLS/blocked — **uniform** (no SSRF oracle) | D-32, #25B |
| `nxdomain_greenfield` | no site at all → greenfield lead | D-32 |
| `robots_blocked` | `Disallow: /` — homepage-only/no expansion | #12/R-10 |
| `out_of_scope` | `core_pages == "30+"` | #27.2 |
| `needs_review` | ≥7 pages / bilingual_suspected / anti_bot / partial / needs_browser | #27.6 |
| `parked` · `no_html` · `no_owned_site` | greenfield — skips assessment | D-28/29, N-22, #27.6 |
| `budget_exceeded` | daily global ceiling → degrade to email-capture | #25A |

**`failed` shape:**
```jsonc
{ "quote_id": "qt_a", "status": "failed", "indicative": true,
  "reason": "unreachable", "book_a_call": true }
```
**`400` (validation):**
```jsonc
{ "error": "invalid_request", "detail": "answers.pages: out of enum",
  "allowed": ["1_2","3_4","5_plus"] }
```
**`429`:** header `Retry-After: <seconds>`; body `{ "error": "rate_limited" }`. [#25A]

## 6. Polling

- **Suggested interval:** **1500 ms**. **Terminal states:** `completed`, `failed`.
- **Budget:** the scan's hard ceiling is **25 s** (#9) + queue latency. The site's ~**35 s**
  client ceiling is **compatible** (25 s scan + margin). On the site ceiling, render the
  last `pending` as a graceful "still working / book a call" — never a hang.
- Stage 1½ price is deterministic and fast once the scan completes; no second poll phase.

## 7. CORS (#33 — ratified, supersedes #30.4)

- **Production:** `Access-Control-Allow-Origin` = the **exact production origin** from env
  (`ALLOWED_ORIGIN`, the Netlify domain) — exact string match. [#33; #25A placement]
- **Deploy previews (#33):** origins matching the anchored, **https-only** pattern
  `^https://[a-z0-9-]+--creavy\.netlify\.app$` are allowed **live** — Netlify per-deploy
  previews (`deploy-preview-N--creavy.netlify.app`) hit the real staging service; **no mock
  adapter**. Safe because the `*--creavy.netlify.app` namespace is Netlify-controlled — no
  third party can mint one. Fully anchored (start **and** end): lookalikes such as
  `https://…creavy.netlify.app.evil.com` are rejected.
- **Config-driven:** production origin from `ALLOWED_ORIGIN`; the preview pattern is a
  documented constant. Any other origin → **no `Access-Control-Allow-Origin` header** (the
  browser blocks it).

## 8. Not in this contract

- **Stage 2 assessment** (Claude analysis, written quote) — behind email capture (#25C,
  #29.2); its own contract, designed from `ASSESSMENT-RECON.md`.
- **#24 event-stream** (`events since seq N`, SSE) — separate endpoint, server-side FR/EN
  templates (Phase 2). One flag line here so the two contracts never collide (§2).
- **Endpoint abuse layers** (honeypot, Turnstile siteverify, rate-limit internals) —
  #25A, endpoint-layer, not request/response shape. §P.
- **Never returned:** `crawl_facts`, `claude_assessment`, `signals_matched`, review flags,
  scoring, `pairing_evidence`, raw event data. Stored, never on the wire. [#24, #8]
  **Sole exception:** the `analysis_details` whitelist (§4e) — five detection facts only,
  high-confidence, `https` true-only. [#31]

## 9. Examples (six complete cases, real config prices)

**E1 — POST accepted (pending):** `POST /quote {url, answers}` → `{ "quote_id":"qt_1",
"status":"pending" }`.

**E2 — scanned flat (4-page WordPress, wants bilingual, no brand assets):**
```json
{ "quote_id":"qt_2","status":"completed","indicative":true,"basis":"scanned",
  "register":"flat","review_required":false,
  "result":{ "bundle":{"tier":"standard","addons":["bilingual"]},
    "indicative_total":348000,"currency":"CAD",
    "suggested_addons":[{"id":"logo_refresh","amount":49000}],"care_plan_monthly":5900,
    "reasons":["cheapest_bundle","bilingual_addon"],
    "core_pages":4,"detected_platform":"wordpress","confidence":"high",
    "analysis_details":[{"item":"platform","value":"wordpress"},{"item":"pages","value":4},
      {"item":"language","value":"fr_en"},{"item":"https","value":true}] } }
```
*(Standard 279000 + bilingual 69000 = 348000; Standard+bilingual beats Pro 429000 — #27.3.
`has_brand_assets:false` → `logo_refresh` suggestion at config price, 30.6. `analysis_details`
(#31): four high-confidence facts; `https` present so it appears; no `booking` line — not
whitelisted, no detector.)*

**E3 — scanned estimation (5-page, JS-heavy → softened):**
```json
{ "quote_id":"qt_3","status":"completed","indicative":true,"basis":"scanned",
  "register":"estimation","review_required":true,
  "result":{ "range":{"min":318000,"max":429000},"currency":"CAD","confidence":"medium",
    "suggested_addons":[],"reasons":["needs_closer_look"],
    "core_pages":5,"detected_platform":"unknown" } }
```
*(Bounds = Standard+extra_page 318000 … Pro 429000, the #27.3 valid-bundle set. Platform
"unknown" because below high confidence — #23.)*

**E4 — declared, no_site (answers only: 3-4 pages, booking, bilingual):**
```json
{ "quote_id":"qt_4","status":"completed","indicative":true,"basis":"declared",
  "register":"flat","review_required":false,
  "result":{ "bundle":{"tier":"standard","addons":["bilingual","booking"]},
    "indicative_total":407000,"currency":"CAD",
    "suggested_addons":[],"care_plan_monthly":5900,
    "reasons":["cheapest_bundle","declared_basis"] } }
```
*(279000 + bilingual 69000 + booking 59000 = 407000; no crawl fields — #29.3.)*

**E5 — review-required (30+ pages → out-of-scope, email-capture):**
```json
{ "quote_id":"qt_5","status":"completed","indicative":true,"basis":"scanned",
  "review_required":true,
  "result":{ "reason_code":"out_of_scope","currency":"CAD","reasons":["out_of_scope"] } }
```

**E6 — failed (unreachable) + book-a-call:**
```json
{ "quote_id":"qt_6","status":"failed","indicative":true,"reason":"unreachable","book_a_call":true }
```

**E7 — declared/scanned page-band disagreement → estimation (30.1):** scanned `core_pages:3`
(band `3_4`) but `answers.pages:"5_plus"`.
```json
{ "quote_id":"qt_7","status":"completed","indicative":true,"basis":"scanned",
  "register":"estimation","review_required":true,
  "result":{ "range":{"min":279000,"max":429000},"currency":"CAD","confidence":"low",
    "suggested_addons":[],"reasons":["declared_scan_conflict"],
    "core_pages":3,"detected_platform":"wordpress","confidence_platform":"high" } }
```
*(Bounds = Standard 279000 … Pro 429000 across the union of the 3-page and 5+-page
need-sets, #27.3/30.1. Scanned facts still apply as needs.)*

**E8 — `component: "listings"` → Pro (30.2):** 4-page site, listings desired.
```json
{ "quote_id":"qt_8","status":"completed","indicative":true,"basis":"scanned",
  "register":"flat","review_required":false,
  "result":{ "bundle":{"tier":"pro","addons":[]},"indicative_total":429000,"currency":"CAD",
    "suggested_addons":[],"care_plan_monthly":5900,
    "reasons":["cheapest_bundle","listings_needs_pro"],
    "core_pages":4,"detected_platform":"wordpress","confidence":"high" } }
```
*(Listings has no Standard add-on → only Pro covers it, #27.4/30.2. Pro = 429000.)*

## 10. Gate — flag batch (all resolved by amendment #30, 2026-07-19)

v0.1's eight flags + the missed ninth (suggestion prices), ratified:

- **⚠-1 `pages` vs `core_pages` precedence** → ✅ **30.1**: disagreement → `estimation`
  over the union need-set; scanned facts always apply as needs.
- **⚠-2 booking-vs-listings conflation** → ✅ **30.2**: `component` enum
  (`none|booking|listings|both`); legacy `true` → estimation, never a silent under-price.
- **⚠-3 CORS deploy previews** → ✅ **30.4**: production origin only; previews mock.
- **§P-2 answer-object source** → ✅ **30.8**: founder-verified against the site object
  (with the 30.2 enum applied).
- **§P-3 declared-answer integration** → ✅ **30.1**: declared answers *add* needs, never
  erase evidence.
- **(ninth) suggestion prices** → ✅ **30.3**: `suggested_addons: [{id, amount}]`, cents
  from config.
- **§P-1 reason codes** → ✅ **30.5 (v0.3)**: stable append-only `reason_code` enum live
  (§2a); prose in internal `reason_text`. Still **optional** to render.
- **§P-5 `suggested_addons` emission** → ✅ **30.6 (v0.3)**: engine populates `[{id,
  amount}]` (logo when no brand assets, SEO below blog threshold). Site must still
  tolerate `[]`.
- **§P-4 honeypot/Turnstile fields** → ⏳ **30.7**: Phase 2 (#25A) — the only remaining
  deferral.

**No open flags block v0.3.** The one ⏳ item is a ratified Phase-2 deferral, not an open
question.

## 11. Stage 2 — the assessment (v0.7, additive; spec: `stage2-treaty-v07.md` §3)

The Claude assessment (design #32, model chosen #32 Fork 1) renders **below** the stage-1½
price, which is never replaced (treaty T1). **The assessment is never a gate** (T5): any
failure → the price/panel/CTAs are unchanged and this section is simply absent.

### 11a. `POST /quote/:id/assess`
```jsonc
{ "content_readiness": "ready" | "partial" | "none" }   // REQUIRED, closed enum. NO other fields.
```
- **No PII, by construction:** an email-shaped (or any unknown) field → **`400`**. The service
  never receives an email (T4 — PII lives only in Netlify Forms).
- **Preconditions:** the quote **exists**, is `completed`, and `assessable()` is true (#32 A6).
  Otherwise **`409`** + `{ "error": "<machine reason>" }` — the site renders nothing extra.
- **Idempotent per quote (#32 A7):** repeat POSTs return the **existing** assessment — the
  model is called **at most once per quote, ever.**
- Full **#25-A wall** applies; the **assessment daily ceiling** (50/day) is enforced here →
  **`409 { "error": "budget_exceeded" }`** → page unchanged.
- **Response `202`:** `{ "assessment_id": "as_…", "poll_after_ms": 1500 }`.

### 11b. `GET /quote/:id/assessment`
```jsonc
{
  "status": "pending" | "streaming" | "completed" | "unavailable",  // unavailable = normal terminal (T5)
  "assessment_id": "as_…",
  "prose_chunks": ["…"],        // prospect-facing prose, in order (the streamed output)
  "seq": 7,                      // last event seq (for the shared #24 route)
  "suggested_addons": [{ "id": "copywriting_per_page", "amount": 19000 }]  // refreshed by content_readiness
}
```
- **Public projection ONLY** (#24 default-deny). `complexity_factors`, `review_note`,
  `confidence`, `flagged_for_review` are **internal — never in this response.**
- `content_readiness` feeds `suggested_addons` + the founder review note **only** — **never a
  pricing input** (#32 firewall). Amounts are config cents (#30.3).
- **Streaming:** `assessment_started` → `assessment_chunk*` → `assessment_complete` on the
  **existing** `GET /quote/:id/events?since=N` route. Real chunks, real order, no synthetic
  pacing (#24 honesty).

### 11c. Review-copy variants (treaty §7 — stop overclaiming « on a bien lu votre site »)

When a scan was **limited** (`robots_blocked`, `partial_scan`, `anti_bot_challenge`), the
stage-1 result carries that **public-safe reason code** in `reasons[]` and (for those causes)
`register: "estimation"`. The site **keys its review copy on `register` + the public-safe
reason code** — **never** on internal flags — so a limited read says the true thing
(« on a regardé votre page d'accueil ») instead of overclaiming a full read. A full read
carries **none** of those codes. Machine values only; the site owns the wording.
