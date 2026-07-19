# Fingerprint adapter — spike report

> **STATUS: PROPOSAL — NOT committed to SPEC.** Presents the recommendation and a
> proposed **SPEC amendment #23**. #23 is *not* written into SPEC §2 and the
> fingerprint adapter is *not* implemented in `src/` — both wait on founder
> sign-off (the gate). This report is a `/spikes` artifact; it gets pressure-tested
> before #23 lands.

## Spike question (brief)

Can a **passive, hand-rolled** detector identify the platform of ICP sites at
**≥ 90 % high-confidence accuracy**, **zero dependencies**, **zero extra network
requests** — or does a community Wappalyzer fork beat it by enough to justify the
dependency?

## Method

- **Corpus:** 50 real Québec ICP sites (plumbers, roofers, HVAC, electricians,
  landscapers, + photographers/salons/boutiques for closed-platform coverage),
  harvested once, politely, with UA `CreavyQuoteBot/1.0 (+https://creavy.com/bot)`
  (#15), `Set-Cookie` stripped, body capped 2 MB. Fixtures in
  `fixtures/sites/<slug>/` with human-labelled `ground_truth` in `manifest.json`.
  Two embedded Mapbox `pk.` map tokens (Duda sites) were redacted — detection-safe.
- **All three candidates are PASSIVE** (SPEC #3 "HTTP-only"): they consume the
  already-fetched page and make **zero** requests of their own.
  - **A — hand-rolled signal table** (`spikes/detectors.mjs`, ~140 LOC): headers →
    asset/DOM markers → generator meta → class heuristics; brief §4 table.
  - **B — Wappalyzer fork** (enthec/webappanalyzer, **GPL-3.0**) behind a thin
    passive evaluator filtered to the platform techs. Supports the passive fields
    (`headers`, `meta`, `html`, `scriptSrc`, `url`); **excludes `js`/`dom`/`cookies`**
    — `js`+`dom` need a browser, `Set-Cookie` is stripped. That exclusion *is* the
    HTTP-only constraint.
  - **C — generator-meta only** (control): map `<meta generator>` to a platform by
    exact name; plugin generators (Elementor, AIOSEO, WP Rocket…) intentionally
    unresolved.
- **Scored** by `spikes/score.mjs` against rubric §6.

## Corpus composition (ground truth)

| platform | n | notes |
|---|---|---|
| wordpress | 24 | incl. builders: divi ×1, elementor ×7, wpbakery ×1, beaver ×1, theme/Gutenberg ×14 |
| custom / static | 12 | no platform markers — hand-built (the ICP's "best leads") |
| shopify | 5 | artisan boutiques |
| wix | 4 | |
| duda | 2 | |
| squarespace | 2 | |
| square_online (Weebly lineage) | 1 | |

Real ICP skews heavily WordPress — that concentration is **representative**, not a
sampling flaw. The 12 custom/static negatives are the calibration stress-test.

## Rubric §6 scores

| Criterion | A (hand-rolled) | B (wappalyzer passive) | C (generator-only) | Target |
|---|---|---|---|---|
| **Platform accuracy @ high conf** | **100.0 %** (38/38) | 94.7 % (36/38) | 34.2 % (13/38) | ≥ 90 % |
| Platform accuracy @ any conf | 100.0 % | 94.7 % | 34.2 % | — |
| **Builder detection** (10 known) | **80.0 %** (8/10) | 40.0 % (4/10) | 0 % | correct on WP |
| **False positives on custom** (hi/any) | **0 / 0** | 0 / 0 | 0 / 0 | **zero** |
| **Wrong-at-high** (calibration) | **0** | 0 | 0 | **zero** |
| Runtime | ~1.7 ms/site | ~1.7 ms/site | ~0.16 ms/site | < 50 ms |
| Dependency weight | **none** | GPL-3.0 ruleset (~1.5 MB fetched) + evaluator | none |
| License | n/a | **GPL-3.0** (enthec LICENSE confirmed) | n/a |
| Maintenance | edit 1 row + 1 fixture | track fork cadence | trivial |

Per-site detail: `node spikes/score.mjs --per-site`.

## Findings

1. **A meets the bar outright: 100 % @ high, zero deps, zero extra requests.** The
   spike question's own tiebreaker — *"candidate A makes the entire question
   moot"* — is satisfied.
2. **B does not beat A; passively it's worse.** B trails on platform (94.7 %) and
   collapses on builders (40 %). Two failure modes, both from the HTTP-only
   constraint:
   - **Duda missed twice** (→ `custom`): enthec's Duda rule is `scriptSrc:
     dd-cdn.multiscreensite.com/` + `js`; our Duda sites expose Duda only via
     other `multiscreensite.com`/`cdn-website.com` assets that A matches broadly.
   - **Builders missed**: Beaver is **`dom`-only**, WPBakery **isn't in the ruleset**,
     and several Divi/Elementor signals sit in `js`/`dom` — all browser-only, so
     passive B can't see them. A reads the same builders from HTML classes/asset
     paths.
   - Square Online isn't a standalone tech; both A and B resolve it to **Weebly**
     (correct — same lineage).
3. **C confirms A isn't over-built.** Generator-only recovers only 34 %; A adds
   **+66 points** via header/asset/DOM signals that a generator-only baseline can't
   see. C is never *wrong* at high conf — generator meta, when present, is reliable,
   which is exactly why A already uses it as one signal.
4. **Calibration is perfect for all three** — 0 false-positives across 12 custom
   negatives, 0 wrong-at-high. This is the decisive property: SPEC #3 only lets us
   show **high-confidence** platform claims to prospects. A never lies at high conf.
5. **Licensing (brief §3 checklist):** enthec/webappanalyzer's own LICENSE is
   **GPL-3.0**. Server-side use that never distributes the code is very likely fine
   (GPLv3 obligations attach to distribution, unlike AGPL) — a practical reading,
   the founder's call. Since B isn't adopted, the ruleset is **fetched for
   evaluation only, not vendored** (`spikes/wappalyzer/` is gitignored).

## Caveats (honest scope)

- **Adversarial cases (parked / SPA-shell / soft-404)** are *not* in this corpus.
  No empty-SPA-shell surfaced among 50 real ICP sites — consistent with the
  two-speed premise that SPA shells are the rare exception. These three are
  primarily **bounder** concerns (`needs_browser` / `parked` / `soft_404` flags,
  edge-case Tables B–D) and are deferred to the bounder tour, where the 50-site
  corpus is reused. The 12 custom/static negatives already exercise the
  fingerprint calibration criterion (no false platform claim on non-platform pages).
- **B was evaluated passive-only**, as the HTTP-only constraint requires. B's
  browser-mode reputation is not in question — the finding is that *under our
  constraint* its advantage evaporates.
- **GoDaddy / Weebly-classic / Webflow / Joomla / Drupal / Framer** have signal-table
  rows in A but no corpus fixtures (none surfaced in ICP search). Their rows are
  carried from the brief's signal table; add fixtures opportunistically later.

## Recommendation

**Adopt Candidate A** (hand-rolled passive signal table). Freeze the interface
below. Keep the enthec ruleset as an *optional future enrichment* only if passive
accuracy degrades on a broader corpus. A probe pack (`/wp-json/`, favicon hash) is
a later amendment if passive accuracy ever disappoints — v1 stays passive.

## Proposed SPEC amendment #23 — *pending sign-off, NOT committed*

> **23. Fingerprint adapter = hand-rolled passive signal table (Candidate A).**
> On a 50-site real ICP corpus: 100 % platform accuracy @ high confidence, 80 %
> builder, 0 false-positives on 12 custom negatives, 0 wrong-at-high, zero deps,
> zero extra requests, ~1.7 ms/site. The Wappalyzer fork (enthec/webappanalyzer,
> GPL-3.0) scored 94.7 % / 40 % *passively* — its Duda/Beaver/WPBakery/Squarespace
> rules need `js`/`dom` (browser), which the HTTP-only constraint (SPEC #3)
> forbids — so it loses while adding a GPL-3.0 dependency + fork-cadence risk.
> Generator-only is insufficient (34 %). Closes SPEC §14 thread 2 and supersedes
> the "maintained Wappalyzer-style core" language in decision #3.
>
> **Frozen interface (passive v1 — zero network requests):**
> ```ts
> fingerprint(pages: FetchedPage[]) -> {
>   platform: string | "custom" | "unknown",
>   builder?: "elementor" | "divi" | "wpbakery" | "beaver" | "none",
>   theme?: string,          // WP theme slug when visible
>   version?: string,        // only when a signal exposes it; never guessed
>   confidence: "high" | "medium" | "low",
>   signals_matched: string[]
> }
> ```
> **Confidence:** high = ≥1 deterministic signal; medium = supporting signals only;
> low = fallback (custom/unknown). Only **high**-confidence platform claims are shown
> to prospects; medium/low route through human-review wording. A probe pack may be
> added by later amendment if passive accuracy disappoints.

TDD backlog for the adopted adapter: `spikes/fingerprint-tdd-backlog.md` (F-01…F-50).
