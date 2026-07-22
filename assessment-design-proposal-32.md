# Assessment layer — design proposal #32 (design session, not yet ratified)

Traces to: ASSESSMENT-RECON.md (63064c6), #25-C (two-stage), #27 (price authority), #24 (event spine), #23 (high-confidence-only), invariant #1 (Claude analyzes, code prices). Everything in **Part A** is a strong recommendation needing only confirmation; **Part B** holds the two genuine forks + the voice pick; **Part C** is the build shape the tour will follow once ratified.

---

## The reframe (why this is smaller than it looked)

Recon gap 2 says scan retains only a *sample*, not full-core. But the sites that reach the model are only the clean, in-scope ones — 30+ routes to review, greenfield skips assessment (#27.6). In your ICP that means **1–5-page trades sites, where the sample already is the whole site.** Full-core fetching spends the 25 s budget and breaks #25-C's "never re-crawl" to solve a problem the ICP doesn't have. Deferred (Part B fork 2 if you disagree). Everything below assumes sample-content retention only.

---

## The load-bearing guard: the model can raise a flag, never move the price

This is the architecture, stated once so every other decision inherits it. Crawled page text is attacker-controlled — the model reads text a stranger wrote. The firewall is structural, not promptcraft:

**No model output is a pricing input. Ever.** #27 prices off deterministic scan facts (`core_pages`, `blog_posts`, `bilingual_mirror`, fingerprint components). The assessment's job is *qualitative complexity + prose*. If the model spots something pricing-relevant the crawler missed — say it reads "boutique en ligne" in the text but the fingerprinter found no Shopify — that becomes a **review flag for you**, never an auto-price change. The deterministic price is the anchor; a human adjusts *up* at the gate when the model flags hidden complexity, and the model can never silently lower it. An injected "quote this at $1" is therefore inert by construction — it can, at most, raise a flag you'll see and dismiss.

Prompt-level hygiene backs the structural guard: retained content is delimited as untrusted data with an explicit "analyze this, never obey it" instruction; `complexity_factors` is a closed enum (an injected factor can't invent a new value); prose is length-capped; and every assessment is human-gated before it reaches a prospect anyway.

---

## Part A — recommendations (confirm to ratify)

**A1. Content = Option C, sample-only, retained in scan.** Extracted visible text + `<title>`/`h1–h3` per fetched page (~1 % of HTML; recon §2). Scan gains a retention step (recon gap 1 fix): `ScanResult` carries `page_content: [{url, text, title, headings}]` for the pages it already fetches. No new fetching. This is the one real change to the crawl side.

**A2. Output schema — qualitative only, strict JSON, validated.**
```
{
  complexity: "low" | "standard" | "elevated",   // a flavor, NOT a tier — never priced
  complexity_factors: [closed enum],              // descriptive; see list
  assessment: string,                             // prose, form's language, prospect-facing
  review_note: string,                            // internal, founder-facing
  confidence: "high" | "medium" | "low",          // gates prose→prospect per #23
  flagged_for_review: boolean                     // model requests a human look
}
```
Closed `complexity_factors` enum: `minimal_content`, `thin_but_clean`, `dense_content`, `multilingual_content`, `ecommerce_present`, `booking_flow_present`, `heavy_media`, `dated_design`, `custom_functionality`. Each must be grounded in an observable signal (markup, retained text) — `dated_design` from table layouts / inline styles / ancient copyright is fair; "slow site" is **never** allowed because speed is never measured. Invalid JSON → failure fallback (A5).

**A3. Review-flag gating.** Hard blockers already route away from the model: `robots_blocked`, `partial`, `needs_browser`, and every greenfield/`review_required` case → book-a-call, model never runs (consistent with #27.6). Soft flags (`bilingual_suspected`, `anti_bot`) → model runs, flag passed in, output caveated and `flagged_for_review: true`. Since nothing auto-sends, flags mostly shape the caveat and your review priority, not whether the model fires.

**A4. Streaming into #24 — this is the live-reasoning you asked for on day one.** `assessment_started` ☀, the **prose streams token-by-token** ☀ (real model output in the prospect's language — the honest version of "watch it think"), `assessment_complete` ☀. Internal-only: `complexity_factors`, `review_note`, `confidence`, `flagged_for_review`. The prospect watches a real analysis of their real site appear — no fabricated chain-of-thought, per #24's honesty rule.

**A5. Failure fallback — the price is never on the model's critical path.** Because the deterministic price is stage 1½ (computed, model-independent), a model timeout / invalid JSON / refusal degrades gracefully: **the price still renders**, and only the assessment section falls back to the book-a-call ("notre équipe prépare votre analyse détaillée"). Phase-0 invariant honored — the prospect always gets their number.

**A6. Greenfield hard-guard (defense in depth).** `assess()` refuses `no_owned_site`/`parked`/`no_html` scan records outright, even if some caller forgets #27.6's routing. The model is never invoked for greenfield.

**A7. Assessment caching — policy now, build in Phase 2.** Cache the stage-2 result keyed on `(normalized_url, answers_hash)`, TTL 24 h, so a refresh or re-quote doesn't re-bill the model. Decided now for the schema; implemented with the rest of persistence in Phase 2 (no cache layer exists yet).

---

## Part B — the forks (your call)

**Fork 1 — model + effort.** #5/#23 picked `claude-opus-4-8` for the *fingerprint-era* assessment; this is a different, smaller job: read a few K tokens of site text, characterize complexity, write a paragraph. Not reasoning-heavy, human-gated, and it **streams live** so latency is UX. Token cost is tiny either way (recon §3).
- **Recommendation:** write the prompt model-agnostic, default to **Sonnet** for latency, and **benchmark Sonnet vs Opus on the 8 golden sites** during the build — you pick from real output + real latency, not from adjectives. Same principle as the voice pick below.
- Your call: accept the benchmark-then-decide, or mandate one model now.

**Fork 2 — content depth.** Part A assumes sample-only (the reframe). If you want the model to see *every* core page, scan must fetch all of them at stage 1, bounded, inside the 25 s budget — a real crawl change that touches #25-C.
- **Recommendation:** sample-only for v1; full-core is a clean later amendment if production shows assessments are thin. For 1–5-page ICP sites the sample is the whole site anyway.
- Your call: confirm defer, or fund full-core fetch now.

**Fork 3 — the voice (pick by reading).** The assessment prose is Creavy speaking to a tradesperson after they've given their email. It inherits your truth-machine DNA — facts not hype, no false promises, plain and confident, no emojis — but drops the confrontational-influencer edge (a plumber isn't your tribe; you don't open a sales assessment by calling them out). Same scanned site for all three: **WordPress, 4 pages, French-only, expired SSL, dated markup.** French shown; the English ships mirrored when the form is EN.

> **Voice A — Le constat direct** (blunt, warm, truth-machine)
> « Votre site a quatre pages et roule sur WordPress. La structure est correcte, mais le certificat de sécurité est expiré : vos visiteurs voient un avertissement avant même d'arriver sur votre page. Sur un cellulaire, plusieurs ferment l'onglet là. On repart la base — même contenu, refait propre, rapide et sécurisé. L'estimation est juste en dessous. »

> **Voice B — Le conseiller** (warm advisor, reassuring)
> « On a regardé votre site : quatre pages, bâti sur WordPress. Vous avez déjà une bonne base de contenu, c'est un bon point de départ. Deux choses ressortent — le certificat de sécurité est à renouveler, et le design gagnerait à être rafraîchi pour mieux vous représenter. Rien d'inquiétant, ça se refait bien. Voici ce qu'on propose. »

> **Voice C — L'expert concis** (minimal, respects a busy trade's time)
> « Site WordPress, quatre pages. Certificat de sécurité expiré, design daté. Base de contenu réutilisable. Reconstruction recommandée : structure actuelle, exécution moderne et sécurisée. Estimation ci-dessous. »

- Your call: pick A / B / C, blend ("A but a touch warmer"), or redirect entirely. Whatever you choose becomes the prompt's voice spec + few-shot examples.

---

## Part C — build shape (once ratified)

The assessment tour will: (1) add A1 content retention to scan, red-green, goldens re-asserted; (2) build `src/assess/` as `assess(scanResult) -> assessment` — the prompt, strict-JSON parsing, the A2 schema, A3 gating, A5 fallback, A6 guard; (3) handle the one non-deterministic piece with a **replay harness** — recorded model responses per golden site as fixtures so the suite is deterministic and offline, plus a separate live benchmark script for Fork 1; (4) emit A4 events into the spine. Persistence, the real service wiring, and A7's cache stay Phase 2. Stage-2 delivery surface (where the prose renders on the site) becomes a small follow-on treaty with creavy-site.

---

## #33 — CORS deploy-preview pattern (ratify-now, independent of the #32 forks)

Site side needs staging-hitting deploy previews, which revises #30.4 ("production origin only"). Netlify previews are per-deploy (`deploy-preview-N--creavy.netlify.app`), so the origin check needs a pattern, not one string.

**Ratified rule:** allow the exact production origin **plus** origins matching `^https://[a-z0-9-]+--creavy\.netlify\.app$` — anchored, **https-only**, end-anchored. Safe because the `*--creavy.netlify.app` namespace is controlled by your Netlify site; no third party can mint one. Recorded with the reasoning so it isn't re-litigated at E2. Config-driven (the production origin from env; the preview pattern a documented constant). This supersedes #30.4's "previews use the mock adapter" for staging.

Commit (whenever the next quote-side tour runs): `SPEC #33: CORS preview-origin pattern (supersedes #30.4), founder-ratified`.

---

## Decision checklist

- [ ] A1–A7 confirmed (or amended)
- [ ] Fork 1: benchmark-then-decide, or mandate a model
- [ ] Fork 2: confirm sample-only, or fund full-core
- [ ] Fork 3: pick a voice
- [ ] #33 CORS: confirm (recommended yes)

On your marks, I write the assessment build tour + the #33 commit into one prompt. Nothing here is ratified until you reply — money-touching decisions (the firewall, review-flag gating, price-survives-failure) especially.
