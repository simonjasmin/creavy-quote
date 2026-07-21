# Deploy — Phase 2b stage-2 assessment (Railway staging)

Build-complete and green (379 tests). Contract v0.7 live in the repo; `/health` reports it.
The one **founder step** is the model key — flagged below.

## Founder step: add the assessment model key

Add to **Railway staging** service variables:

- `ANTHROPIC_API_KEY` — a **new key named `creavy-quote-prod`**, with **its own spend limit**
  (independent of the benchmark/record key). Never committed, never logged, never echoed in
  errors.

**Guard change (deliberate):** 2a refused to boot if this key was present (no-model posture).
2b **expects** it — `src/service/config.ts` now reads it into `config.anthropicApiKey`.
Absent → assessments degrade to `unavailable` and **stage 1½ is untouched** (T5); the service
still boots. So the key is *expected* but not *required-to-boot*.

## Deploy

1. Add the variable (above). Redeploy (push already triggers Railway).
2. Migrations run at boot: `migrated 0002_assessments`. `/health` stays green, `contract_version` → `0.7`.
3. **Live smoke** (real streamed prose from a real scanned site):
   ```
   node spikes/smoke-2b-live.mjs https://creavy-quote-production.up.railway.app <real-icp-url>
   ```
   Prints the streamed French prose verbatim, latency, the idempotency proof (2nd POST → same
   assessment id, no second model call), and the ceiling note.

## Already proven locally (no deploy needed)

`node --env-file=.env spikes/smoke-2b-local.mjs` runs the **full flow with the real opus
model** against a real site's captured content (golden) — see the gate report for the first
real assessment. Internal fields never ship; idempotency holds; `content_readiness` drives a
code-mapped suggestion, never a price.

## Posture

- **No email anywhere** (T4): the body is `{content_readiness}` only; any other field or an
  email-shaped value → `400`. PII lives only in Netlify Forms.
- **Assessment ceiling** 50/day (`DAILY_ASSESSMENT_CEILING`) enforced at POST → `409
  budget_exceeded`; page unchanged.
- **Idempotency**: one model call per quote, ever (unique `quote_id` index + service check).
- **Failure = page unchanged**: timeout / invalid / refusal / ceiling / precondition →
  terminal `unavailable`; the price never depends on the model.
