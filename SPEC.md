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

**Collision flags — ✅ RESOLVED (thread 4, founder-ratified 2026-07-18).** All four
adopt the batch #9 values (now live in §4.1); Phase 0's numbers predate the
politeness/retry model and were sized for the old 20 s budget.

| Cap | Phase 0 (was) | **Adopted (batch #9)** | Why |
|-----|---------------|------------------------|-----|
| Total crawl budget | 20 s | **25 s** | coherent cap set; no regime-mixing |
| Per-fetch timeout | 5 s | **8 s + 1 connect-retry** | D-32 slow-vs-down disambiguation |
| Fetch cap | 30 URLs | **60 fetch / 30 core** | robots/sitemap/redirects/S-20 sample burn fetches ≠ pages |
| Concurrency | ≥ 8 (intra-scan) | **2 / host + 300 ms** | 8-wide on a shared host earns our own `anti_bot` flags (#15) |

Non-colliding caps from inventory §3 **were adopted** into §4.1 (crawl depth 3, redirect hops 5, HTML read 2 MB, robots parse 500 KB, sitemap index depth 2, child sitemaps 5, `"30+"` short-circuit, budget-as-governor).

**UA example (not a collision):** Phase 0 §6 carried an illustrative UA on `creavy.ca`; ratified #15 uses `creavy.com`. Since §6's UA was an example, not a §2 decision, it's been updated to `.com` to match the ratified decision.

### 2.2 Fingerprint adapter — amendment #23 (founder-ratified 2026-07-18)

**23. Fingerprint adapter = hand-rolled passive signal table (spike Candidate A).**
Supersedes the "maintained Wappalyzer-style core" language in decision #3 and
**closes §14 thread 2**. On a 50-site real ICP corpus: platform **100 % @ high
confidence**, 0 false-positives on 12 custom negatives, 0 platform-wrong-at-high,
zero deps, zero extra network requests, ~1.7 ms/site. The Wappalyzer fork
(enthec/webappanalyzer, **GPL-3.0**) scored 94.7 % / 40 % *passively* — its
Duda/Beaver/WPBakery/Squarespace rules need `js`/`dom` (browser), forbidden by the
HTTP-only constraint (#3) — while adding a GPL-3.0 dependency. Full spike report:
`spikes/fingerprint-spike-report.md`.

**Frozen interface (passive v1 — zero network requests):**
```ts
fingerprint(pages: FetchedPage[]) -> {
  platform: string | "custom" | "unknown",
  builder?: string,              // primary builder (WP): elementor|divi|wpbakery|beaver
  builders_detected: string[],   // ALL builders present (dual-builder sites → [elementor, wpbakery])
  theme?: string,                // WP theme slug when visible
  version?: string,              // only when a signal exposes it; never guessed
  confidence: "high" | "medium" | "low",
  signals_matched: string[]
}
```
**Confidence:** high = ≥1 deterministic signal; medium = supporting only; low =
fallback (custom/unknown). Only **high**-confidence platform/builder claims reach
prospects; medium/low route through human-review wording.

**Rider (a) — coverage-capped confidence.** Any platform/builder with **zero
labeled corpus fixtures cannot emit high confidence** — capped at medium until a
real fixture lands. Zero-coverage today (→ medium cap): `webflow`, `godaddy`,
`joomla`, `drupal`, `framer`, `carrd`. Covered (may emit high): wordpress, wix,
squarespace, shopify, duda, weebly + all four builders.

**Rider (b) — regression-by-fixture.** Every production scan logs
`signals_matched` + `confidence`. Any misidentification (human review / client
report) becomes a **new labeled fixture + signal patch before the fix ships**. The
corpus only grows; production is the holdout the in-sample 100 % never was. A
zero-coverage row's first production hit lands at medium → review → fixture → cap
lifts.

**Rider (c) — builder precedence (content > install).** Builder signals are typed
`install` (site-kit markers present once a builder is merely *active* — Elementor's
`elementor-(default|global|kit)`, `/plugins/elementor/`) vs `content` (the builder
actually *built the page* — `elementor-(page|section|column|container|element|widget|button)`,
`vc_row`/`js_composer`, `et_pb_`, `fl-builder`). **Primary `builder` = most
content-level matches**; install-level alone **never** claims primary over another
builder's content. Two content builders → primary = most content matches, **both**
in `builders_detected`. Verified empirically (step 5): true-Elementor fixtures carry
14–1003 content classes; the dual-builder fixture carries **0 content / 4 install**
Elementor + WPBakery `vc_row` content → primary WPBakery.

**Calibration definition (frozen — so the number can't drift):** *builder
wrong-at-high* = asserting at high confidence a builder with **zero signals of any
class present**. Post-fix under corrected labels: builder set-accuracy 10/10,
primary 10/10, **0 wrong-at-high**.

**DoD (brief §7):** the F-backlog (`spikes/fingerprint-tdd-backlog.md`, F-01…F-50,
one case per fixture) is part of #23; the `src/` adapter is built red-green against
it. A probe pack (`/wp-json/`, favicon hash) may be added by later amendment if
passive accuracy degrades on a broader corpus.

### 2.3 Live scan narration — amendment #24 (founder-initiated 2026-07-18)

**24. One event spine, three readers.** Every pipeline step emits typed events to
an injectable `ScanEventEmitter` (same discipline as transport + clock; default
**no-op**). The log is **append-only, ordered by `seq`** — a window on work already
done: an event never computes anything new and never blocks; a slow consumer can't
slow a scan (fire-and-forget). Shape `{seq, ts, type, data}`, internal by default.
Three readers of **one** log: **prospect** (public live stream), **founder** (full
evidence trail behind every flag/number), **telemetry** (the persisted log *is*
rider (b)'s signals/confidence record — no second logging system).

**Public projection — default-deny, structural** ([src/crawl/eventProjection.ts](src/crawl/eventProjection.ts)):
only whitelisted types reach the browser, rendered server-side through **FR/EN
templates (data/config, not code branches)**. **Raw data never ships** — only the
rendered string + a stable type. **Never public:** prices/tiers/dollar amounts,
review flags, anything below **high** confidence (#23), signal internals, negative
judgments (findings phrased as facts). **Honesty rule:** every public event is a
real completed pipeline fact in real order — no synthetic delays, no fabricated
reasoning. Claude's streamed analysis joins the spine as `assessment_*` events when
the assessment layer ships.

**Catalog (this tour):** `scan_started`☀ · `url_normalized`☀ · `robots_checked` ·
`sitemap_found`/`sitemap_absent`☀ · `page_fetched`☀ · `platform_detected`☀ (high
only) · `builder_detected`☀ (high only) · `bilingual_paired`☀ · `blog_classified`☀ ·
`core_count_progress`☀ · `needs_browser` · `review_flag_raised` · `scan_partial` ·
`scan_complete`☀. Spine in [src/crawl/events.ts](src/crawl/events.ts), threaded
through sitemap + scan; proven by [test/crawl.events.test.ts](test/crawl.events.test.ts),
incl. the bilingual **moat line** on a synthetic explicit-`/fr//en/` scan.

**Transport (Phase 2, NOT this tour):** events persist to the job record; the async
API exposes "events since seq N" via polling first, SSE as fast-follow. This
amendment fixes only *ordered, append-only, resumable by seq* — no endpoint/SSE/
persistence in Phase 1.

### 2.4 Endpoint hardening — amendment #25 (founder-initiated 2026-07-18)

**Placement rule (governs Part A): the site renders, the endpoint decides.**
Creavy-site owns only the honeypot field + Turnstile widget (presentation);
**creavy-quote owns every check**, incl. server-side Turnstile verification. One
wall at the door — a check that runs on the site is bypassed by not visiting it.

**25A — Abuse control (Phase 2, spec-now).** Endpoint order, cheapest + most
decisive first: (1) **resolve client IP** from the trusted proxy hop (never blind
XFF; key IPv6 on /64); (2) **rate-limit → 429** (sliding window; in-memory MVP →
Postgres/Redis multi-instance; first, zero I/O); (3) **honeypot → silent
accept-and-drop** (plausible job id, never scan); (4) **payload validation**
`normalize(url)` → 400, N-22/N-23 short-circuit to greenfield/human (no crawl);
(5) **Turnstile siteverify → 403** (once at submit, never on poll; unreachable →
**fail open** to rate-limit-only + review flag); (6) **daily global budget → degrade
to email-capture mode** (blast-radius cap, not an error); (7) **cache by normalized
URL (24 h)** → serve cached, zero spend; (8) **only now enqueue**. Config (per #9):
5/IP/hr · 20/IP/day · 3/normalized-URL/day · a daily global ceiling. **Log which
layer rejected each request.**

**25B — SSRF protection (Phase 1, ✅ BUILT this tour).** The more serious risk.
[src/crawl/ssrf.ts](src/crawl/ssrf.ts) blocks private/reserved destinations
(loopback · 10/172.16/192.168 · 169.254 + cloud metadata · fc00::/7 · 0.0.0.0/8 ·
multicast · localhost-by-name), **per-hop before connect** in both transports and
across every redirect (D-01…D-08); the real transport resolves DNS then re-checks
the IP. **N-21 amended:** public IP literals kept (`ip_literal` note),
private/reserved + localhost **rejected** (the committed rule was a hole).
Non-http(s) redirect targets rejected (D-39). **Uniform failure:** a blocked
destination is indistinguishable from any dead host (D-40) — no internal
port-scan oracle. Never attach credentials/cookies/auth to crawl requests. 2 MB
ceiling unchanged. Tests **D-35…D-40** + N-21 ([test/crawl.ssrf.test.ts](test/crawl.ssrf.test.ts)).

**25C — Two-stage flow [DECIDED 2026-07-18].** Scan is **free + ungated** (crawl +
fingerprint, zero tokens, cached by normalized URL, streamed live per #24);
**assessment + quote run behind email capture.** Stage 2 references a completed
stage-1 scan by id and **never re-crawls** (the Part A cache is the bridge); same
wall (Turnstile + rate limits + email syntax/MX); daily global ceiling is the hard
token cap; click-to-verify email is Phase-2, not v1. **Capture ≠ sending** (store
email with a purpose line; sending stays out of v1). Effect: **abuse costs
bandwidth, never tokens.** Shapes the assessment tour — the model is invoked from
**stage 2 only**; its input contract is the cached decision-#8 object + fetched page
content, **never a live crawl.**

### 2.5 Bilingual pairing — amendments #26 + #28 (founder-ratified 2026-07-18/19)

**26. Root-tree pairing (extends #18).** Prefix-less roots pair against a
language-prefixed tree in **both** directions (fr-root+`/en/`, en-root+`/fr/` —
nothing assumes French). Root language is **content-inferred**
([src/crawl/langDetect.ts](src/crawl/langDetect.ts): hand-rolled fr/en stopword +
diacritic detector, zero-dep); `<html lang>` demoted to a fallback (WP themes ship
`lang="en-US"` on French sites — metadata lies, content doesn't).

**28. Bilingual pairing is an evidence ladder** (strongest first; climb down when a
rung is absent), [src/crawl/bilingual.ts](src/crawl/bilingual.ts) `resolveBilingual`:
1. **hreflang** (authoritative) — `<link rel=alternate hreflang>` (head) +
   `<xhtml:link>` (sitemap). fr+en groups pair exactly, **translated slugs and all** →
   `mirror`.
2. **path** — exact slug match after prefix strip + language difference.
3. **tree** — `mirror` without page pairs when **all** guards hold: two trees; each
   tree ≥ **80 %** one content-detected language (false-merge guard); each tree ≥ **3**
   pages; smaller/larger ≥ **0.5**. Any guard fails → `bilingual_suspected` → review.

Counting unchanged: page pairs dedupe pair-wise; tree/suspected take the larger tree
(#18) — #24's "comptées comme un seul site bilingue" stays literally true. Evidence
grade `pairing_evidence: hreflang|path|tree` travels in `reasons[]` + the internal
event log (**not public**). Thresholds live in config (#27.7), loader-validated.
**Supersedes #26 acceptance item 7.** Cases **S-25…S-34**
([test/crawl.bilingual.test.ts](test/crawl.bilingual.test.ts)).

**Acceptance (evidence-based relabels):** the three real bilingual goldens —
labarberie (WP/Yoast), mchenryplumbing + mtlplomberie (Duda, **translated-slug**) —
all earn `bilingual_mirror: true` via **hreflang** (each carries fr+en alternates);
the moat event fires on real sites. Two-of-three being translated-slug is the
**dominant moat-customer shape**, not an edge case.

### 2.6 Tier-mapping rules — decision batch #27 (founder-ratified 2026-07-19)

**27. Tier mapping is a PURE function of the decision-#8 scan result + pricing config
— no model call** ([src/tiermap/tiermap.ts](src/tiermap/tiermap.ts)). Output:
`{bundle:{tier,addons[],modifiers[]}, indicative_total, review_required, reasons[]}`.
**Supersedes §8's pseudocode** (which read Claude's `template_estimate`/
`complexity_score`) — now scan-only, per the #25C two-stage split (the model assesses
in **stage 2**, not here). Invariant #1 holds: code computes the price.

- **27.2 shapes:** 1-2→Présence · 3-4→Standard · 5-6 (no heavy component)→Standard +
  extra-page · **≥7→review, no auto-bundle** · "30+"→out-of-scope.
- **27.3 cheapest valid bundle:** needs generate valid bundles → pick least expensive,
  ties→fewer line items. **Pro only when actually cheapest** (never a default upsell).
  Crossovers proven: bilingual-only→Standard+$690 beats Pro; bilingual+booking+5p→Pro.
- **27.4 needs:** `bilingual_mirror`→bilingual; `bilingual_suspected`→review;
  booking/listings→those needs (Pro includes them); Shopify/e-comm→`human_quote`
  (#21)→review.
- **27.5 blog:** `blog_posts` ≥ 5 → SEO migration ($390) auto-included; below →
  suggestion in `reasons[]`.
- **27.6 blocking → email-capture:** `review_required` / `needs_browser` /
  `robots_blocked` / `partial` / parked|no_html|no_owned_site. Greenfield also skips
  stage-2.
- **27.7 constants in config** (`tiermap` block, loader-validated per #22): review ≥7,
  blog ≥5, extra-page cap, tier capacities, Pro inclusions.
- **27.8 rush + care plan:** rush = a form option (never detected) → #20 percent
  modifier at render; care plan default (opt-out) at render. `indicative_total` = the
  one-time build only.

Tests **T-01…T-26** (expected totals from config) + golden bundles on 8 real sites.
Report + candidate future decisions: [TIERMAP-REPORT.md](TIERMAP-REPORT.md).

### 2.7 Price/assessment split — amendment #29 (founder-ratified 2026-07-19)

**29. The deterministic indicative price is public + zero-PII** (supersedes part of
#25C; extends #27.6).

- **29.1 Stage 1½** — the #27 mapper output (`bundle`, `indicative_total`, `reasons`) is
  returned **publicly, with no contact field**. It costs **zero tokens** — #25C's gate
  existed to protect token spend, and #25A's wall (rate limits · Turnstile · cache ·
  daily ceiling) already covers bandwidth. Everything returned is code-computed from
  ratified config.
- **29.2 Stage 2 unchanged in spirit** — the Claude assessment (personalized analysis +
  written quote) stays **behind email capture** (#25C). The email hook becomes *"get
  your full analysis,"* not *"get your price."*
- **29.3 Declared basis** — a request may carry answers **without a URL** (`no_site`);
  priced from declared answers through the same #27 mapper, tagged `basis:"declared"`
  (vs `"scanned"`). #27.6's greenfield rule is amended: greenfield still **skips
  assessment** (nothing to assess), but an **answers-only indicative price is
  legitimate** — it fakes no scan.
- **29.4 Estimation register (derived, not invented)** — partly-declared inputs or a
  softened #27 blocking condition → `register:"estimation"` + `range:{min,max}` = the
  bounds of the **valid-bundle set the #27.3 enumerator already computes**, plus a
  `confidence` enum. `register:"flat"` → single `indicative_total`. **No number in
  either register may originate outside the pricing config + the #27 enumerator.**
- **29.5 Binding** — nothing is binding until founder sign-off; every response is
  indicative and says so via a machine flag `indicative:true`, **never localized text**.

### 2.8 Answers reconciliation + contract hardening — amendment #30 (founder-ratified 2026-07-19)

**30. Resolves the contract-v0.1 flag batch** (see [contracts/quote-api-contract.md](contracts/quote-api-contract.md) v0.2).

- **30.1 Declared vs scanned** — URL + answers both present: bands **agree** →
  `register:"flat"`, `basis:"scanned"`; **disagree** → `register:"estimation"`, range =
  #27.3 bundle-set bounds across the **union** of both readings' need-sets, confidence
  lowered, review raised (joins #29.4's estimation triggers). **Scanned facts (bilingual,
  blog_posts, platform, components) always apply as needs** regardless of the page-band —
  declared answers **add needs, never erase evidence**.
- **30.2 Component enum** — `needs_booking_or_listings: boolean` → `component:
  none|booking|listings|both`. `booking`→booking need (Standard-compatible, $590 path);
  `listings`→listings (Pro trigger, #27.4); `both`→both (enumerator decides). Legacy
  `true` → `estimation` [cheapest booking bundle … Pro] — **never a silent under-price**.
- **30.3 Suggestion prices** — `suggested_addons` → `[{id, amount}]`, amounts integer
  cents from config (#20; #22 no-drift extended across the repo boundary).
- **30.4 CORS** — production origin only from env; deploy previews use the mock adapter.
- **30.5 Reason codes** — a stable `reason_code` enum lands **next quote-side tour**;
  the mapper's prose moves to internal `reason_text` (never crosses the API). Until then
  `reasons[]` are opaque/optional.
- **30.6 suggested_addons emission** — the engine emits suggestions **next tour** (#27.5
  SEO rule + `has_brand_assets:false`→`logo_refresh`); until then the field is present +
  empty.
- **30.7 Honeypot/Turnstile** request fields remain Phase 2 (#25A).
- **30.8 Answers schema founder-verified** against the creavy-site object (with 30.2
  applied).

### 2.9 Analysis-details panel — amendment #31 (founder-ratified 2026-07-20)

**31. A narrow, whitelisted exception to stored-never-returned** (#24/#8), consumer-driven
(creavy-site's collapsed « Détails de l'analyse » panel). `analysis_details` on
**completed** quotes: optional array of `{item, value}`, **machine enums/typed values
only** (site owns FR/EN labels).

- **Whitelist (ratified):** `platform | pages | language | ecommerce | https`. **`booking`
  dropped** — no scan-side detector (it is a *declared answer*, not a detected fact;
  TIERMAP-REPORT §3.6). Re-add in a later bump only if a booking-widget detector ships.
- **Inclusion rule:** an item appears **only at high detection confidence** (#23); below →
  **omitted**, and **no confidence field crosses the wire — absence IS the signal**.
- **`https` is true-only** — emitted only when HTTPS is present (a positive fact); omitted
  when absent, so a `false` never reads as critique (#24 "findings phrased as facts, never
  negatives").
- **`ecommerce`** = Shopify platform detection (the fingerprint has no WooCommerce
  *platform*, so WooCommerce e-comm stays silent).
- **Absent entirely** on `no_site` quotes and when nothing qualifies (site renders nothing).
- **Explicitly out:** theme/generator id, version numbers, scores, recommendations, anything
  requiring the Claude assessment — **detection-adapter facts only, ~zero tokens**.
- Mostly **re-packages already-public #8 fields** (platform/pages/language) + the fetched
  URL scheme (https) + the Shopify flag — the exception is narrow by construction. Engine
  population is a follow-up build.

Contract: [contracts/quote-api-contract.md](contracts/quote-api-contract.md) v0.4.

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
| `FETCH_TIMEOUT_MS` | 8000 | Per-URL fetch timeout **+ 1 retry on connect errors only** (batch #9, thread 4). Enables D-32 slow-vs-down disambiguation. |
| `CRAWL_BUDGET_MS` | 25000 | Hard wall-clock ceiling for the whole crawl; the **universal governor** (#9) — exhaustion → `partial:true` + review (batch #9, thread 4). |
| `FETCH_CAP` / `CORE_CAP` | 60 / 30 | Max **fetches** per scan / max **core pages** counted precisely (`"30+"` short-circuit beyond). Separates fetches from pages (batch #9, thread 4). |
| `FETCH_CONCURRENCY` | 2 / host | Concurrent fetches **per host** + ~300 ms spacing (batch #9, thread 4). Cross-job worker parallelism is a **separate Phase-2 scope**, not a crawl cap. |
| `CRAWL_DEPTH` | 3 | Max crawl depth from root (inventory §3, adopted). |
| `REDIRECT_HOPS` | 5 | Max redirect hops per URL, incl. robots.txt (adopted). |
| `HTML_READ_CAP` | 2 MB | HTML bytes read per page; parse the truncated prefix (adopted). |
| `ROBOTS_PARSE_CAP` | 500 KB | robots.txt parse cap, matches Google (adopted). |
| `SITEMAP_INDEX_DEPTH` | 2 | Sitemap-index recursion depth (adopted). |
| `CHILD_SITEMAPS` | 5 | Max child sitemaps fetched (adopted). |
| `ASSESS_TIMEOUT_MS` | ~15000 | Claude call timeout (incl. one retry). |
| `QUOTE_DEADLINE_MS` | ~45000 | Absolute per-quote deadline; on breach the worker writes `failed`. |

**Thread 4 (batch #9 cap reconciliation) — CLOSED, founder-ratified 2026-07-18.**
All four contested caps adopt the batch #9 values above (§2.1 collision flags marked
resolved). Concurrency reading: Phase 0's `≥8` was *intra-scan throughput math* for
the old 20 s budget, so `2/host + 300 ms` replaces it; cross-job worker parallelism
stays out of the crawl caps (Phase 2 service-assembly concern).

`SYNC_HOLD_MS` (8 s) and `CRAWL_BUDGET_MS` (25 s) are **independent timers**. The
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
- **Fingerprint (#23, supersedes #3's "Wappalyzer-style core"):** HTTP-only,
  **hand-rolled passive signal table** ([src/fingerprint/](src/fingerprint/)) —
  zero deps, zero extra requests; content>install builder precedence; coverage-capped
  confidence (rider a). Output → `detected_platform ∈ wordpress | wix | squarespace |
  shopify | duda | weebly | webflow | godaddy | joomla | drupal | framer | carrd |
  custom | unknown` + `builders_detected[]`.
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
(integer **cents**), `percent_modifier`, `human_quote` (#21: e-commerce is
`human_quote`). Placeholders are un-runnable (#22): the loader hard-fails on any
`TODO(...)` at boot and in tests. **Add-on values supplied** (CHECKLIST, founder
2026-07-18) — thread 1 closed. Live module:
[`src/pricing/pricing.config.ts`](src/pricing/pricing.config.ts), validated by
[`loadPricingConfig.ts`](src/pricing/loadPricingConfig.ts), proven by
[`test/pricing.config.test.ts`](test/pricing.config.test.ts). Shape:

```jsonc
// src/pricing/pricing.config.ts — single source of truth; repricing = edit here.
// All monetary values are integer CENTS, CAD.
{
  "currency": "CAD",
  "care_plan": { "key": "tranquillite", "label_fr": "Tranquillité", "monthly_cents": 5900 },
  "tiers": {
    "presence":   { "label_fr": "Présence",         "price_cents": 149000 },
    "standard":   { "label_fr": "Standard",         "price_cents": 279000 },
    "pro":        { "label_fr": "Pro",              "price_cents": 429000 },
    "pro_custom": { "label_fr": "Pro (sur mesure)", "price_min_cents": 429000, "price_max_cents": null }
  },
  "addons": {
    "extra_page":           { "price": { "kind": "flat", "cents": 39000 } },  // $390
    "copywriting_per_page": { "price": { "kind": "flat", "cents": 19000 } },  // $190 / page
    "logo_refresh":         { "price": { "kind": "flat", "cents": 49000 } },  // $490
    "bilingual":            { "price": { "kind": "flat", "cents": 69000 } },  // $690 (non-Pro)
    "booking":              { "price": { "kind": "flat", "cents": 59000 } },  // $590
    "ecommerce":            { "price": { "kind": "human_quote" } },           // #21 — sur mesure
    "photo_sourcing":       { "price": { "kind": "flat", "cents": 14000 } },  // $140
    "seo_migration":        { "price": { "kind": "flat", "cents": 39000 } },  // $390
    "rush_delivery":        { "price": { "kind": "percent_modifier", "percent": 20, "applies_to": "build_subtotal" } }, // +20% build only
    "extra_revision":       { "price": { "kind": "flat", "cents": 14000 } }   // $140
  }
  // (label_fr on each add-on omitted here for brevity — present in the module.)
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

1. **CHECKLIST add-on prices** — **✅ CLOSED.** Values encoded in
   [`src/pricing/pricing.config.ts`](src/pricing/pricing.config.ts) as integer cents
   per #20 (e-commerce → `human_quote`, #21); loader hard-fails on any `TODO(...)`
   per #22, proven by [`test/pricing.config.test.ts`](test/pricing.config.test.ts).
2. **Fingerprint adapter choice** — **✅ CLOSED by amendment #23 (§2.2):**
   hand-rolled passive signal table (Candidate A), with content>install builder
   precedence and coverage-capped confidence. Built in [src/fingerprint/](src/fingerprint/).
3. **Persona source** — `persona` (plumber|hvac|realtor…) comes from the landing-page
   source per architecture §8; wiring is a `creavy-site` concern (Phase 4).
4. **Batch #9 cap reconciliation (§2.1)** — **✅ CLOSED (thread 4, §4.1):** all four
   caps adopt batch #9 (budget 25 s, per-fetch 8 s + retry, fetch 60/30 core,
   concurrency 2/host + 300 ms).
5. **Bilingual pairing — ✅ CLOSED by amendments #26 + #28 (§2.5).** The implicit-FR-root
   gap became the evidence ladder (hreflang → path → tree). All three real bilingual
   goldens now earn `bilingual_mirror: true` (via hreflang), moat fires on real sites.
6. **scan() → PoliteScheduler — ✅ CLOSED.** `scan()` routes the sitemap sample fetches
   through `PoliteScheduler` (thread-6 test asserts ≤2 in-flight per host at
   composition level, fake clock). Sequential single-host fetching remains polite by
   construction; the budget governor is the scheduler's.
7. **Soft-404 wired into scan — ✅ CLOSED.** `crawlSitemaps` checks `isSoft404` on the
   verify sample; scan subtracts detected soft-404s from `core_pages`. *Rationale
   corrected (founder):* under-excluding soft-404s never under-prices, but it **can
   over-count via the link-crawl path and push a tier boundary** — money-adjacent in
   the other direction; hence wired now, not later.
8. **DNS rebinding — residual risk accepted for MVP (#25 Part B).** The SSRF guard
   resolves + checks the IP, then `fetch` re-resolves (TOCTOU). Hardening (resolve
   once, connect to the validated IP) is deferred; not a Phase-1 task.
