# Corpus outcome sweep + E2 review-rate diagnosis

> Measurement + the #35 outcome shift. Reproduce: `node spikes/corpus-sweep.mjs` (offline)
> and `node spikes/diagnose-site.mjs <url>` (live). Updated 2026-07-20 for **#35 (size-
> estimation band)**. Suite green (368).

## 0. Corrections (founder, recorded in SPEC #35)

- **elevatek.ca is the founder's consulting brand — OUT of ICP**, not a tradesperson. Its
  earlier `review` outcome was **correct, not collateral.** The prior "small trades site
  denied a price" framing is **struck.**
- **Bilingual mirrors do NOT inflate core counts** — #26/#28 pairing dedupes a fr/en mirror to
  one core set. The prior "bilingual → more pages / doubled sitemap" rationale is **struck.**

## 1. The two live E2 cases — cause chain, under #35

| site | core | flags | → outcome (post-#35) | reason |
|---|--:|---|---|---|
| **elevatek.ca** | **7** | bilingual (hreflang) | **estimation band**, range **[357000, 396000]** | `size_estimation_band` |
| **toitureshogue.com** | **31** | `partial` (sitemap capped) | pure review (partial excludes band; >12) | `review_unusual_size` |

- **elevatek.ca now returns an instant range** ($3,570–$3,960) — correct by page count,
  independent of its out-of-ICP fit (#35).
- **toitureshogue.com stays review** — `partial` (children-capped sitemap) is a band exclusion,
  so an undercounted huge site can't sneak a band price. Cosmetic thread: it reads
  `review_unusual_size` vs `out_of_scope`, same no-price outcome (§4).

## 2. Full-crawl outcome sweep (SET A, 15 faithful fixtures) — before vs after #35

| outcome | before #35 | **after #35** | sites (after) |
|---|--:|--:|---|
| flat | 5 | 5 | toituresmarcelpouliot(4), syn-couvreur-dated(4), syn-electricien-sain(5), syn-plomberie-bilingue(3), bilingual(2) |
| **estimation** | 1 | **3** | **lasouche(12)**, **mtlplomberie(10)** (now band), spa-shell(1, needs_browser) |
| review (no price) | 5 | **3** | paysagesgenest(16), pierrehamelin(27), protectoit(27) |
| out_of_scope (30+) | 3 | 3 | itemconstruction, labarberie, mchenryplumbing |
| greenfield | 1 | 1 | parked(0) |

- **Reason histogram (after):** `cheapest_bundle`×6, `size_estimation_band`×2,
  `out_of_scope`×3, `needs_review`×3, `bilingual_addon`×2, `needs_closer_look`×1, `parked`×1.
- **Core distribution:** `0`×1 `1`×1 `2`×1 `3`×1 `4`×2 `5`×1 `7-29`×5 `30+`×3.
- **Auto-price rate (flat + estimation over real sites):** **8 / 14 = 57 %** (was 43 % pre-#35).
  Including the 2 live E2 sites (elevatek → band, toitureshogue → review): **9 / 16 = 56 %.**

> **⚠ Bias caveat (still load-bearing):** this is **not a random ICP sample.** The 9 real
> goldens were chosen for *crawl coverage* — most are ≥7/30+. So 57 % is a **floor**, not the
> funnel rate. A real small-trades funnel skews ≤6-core (instant flat) and 7–12 (now instant
> range). The honest funnel-rate authority is **production telemetry (rider b), post-launch**
> — the corpus sweeps are directional.

## 3. Root-only 50-site corpus (SET B — sitemap-derived core band only)

Root-only fixtures can't be faithfully full-scanned (no mocking to force outcomes). Reported
only as far as the sitemap allows:

- **15 measurable** (`<urlset>`) · **35 not-measurable** (31 sitemap *index* files needing
  child fetches; 4 no/unparseable).
- **Sitemap-derived core band (ROUGH — no pairing / no soft-404):** `2`×1, `5`×1, `7-30`×8,
  `30+`×5. Directional; reinforces the bias-large reading.

## 4. Recorded threads (not fixed)

- **31-vs-`"30+"` sentinel** (toitureshogue): a capped/partial sitemap yields a number just
  over 30 instead of the `"30+"` sentinel → `review_unusual_size` not `out_of_scope`.
  **Cosmetic** (same no-price outcome); `partial` also blocks the band, so no price leaks.
- **Production telemetry is the real funnel-rate measure** once quotes flow (rider b).

## 5. Small-sites harvest / synthetic-golden swap — BLOCKED at sourcing (honest)

The 10-site directory harvest **could not proceed politely from here:**
- **Pages Jaunes** returns **HTTP 403 to the CreavyQuoteBot UA — including its `robots.txt`**
  (edge anti-bot). Per the standing rules (robots respected, honest identifiable UA, no
  detection evasion), I did **not** scrape past it.
- **Google Maps** listing pages are JS-rendered — a plain fetch yields no business websites.

No domains were fabricated. **The swap stays pending a politely-accessible candidate source.**
Recommended source: **the E2 funnel's own real submissions** (already consented, exactly ICP)
— pipe a handful of real ≤6-core small-site URLs from staging and I'll harvest them under the
standing rules and fold them in, completing the swap and widening the measurable set.
