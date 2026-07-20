# Deploy — Phase 2a stage-1/1½ service (Railway staging)

The service is **build-complete and green** (353 tests). This environment has **no Railway
CLI / token and no `DATABASE_URL`**, so the actual staging deploy + the live-URL smoke are a
**founder step**. Everything needed to do it is here.

## What deploys

- `Dockerfile` — `node:24-alpine`, `npm install --omit=dev` (only `pg`, #34), `npm start`.
- `railway.json` — Dockerfile builder, `healthcheckPath: /health`, 1 replica.
- `src/service/index.ts` — boot: load config (hard-fail) → run migrations → start server.
- `src/service/migrations/0001_quotes.sql` — the schema (Phase 0 §8 reconciled).

## Deploy steps (founder)

1. **Create the Railway project + Postgres plugin** (staging environment). Railway injects
   `DATABASE_URL`.
2. **Set service variables.** `NODE_ENV=staging` is **already baked into the Dockerfile** —
   you only set these two required vars (the loader **refuses to boot** without either, #22):
   - `ALLOWED_ORIGIN=https://<the-netlify-production-origin>`  ← **the value the site's Q3 needs**
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`  ← reference the Railway Postgres plugin (its
     **internal** URL needs no SSL config). **Required on staging** — the service will not
     silently run in-memory.
   Optional (defaults are fine for staging):
   - `TURNSTILE_ENABLED=false`  (staging starts disabled; production flips it on)
   - the tunables (permissive-but-present ceilings)
   - **do NOT set `ANTHROPIC_API_KEY`** — the loader refuses to boot if it's present (#34).
3. **Deploy.** The Dockerfile build runs; on boot `index.ts` applies migrations
   (`migrated 0001_quotes`) then listens. `/health` turns green.
4. **Capture the live smoke** against the real URL (mirror `spikes/smoke-2a.mjs`, but with a
   real ICP URL and the live `HttpTransport`):
   - a scanned quote to completion via poll (real ICP URL)
   - a no-site declared quote
   - a 429 from a rate-limit burst
   - a rejected CORS origin
   - `/health`
5. **Relay to the gate:** staging base URL + resolved `ALLOWED_ORIGIN` + the transcript →
   creavy-site session for E2 (staging integration).

## Local pre-deploy checks (no network needed)

```
npm test                     # 353 green
node spikes/smoke-2a.mjs     # real HTTP server on localhost (MemoryStore + golden transport)
```

`spikes/smoke-2a-transcript.md` is the captured local transcript (all five behaviours).

## Production cutover checklist (NOT this tour — the cutover tour)

- [ ] `TURNSTILE_ENABLED=true` + real `TURNSTILE_SECRET` (production requires it).
- [ ] Tune `DAILY_SCAN_CEILING` / `DAILY_ASSESSMENT_CEILING` to real capacity.
- [ ] `NODE_ENV=production` (makes `DATABASE_URL` mandatory; enforces the no-key guard).
- [ ] Confirm `TRUSTED_PROXY_HOPS` matches the real proxy chain in front of the service (see
      "Rate-limit keying" below).
- [ ] Production `ALLOWED_ORIGIN` (final Netlify domain).
- [x] ~~Bump contract §7 to #33~~ — **done in v0.5** (`f14298f`). Site re-syncs its copy.
- [ ] Render-graduation trigger from Phase 0 stays recorded (single-instance is the MVP posture).

## Rate-limit keying (TRUSTED_PROXY_HOPS)

The limiter is a sliding window of `RATE_LIMIT_MAX` requests **per resolved client key**, per
`RATE_LIMIT_WINDOW_MS` (default 10 / 60 s). It is exact and pinned by tests **RL-01…RL-03**.

The *effective* ceiling depends on the **resolved key** being the true client. In the staging
live smoke, a burst got **20 through before a 429** (429 at burst #19 + 2 prior POSTs = 21st
blocked) — i.e. **2×10**. That means the burst source resolved to **two keys**, one of:

1. a **dual-stack client** sending some requests over IPv4 and some over IPv6 (each is a
   distinct key; a real single-address browser session uses one), or
2. **`TRUSTED_PROXY_HOPS` ≠ Railway's real proxy depth**, so the key lands on a rotating
   Railway edge/proxy IP instead of the client.

**To diagnose:** each `429` now logs `{ key, resolved_ip, xff, hops }`. Read a few 429 lines
from the Railway logs during a burst:
- If `resolved_ip` alternates between an **IPv4 and an IPv6** for the same source → it's
  dual-stack (harness artifact; real clients are single-address — nothing to fix).
- If `resolved_ip` is a **Railway/proxy address** (not your client IP), or `xff` has more
  entries than `hops` accounts for → set `TRUSTED_PROXY_HOPS` to `xff_entries` so the key
  becomes the leftmost (true client) entry. It's a config var — no redeploy of code needed.

Either way the limiter itself is correct; this only tunes *what counts as one client*.
