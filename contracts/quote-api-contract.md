# Creavy Quote API — contract v0.1

> **Canonical home:** this file (`contracts/quote-api-contract.md` in `creavy-quote`).
> creavy-site keeps a **synced copy** and never reads `SPEC.md`. Machine enums only;
> all FR/EN labels are **site-owned**. Amounts are **integer cents, `currency:"CAD"`**
> (#20) — the site divides for display.
>
> **Sole authority:** the ratified decisions in `SPEC.md` (§2 #1–#29) + the pricing
> config. Consumer requirements from creavy-site are inputs to validate, not authority.
> Every field cites a decision ID; anything unsettled is **⚠ FOUNDER DECISION** or
> **§ PROVISIONAL**, collected in §10. Zero silent inventions.

## 1. Header / traceability

- **Version:** 0.1 (2026-07-19). **Status:** draft for creavy-site E1; indicative only.
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
| Suggested add-ons | `suggested_addons[]` — **unpriced upsells** (e.g. `logo_refresh` when `has_brand_assets:false`; `seo_migration` when blog < 5). Verbatim config IDs | [cfg], #27.4/27.5 · §P-5 |
| Price kinds | `flat` (cents) · `percent_modifier` · `human_quote` | #20 |
| Tiers | `presence` · `standard` · `pro` · `pro_custom` | [cfg], naming §2 |
| Confidence | `platform` appears **only at high confidence**, else `"unknown"` | #23 |
| Page count | `core_pages` from the decision-#8 object (int or `"30+"`) | #8 |
| Indicative flag | `indicative: true` on every response | #29.5 |
| Basis | `"scanned"` (URL crawled) · `"declared"` (answers-only, `no_site`) | #29.3 |
| Register | `"flat"` (single `indicative_total`) · `"estimation"` (`range{min,max}`+`confidence`) | #29.4 |
| Never returned | `crawl_facts`, `claude_assessment`, `signals_matched`, review flags, scoring, event-log content — **stored, never returned** | #24, #8 |

**Add-on IDs (from config, verbatim — not retyped from memory):** `extra_page`,
`copywriting_per_page`, `logo_refresh`, `bilingual`, `booking`, `ecommerce`
(human_quote), `photo_sourcing`, `seo_migration`, `rush_delivery` (percent_modifier),
`extra_revision`. [cfg]

**§P-1 — reason codes vs prose.** `reasons[]` in responses are **machine codes** (site
renders FR/EN). The #27 engine currently emits **English prose** reasons; a reason-code
enum + engine mapping is **§ PROVISIONAL** (see §10). v0.1 lists the codes; the prose
stays internal (founder panel).

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
    "needs_booking_or_listings": true,     // boolean
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
| `pages` | enum `1_2`\|`3_4`\|`5_plus` | **tier_input** (page band) | **only key that changes meaning:** current-site pages when scanned; pages **needed** when `no_site` (site swaps the label; API sees one field) | #27.2 · ⚠-1 precedence vs crawl `core_pages` |
| `needs_booking_or_listings` | boolean | **tier_input** (Pro trigger) | mode-independent — *desired* functionality the crawl can't see | #27.4 · ⚠-2 booking-vs-listings pricing |
| `languages` | enum `fr`\|`fr_en` (room for future `en`) | **tier_input** (bilingual) | mode-independent — *desired* delivered language(s) | #18 (bilingual pricing) · #26/#28 |
| `has_brand_assets` | boolean | **addon_signal only** (never tier) | mode-independent | #27 addon · `logo_refresh` $490 [cfg] |

**Validation:** any **missing key** or **out-of-enum** value → **`400`** (§5 shape). `url`
absent while `no_site=false` → `400`. Answers are all-or-nothing (client submits once).

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
    "suggested_addons": ["logo_refresh"], // unpriced upsells (has_brand_assets:false), [cfg]
    "care_plan_monthly": 5900,        // cents, [cfg] (attached at render, #27.8)
    "reasons": ["cheapest_bundle"],   // machine codes, §P-1
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

## 7. CORS

- **Production:** `Access-Control-Allow-Origin` = the **single production origin** from
  env (`ALLOWED_ORIGIN`, the Netlify domain). [#25A placement rule; Phase-2 env]
- **⚠-3 deploy previews:** preview-origin policy is **unratified**. **Recommended
  default:** allowlist the **production origin only**; deploy previews use the site's
  **mock adapter** (no live cross-origin). Founder call.

## 8. Not in this contract

- **Stage 2 assessment** (Claude analysis, written quote) — behind email capture (#25C,
  #29.2); its own contract, designed from `ASSESSMENT-RECON.md`.
- **#24 event-stream** (`events since seq N`, SSE) — separate endpoint, server-side FR/EN
  templates (Phase 2). One flag line here so the two contracts never collide (§2).
- **Endpoint abuse layers** (honeypot, Turnstile siteverify, rate-limit internals) —
  #25A, endpoint-layer, not request/response shape. §P.
- **Never returned:** `crawl_facts`, `claude_assessment`, `signals_matched`, review flags,
  scoring, `pairing_evidence`, raw event data. Stored, never on the wire. [#24, #8]

## 9. Examples (six complete cases, real config prices)

**E1 — POST accepted (pending):** `POST /quote {url, answers}` → `{ "quote_id":"qt_1",
"status":"pending" }`.

**E2 — scanned flat (4-page WordPress, wants bilingual):**
```json
{ "quote_id":"qt_2","status":"completed","indicative":true,"basis":"scanned",
  "register":"flat","review_required":false,
  "result":{ "bundle":{"tier":"standard","addons":["bilingual"]},
    "indicative_total":348000,"currency":"CAD",
    "suggested_addons":[],"care_plan_monthly":5900,
    "reasons":["cheapest_bundle","bilingual_addon"],
    "core_pages":4,"detected_platform":"wordpress","confidence":"high" } }
```
*(Standard 279000 + bilingual 69000 = 348000; Standard+bilingual beats Pro 429000 — #27.3.)*

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

## 10. Gate — flags for founder ratification

Nothing below is guessed; each is a stated open question. Batch:

- **⚠-1 `pages` vs crawl `core_pages` precedence.** When declared `pages` and scanned
  `core_pages` disagree, which wins? Schema is fixed; the **mapping** belongs to the
  deferred tier-mapping tour. Contract uses `core_pages` for scanned, declared `pages`
  for `no_site`; the *conflict* rule is unresolved.
- **⚠-2 `needs_booking_or_listings` conflation.** One boolean covers **booking** (has a
  Standard add-on, $590 [cfg]) **and** **listings** (no Standard add-on → forces Pro).
  They price differently; the declared answer can't distinguish. v0.1 maps `true` →
  **booking** need (representative). Founder: split the field, or fix the mapping?
- **⚠-3 CORS deploy-preview policy** (§7). Recommended: production origin only; previews
  use the mock adapter.
- **§P-1 reason codes** (§2). `reasons[]` are machine codes; the #27 engine emits English
  prose today — a reason-code enum + mapping is provisional.
- **§P-2 Answer-object source.** The tour's `[FOUNDER PASTES…]` block was **empty**; this
  contract used the **"consumer-fixed ANSWERS SCHEMA"** section (which says "Encode
  these:") as authoritative. Confirm it matches the creavy-site answer object.
- **§P-3 declared-answer integration into #27.** How declared `pages`/`languages`/
  `needs_*` combine with scan facts (override vs supplement) is the deferred tier-mapping
  tour's work; the contract fixes the **schema + shapes**, not the integration.
- **§P-4 honeypot/Turnstile fields** in the request envelope (§8) — endpoint-layer
  (#25A), shape TBD at Phase-2 service assembly.
- **§P-5 `suggested_addons` derivation.** The #27 engine returns the **priced** bundle;
  the **unpriced upsell** list (`logo_refresh` from `has_brand_assets:false`,
  `seo_migration` when blog < 5, `bilingual` on a monolingual lower tier) is derived from
  answer signals + #27 reasons and is **not yet emitted** by the engine — provisional.
