# Tables B/C/D tour — report

> Crawl-side modules (robots, sitemap, bounder, scheduler), `scan()` composition,
> golden scans, and SPEC #24 (event spine). All test-first against the edge-case
> inventory. **205/205 tests green.** Hold before the assessment-schema + tier tour.

## Coverage — every case ID → ≥1 test, all green

| Table | Cases | Module | Test |
|-------|-------|--------|------|
| B robots | R-01…R-20 | [src/crawl/robots.ts](src/crawl/robots.ts) | [crawl.robots.test.ts](test/crawl.robots.test.ts) |
| C sitemap | S-01…S-24 | [src/crawl/sitemap.ts](src/crawl/sitemap.ts) + [bilingual.ts](src/crawl/bilingual.ts) | [crawl.sitemap.test.ts](test/crawl.sitemap.test.ts) |
| D1 canonical | D-01…D-08 | [src/crawl/canonical.ts](src/crawl/canonical.ts) | [crawl.canonical.test.ts](test/crawl.canonical.test.ts) |
| D2/D3/D4 bounder | D-09…D-33 | [src/crawl/bounder.ts](src/crawl/bounder.ts) | [crawl.bounder.test.ts](test/crawl.bounder.test.ts) |
| D-34 scheduler | D-34 | [src/crawl/scheduler.ts](src/crawl/scheduler.ts) | [crawl.scheduler.test.ts](test/crawl.scheduler.test.ts) |
| scan() | composition | [src/crawl/scan.ts](src/crawl/scan.ts) | [crawl.scan.test.ts](test/crawl.scan.test.ts) |
| #24 events | spine + projection | [events.ts](src/crawl/events.ts) + [eventProjection.ts](src/crawl/eventProjection.ts) | [crawl.events.test.ts](test/crawl.events.test.ts) |

## Architecture (§0) — all in place

- **Injectable transport** ([types.ts](src/crawl/types.ts) `Transport`); tests replay
  fixtures through `FakeTransport` ([test/helpers/replay.ts](test/helpers/replay.ts)).
  **Zero network in tests.** Production transport: [httpTransport.ts](src/crawl/httpTransport.ts).
- **Injectable clock**; the 25 s budget, 300 ms spacing, 8 s timeout, and D-34's
  in-flight invariant are all proven under `FakeClock`.
- **No Playwright.** `needs_browser` + reasons are an *output* of the fast path; no
  browser dependency introduced.
- **Injectable event emitter** (#24), same discipline; default no-op.

## Golden scans — 8 real full-crawl sites (deterministic replay + verified invariants)

`fixtures/golden/*` captured by [spikes/harvest-golden.mjs](spikes/harvest-golden.mjs)
(polite, Set-Cookie stripped, Mapbox tokens redacted). Categories:
**blog-heavy** WordPress (`lasouche`, 54 posts), **sitemap-less** link-crawl
(`paysagesgenest`), multi-page WordPress (`itemconstruction`, `pierrehamelin`), Wix
(`protectoit`), Duda (`mchenryplumbing`), custom/static (`toituresmarcelpouliot`),
bilingual (`labarberie` — see thread 5). Platform + `needs_browser` independently
verified against the fingerprint corpus labels.

**Two golden gaps, reported not faked:** no real ICP site yielded a clean
explicit-`/fr//en/` bilingual (all use fr-root+`/en/` → thread 5) or a true
one-pager (trades sites are multi-page). Those behaviours are proven instead by the
**synthetic** bilingual scan (`bilingual_mirror:true`, moat line fires) and the
**D-09** one-pager unit test.

## Diagnosis-with-evidence (rider-c standing rule)

No ground-truth relabels were needed. One **test-fixture bug** was caught and fixed
with evidence: the scan happy-path scenario's `ok(locs)` spread overwrote the
WordPress homepage entry (since `locs` included `/`), so `scan` fetched `"ok"` and
returned `platform:custom`. Evidence (`DBG` trace: fp-body len 2, no `wp-content`)
proved the fixture — not the code — was wrong; reordered the scenario. Code was not
tuned to a bad label.

## New §14 threads

- **Thread 5 — bilingual implicit-FR-root (⚠️ MONEY-touching, OPEN).** Per the tour's
  §4 rule, **not auto-fixed** — needs a founder decision. Evidence + recommendation
  in SPEC §14.
- **Thread 6 — scan() not yet on PoliteScheduler (crawl-mechanical, conservative).**
  Sequential single-host fetching is polite; scheduler wiring is Phase 2.
- **Thread 7 — soft-404 not wired into scan (crawl-mechanical, conservative).**
  Under-excluding over-counts core → higher tier → never underprices.

## #24 — live scan narration

One append-only, seq-ordered event spine, three readers (prospect/founder/telemetry),
default-deny public projection with FR/EN templates as data/config. The **moat line**
(`bilingual_paired` → "Versions française et anglaise détectées — comptées comme un
seul site bilingue") is asserted on the synthetic bilingual scan. Fire-and-forget
proven (a throwing consumer can't break a scan). No persistence/endpoint/SSE this
tour (Phase 2). SPEC §2.3.

**Out of scope (held):** assessment schema · tier mapping · Playwright · API/service
assembly · queue/worker parallelism · Creavy-site repo.
