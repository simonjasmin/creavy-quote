# Creavy Quoting Service — Phase 0 Architecture & Spec

> Purpose: this document is the spec input for the `creavy-quote` repository.
> Hand it to the Superpowers **brainstorming** step as the starting context, then let
> the methodology refine it into the implementation plan. It is deliberately
> opinionated about *what* and *why*, and leaves *how* (exact libraries, file
> layout) to the spec/plan phase.

---

## 1. What this service is

A standalone backend service, separate from the Creavy marketing site. It takes a
prospect's existing website URL plus a few answers, analyzes the site, and returns
a **pricing tier + range** for a Creavy "revamp" — never a binding instant price.
It stores every quote for conversion tracking and repricing feedback.

It does **one job**: `URL + answers in → tier/range out → stored`.
Payment (Stripe) and email workflows are explicitly **out of scope for v1**.

## 2. Why a separate service (not Netlify Functions)

The two core operations — crawling a target site and calling Claude — are too
long-running and variable for comfortable serverless functions (short timeouts,
cold starts fighting a multi-page crawl). A small dedicated service gives us
control over crawl bounds, an optional headless-browser fallback, and a real
database.

## 3. Hosting

- **MVP host: Railway.** Cheapest + simplest for a bursty, low-traffic, solo-built
  MVP; usage-based billing; web service + Postgres + optional worker in one place.
- **Graduate to Render** when this is a proven revenue engine and we want flat,
  predictable billing + production Postgres (PITR, backups, read replicas). Both
  are "bring your own container," so the move is low-friction.
- **Not Fly.io.** Its edge/multi-region advantage is irrelevant — all users are in
  Québec and an 8-second quote doesn't care about edge latency. It would add Docker
  complexity for no benefit.
- **Database:** Railway-managed Postgres for the MVP. Attach external managed
  Postgres (Neon/Supabase) only when backup guarantees start to matter.

## 4. The one principle that keeps infra cheap: two-speed processing

Most platform detection can be done **HTTP-only** (fetch HTML + headers, run
Wappalyzer-style fingerprints). A real headless browser (Playwright) is only
needed when HTTP detection is inconclusive (heavily JS-rendered Wix/Squarespace/
Webflow).

- **Fast path (the ~90% case):** HTTP fetch + fingerprint + sitemap parse →
  returns in a few seconds.
- **Slow path (the exception):** enqueue a Playwright job; front end polls.

Keeping the browser as the *exception* means no beefy always-on browser host is
required. **This is the single most important architectural choice.**

## 5. The other principle: Claude proposes, code disposes

Claude returns a **structured complexity assessment** (JSON). Our code maps that
assessment to the public **tier + range** using fixed rules. Claude never emits the
final binding price freehand — that would reintroduce underpricing risk and make
pricing non-deterministic. **Prompt Claude for analysis; compute price in code.**

## 6. Request flow

```
Creavy marketing site (Astro / Netlify)
        │  HTTPS (CORS)  POST /quote  { url, answers }
        ▼
Quoting service (Node/TS API on Railway)
        ├─ 1. Validate + normalize URL
        ├─ 2. Fetch homepage (HTTP) + parse
        ├─ 3. Platform detect (Wappalyzer-style fingerprints, HTTP-only)
        ├─ 4. Discover pages: parse /sitemap.xml; fallback to capped link-crawl
        ├─ 5. IF detection inconclusive → enqueue Playwright job (slow path)
        ├─ 6. Compose facts + user answers → Claude (Anthropic API)
        ├─ 7. Map Claude's assessment → tier + range (OUR rules, deterministic)
        └─ 8. Persist quote → Postgres; return quote_id + status + (tier/range)
        ▼
Postgres
```

## 7. API contract (async-capable from day one)

Design the contract as async-capable even though the fast path usually completes
quickly. This avoids a painful front-end refactor if the browser fallback is later
needed. Fast path may return `completed` immediately; slow path returns `pending`.

### `POST /quote`
Create a quote request.

Request:
```json
{
  "url": "https://example-plumber.ca",
  "answers": {
    "distinct_page_designs": 4,        // user's count of genuinely different layouts
    "needs_booking_or_listings": false,
    "bilingual": true,
    "has_brand_assets": true
  }
}
```

Response (fast path completed):
```json
{
  "quote_id": "qt_a1b2c3",
  "status": "completed",
  "result": {
    "tier": "standard",
    "tier_label_fr": "Standard",
    "price_min": 2790,
    "price_max": 2790,
    "currency": "CAD",
    "estimated_weeks": "2-3",
    "care_plan_monthly": 59,
    "suggested_addons": ["bilingual", "copywriting"],
    "detected_platform": "wordpress",
    "page_count": 6,
    "confidence": "high"
  }
}
```

Response (slow path, browser job queued):
```json
{ "quote_id": "qt_a1b2c3", "status": "pending" }
```

### `GET /quote/:id`
Poll for status / retrieve a stored quote (also used by you on the confirmation call).
Returns the same shape as above with `status` of `pending | completed | failed`.
On `failed`, include a graceful message → "we couldn't fully analyze your site, book a call."

### Error / edge handling (must always return *something*)
- Invalid/unreachable URL → `failed` + book-a-call fallback, still persisted.
- Crawl timeout / hostile site → bounded, returns partial + `confidence: "low"`.
- Always respect robots.txt; fetch only public pages; clear user-agent.

## 8. Postgres schema (v1)

```sql
CREATE TABLE quotes (
  id                TEXT PRIMARY KEY,          -- e.g. qt_a1b2c3
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- input
  url               TEXT NOT NULL,
  answers           JSONB NOT NULL,            -- raw user answers

  -- processing
  status            TEXT NOT NULL DEFAULT 'pending', -- pending|completed|failed
  used_browser      BOOLEAN NOT NULL DEFAULT false,  -- did we hit the slow path?
  confidence        TEXT,                            -- high|medium|low

  -- crawl facts
  detected_platform TEXT,                      -- wordpress|wix|squarespace|webflow|shopify|custom|unknown
  page_count        INTEGER,
  template_estimate INTEGER,                   -- distinct layouts (claude + answers)
  crawl_facts       JSONB,                     -- raw signals for debugging/repricing

  -- claude assessment (analysis only, not the price)
  claude_assessment JSONB,                     -- complexity score, component flags, reasoning

  -- output shown to user (computed by OUR rules)
  tier              TEXT,                       -- essential|standard|pro
  price_min         INTEGER,
  price_max         INTEGER,
  currency          TEXT DEFAULT 'CAD',
  suggested_addons  JSONB,

  -- conversion tracking
  booked_call       BOOLEAN NOT NULL DEFAULT false,
  persona           TEXT                        -- plumber|hvac|realtor|... (from landing page source)
);

CREATE INDEX idx_quotes_created_at ON quotes (created_at);
CREATE INDEX idx_quotes_status     ON quotes (status);
CREATE INDEX idx_quotes_persona    ON quotes (persona);
```

Notes:
- `crawl_facts` + `claude_assessment` are kept raw so you can re-derive pricing
  later without re-crawling — this is your **repricing feedback loop**.
- `persona` + `booked_call` are your **conversion funnel** data per landing page.

## 9. Tier-mapping rules (deterministic, in code — not Claude)

Pseudocode the spec phase should formalize into tested functions:

```
score = claude_assessment.complexity_score   // 0..100
components = claude_assessment.component_flags // booking, ecommerce, listings, multilingual...

if page_count <= 2 and no heavy components      -> essential  (1490)
elif page_count <= 4 and <=4 templates          -> standard   (2790)
elif page_count <= 5 or one heavy component      -> pro        (4290)
else                                             -> pro + "book a call" (range/custom)

addons suggested from: bilingual, copywriting, booking, ecommerce, extra pages, logo
```

Keep these numbers in **one config module** so repricing is a one-file change.

## 10. Explicitly out of scope for v1
- Stripe / deposits / care-plan billing.
- Email workflows / marketing automation (separate Make/HubSpot layer later).
- Auth / accounts (quotes are anonymous + quote_id).
- The marketing site itself (separate `creavy-site` repo, Astro/Netlify, no Superpowers).

## 11. Why this repo is the right place for Superpowers
The bug-prone, testable units — URL normalization, platform fingerprinting,
sitemap parsing, crawl-bounding, the deterministic tier-mapping rules, graceful
failure paths — are exactly what TDD + the spec→plan→subagent workflow is built
for. Start the repo under Superpowers; let brainstorming refine this doc into the
plan.

## 12. Open questions for the brainstorming step to resolve
1. Sync threshold: how long does the fast path wait before degrading to async?
2. Page-discovery cap: max pages to scan on the link-crawl fallback?
3. Which Wappalyzer-style fingerprint library, and HTTP-only vs. browser trigger rule?
4. Queue mechanism for the slow path: in-process worker vs. a real queue?
5. Claude prompt: exact JSON schema for the assessment output + validation.
6. Rate limiting / abuse protection on a public `POST /quote` endpoint.
