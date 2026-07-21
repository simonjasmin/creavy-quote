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

## 5. Small-sites harvest / synthetic-golden swap — DEFERRED to founder-curated URLs

**Pages Jaunes / Google Maps blocking the CreavyQuoteBot UA was the bot posture working as
designed** (PJ 403s even `robots.txt`; Maps is JS-only). Founder resolution: **don't retry,
don't evade — the source inverts to a founder-curated list** of 8–10 real Québec trades sites
(a mix of ≤6-core and 7–12-core, so the #35 band gets real coverage). When that list lands:
harvest under the standing rules, complete the synthetic-golden swap, re-run this sweep on the
widened set, and report the new rate. No domains were fabricated; no self-sourcing.

## 6. p95 fast-path scan latency — E3 acceptance gate (measured AGAINST STAGING)

`node spikes/latency-staging.mjs` — POST /quote to the live staging service (real
`HttpTransport` crawls each URL from Railway's network), **cache-busted** (unique `?cb` →
distinct normalized_url → #25-A cache miss → genuine fresh scan), **one polite pass each**,
latency = POST → terminal state. Corpus = the 9 golden real sites + the 2 live E2 sites
(harvested URLs append once curated).

| run (paced, isolated) | n | p50 | **p95** | max | gate < 8 s |
|---|--:|--:|--:|--:|:--:|
| 1 | 11 | 3447 ms | **7710 ms** | 7710 ms | ✅ PASS |
| 2 | 11 | 3236 ms | **7163 ms** | 7163 ms | ✅ PASS |
| 3 (post-2b deploy, + sltoiture seed) | 12 | 2852 ms | **7116 ms** | 7116 ms | ✅ PASS |

- **Post-2b re-measure (run 3) confirms no stage-1 regression** from the assessment deploy
  (staging now `contract_version 0.7`) — assessments are a separate path. Seed `sltoiture.com`
  (30+, overflow short-circuits after the homepage) = **543 ms**, the fastest in the set.

- **p95 ≈ 7.2–7.7 s < 8 s → PASS**, stable across two runs. The p95 driver is
  **toitureshogue.com (31 core)** — the largest, out-of-ICP-size site; the ≤6-core ICP subset
  is all **< 2.5 s** (mchenry 0.6 s, paysages 1.1 s, toituresmarcelpouliot 1.7 s, elevatek
  1.9 s, mtlplomberie 2.5 s). Headroom is **marginal** (~0.3–0.8 s) and single-site-driven; n=11.
- **⚠ Contention flag (data, not fixed):** an earlier run with **bunched POSTs** (concurrent
  scans on the **single staging instance**) degraded sharply — lasouche to ~12 s and protectoit
  to a transient failure — pushing p95 to **11 938 ms (FAIL)**. This is a **capacity** signal,
  not a scan-latency one: the isolated fast-path is < 8 s, but concurrency on one replica blows
  the budget. The Phase-0 **Render-graduation trigger** (multi-instance) is the lever;
  single-instance is the ratified MVP posture. Flagged for the launch-capacity decision.
