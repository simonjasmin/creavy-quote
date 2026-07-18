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

### 2.1 Phase 1 decision batch — amendments 8–22 (founder-ratified 2026-07-18)

> Numbering continues after #7 (no renumber needed). Diffed against Phase 0 §2/§4.1.
> On collision **Phase 0 wins** and the item is flagged below, not amended — per this
> tour's rule and the batch doc's own header.

**A. Crawl & bounder**

| # | Decision | Closes |
|---|----------|--------|
| 8 | **Bounder returns a structured result, not an integer** — `{canonical_origin, core_pages, blog_posts, excluded{}, languages[], bilingual_mirror, needs_browser+reasons[], review_flags[], partial}`. The tier mapper consumes `core_pages` + components only; blog volume and bilingualism are pricing *signals*, not page inflation. | Inventory §2; shapes Table D + the assessment schema. |
| 9 | **Caps from inventory §3, and caps live in config, not code.** Precise counting stops at 30 → report `"30+"` + `out_of_icp_scope`. The fast-path budget is the **universal governor**: politeness delays, slow hosts, absurd `Crawl-delay` all just exhaust the budget → `partial:true` + review. One mechanism, no edge-case forest. **Four numeric caps collide with Phase 0 §2 #2 — see Collision flags; Phase 0 values retained pending founder reconciliation.** | S-05, S-23, D-21, D-31, D-32, D-33. |
| 10 | **Form input repair is permissive, never guessy.** Trim; repair `https:/`/`https//`; strip userinfo (+`suspicious_input`). Interior whitespace, non-http(s), >2000 chars → typed rejection + friendly message. | N-18, N-20, N-27, N-28. |
| 11 | **Ownership principle** (governs 12–14): the submitter is unverified, so the crawler always behaves as a stranger — full robots respect for *expansion*, no evasion, no aggressive retries. Fetching the single submitted URL is a user-initiated (link-preview-class) request, always permitted. | — |
| 12 | **robots `Disallow:/`** → fetch submitted URL only, no expansion/sitemap; `robots_blocked` → human review. | R-10. |
| 13 | **robots errors:** 4xx → unrestricted (RFC 9309); 5xx / unreachable-after-5-hops → treat as full block + note. | R-02, R-03, R-05. |
| 14 | **Anti-bot & invalid TLS:** challenge pages → one standard attempt, never a bypass, `anti_bot` → human; invalid TLS → one unverified retry (assessment only), `tls_invalid` always surfaced (doubles as a sales signal). | D-24, D-26. |
| 15 | **Bot identity:** UA `CreavyQuoteBot/1.0 (+https://creavy.com/bot)`, from config. Commits to a one-paragraph bot page on creavy.com (may 404 until the marketing site ships — acceptable). `Crawl-delay` applied as-is; the budget converts extremes to homepage-only partial + review. | R-07, R-13. |
| 16 | **Canonical host resolution:** redirects authoritative; apex+www both 200 → deterministic pick (https → homepage `rel=canonical` → internal-link majority → www) + `host_ambiguous`; root cross-domain redirect re-anchors once (`domain_moved`), 2nd hop stops + flag. | D-01…D-04. |
| 17 | **Scope = canonical host only.** www↔apex unify; language subdomains merge as mirrors (#18); every other subdomain → `related_property`, out of `core_pages`. | D-20. |
| 18 | **Bilingual pairing (pricing-critical):** `hreflang` authoritative, else mirror heuristic (lang path prefixes / `lang=` / lang subdomains, 1:1 tree). Paired → one core page per pair, `bilingual_mirror:true`, both languages recorded. Unpairable twin trees → larger tree + `bilingual_suspected` → human. **Never sum both trees.** | S-22, D-16. |
| 19 | **Sitemap trust:** sample-verify `min(core,10)` locs; >30% non-200 → distrust → link-crawl fallback + `stale_sitemap`. Classify: pages→core, posts→`blog_posts`, taxonomies/authors/dates→`excluded.archives`. | S-20. |

**B. Pricing config**

| # | Decision | Closes |
|---|----------|--------|
| 20 | **Config schema knows exactly three price kinds:** `flat` (integer cents), `percent_modifier` (e.g. rush +20 %, applies to the one-time build subtotal only — never recurring), `human_quote` (no auto price → renders "sur mesure — réponse en 24 h" + review flag). No other kinds — "from $890" is unrepresentable as an auto-quote by construction. | — |
| 21 | **E-commerce add-on ships as `human_quote` in v1.** (flat-with-scope-wall considered, declined — scope variance is exactly what flat can't hold; a human touch on the highest-ticket add-on is a feature.) Revisit if e-comm > ~1 in 5 quotes. | — |
| 22 | **Placeholders are un-runnable.** Loader hard-fails on any `TODO(...)` at boot and in tests. No bypass flag; dev/CI run a complete fixture config. Gate E can't pass by accident; no environment can quote a $0 add-on. | — |

**Collision flags (Phase 0 wins — not amended, founder's call):**

Decision #9's caps table restates four numbers already fixed by **Phase 0 §2 #2** (and §4.1). Per the rule I kept Phase 0's values and did **not** amend them:

| Cap | Phase 0 (kept) | Batch #9 wanted | Recommendation |
|-----|----------------|-----------------|----------------|
| Total fast-path / crawl budget | **20 s** (`CRAWL_BUDGET_MS`) | 25 s | Reconcile — pick one; both defensible. |
| Per-fetch timeout | **5 s** (`FETCH_TIMEOUT_MS`) | 8 s (+1 retry, connect-errors only) | Adopt batch — 8 s + connect-retry suits slow Québec hosts. |
| Fetch cap per scan | **30 URLs** (`CRAWL_URL_CAP`) | 60 fetches / 30 core counted | Adopt batch's split (fetch ≤60, count ≤30 core). |
| Concurrency | **≥ 8** (`FETCH_CONCURRENCY`) | **2 / host** + ~300 ms spacing | **Adopt batch** — ≥8 to one small host contradicts invariant #4; 2/host is correct. |

Non-colliding caps from inventory §3 **were adopted** into §4.1 (crawl depth 3, redirect hops 5, HTML read 2 MB, robots parse 500 KB, sitemap index depth 2, child sitemaps 5, `"30+"` short-circuit, budget-as-governor).

**UA example (not a collision):** Phase 0 §6 carried an illustrative UA on `creavy.ca`; ratified #15 uses `creavy.com`. Since §6's UA was an example, not a §2 decision, it's been updated to `.com` to match the ratified decision.

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
| `FETCH_TIMEOUT_MS` | 5000 | Per-URL fetch timeout. ⚑ batch #9 proposed 8000 (+1 connect-retry) — see §2.1 collision flags. |
| `CRAWL_BUDGET_MS` | 20000 | Hard wall-clock ceiling for the whole crawl; the **universal governor** (#9) — exhaustion → `partial:true` + review. ⚑ batch #9 proposed 25000. |
| `CRAWL_URL_CAP` | 30 | Max URLs fetched. ⚑ batch #9 proposed fetch ≤60 / count ≤30 core (`"30+"` short-circuit beyond). |
| `FETCH_CONCURRENCY` | ≥ 8 | Concurrency pool. ⚑ batch #9 proposed **2 / host** + ~300 ms spacing (politeness) — see flags; recommend adopting. |
| `CRAWL_DEPTH` | 3 | Max crawl depth from root (inventory §3, adopted). |
| `REDIRECT_HOPS` | 5 | Max redirect hops per URL, incl. robots.txt (adopted). |
| `HTML_READ_CAP` | 2 MB | HTML bytes read per page; parse the truncated prefix (adopted). |
| `ROBOTS_PARSE_CAP` | 500 KB | robots.txt parse cap, matches Google (adopted). |
| `SITEMAP_INDEX_DEPTH` | 2 | Sitemap-index recursion depth (adopted). |
| `CHILD_SITEMAPS` | 5 | Max child sitemaps fetched (adopted). |
| `ASSESS_TIMEOUT_MS` | ~15000 | Claude call timeout (incl. one retry). |
| `QUOTE_DEADLINE_MS` | ~45000 | Absolute per-quote deadline; on breach the worker writes `failed`. |

⚑ = value collides with batch #9; **Phase 0 retained pending founder reconciliation** (§2.1 collision flags). Non-⚑ caps below `FETCH_CONCURRENCY` are the non-colliding inventory §3 caps, adopted.

`SYNC_HOLD_MS` (8 s) and `CRAWL_BUDGET_MS` (20 s) are **independent timers**. The
fast path (~90 %) completes crawl+assess+price well inside 8 s and returns
`completed` synchronously. A crawl-heavy site legitimately needing up to the crawl
budget returns `pending` at 8 s; the in-process worker continues and the client polls.

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

- **Politeness (invariant #4):** robots.txt honored (ownership principle #11 —
  crawler behaves as a stranger); user-agent `CreavyQuoteBot/1.0
  (+https://creavy.com/bot)` from config (#15); public pages only; all §4.1
  caps enforced; SSRF guard (reject private/loopback/link-local hosts and redirects
  into them).
- **Bounder output (#8):** a **structured result**, not a bare integer —
  `{canonical_origin, core_pages, blog_posts, excluded{}, languages[],
  bilingual_mirror, needs_browser+reasons[], review_flags[], partial}`. The tier
  mapper consumes `core_pages` + components only.
- **Page discovery:** `/sitemap.xml` first for `core_pages` (no per-page fetch),
  with the **trust rule** (#19: sample-verify `min(core,10)`, distrust > 30 %
  non-200 → link-crawl fallback + `stale_sitemap`); classify pages→core,
  posts→`blog_posts`, taxonomies/authors/dates→`excluded.archives`. If absent/invalid,
  capped concurrent link-crawl from the homepage. Fetch a **sample** sufficient to
  estimate distinct templates, not all 30. Bilingual mirrors pair-dedupe (#18).
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
  core_pages           # structured bounder (#8); blog_posts EXCLUDED from the count
  template_estimate    # max(claude.template_estimate, answers.distinct_page_designs)
  components           # claude.component_flags[] ∪ derived from answers
  score                # claude.complexity_score (0..100), guardrail/tiebreak

HEAVY = { booking, ecommerce, listings, membership }
heavy = components ∩ HEAVY

# precedence top-down; first match wins
if core_pages <= 2 and heavy == {} and template_estimate <= 2:
    tier = presence     # 1490
elif core_pages <= 4 and template_estimate <= 4 and |heavy| == 0:
    tier = standard     # 2790
elif core_pages <= 5 or |heavy| == 1:
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

Add-on **schema** follows decision **#20** — exactly three price kinds: `flat`
(integer cents), `percent_modifier`, `human_quote` (#21: e-commerce is
`human_quote`). Placeholders are un-runnable (#22): the loader hard-fails on any
`TODO(...)`. The stub below predates #20; the real #20-schema config module + values
land in the thread-1-closing commit (see §14). Interim stub:

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

1. **CHECKLIST add-on prices** — **OPEN, schema decided (#20/#21/#22), values
   pending the next commit** (`pricing config: CHECKLIST add-on values`, this tour).
   Founder supplied the values; they encode as integer cents, with e-commerce →
   `human_quote` (#21).
2. **Fingerprint lib / adapter choice** — **OPEN, pending amendment #23**
   (the fingerprint spike, this tour — gated on founder sign-off before #23 is
   committed). Candidates A (hand-rolled signal table), B (Wappalyzer-fork
   ruleset), C (generator-meta control) per the spike brief.
3. **Persona source** — `persona` (plumber|hvac|realtor…) comes from the landing-page
   source per architecture §8; wiring is a `creavy-site` concern (Phase 4).
4. **Batch #9 numeric collisions (§2.1)** — four caps (budget 20 vs 25 s, per-fetch
   5 vs 8 s, fetch 30 vs 60, concurrency ≥8 vs 2/host) retain Phase 0 values pending
   founder reconciliation. Recommendations in §2.1.
