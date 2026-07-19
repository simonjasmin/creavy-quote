# Tier-mapping engine (#27) — report

> Built 2026-07-19, red-green. Pure function of the #8 scan result + config, no model
> call ([src/tiermap/tiermap.ts](src/tiermap/tiermap.ts)). **262/262 suite green.**
> Hold before the assessment tour. §3 lists rules that felt ambiguous in practice —
> **candidate future decisions, listed not decided.**

## T-table — T-01…T-26 all green (expected totals computed from config)

| Range | Cases | Result |
|---|---|---|
| 27.2 shapes | T-01…T-08 | 1-2→Présence, 3-4→Standard, 5-6→Standard+extra, 7+→review, 30+→out-of-scope |
| 27.3 crossovers | T-09…T-15 | **bilingual-only→Standard+$690 beats Pro (3480<4290)**; **bilingual+booking+5p→Pro (4290<4460)**; listings→Pro; e-comm→review |
| 27.5 blog | T-16, T-17 | ≥5→SEO migration auto-included; <5→suggested |
| 27.6 blocking | T-18…T-25 | needs_browser / robots_blocked / partial / greenfield / bilingual_suspected / anti_bot → review |
| config-drift | T-26 | totals read from config (a hardcoded drift fails) |

[test/tiermap.test.ts](test/tiermap.test.ts) · [test/tiermap.golden.test.ts](test/tiermap.golden.test.ts).

## Golden bundles — the mapper on 8 real scan-results

| Site | core | blog | bilingual | → outcome |
|---|---|---|---|---|
| toituresmarcelpouliot | 4 | 0 | no | **Standard = 2790 CAD** (only clean shape) |
| lasouche | 12 | 54 | no | review (≥7) |
| paysagesgenest | 16 | 0 | no | review (≥7) |
| mtlplomberie | 18 | 0 | yes | review (≥7) |
| pierrehamelin | 27 | 0 | no | review (≥7) |
| protectoit | 27 | 34 | no | review (≥7) |
| itemconstruction / labarberie / mchenryplumbing | 30+ | — | — | review (out-of-scope) |

**Observation (not a decision):** **8 of 9 real goldens → review.** Real Québec trades
sites carry 10–30 core pages, above the clean-shape ceiling (≥7). Only ≤6-page sites
get an indicative price. This is the ratified 27.2 rule working — the auto-price
envelope is deliberately the small/moat site — but it means the human gate handles
most established businesses. Listed for the founder's eye (see §3.1).

## 3. Rules that felt ambiguous in practice (candidate future decisions — NOT decided)

1. **Auto-price envelope vs reality.** ≥7→review sends most real sites to human review
   (golden evidence above). Intended coverage, or raise the threshold? Money-touching —
   left as-is per the ratified default.
2. **27.2 "5+component→Pro" vs 27.3 arithmetic.** A *single* heavy component at 5
   pages is cheaper on Standard+add-on (e.g. Standard+extra+booking = 3770) than Pro
   (4290), so it maps to Standard, not Pro. "5+component→Pro" only holds for *multiple*
   components (the bilingual+booking crossover). I implemented **27.3 arithmetic** (the
   named crossovers confirm it); 27.2's prose is the special case, not the rule.
3. **Pro inclusions inferred.** To make bilingual+booking+5p→Pro, Pro must cover
   bilingual **and** booking flat. #27 didn't state Pro's inclusions; I set
   `pro_includes = [bilingual, booking, listings]` in config. Confirm.
4. **Listings has no flat add-on.** The CHECKLIST config has no `listings` add-on, so a
   listings need is coverable *only* by Pro (which includes it) — a listings site is
   Pro or review, never Standard+listings. Intended, or add a Standard-tier listings
   add-on?
5. **Présence never carries a component.** A 2-page bilingual site maps to
   Standard+bilingual (3480), not Présence+bilingual (2180), because Présence is
   defined as simple-only. Cheaper-for-tiny-bilingual is left on the table by design —
   confirm.
6. **Component detection isn't wired.** `booking`/`listings` are **not** produced by the
   current scan (not on the #8 object) — only `bilingual` (from `bilingual_mirror`) and
   `ecommerce` (from `detected_platform==="shopify"`) are derivable today. So golden
   bundles never carry booking/listings. Where should booking/listing detection live —
   scan (extend #8) or the stage-2 assessment?
7. **`extra_page_cap` is currently inert.** Pages 5-6 need only 1-2 extra pages (within
   the cap of 3); anything needing ≥3 extra pages is already ≥7→review. The cap only
   matters if the review threshold rises (see §3.1).
