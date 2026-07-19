# Assessment layer — recon (read-only)

> Produced 2026-07-19. **No code built, no model called.** Measurements from the 8+1
> golden fixtures (`spikes/measure-recon.mjs`). Feeds the assessment-tour design;
> founder + strategy pass first. Everything in §5 is a question, not a proposal.

## 1. What survives a scan today

`scan()` ([src/crawl/scan.ts](src/crawl/scan.ts)) returns **one thing**: the
`ScanResult` = the decision-#8 object + `detected_platform` + `builders_detected`
([src/crawl/types.ts](src/crawl/types.ts) `BounderResult`). Everything else is
**local to the call and dies on return**:

| Data | Where it lives during scan | Persists after `scan()`? |
|---|---|---|
| #8 result object (core_pages, blog_posts, languages, bilingual_mirror, excluded, review_flags, needs_browser, partial) | return value | ✅ **yes** (the only survivor) |
| detected_platform + builders_detected + confidence | return value | ✅ yes |
| Fetched **HTML bodies** (homepage `canon.html`, sampled pages) | local vars, `FetchResult.body` | ❌ **no** — discarded |
| Extracted **visible text** | not extracted except transiently (lang detect) | ❌ no |
| Response **headers**, fingerprint `signals_matched` | local; signals summarized into result only | ❌ no (signals_matched not on the result) |
| **Event log** (#24) | the injected emitter | ⚠️ only if the caller retains it (default no-op drops it) |
| `pairing_evidence` grade | in `review_flags` as `pairing_evidence:*` | ✅ yes (rides the result) |

**Headline gap:** #25C says stage 2 consumes *"the cached stage-1 result plus page
content"* and **never re-crawls** — but today **no page content is retained**. Stage 2
cannot exist until scan persists content. This is the central missing piece.

**Second gap:** scan only *fetches* a **sample** — homepage + the ≤10 stale-verify
pages ([sitemap.ts](src/crawl/sitemap.ts) `crawlSitemaps`). **Overflow ("30+") sites
short-circuit before the sample**, so they retain **only the homepage**. Evidence: in
the fixtures, `itemconstruction`/`labarberie`/`mchenryplumbing` (all 30+) have **1**
page body; non-overflow sites have up to 10.

## 2. Content-retention options (measured on the 8 golden sites)

Per-fetched-page averages, and full-corpus totals across 49 fetched pages:

| Option | What it stores | avg tok/page | corpus total | text ÷ HTML |
|---|---|---|---|---|
| **A. Full HTML** | raw response bodies | **61,623** | ~2.95M tok | 100% |
| **B. Extracted visible text** | `visibleText()` per page | **905** | ~43K tok | **~1%** |
| **C. Text + selected metadata** | text + `<title>`/description/h1–h3 | 905 + 76 | ~45K tok | ~1.1% |

Storage (bytes, corpus): HTML **11.8 MB** · text **173 KB** · meta **14.5 KB**.

**Full HTML is a non-starter for a model payload** — one Wix site (`protectoit`) is
7.5 MB / **1.9M tokens** for a single page (JS/markup, not content). Text extraction
is a ~99% reduction and lands every site in a sane range. Option C adds a rounding
error over B while preserving the signals a human skims first (title, headings).

## 3. Token economics (real golden content, text option unless noted)

| Site shape | Golden proxy | core_pages | Option B (text) | Option A (HTML) |
|---|---|---|---|---|
| ~1-pager / small | `toituresmarcelpouliot` | 4 | **~1.9K tok** | ~21K tok |
| mid (≈dozen) | `mtlplomberie` | 18 (10 fetched) | **~6.5K tok** | ~264K tok |
| blog-heavy | `lasouche` | 12 core + 54 posts | **~15.2K tok** (10 fetched) | ~523K tok |

Notes (no pricing math, counts only): (a) these are the **fetched sample**, not the
full core set — a full-site payload needs content scan doesn't yet retain (§1 gap 2);
(b) blog **posts are excluded from core** (#8), so a blog-heavy site's *assessment*
payload is core-page text, not the 54 posts — the 15.2K here over-counts because the
sample happened to include posts; core-only text is a few K; (c) no true 1-pager
exists in the corpus — the 4-page site is the floor.

## 4. The seam — where `assess(scanId)` attaches

- **Entry point:** a new `src/assess/` module, `assess(scanId) -> assessment`. It runs
  in **stage 2** (#25C), invoked from the future service after email capture — **not**
  from `scan()`. It reads the cached stage-1 record; it does **not** call the crawl.
- **Cache key / handoff:** the Part A cache keys on the **normalized URL** (the
  [normalize()](src/url/normalize.ts) identity — already built) with 24 h TTL; the job
  record holds `{ scan_result, content, event_log }`. Stage 2 looks up by `scanId` →
  the same record.
- **Contract in (proposed by #25C, to confirm):** `assess()` receives the **#8 object
  + retained page content** (Option B/C) — never a live crawl. Output feeds the
  deterministic tier-mapper (#27) which is the price authority; the model only
  *assesses complexity*, per invariant #1.
- **What's missing to build it:**
  1. **Content retention** — scan must persist extracted text per core page (§1 gap 1).
  2. **Full-core fetch decision** — retain only the sample, or fetch all core pages
     (bounded) so the assessment sees the whole site (§1 gap 2). Interacts with the
     25 s budget and #25C's "never re-crawl."
  3. **Persistence layer** — the job/cache record (Postgres per Phase 0 §8) doesn't
     exist yet; today nothing is stored at all.
  4. **`signals_matched` + `pairing_evidence`** would help the model but aren't on the
     result object yet.

## 5. Open decisions (questions only — for the assessment-tour design)

- **Model:** which model runs the assessment, and at what effort? (SPEC #5/#23 picked
  `claude-opus-4-8` for the *fingerprint-era* assessment — does that still hold for the
  full complexity assessment, given the two-stage token economics?)
- **Content option:** A / B / C from §2 — and does the assessment need full-core
  content or is homepage + sample enough for a triage-grade complexity read?
- **Full-core fetch:** does scan retain only its sample, or fetch all core pages
  (bounded) at stage 1 so stage 2 has the whole site without re-crawling (#25C)?
- **Output schema:** what does the model return, and how does it map to #27's
  `component_flags` / needs? Strict JSON like #5? What fields?
- **Tone / constraints:** language (FR/EN per form), what the model may and may not
  say, and the #23 rule that only high-confidence claims reach prospects.
- **Review-flag handling:** how do stage-1 `review_flags` (`bilingual_suspected`,
  `anti_bot`, `partial`, `robots_blocked`, …) gate or shape the assessment? Skip the
  model? Caveat the output?
- **Streaming into #24:** the assessment streams as `assessment_*` events on the spine
  (#24 honesty rule) — which events, which are public, what FR/EN templates?
- **Failure fallback:** model timeout / invalid output / refusal → what does stage 2
  render? (Phase 0 invariant: always return something — the graceful book-a-call.)
- **Greenfield skip:** #27.6 says `no_owned_site`/`parked`/`no_html` skip stage 2
  entirely — confirm the assessment layer is never invoked for those.
- **Caching the assessment:** is the stage-2 result cached (re-quote without re-billing
  the model), and keyed how?

**Recommendation for the tour to weigh (not a decision):** Option **C** (text + title/
headings) — ~1% of HTML, every site in-budget, preserves what a human skims — with an
explicit call on full-core-vs-sample content, since that single choice drives both the
token bill and whether #25C's "never re-crawl" holds.
