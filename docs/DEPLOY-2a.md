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
2. **Set service variables** (from `.env.example`) — staging posture:
   - `ALLOWED_ORIGIN=https://<the-netlify-production-origin>`  ← **the value the site's Q3 needs**
   - `NODE_ENV=staging`
   - `TURNSTILE_ENABLED=false`  (staging starts disabled; production flips it on)
   - leave the tunables at defaults (permissive-but-present ceilings)
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
- [ ] Confirm `TRUSTED_PROXY_HOPS` matches the real proxy chain in front of the service.
- [ ] Production `ALLOWED_ORIGIN` (final Netlify domain).
- [ ] Bump `contracts/quote-api-contract.md` §7 to reflect **#33** (the contract still shows
      the superseded #30.4 "production-origin-only" preview line — code follows #33; the
      contract prose lags). *(Flagged during 2a; a v0.5 doc bump.)*
- [ ] Render-graduation trigger from Phase 0 stays recorded (single-instance is the MVP posture).
