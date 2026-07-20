# Phase 2a — GATE payload (staging live) → creavy-site Q3 / E2

**Status: CLOSED ✅** — stage-1/1½ service is live on Railway staging, live smoke 5/5 green.
This is the payload for the creavy-site session to begin E2 (staging integration).

## Endpoint

- **Staging base URL:** `https://creavy-quote-production.up.railway.app`
- **`ALLOWED_ORIGIN`:** `https://creavy.netlify.app`
- **CORS (#33):** the production origin above **plus** any `https://<name>--creavy.netlify.app`
  deploy-preview origin, **live** (no mock adapter). Any other origin → no `ACAO` (blocked).
  Verified live: production echoed · `deploy-preview-N--creavy.netlify.app` echoed · `evil.com`
  blocked.
- **Contract:** `contracts/quote-api-contract.md` **v0.5** — site should re-sync its copy
  (only delta from v0.4 is §7 CORS → #33, already implemented in staging).
- **Version sync rule (E2 incident):** a version bump is complete only when the contract file
  is copied into `creavy-site/design/` **and** staging `/health` reports the matching
  `contract_version`. `/health` now returns `contract_version` (single-sourced from the
  contract file at boot) — the site can assert its synced copy matches before wiring.

## Routes (per contract v0.5)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/quote` | create a quote → `{quote_id, status}` (sync-hold ≤ 8 s, else `pending`) |
| `GET` | `/quote/:id` | poll — `pending` \| `completed` \| `failed` (contract §4/§5 shapes) |
| `GET` | `/quote/:id/events?since=N&lang=fr` | #24 public event lines (`{seq, type, text}`) |
| `GET` | `/health` | `{status:"ok", env:"staging", contract_version:"0.5"}` — assert your synced copy matches |

- **Polling:** interval **1500 ms**, terminal states `completed`/`failed`, client ceiling ~35 s
  (contract §6). `429` carries `Retry-After` (seconds).
- **Indicative only:** every response has `indicative: true`; nothing binds (#29.5).

## Live smoke — 5/5 (see `spikes/smoke-2a-live-transcript.md`)

1. **Scanned → completed via poll** (real ICP site) — `basis:scanned`, Standard, `core_pages:4`.
2. **No-site declared** — `basis:declared`, Standard `[bilingual, booking]`, `indicative_total:407000`.
3. **Rate-limit burst** — `429` + `Retry-After: 54s`.
4. **CORS #33** — preview echoed, `evil.com` blocked.
5. **`/health`** — `200 {status:ok, env:staging}`.

## Notes for E2

- Staging posture: **Turnstile OFF**, permissive-but-present ceilings, **real Postgres**. The
  honeypot field is `company_website` (hidden; a filled value → silent accept-and-drop).
- Machine enums only on the wire — the **site owns all FR/EN labels** (the `reason_code`
  enum is optional to render; tolerate unknown codes).
- Rate-limit ceiling is **per resolved client key**; see DEPLOY-2a "Rate-limit keying" — a
  real single-address browser session gets the configured limit (no action needed for E2).

## Not in 2a (still gated)

Stage-2 assessment (Claude), email capture, and the assessment-delivery surface are **2b**,
after the stage-2 treaty with creavy-site. `assess()` stays library-only; **no model call and
no `ANTHROPIC_API_KEY` in this service or its environments**.
