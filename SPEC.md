# Creavy Quoting Service — Approved Spec (Phase 0)

> Status: **approved-pending-founder-sign-off**, 2026-07-18.
> Input: [PHASE0-ARCHITECTURE.md](PHASE0-ARCHITECTURE.md). This document closes
> every open question in §12 of that doc (plus the amendment #7) with a written
> decision, and formalizes the tier-mapping and pricing config. Sequencing lives
> in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md).
> Methodology: Superpowers (brainstorm → spec → plan → TDD), per [CLAUDE.md](CLAUDE.md).

---

## 1. Invariants (the contract this spec must never break)

These are lifted from [CLAUDE.md](CLAUDE.md) and are load-bearing. Every phase,
refactor, and PR is checked against them.

1. **Claude proposes, code disposes.** Claude returns a validated JSON complexity
   assessment; it NEVER emits the final price. The deterministic tier-mapping
   config module computes all prices.
2. **Every quote persists** — including `failed` and abandoned — with raw
   `crawl_facts` and `claude_assessment`. These columns are the repricing feedback
   loop and the conversion funnel. Never trim them.
3. **Prices live in ONE config module.** Présence 1490 · Standard 2790 · Pro 4290 ·
   Tranquillité 59/mo (CAD). Repricing = a one-file change.
4. **The crawl is bounded and polite:** page cap, per-fetch timeout, total budget,
   robots.txt respected, clear user-agent, public pages only.
5. **The API always returns something** — worst case `failed` with a graceful
   book-a-call payload. No dead ends, no hangs.
6. **Rate limiting on `POST /quote` is not optional** (public endpoint).
7. **v1 excludes** Stripe, email workflows, auth, and the Playwright fallback
   (v1.1). Do not let them creep in.

---

## 2. Resolved decisions (PHASE0-ARCHITECTURE.md §12 + amendment)

| # | Question | Decision | Notes |
|---|----------|----------|-------|
| 1 | Sync threshold before degrading to async | **Sync-hold 8 s.** `POST /quote` holds up to `SYNC_HOLD_MS = 8000`; returns `completed` if the pipeline finished, else `pending`. | Founder call. 8 s is the *client-perceived pending threshold*, a **distinct timer** from the 20 s crawl budget (#2). See §4. |
| 2 | Page-discovery cap | **30 URLs fetched · 5 s/fetch · 20 s total crawl budget**, fetched **concurrently** (pool ≥ 8, or 30×5 s = 150 s serial won't fit). | Founder call. 20 s is the background-worker ceiling; crawl-heavy sites return `pending` at 8 s and finish in the worker. `page_count` is read from `/sitemap.xml` without fetching every page. |
| 3 | Fingerprint lib + browser-trigger rule | **HTTP-only, maintained Wappalyzer-style JS core**, fingerprint DB vendored + pinned. Browser trigger = *detection inconclusive* **AND** *page mostly empty* (static body text `< ~500` chars OR known SPA root — `#root`/`#__next`/`#app`/`<astro-island>` — with no meaningful `<main>`/article content). | Original `wappalyzer` npm is proprietary/deprecated; exact lib chosen by a Phase-1 spike (candidates: `wappalyzer-core`, `simple-wappalyzer`, maintained fork). |
| 4 | Slow-path queue | **In-process worker for v1. Playwright deferred to v1.1.** No Redis/BullMQ. | **Consistency fix:** v1 has no Playwright, so the browser-trigger case (#3) does **not** enqueue a job — it resolves to `completed` + `confidence:"low"`, or `failed`→book-a-call. Async *contract* stays; async *path* is dormant until v1.1. |
| 5 | Claude output schema + model | **Strict JSON** `{complexity_score, template_estimate, component_flags[], reasoning}` via **structured outputs** (`output_config.format`) — retry once on invalid as a fallback. **Model: `claude-opus-4-8`.** | Founder call on model. Structured outputs make invalid output near-impossible; the retry is belt-and-suspenders. See §7 for bounds + latency budget. |
| 6 | Rate limiting / abuse | **Per-IP 5/hour token bucket + global daily cap**, correct client-IP behind Railway's proxy, **per-URL short-TTL dedupe cache** (~10 min), 429 → graceful book-a-call payload. | See §11. |
| 7 | (Amendment) answers collected during the analysis animation | **Client-side collection; answers submitted once complete; no API contract change.** The two edge states (analysis-done-first / answers-done-first) are **client-side animation states**. | Server always receives `{url, answers}` together at POST time. v1.1 "prewarm" two-call variant noted but not adopted (would change the contract). |

**Naming reconciliation:** §7/§8 of the architecture doc used tier enum `essential`,
but the entry product is **Présence**. This spec standardizes tier keys to
`presence | standard | pro` (+ `pro_custom` for the range/book-a-call case) and
updates the persisted enum to match (§10). DB, config, and FR labels stay in sync.

---

## 3. What this service is (unchanged)

`URL + answers in → tier/range out → stored`. A standalone Node/TS service on
Railway, separate from the marketing site. It analyzes a prospect's site and
returns a **pricing tier + range** for a Creavy revamp — never a binding instant
price — and stores every quote. Stripe, email, and auth are out of scope for v1.

---

## 4. Request flow & state machine

### 4.1 Timers (the reconciliation of #1 + #2)

| Constant | Value | Meaning |
|----------|-------|---------|
| `SYNC_HOLD_MS` | 8000 | Max time `POST /quote` holds the connection before returning `pending`. Also the p95 SLO for `completed` fast-path responses. |
| `FETCH_TIMEOUT_MS` | 5000 | Per-URL fetch timeout. |
| `CRAWL_BUDGET_MS` | 20000 | Hard wall-clock ceiling for the whole crawl (homepage + sitemap + sampled pages). Background worker may run to this. |
| `CRAWL_URL_CAP` | 30 | Max URLs fetched. |
| `FETCH_CONCURRENCY` | ≥ 8 | Concurrency pool so 30×5 s fits inside 20 s. |
| `ASSESS_TIMEOUT_MS` | ~15000 | Claude call timeout (incl. one retry). |
| `QUOTE_DEADLINE_MS` | ~45000 | Absolute per-quote deadline; on breach the worker writes `failed`. |

`SYNC_HOLD_MS` (8 s) and `CRAWL_BUDGET_MS` (20 s) are **independent timers**. The
fast path (~90 %) completes crawl+assess+price well inside 8 s and returns
`completed` synchronously. A crawl-heavy site legitimately needing up to 20 s
returns `pending` at 8 s; the in-process worker continues and the client polls.

### 4.2 Pipeline

```
POST /quote { url, answers }
  1. Validate + normalize URL (reject non-http(s), private/loopback hosts, malformed)
  2. Rate-limit check (per-IP 5/hr + global daily cap) → 429 + book-a-call if exceeded
  3. Dedupe: normalized-URL cache hit within ~10 min → return stored quote
  4. Persist quote row (status=pending) → quote_id
  5. Start pipeline + race it against SYNC_HOLD_MS (8 s):
        a. robots.txt fetch + parse (respect; public pages only; clear UA)
        b. homepage fetch (HTTP)  ── FETCH_TIMEOUT_MS
        c. platform fingerprint (HTTP-only, Wappalyzer-style)
        d. discover pages: parse /sitemap.xml (page_count, no per-page fetch);
           fallback to capped link-crawl (CRAWL_URL_CAP, FETCH_CONCURRENCY, CRAWL_BUDGET_MS)
        e. IF detection inconclusive AND page mostly empty:
              v1 → mark confidence="low" (NO browser job); v1.1 → enqueue Playwright
        f. compose crawl_facts + answers → Claude (claude-opus-4-8, structured output)
        g. validate assessment (retry once); on hard failure → status=failed
        h. map assessment → tier + range (deterministic config; §8)
        i. persist (status=completed | failed), crawl_facts, claude_assessment, output
  6. If pipeline done ≤ 8 s → return { quote_id, status:"completed", result }
     Else → return { quote_id, status:"pending" }; worker finishes in background.
```

### 4.3 States

`pending → completed` · `pending → failed`. `failed` always carries a graceful
book-a-call payload. The worker's `QUOTE_DEADLINE_MS` guarantees no quote is stuck
in `pending` forever.

---

## 5. API contract

Async-capable from day one (unchanged shape from architecture §7).

### `POST /quote`
Request:
```json
{
  "url": "https://example-plumber.ca",
  "answers": {
    "distinct_page_designs": 4,
    "needs_booking_or_listings": false,
    "bilingual": true,
    "has_brand_assets": true
  }
}
```
Response — fast path completed:
```json
{
  "quote_id": "qt_a1b2c3",
  "status": "completed",
  "result": {
    "tier": "standard", "tier_label_fr": "Standard",
    "price_min": 2790, "price_max": 2790, "currency": "CAD",
    "estimated_weeks": "2-3", "care_plan_monthly": 59,
    "suggested_addons": ["bilingual", "copywriting"],
    "detected_platform": "wordpress", "page_count": 6, "confidence": "high"
  }
}
```
Response — slow path (returned at the 8 s hold, or browser job in v1.1):
```json
{ "quote_id": "qt_a1b2c3", "status": "pending" }
```

### `GET /quote/:id`
Poll for status / retrieve a stored quote (also used on the confirmation call).
Same `result` shape; `status ∈ pending | completed | failed`. On `failed`, include
the graceful message → "we couldn't fully analyze your site, book a call."

### Error / edge handling (always return *something* — invariant #5)
- Invalid/unreachable URL → `failed` + book-a-call, **still persisted**.
- Crawl timeout / hostile site → bounded; returns partial + `confidence:"low"`.
- Rate-limit exceeded → `429` + book-a-call payload.
- Always respect robots.txt; fetch only public pages; clear user-agent.

---

## 6. Crawl & platform detection

- **Politeness (invariant #4):** robots.txt honored; clear, identifiable
  user-agent (e.g. `CreavyQuoteBot/1.0 (+https://creavy.ca/bot)`); public pages
  only; `CRAWL_URL_CAP`/`FETCH_TIMEOUT_MS`/`CRAWL_BUDGET_MS`/`FETCH_CONCURRENCY`
  enforced; SSRF guard (reject private/loopback/link-local hosts and redirects
  into them).
- **Page discovery:** `/sitemap.xml` first for `page_count` (no per-page fetch);
  if absent/invalid, capped concurrent link-crawl from the homepage. Fetch a
  **sample** of pages sufficient to estimate distinct templates, not all 30.
- **Fingerprint (#3):** HTTP-only, maintained Wappalyzer-style core; fingerprint
  DB vendored + pinned; output → `detected_platform ∈ wordpress | wix | squarespace
  | webflow | shopify | custom | unknown`.
- **Browser trigger (#3):** *inconclusive* **AND** *mostly empty* (static body
  text `< ~500` chars OR known SPA root with no meaningful content). v1: no
  Playwright → `confidence:"low"`. v1.1: enqueue Playwright.

---

## 7. Claude assessment (analysis only — never the price)

- **Model:** `claude-opus-4-8` (founder call). One-line config knob; the Phase-5
  acceptance replay is the gate that confirms model+prompt quality.
- **Latency budget:** to keep the fast path inside 8 s, the call runs with
  **thinking off** (omit the `thinking` param) / low effort, a **small
  `max_tokens`** (~512), and **structured outputs** — a bounded extraction,
  not deep reasoning. Non-streaming (small output).
- **Structured output (#5):** `output_config.format` json-schema, `strict`.
  Retry **once** on any validation miss; on second failure → `status=failed`
  (book-a-call), row still persisted.

Assessment schema (analysis only):
```jsonc
{
  "type": "object", "additionalProperties": false,
  "required": ["complexity_score", "template_estimate", "component_flags", "reasoning"],
  "properties": {
    "complexity_score":  { "type": "integer" },              // 0..100 (clamp on read)
    "template_estimate": { "type": "integer" },              // distinct layouts, >=1
    "component_flags":   { "type": "array", "items": {
        "type": "string",
        "enum": ["booking","ecommerce","listings","membership",
                 "multilingual","forms","gallery","blog"] } },
    "reasoning":         { "type": "string" }                // capped, for repricing/debug
  }
}
```
`template_estimate` is reconciled with the user's `distinct_page_designs` answer
by the mapping layer (§8), taking the **higher** of the two (never underprice).

- **Cost control:** the global daily cap (#6/§11) bounds Opus spend; the per-URL
  dedupe cache avoids re-billing refresh spam.

---

## 8. Deterministic tier-mapping (in code, tested — never Claude)

Formalizes architecture §9 into a pure, unit-tested function. **Ties round UP** —
this directly serves Gate E's "zero quotes below the manual price" rule.

```
inputs:
  page_count           # from sitemap/crawl
  template_estimate    # max(claude.template_estimate, answers.distinct_page_designs)
  components           # claude.component_flags[] ∪ derived from answers
  score                # claude.complexity_score (0..100), guardrail/tiebreak

HEAVY = { booking, ecommerce, listings, membership }
heavy = components ∩ HEAVY

# precedence top-down; first match wins
if page_count <= 2 and heavy == {} and template_estimate <= 2:
    tier = presence     # 1490
elif page_count <= 4 and template_estimate <= 4 and |heavy| == 0:
    tier = standard     # 2790
elif page_count <= 5 or |heavy| == 1:
    tier = pro          # 4290
else:
    tier = pro_custom   # Pro floor + "book a call" → price_min=4290, price_max=null (range)

# guardrail: a very high complexity_score can only push UP a tier, never down
```

- `presence|standard|pro` → `price_min == price_max` (flat).
- `pro_custom` → `price_min = 4290`, `price_max = null` (range / book-a-call),
  `confidence` may be `medium|low`.
- **Add-ons suggested** from: `bilingual`, `copywriting`, `booking`, `ecommerce`,
  extra pages, `logo` (missing brand assets). Prices per §9.

---

## 9. Pricing config module (the ONE file — invariant #3)

Locked tiers (CAD):

| key | FR label | price | care plan |
|-----|----------|-------|-----------|
| `presence` | Présence | 1490 | 59/mo (Tranquillité) |
| `standard` | Standard | 2790 | 59/mo |
| `pro` | Pro | 4290 | 59/mo |
| `pro_custom` | Pro (sur mesure) | 4290+ (range) | 59/mo |

Add-ons — **BLOCKER: prices per CHECKLIST source docs, not yet available**
(Drive connector returned token-expired; no `CHECKLIST.md` in repo). Ships as
explicit placeholders until supplied:

```jsonc
// pricing.config — single source of truth; repricing = edit here only
{
  "currency": "CAD",
  "tiers": {
    "presence":   { "label_fr": "Présence", "price": 1490 },
    "standard":   { "label_fr": "Standard", "price": 2790 },
    "pro":        { "label_fr": "Pro",       "price": 4290 },
    "pro_custom": { "label_fr": "Pro (sur mesure)", "price_min": 4290, "price_max": null }
  },
  "care_plan_monthly": 59,   // Tranquillité
  "addons": {
    "bilingual":   { "label_fr": "Bilingue",       "price": "TODO(CHECKLIST)" },
    "copywriting": { "label_fr": "Rédaction",      "price": "TODO(CHECKLIST)" },
    "booking":     { "label_fr": "Réservation",    "price": "TODO(CHECKLIST)" },
    "ecommerce":   { "label_fr": "Boutique",       "price": "TODO(CHECKLIST)" },
    "extra_pages": { "label_fr": "Pages sup.",     "price": "TODO(CHECKLIST)" },
    "logo":        { "label_fr": "Logo",           "price": "TODO(CHECKLIST)" }
  }
}
```

---

## 10. Postgres schema (v1)

Base schema per architecture §8, with **one change**: the `tier` enum is
`presence | standard | pro | pro_custom` (was `essential | standard | pro`). All
other columns unchanged. `crawl_facts` + `claude_assessment` kept raw (invariant
#2). Indices on `created_at`, `status`, `persona` retained.

---

## 11. Rate limiting & abuse (invariant #6)

- **Per-IP:** token bucket, **5 / hour**. Client IP extracted from Railway's proxy
  headers safely (don't trust arbitrary `X-Forwarded-For`; use the proxy's
  documented client-IP position).
- **Global daily cap:** configurable (e.g. 300–500/day) to bound Claude/Opus spend.
- **Per-URL dedupe cache:** normalized URL seen within ~10 min → return the stored
  quote (kills refresh spam, saves cost).
- **On limit:** `429` + graceful book-a-call payload (invariant #5).
- All limits are **config-driven** (Railway env / config module).

---

## 12. Observability

- **Health endpoint** (`GET /health`) — liveness + DB reachability.
- **Minimal request logging** — method, path, status, latency, quote_id, outcome.
  **No PII beyond the quote row itself.** The `url`/`answers` live in the quote
  row (the funnel data); logs reference `quote_id`, not payloads.

---

## 13. Explicitly out of scope for v1

Stripe / deposits / care-plan billing · email workflows / marketing automation ·
auth / accounts · the Playwright browser fallback (v1.1) · the marketing site
itself (`creavy-site`, tracked as a separate phase but a separate repo).

---

## 14. Open items / blockers

1. **CHECKLIST add-on prices (BLOCKER for finalizing §9).** Re-authorize the
   Drive connector or paste the CHECKLIST. Config ships with `TODO(CHECKLIST)`
   until then; tier prices are unblocked.
2. **Fingerprint lib choice** — resolved by a short Phase-1 spike (§6/#3).
3. **Persona source** — `persona` (plumber|hvac|realtor…) comes from the landing-page
   source per architecture §8; wiring is a `creavy-site` concern (Phase 4).
