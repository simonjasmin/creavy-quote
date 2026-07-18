# SPEC amendment — Phase 1 decision batch

Resolves every **[spec?]** in `creavy-quote-phase1-crawl-edge-cases.md`, plus three pricing-config schema decisions surfaced during CHECKLIST review. Numbered to continue SPEC §2 after amendment #7 — renumber if the scheme differs. **All fifteen decisions are ratified — founder sign-off 2026-07-18, with #15 and #21 confirmed as recommended.** If anything here collides with an existing §2 decision from Phase 0, the existing decision wins — delete the row and flag it.

Format per decision: what, why, which test cases it unblocks.

---

## A. Crawl & bounder

**8. Bounder returns a structured result, not an integer.**
Shape per edge-case doc §2: `canonical_origin, core_pages, blog_posts, excluded{}, languages[], bilingual_mirror, needs_browser + reasons[], review_flags[], partial`.
*Why:* blog volume and bilingualism are pricing signals, not page inflation; the tier mapper consumes `core_pages` + components only. A single count cannot express the sites this ICP actually has.
*Closes:* §2 of the inventory; shapes all of Table D and the assessment schema.

**9. Caps adopted as defaulted in inventory §3, and caps live in config, not code.**
Precise counting stops at 30 → report `"30+"` + `out_of_icp_scope` flag. The 25 s fast-path budget is the universal governor: politeness delays, slow hosts, and absurd `Crawl-delay` values get no special logic — they exhaust the budget, which yields `partial: true` + review. One mechanism, no edge-case forest.
*Closes:* S-05, S-23, D-21, D-31, D-32, D-33.

**10. Form input repair is permissive, never guessy.**
Trim whitespace; repair `https:/` and `https//`; strip userinfo (+ `suspicious_input` note). Interior whitespace, non-http(s) schemes, and > 2,000 chars → typed rejection with a friendly form message.
*Why:* it's a lead form — friction loses prospects — but we repair only unambiguous typos.
*Closes:* N-18, N-20, N-27, N-28.

**11. Ownership principle (governs 12–14).**
The form submitter is unverified — anyone can paste any URL, including a competitor's. The crawler therefore always behaves as if scanning a stranger's site: full robots respect for expansion, no evasion, no aggressive retries. Fetching the single submitted URL is a user-initiated request (link-preview class) and is always permitted.
*Why:* one principle settles every "but the owner asked" argument before it starts, because we can never prove the owner asked.

**12. robots.txt `Disallow: /` (full block).**
Fetch the submitted URL only. No expansion, no sitemap fetches. Page count unknown → `robots_blocked` flag → human review.
*Closes:* R-10.

**13. robots.txt errors.**
4xx → unrestricted (RFC 9309). 5xx, or unreachable after the 5-hop redirect cap → treat as full block (same behavior as #12) + note.
*Closes:* R-02, R-03, R-05.

**14. Anti-bot and invalid TLS.**
Challenge pages: one standard-config attempt, never a bypass attempt; `anti_bot` flag → human. Invalid/expired TLS: one unverified retry, content used for assessment only, `tls_invalid` always surfaces — it doubles as a sales signal ("your site warns visitors").
*Closes:* D-24, D-26.

**15. Bot identity. [CONFIRMED — founder, 2026-07-18]**
UA string `CreavyQuoteBot/1.0 (+https://creavy.com/bot)`, read from config (R-07). This commits to a one-paragraph bot page on creavy.com — transparency that costs nothing and reads well when a prospect's host logs show us. `Crawl-delay` is applied as-is; per #9 the budget converts extreme values into a homepage-only partial + review, which is exactly the politeness the site asked for.
*Note:* the bot page is a Creavy-site backlog item; the URL may 404 until the marketing site ships, which is acceptable.
*Closes:* R-07, R-13.

**16. Canonical host resolution.**
Redirects are authoritative. If apex and www both serve 200 with no redirect, pick deterministically: (a) https over http, (b) the homepage's own `rel=canonical` if present, (c) internal-link majority, (d) www — and always set `host_ambiguous`. A root-level cross-domain redirect re-anchors the scan once (`domain_moved`); a second cross-domain hop stops the scan + flag.
*Closes:* D-01, D-02, D-03, D-04.

**17. Scope = canonical host only.**
www ↔ apex unify. Language subdomains (`fr.`, `en.`) merge as mirrors under #18. Every other subdomain → `related_property`, out of `core_pages`.
*Closes:* D-20.

**18. Bilingual pairing (pricing-critical).**
`hreflang` is authoritative. Otherwise, pair by mirror heuristic: language path prefixes (`/fr`, `/en`, `/fr-ca`, `/en-ca`), a `lang=` param, or language subdomains, with 1:1 tree correspondence. Paired → one core page per pair, `bilingual_mirror: true`, both languages recorded. Two language trees detected but unpairable (translated slugs) → `core_pages` = the larger tree, `bilingual_suspected` flag → human review. **Never sum both trees.**
*Why:* bilingual is a tier feature ($690 add-on / included in Pro). A naive count double-prices exactly the Québec sites the moat is built on.
*Closes:* S-22, D-16.

**19. Sitemap trust rule.**
Sample-verify `min(core, 10)` locs; more than 30 % non-200 → distrust the sitemap, fall back to link crawl, `stale_sitemap` flag. Classification per S-17/S-18: pages → core, posts → `blog_posts`, taxonomies/authors/date archives → `excluded.archives`.
*Closes:* S-20.

---

## B. Pricing config

**20. The config schema knows exactly three price kinds.**
`flat` (integer cents), `percent_modifier` (e.g. rush +20 %), `human_quote` (no auto price — the quote flow renders a "sur mesure — réponse en 24 h" line and sets a review flag). Percent modifiers apply to the one-time build subtotal (tier + flat add-ons) only — never to recurring care-plan amounts. No other kinds exist, which makes "from $890" unrepresentable as an auto-quote by construction.

**21. E-commerce add-on ships as `human_quote` in v1. [CONFIRMED — founder, 2026-07-18]**
Alternative considered and declined: convert to `flat` with a hard scope wall ("up to N products, one payment provider").
*Why:* e-comm scope variance is exactly what flat pricing can't hold, volume will be low, and a human touch on the highest-ticket add-on is a feature, not a failure of automation. Revisit if e-comm requests exceed ~1 in 5 quotes.

**22. Placeholders are un-runnable.**
The config loader hard-fails on any `TODO(...)` value at boot and in tests. No bypass flag — dev and CI run against a complete fixture config instead. Gate E cannot be passed by accident, and no environment can ever quote a $0 add-on.

---

## Usage

1. Paste into the Claude Code session. Before amending, Claude Code diffs this against the existing SPEC §2 — any collision with a Phase 0 decision resolves in favor of Phase 0, flagged back to founder.
2. Amend SPEC §2 with decisions 8–22, commit.
3. The tagged tests in the edge-case inventory are now mechanical: no policy gets invented mid-TDD. Build order: Table A (pure, fast wins) → B → C → D.
