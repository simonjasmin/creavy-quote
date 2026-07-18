# creavy-quote — Fingerprint adapter spike brief

**Spike question:** can a passive, hand-rolled detector identify the platform of ICP-representative sites with ≥90 % high-confidence accuracy, zero dependencies, and zero extra network requests — or does a community Wappalyzer fork beat it by enough to justify the dependency?

**Timebox:** one session (~half day). If integrating candidate B's evaluator alone consumes half the box, that is itself the answer — record it and stop.

---

## 1. Design constraints (spike validates, then freezes)

**Passive-only v1.** The fingerprinter consumes pages the bounder already fetched — `{url, status, headers, body}` — and makes **zero requests of its own**. No `/wp-json/` probes, no favicon hashing. This keeps the budget math in SPEC decision #9 untouched and makes the adapter a pure, synchronous function: table-testable exactly like the normalizer. A probe pack can be a later amendment if passive accuracy disappoints.

**Proposed interface (freeze at spike end):**

```
fingerprint(pages: FetchedPage[]) -> {
  platform: string | "custom" | "unknown",
  builder?: string,        // WP only: elementor | divi | wpbakery | beaver | none
  theme?: string,          // WP theme slug when visible
  version?: string,        // when a signal exposes it; never guessed
  confidence: "high" | "medium" | "low",
  signals_matched: string[]
}
```

Confidence rules: **high** = ≥1 deterministic signal; **medium** = supporting signals only; **low** = fallback classification (custom/unknown). The assessment layer may only phrase platform claims to prospects at high confidence — medium and low route through human review wording.

**Why 13 platforms, not 6,000.** Creavy quotes 1–5-page trades sites. Detection only matters where it moves effort or price: migration source, builder soup, closed platform, free-plan subdomain. A general-purpose ruleset is scope without payoff.

---

## 2. Candidates

**A — Hand-rolled signal table (recommended going in).** ~13 platform rows (§4), evaluated headers-first. Estimated 150–300 LOC plus a data table we own. Maintenance story: when Wix changes a CDN domain, we edit one row and one fixture.

**B — Maintained Wappalyzer-fork ruleset.** enthec/webappanalyzer or tunetheweb/wappalyzer fingerprints behind a thin evaluator, filtered to CMS/page-builder categories. Breadth for free; cost is the evaluator integration, a dependency on fork cadence, and the license lineage (§3).

**C — Control: generator-meta only.** Trivial baseline. If A barely beats C on the corpus, A is over-built — simplify it. If C alone scores well, that is worth knowing too.

---

## 3. Licensing pre-research (done — don't respend spike time here)

Findings from research on 2026-07-18:

- Wappalyzer closed-sourced in August 2023; the original repo is gone. Community forks carry the last open ruleset and remain actively maintained as of 2026: enthec/webappanalyzer, tunetheweb/wappalyzer, dochne/wappalyzer, plus HTTP Archive's fork used for their monthly crawl.
- The historical ruleset lineage is **GPLv3**. Practical reading for creavy-quote: the service is server-side and never distributes the code, and GPLv3 (unlike AGPL) attaches obligations to distribution — so using a fork's data server-side is very likely fine. This is a practical reading, not legal advice.
- Spike checklist item if B is seriously considered: open the chosen fork's LICENSE file and confirm what it actually says (2 minutes). Some downstream repackagers claim different licensing than the lineage suggests — trust the fork's own file, not a vendor page.
- Tiebreaker: candidate A makes the entire question moot.

---

## 4. Signal table (seed for candidate A; ground truth for scoring all candidates)

Evaluation order: response headers & asset domains → DOM attributes & comments → generator meta → class-name heuristics. Signals marked *(verify)* are plausible but unconfirmed — confirm or replace them against fixtures during the spike.

| Platform | Deterministic signals | Supporting signals | Pricing / assessment note |
|---|---|---|---|
| WordPress | `/wp-content/`, `/wp-includes/` asset paths; `Link:` header with `rel="https://api.w.org/"` | generator meta (often stripped); `wp-emoji` inline script; `wp-sitemap.xml` already seen by the sitemap module | Migration source #1 — always attempt builder + theme sub-detection |
| — WP builders | Elementor: `/plugins/elementor/` + `elementor-` classes · Divi: `/themes/Divi/` + `et_pb_` classes · WPBakery: `vc_row` · Beaver: `fl-builder` | theme slug from `/wp-content/themes/<slug>/` | Builder soup = content-extraction effort; feeds migration notes |
| Wix | `X-Wix-Request-Id` header; `wixstatic.com` / `parastorage.com` assets | generator meta "Wix.com Website Builder"; `*.wixsite.com` host = free plan — itself a sales signal | Closed platform: rebuild, not migrate |
| Squarespace | `<!-- This is Squarespace. -->` HTML comment; `static1.squarespace.com` assets | `Y.Squarespace` JS globals; `sqs-` classes | Closed: rebuild |
| GoDaddy W+M | `wsimg.com` asset domains *(verify exact hosts)* | generator meta variants *(verify)* | Very common in this ICP; rebuild |
| Weebly / Square Online | `editmysite.com` asset domains | generator "Weebly" | Legacy trades sites; rebuild |
| Shopify | `cdn.shopify.com`; `X-ShopId` / `X-Shopify-Stage` headers | `Shopify.theme` global; `/collections/`, `/products/` paths; `*.myshopify.com` | Routes toward the e-comm `human_quote` path (SPEC #21) |
| Webflow | `data-wf-site` / `data-wf-page` attrs on `<html>`; `assets.website-files.com` | generator "Webflow" | Rare in ICP; HTML export possible |
| Duda | `cdn-website.com` asset domains *(verify)*; `dmBody` classes *(verify)* | `multiscreensite.com` legacy refs | Agencies resell Duda to SMBs — plausible in ICP |
| Joomla | generator "Joomla!"; `/components/com_` paths | `option=com_` params; `/media/jui/` | Legacy; migration heavier than WP |
| Drupal | `X-Generator: Drupal` header; `/sites/default/files/` | | Rare in ICP |
| Framer / Carrd | `framerusercontent.com`; `carrd.co` refs | | Modern one-pager competitors — Présence-tier context |
| Custom / static (fallback) | *absence* of all above | `.html` extensions; hand-rolled markup; table layouts; ancient copyright year | Often the best leads — outdated hand-made sites with real businesses behind them |

---

## 5. Fixture corpus (shared with bounder Tables B–D — harvest once)

18–24 sites, real Québec trades where findable (plumber / HVAC / realtor — Pages Jaunes and Google Maps listings are good hunting grounds):

- ≥3 WordPress (mix: Elementor, Divi, vanilla theme)
- 3 Wix · 3 Squarespace · 2–3 GoDaddy · 2 Weebly/legacy
- 1 Shopify · 1 Webflow or Duda if findable
- 2 ancient custom/static sites
- Adversarial: 1 parked domain · 1 SPA shell · 1 host that soft-404s everything

Layout: `fixtures/sites/<slug>/{manifest.json, root.headers.json, root.html, robots.txt?, sitemap.xml?}` — `manifest.json` carries human-labeled `ground_truth` (platform, builder, bilingual, page count if known). Strip `Set-Cookie` from everything committed.

---

## 6. Scoring rubric

| Criterion | Target / question |
|---|---|
| Platform accuracy | ≥90 % correct at high confidence on the corpus |
| Builder detection | Correct on the WP fixtures |
| False positives | Zero platform claims on custom/static fixtures |
| Calibration | No *wrong* answer ever carries high confidence — wrong-at-high is the one unforgivable failure |
| Runtime | Sane (<50 ms/site passive); not a differentiator, just a floor |
| Dependency weight | Candidate B: what did the evaluator drag in? |
| License | Candidate B: fork's own LICENSE file says what? |
| Maintenance | Who fixes it when Wix rotates a CDN domain, and how fast? |

---

## 7. Definition of Done

- Fixture corpus committed with labeled ground truth.
- All three candidates scored against §6; numbers in the spike report, not adjectives.
- Decision recorded as **SPEC amendment #23**: adapter choice + the frozen interface from §1.
- Spike code deleted or quarantined under `/spikes` — never imported by `src`.
- Fingerprint TDD backlog generated: one case per fixture (`F-01`…), using the same table-driven pattern as the edge-case inventory.
