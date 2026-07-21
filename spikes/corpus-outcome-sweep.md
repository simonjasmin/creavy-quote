# Corpus outcome sweep + E2 review-rate diagnosis

> **Measurement only** — no rule, threshold, or config was changed. Anything that looks
> money-touching-wrong is flagged with data below, not fixed. Reproduce:
> `node spikes/corpus-sweep.mjs` (offline) and `node spikes/diagnose-site.mjs <url>` (live).
> Produced 2026-07-20. Suite green (357) and 2b unstarted at time of measurement.

## 1. The two live E2 review cases — cause chain

Both scanned live (real `HttpTransport`, one polite pass, CreavyQuoteBot UA, robots respected).
**Both hit the same condition: the ≥7-core ceiling (`review_unusual_size`, #27.2).**

| site | core | blog | bilingual | platform | flags | assessable() | → outcome | reason code |
|---|--:|--:|---|---|---|:--:|---|---|
| **elevatek.ca** | **7** | 0 | yes (hreflang) | custom (low) | — | **false** | review, no price | `review_unusual_size` |
| **toitureshogue.com** | **31** | 36 | yes (hreflang) | wordpress (high) | `partial` (sitemap children capped) | false | review, no price | `review_unusual_size` |

- **elevatek.ca** is a **legitimately small bilingual trades site** (7 paired core pages, an
  electrician) — it clears every gate *except* core-count, landing **one page over** the auto-
  quote ceiling of 6. This is the sharpest threshold-argument case (see §5).
- **toitureshogue.com** — 31 core came through as a **number, not the `"30+"` sentinel**,
  because the sitemap **index was children-capped** (`partial`), so the crawl counted 31 from
  the sampled children instead of short-circuiting to `"30+"`. **Not money-touching:** both a
  `31` and a `"30+"` route to review with no auto-price — identical outcome, only the reason
  code differs (`review_unusual_size` vs `out_of_scope`). Flagged as a classification nuance,
  §5.

## 2. Full-crawl outcome sweep (SET A — faithful offline replay)

15 sites with a faithful full-crawl fixture: 9 real goldens + 3 labelled-synthetic goldens +
3 synthetics. `scan → assessable() → #27 mapper` with band-matched neutral answers.

| outcome | count | sites |
|---|--:|---|
| **flat** (instant price) | 5 | toituresmarcelpouliot(4), syn-couvreur-dated(4), syn-electricien-sain(5), syn-plomberie-bilingue(3), bilingual(2) |
| **estimation** (instant range) | 1 | spa-shell(1, `needs_browser`→softened) |
| **review** (no price, ≥7) | 5 | lasouche(12), mtlplomberie(10), paysagesgenest(16), pierrehamelin(27), protectoit(27) |
| **out_of_scope** (30+) | 3 | itemconstruction, labarberie, mchenryplumbing |
| **greenfield** | 1 | parked(0) |

- **Reason-code histogram:** `cheapest_bundle`×6, `needs_review`×5, `out_of_scope`×3,
  `bilingual_addon`×2, `needs_closer_look`×1, `parked`×1.
- **Core-page distribution:** `0`×1, `1`×1, `2`×1, `3`×1, `4`×2, `5`×1, `7-29`×5, `30+`×3.
- **Auto-price rate:** flat+estimation over real (non-greenfield) sites = **6 / 14 = 43 %**.

> **⚠ Bias caveat (load-bearing):** this corpus is **not a random ICP sample.** The 9 real
> goldens were chosen for *crawl coverage* — 8 of 9 are ≥7 or 30+ core; only
> `toituresmarcelpouliot` (4) is small. The synthetics fill the small end deliberately. So the
> 43 % is a **floor, not the funnel rate.** A real small-trades funnel (the ICP) skews to
> ≤6-core sites, which auto-price. Read §5 for what the sweep *does* argue, and §4 for why the
> denominator is untrustworthy.

## 3. Review causes, ranked (real sites, incl. the 2 live E2)

| review cause | reason code | count | note |
|---|---|--:|---|
| **≥7 core** | `review_unusual_size` | **7** | lasouche, mtlplomberie, paysagesgenest, pierrehamelin, protectoit + **elevatek(7)**, toitureshogue(31) |
| 30+ pages | `out_of_scope` | 3 | itemconstruction, labarberie, mchenryplumbing |
| greenfield | `parked` | 1 | parked (no site) |

**The ≥7-core ceiling is the dominant reason a real site gets no instant price** — 7 of the 11
real reviewed sites. Every other gate (needs_browser, robots, anti_bot, partial-alone,
bilingual_suspected, ecommerce) produced **zero** standalone reviews in this corpus.

## 4. Root-only 50-site corpus (SET B — sitemap-derived core band only)

Root-only fixtures cannot be faithfully full-scanned (the sampled pages aren't captured — a
full run would 404 them, i.e. mock the outcome, which we don't do). We report **only the
sitemap-derived core band**, and label the rest **not-measurable**:

- **15 measurable** (flat `<urlset>` sitemap) · **35 not-measurable** (31 are **sitemap
  *index*** files that need child fetches root-only can't do; 4 have no/unparseable sitemap).
- **Sitemap-derived core band (ROUGH):** `2`×1, `5`×1, `7-30`×8, `30+`×5.

> **Rough** = no bilingual pairing (a bilingual site's sitemap doubles its loc count →
> over-counts core) and no soft-404 subtraction. Directional only. It reinforces §2's bias
> reading: this corpus (chosen for *fingerprint* diversity) also skews large — 31 of 46
> sitemaps are multi-child indexes, i.e. bigger CMS sites.

## 5. Flagged — not decided (measurement-only)

1. **The ≥7-core auto-quote ceiling (currently `review_pages=7`, so ≤6 auto-prices).** The
   data argues it may be **tight for bilingual + slightly-larger small sites**:
   - **elevatek.ca at exactly 7** — a small bilingual electrician, ICP-shaped, denied an
     instant price by one page.
   - A **bilingual** small business naturally carries more paired core pages; several corpus
     sites cluster at 10–16 (mtlplomberie 10, lasouche 12, paysagesgenest 16).
   - **Question for the founder (not a change):** should the ceiling rise (e.g. 8 or 10), or
     should **bilingual sites get a higher ceiling** (a 7-page bilingual mirror = ~3–4 unique
     templates)? This is money-touching — it moves sites from "book a call" to an instant
     price — so it stays a founder decision. No code touched.
2. **`31 core → review_unusual_size` instead of `out_of_scope`** (toitureshogue). A capped/
   partial sitemap yields a number just over 30 rather than the `"30+"` sentinel. **Same
   outcome** (no auto-price), only the reason code differs — a classification nuance, not a
   pricing error. Noted in case the reason-code cleanliness matters downstream.
3. **No money-touching price error found.** Every `flat`/`estimation` outcome priced
   correctly (small sites → Standard/Pro per config); the review/out-of-scope/greenfield
   routing all fired on the right conditions. Nothing was mis-priced — the open question is
   purely *how many* sites the ceiling routes to review vs. instant price (item 1).

## 6. Measurable-set extension / synthetic-golden swap — status

- Added **2 live real sites** (elevatek.ca, toitureshogue.com) as real E2 data points — both
  land in `review` (≥7), so neither can **replace** the small (≤6-core) synthetic goldens,
  which remain the only assessable-scale real-shaped fixtures.
- **The swap stays pending a curated list of small (≤6-core) real trades URLs.** Network
  permits, but fabricating/guessing domains would violate evidence honesty; give me a short
  list (or the E2 funnel's real submissions) and I'll harvest them under the standing rules
  and fold them in — that both widens the measurable set and completes the swap.
