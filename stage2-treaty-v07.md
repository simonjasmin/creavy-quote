# Stage-2 treaty — assessment delivery (contract v0.7 spec)

Founder-ratified 2026-07-20. The second and final cross-repo treaty. Traces to: #25-C (two-stage), #29 (price/assessment split), #32 (assessment design + firewall), #24 (event spine), #35 (registers), E2 completion report (founder observations), ASSESSMENT-RECON.md (token economics), pricing-model-research.md (content-readiness gap).

**Canonical home:** `contracts/quote-api-contract.md` in creavy-quote, bumped to **v0.7**. Site re-syncs and asserts `/health` `contract_version` before wiring, per the completeness rule.

---

## 1. Ratified decisions

**T1 — Same-page progressive reveal.** No new screen, no navigation. After email submit, the assessment streams in **below the price card**, above the CTAs. The price stays visible the entire time — it was earned at stage 1½ and is never replaced, hidden, or re-rendered.

**T2 — Content-readiness question rides along.** One question, shown **with** the email field (not before it): *« Vos textes et photos sont-ils prêts? »* / "Are your text and photos ready?" — `ready | partial | none`. It feeds `suggested_addons` and the founder review note only. **Never a pricing input** (#32 firewall). Closes the research gap where content readiness is a top-four industry input we never asked.

**T3 — The panel graduates.** « Détails de l'analyse » stays exactly as-is until the assessment arrives, then the assessment prose sits below it as the bridge the founder found missing. The decorative HTTPS row (true-only) is dropped once the assessment section renders. The panel is facts; the assessment is meaning.

**T4 — Email does two jobs, one submit.** The same submit that fires the Netlify Forms notify-you capture (E3 decision) also triggers the assessment. One tap, two effects: the founder gets the lead, the prospect gets the analysis. **PII stays in Netlify Forms only** — the quote service receives no email address, which keeps #29.1's zero-PII property and the single-place Loi 25 deletion path intact.

**T5 — The assessment is never a gate on anything.** Failure, timeout, refusal, or a blocking flag → the price, the panel, and both CTAs render exactly as today. The assessment section simply doesn't appear (or shows a one-line "notre équipe prépare votre analyse" when it was attempted and failed). Phase-0 invariant, unchanged.

---

## 2. Flow (both repos, one sequence)

1. Stage 1½ completes → price card + panel + CTAs (unchanged, live today).
2. Prospect taps "Recevoir ma soumission par courriel" → the email field **and** the content-readiness question appear inline.
3. Submit fires **two** parallel things:
   a. Netlify Forms POST (all 16+ hidden fields + `content_readiness`) → founder notification. **Unchanged from E3.**
   b. `POST /quote/:id/assess` to the quote service → `{content_readiness}` only. **No email, ever.**
4. Confirmation renders immediately ("c'est parti — votre soumission s'en vient par courriel"), independent of (b).
5. The assessment section appears below the price and streams prose token-by-token (#24 spine, `assessment_*` events).
6. On completion: prose settles, `suggested_addons` refresh if the content answer added any.

---

## 3. API additions (contract v0.7)

**`POST /quote/:id/assess`**
- Body: `{ content_readiness: "ready"|"partial"|"none" }`. No PII. Idempotent per quote id (repeat → returns the existing assessment; never re-bills the model, per #32 A7).
- Preconditions: quote exists, is `completed`, and `assessable()` is true (#32 A6). Otherwise `409` with a machine reason — the site renders nothing extra and keeps today's page.
- The full #25-A wall applies (rate limit, Turnstile, ceilings, cache). The **assessment daily ceiling** (50/day, ratified) is enforced here; exceeded → `409 budget_exceeded` → page unchanged.
- Response: `202` + `{assessment_id, poll_after_ms}`.

**`GET /quote/:id/assessment`**
- `{status: "pending"|"streaming"|"completed"|"unavailable", prose_chunks[], seq, complexity_factors?: never, suggested_addons?}`.
- **Public projection only** (#24 default-deny): prose and completion state ship. `complexity_factors`, `review_note`, `confidence`, `flagged_for_review` are **internal — never in this response.**
- `unavailable` is a normal terminal state, not an error (T5).

**Event polling** reuses the existing since-`seq` route; `assessment_*` events ride the same spine.

**Unchanged:** every stage-1 shape, both registers, reason codes (append-only), `analysis_details`. v0.7 is purely additive — the site can ship its stage-1 behavior unchanged and layer stage 2 on.

---

## 4. Copy and rendering rules (site-owned, treaty-bound)

- **Section heading** (founder wording, EN mirror must match the promise exactly — bilingual-integrity rule): FR « Notre lecture de votre site » / EN "What we saw on your site".
- Streaming shows the real model output as it generates — **no fabricated thinking, no synthetic delays** (#24 honesty rule). If the prose arrives complete rather than streamed, render it plainly; never fake progress.
- The assessment never contains a price (#32 voice spec: no digits-as-prices). If prose containing digits-as-price ever appears, that's a firewall bug — the site reports it, doesn't patch it.
- `suggested_addons` refreshes render as chips (existing component): **labels from the site's map, amounts from the payload** (#30.3, unchanged).
- The assessment section is absent — not empty, not skeleton — when `unavailable`.

## 5. Sequencing (which repo, which order)

1. **creavy-quote (2b tour):** contract v0.7, the two endpoints, `assess()` wired behind them, ceilings, idempotency, event streaming, production API key in Railway with its own spend limit. Deploy to staging. **Gate: staging smoke showing a real streamed assessment.**
2. **creavy-site:** re-sync v0.7, assert `/health` version, add the inline content question + the streaming section. Deploy-preview verification, then founder phone pass.
3. **E3 cutover** is independent of stage 2 — the site can go live on stage 1½ alone, and stage 2 layers in behind it. **Recommended: launch stage 1½ first**, let real quotes accumulate for the acceptance dataset, add the assessment once the gate is green.

## 6. Deliberately out of scope

Sending the assessment by email (it renders on screen; the founder's hand-reply carries it into the inbox — revisit only after volume justifies automation) · any pricing effect from `content_readiness` · exposing internal assessment fields · a founder review UI (still runbook step 9) · full-core content fetch (#32 Fork 2 resolution stands).

## 6b. Gate ratifications (2b build, founder 2026-07-20)

- **First assessment prose — APPROVED** against the #32 voice spec (evidence-grounded findings,
  calibrated severity, warm pivot, close, no platform claim below high confidence, Québec
  register, in band).
- **FACT-line interpretation — CONFIRMED.** `content_readiness` reaches the model as a single
  trusted FACT line (system prompt / firewall / voice byte-unchanged), so the note + prose
  cohere with the declared answer. **Safe because it is a validated closed enum** (3 constant
  strings; 400 otherwise) — the line cannot carry an injection. **⚠ If this field ever becomes
  free text, this analysis is VOID** — re-validate the firewall (noted at `payload.ts`).
- **Readiness-invariance** pinned (ST2-08): identical `page_content` × {ready,partial,none} →
  identical `complexity` + `complexity_factors`; readiness moves suggestions + the note only.
- **Parked refinement (NOT built):** with the FACT line, the prompt MAY later acknowledge
  declared readiness (« vous avez mentionné… ») to dissolve the praise-vs-suggest-copywriting
  tension. **Voice-spec change → founder gate.** Logged, not built.

## 7. Open item for the 2b tour

The `needs_review` copy nuance from E2: when review fired on `robots_blocked`/`partial`, « On a bien lu votre site » overclaims. With v0.7, the assessment is exactly the mechanism to say the true thing per cause. Handle it as copy variants keyed on the *register* and the public-safe reason code — not by exposing internal flags.
