# Creavy Quoting Service — Implementation Plan

> Companion to [SPEC.md](SPEC.md). Methodology: Superpowers — **brainstorm → spec →
> plan → TDD** ([CLAUDE.md](CLAUDE.md)). The bug-prone, testable units (URL
> normalization, fingerprinting, sitemap parsing, crawl-bounding, the deterministic
> tier-mapping, graceful failure paths) are built **test-first**.

This plan sequences the whole roadmap. The four founder instruction blocks map to
phases: **Phase 0** (this tour, spec+plan), **Phases 1–2** (build the service),
**Phase 3** (Railway/staging + smoke suite), **Phase 4** (the `creavy-site` `/prix`
island), **Phase 5** (acceptance replay + cutover + Gate E). Phases 3–5 restate the
founder's stated DoDs verbatim.

---

## Phase 0 — Spec & plan (this tour) · NO CODE

- Resolve all 7 open questions with written decisions ([SPEC.md](SPEC.md) §2).
- Formalize tier-mapping + pricing config ([SPEC.md](SPEC.md) §8–9).
- Commit spec + plan.

**DoD:** Spec and plan committed; every open question closed with a written
decision; founder has read and approved the plan.

---

## Phase 1 — Testable core (TDD, in-process, no infra)

Build the pure/testable units first, each red→green→refactor. No network, no DB —
these are the units TDD is built for.

1. **Repo scaffold & tooling** — Node/TS, test runner, lint/format, CI skeleton,
   `.env.example`. Config-driven timers/limits from [SPEC.md](SPEC.md) §4.1/§11.
2. **URL normalize + validate** — scheme/host rules, SSRF guard (reject
   private/loopback/link-local + redirects into them), canonicalization for the
   dedupe key.
3. **robots.txt fetch + parse** — allow/deny evaluation, clear user-agent.
4. **Platform fingerprint adapter** — spike + choose the maintained Wappalyzer-style
   core ([SPEC.md](SPEC.md) §6/#3); vendor + pin the fingerprint DB; adapter
   interface so the lib is swappable.
5. **Sitemap parse + link-crawl bounder** — `/sitemap.xml` → `page_count`; capped
   concurrent link-crawl (`CRAWL_URL_CAP`/`FETCH_TIMEOUT_MS`/`CRAWL_BUDGET_MS`/
   `FETCH_CONCURRENCY`); "mostly empty" detector.
6. **Assessment client + schema validation** — `claude-opus-4-8`, structured
   outputs, retry-once, latency-tuned ([SPEC.md](SPEC.md) §7). Contract-tested
   against a stub before live keys.
7. **Tier-mapping + pricing config module** — pure function, exhaustive table tests
   incl. **ties-round-up** ([SPEC.md](SPEC.md) §8). ⚠️ **Add-on prices are blocked
   on the CHECKLIST** — tier logic + tests land now; add-on price values fill in
   when the doc arrives (structure ships with `TODO(CHECKLIST)`).

**DoD:** All core units green under TDD; tier-mapping table tests cover the §8
precedence and ties-round-up; no live network/DB required to run the suite.

---

## Phase 2 — Service assembly

Wire the units into the running service.

1. **`POST /quote`** — validate → rate-limit → dedupe → persist → **race pipeline
   against `SYNC_HOLD_MS` (8 s)** → `completed` | `pending` ([SPEC.md](SPEC.md) §4).
2. **In-process worker** — continues `pending` quotes to `CRAWL_BUDGET_MS`, then
   assess+price; enforces `QUOTE_DEADLINE_MS` → `failed`.
3. **`GET /quote/:id`** — poll/retrieve; `failed` → graceful book-a-call payload.
4. **Persistence** — Postgres schema ([SPEC.md](SPEC.md) §10), migrations; raw
   `crawl_facts` + `claude_assessment` always written (invariant #2).
5. **Rate limiting + dedupe cache** ([SPEC.md](SPEC.md) §11).
6. **Health endpoint + minimal logging** (no PII beyond the quote row).

**DoD:** End-to-end locally against a test DB — fast path returns `completed <8 s`;
crawl-heavy returns `pending`→`completed`; hostile/invalid → `failed`+book-a-call;
every path persists a row.

---

## Phase 3 — Railway infra + staging (founder block 2)

1. **Railway project:** web service + Postgres. Env: `ANTHROPIC_API_KEY`,
   `DATABASE_URL`, `ALLOWED_ORIGIN` (the Netlify domain), rate-limit config.
2. **Staging environment + seeded staging DB.**
3. **Smoke suite against staging:** the 3 real URLs + 1 hostile + 1 invalid;
   confirm **p95 fast-path < 8 s**; confirm **CORS allows only the site origin**.
4. **Health endpoint + minimal request logging** (no PII beyond the quote row).

**DoD:** Staging URL live and smoke-tested; production service created but **not yet
referenced by the site**.

---

## Phase 4 — `creavy-site` `/prix` island (founder block 3)

> Separate repo (`creavy-site`, Astro/Netlify). Read its `CLAUDE.md`. The five UI
> states are designed in `design/Creavy_-_Outil_de_prix_dc__1_.html` — implement
> them exactly.

- **Five states:** entrée (URL only) → analyse (4 questions asked one at a time
  during the animation; **both edge states** — analysis-done-first and
  answers-done-first) → résultat (flat price, facts line, add-on chips, double CTA,
  reassurance line) → estimation variant (range + badge, call promoted) → échec
  (graceful → the Tour C5 form; demotes to fallback, never dies).
- **Island on `/prix` and `/en/pricing`** calling the staging API (`PUBLIC_QUOTE_API`
  env): `POST /quote {url, answers}` after client-side collection completes; poll
  `GET /quote/:id` while `pending`; render states per canvas.
- Netlify env switches staging→prod at cutover. **Keep the C5 form intact behind the
  échec state.**

**DoD:** Full flow works on staging end-to-end on mobile; all five states reachable
and matching the canvas; **Lighthouse ≥ 95** holds on `/prix`.

---

## Phase 5 — Acceptance replay + cutover (founder block 4)

> The Phase-D tracking sheet holds 20+ manually-priced quotes — the acceptance
> dataset. **Thresholds are hard gates, not aspirations.** This is also where the
> `claude-opus-4-8` model choice is confirmed against real data.

1. **Replay** every logged URL+answers through staging. Score:
   - tier match **≥ 80 %**;
   - **ZERO** quotes below the manual price without a written, explainable reason;
   - **p95 fast-path < 8 s**;
   - hostile/unreachable URLs all land on **échec** gracefully.
2. **On pass:** flip `PUBLIC_QUOTE_API` to production, deploy, verify `/prix` and
   `/en/pricing` live.
3. **Post-cutover monitoring note in the repo:** for 2 weeks, every DB quote is
   reviewed against founder judgment before the 15-min call — the human gate stays
   until the data says otherwise.

**DoD:** Acceptance report committed; cutover done; **`CHECKLIST.md` Gate E closed.**

---

## Cross-cutting risks & dependencies

- **CHECKLIST add-on prices** gate the *final* pricing config (Phase 1 tier logic is
  unblocked; add-on values fill in later). Also `CHECKLIST.md` must exist for Gate E
  (Phase 5) — created/tracked as part of this roadmap.
- **Opus latency vs. the 8 s fast path** — mitigated by thinking-off / low effort /
  small `max_tokens` / structured output ([SPEC.md](SPEC.md) §7); validated by the
  Phase-3 smoke suite and Phase-5 p95 gate. Fallback lever: drop the model to
  `claude-sonnet-5` / `claude-haiku-4-5` (one-line config) if the p95 gate is at risk.
- **Fingerprint lib maintenance** — vendored + pinned DB, adapter-isolated.
- **v1.1 Playwright** — the async contract and `used_browser` column already exist;
  adding the browser path is additive, not a refactor.
```
