// The HTTP surface — node:http, a hand-rolled router, JSON only. Three routes + /health.
// CORS per #33 on every response. POST runs the wall then (for a fresh scan) the worker
// with a sync-hold race (#1): completed if fast, else pending + background continuation.
// No framework, no dependency (#34).

import { createServer as httpCreateServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { corsHeaders } from "./cors.ts";
import { readContractVersion } from "./contractVersion.ts";
import { runWall, type WallDeps } from "./wall.ts";
import { processJob, type WorkerDeps } from "./worker.ts";
import { projectPublic, type Lang } from "../crawl/eventProjection.ts";
import { clientIp, ipRateKey } from "./clientIp.ts";
import { isHoneypotTripped } from "./honeypot.ts";
import { verifyTurnstile } from "./turnstile.ts";
import { validateAssessBody } from "./assessment/validate.ts";
import { startAssessment, projectAssessment, type AssessmentDeps } from "./assessment/service.ts";
import { soumissionValidUntil } from "./soumissionDates.ts";
import { assessmentId } from "./ids.ts";
import type { AssessmentModel } from "../assess/model.ts";
import type { ServiceConfig } from "./config.ts";
import type { Store, Job } from "./store/types.ts";
import { RateLimiter } from "./rateLimiter.ts";
import type { Transport, Clock } from "../crawl/types.ts";
import type { PricingConfig } from "../pricing/loadPricingConfig.ts";
import type { FetchLike } from "./turnstile.ts";

export type ServerDeps = {
  config: ServiceConfig;
  pricing: PricingConfig;
  store: Store;
  rateLimiter: RateLimiter;
  transport: Transport; // crawl transport (HttpTransport in prod, Fake in tests/smoke)
  clock: Clock;
  fetchImpl?: FetchLike; // Turnstile fetch (injectable)
  syncHoldMs?: number; // #1 (default 8000)
  contractVersion?: string; // sourced at boot from the contract file; defaults to reading it
  assessmentModel?: AssessmentModel | null; // 2b: injected (null → assessments unavailable, T5)
  assessmentModelId?: string | null;
  assessLang?: "fr" | "en"; // prospect prose language (default fr)
  log?: (layer: string, detail?: Record<string, unknown>) => void;
};

const MAX_BODY = 64 * 1024;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<{ ok: true; body: unknown } | { ok: false }> {
  return new Promise((resolve) => {
    let raw = "", tooBig = false;
    req.on("data", (c) => { raw += c; if (raw.length > MAX_BODY) { tooBig = true; req.destroy(); } });
    req.on("end", () => {
      if (tooBig) return resolve({ ok: false });
      if (!raw.trim()) return resolve({ ok: true, body: {} });
      try { resolve({ ok: true, body: JSON.parse(raw) }); } catch { resolve({ ok: false }); }
    });
    req.on("error", () => resolve({ ok: false }));
  });
}

// The POST/GET body a client sees, from a persisted job.
function jobToBody(job: Job): Record<string, unknown> {
  if (job.status === "pending") return { quote_id: job.id, status: "pending" };
  return { quote_id: job.id, status: job.status, ...(job.response as object ?? {}) };
}

export function createServer(deps: ServerDeps): Server {
  const { config, store } = deps;
  const syncHoldMs = deps.syncHoldMs ?? 8000;
  const contractVersion = deps.contractVersion ?? readContractVersion(); // single source: the contract file
  const wallDeps: WallDeps = { config, pricing: deps.pricing, store, rateLimiter: deps.rateLimiter, clock: deps.clock, fetchImpl: deps.fetchImpl, log: deps.log };
  const workerDeps: WorkerDeps = { store, transport: deps.transport, clock: deps.clock, pricing: deps.pricing };
  const assessDeps: AssessmentDeps = { store, model: deps.assessmentModel ?? null, modelId: deps.assessmentModelId ?? null, clock: deps.clock, serviceConfig: config, pricing: deps.pricing, lang: deps.assessLang ?? "fr" };
  const getRateLimiter = new RateLimiter(config.getRateLimit.windowMs, config.getRateLimit.maxPerWindow); // ENG-04 Ruling 1 — all public GETs
  const log = deps.log ?? (() => {});
  const iso = (ms: number) => new Date(ms).toISOString();

  return httpCreateServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const origin = req.headers.origin as string | undefined;
    const cors = corsHeaders(origin, config.allowedOrigin, config.previewOriginPattern);

    try {
      if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }

      // GET /health — includes contract_version so a consumer can detect version skew
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok", env: config.env, contract_version: contractVersion }, cors);

      // ENG-04 Ruling 1 — EVERY other public GET is rate-limited (id enumeration + polling abuse).
      // /health is exempt (uptime probes). Budget clears the island's 700 ms polling worst case.
      if (req.method === "GET") {
        const ip = clientIp(req.socket.remoteAddress ?? "", req.headers["x-forwarded-for"] as string | undefined, config.trustedProxyHops);
        const rl = getRateLimiter.check(ipRateKey(ip), deps.clock.now());
        if (!rl.allowed) { log("get_rate_limit", { key: ipRateKey(ip) }); return send(res, 429, { error: "rate_limited" }, { ...cors, "retry-after": String(rl.retryAfterSec) }); }
      }

      // GET /soumission/:quote_id — ENG-04. Renders the STORED quote VERBATIM (never re-price) as
      // a shareable soumission: the flat/estimation projection + addressee (normalized_url) + the
      // completed assessment prose INLINE + server-computed prepared_at/valid_until. Zero-PII (T4:
      // no name/email/phone). 404 not_found · 409 not_completed/no_price · 410 expired.
      const mSoum = url.pathname.match(/^\/soumission\/([^/]+)$/);
      if (req.method === "GET" && mSoum) {
        const job = await store.getJob(mSoum[1]);
        if (!job) return send(res, 404, { error: "not_found" }, cors);
        if (job.status !== "completed") return send(res, 409, { error: "not_completed" }, cors);
        const stored = (job.response ?? {}) as any;
        if (stored.register !== "flat" && stored.register !== "estimation") return send(res, 409, { error: "no_price" }, cors); // review → the call is the path
        const preparedMs = job.created_at;
        const validUntilMs = soumissionValidUntil(preparedMs, config.soumissionValidityDays); // ENG-05 — end of day Montreal, DST-aware
        if (deps.clock.now() > validUntilMs) return send(res, 410, { error: "expired", reason: "soumission_expired", prepared_at: iso(preparedMs), valid_until: iso(validUntilMs) }, cors);
        const a = await store.getAssessmentByQuote(job.id); // INLINE prose when completed — one fetch renders the page
        const soumission: Record<string, unknown> = {
          quote_id: job.id, soumission: true,
          normalized_url: job.normalized_url, // addressee — a website URL, never PII
          prepared_at: iso(preparedMs), valid_until: iso(validUntilMs),
          indicative: stored.indicative, basis: stored.basis, register: stored.register,
          result: stored.result, // VERBATIM: base/additions/indicative_total/payment_terms/care_plan_monthly/bundle/…
        };
        if (a && a.status === "completed") soumission.assessment = { prose_chunks: a.prose_chunks, suggested_addons: a.suggested_addons }; // public fields ONLY
        return send(res, 200, soumission, cors);
      }

      // POST /quote
      if (req.method === "POST" && url.pathname === "/quote") {
        const parsed = await readBody(req);
        if (!parsed.ok) return send(res, 400, { error: "invalid_request", detail: "body must be JSON ≤ 64KB" }, cors);
        const decision = await runWall({ remoteAddr: req.socket.remoteAddress ?? "", headers: req.headers as Record<string, string | undefined>, body: parsed.body }, wallDeps);

        switch (decision.kind) {
          case "rate_limited": return send(res, 429, { error: "rate_limited" }, { ...cors, "retry-after": String(decision.retryAfterSec) });
          case "invalid": return send(res, 400, decision.error, cors);
          case "turnstile_rejected": return send(res, 403, { error: "forbidden" }, cors);
          case "honeypot": return send(res, 200, { quote_id: decision.quoteId, status: "pending" }, cors); // plausible; no job
          case "completed": return send(res, 200, jobToBody(decision.job), cors);
          case "enqueue": {
            const run = processJob(workerDeps, decision.job.id, decision.request, decision.reviewFlags).catch(() => {});
            await Promise.race([run, new Promise((r) => setTimeout(r, syncHoldMs))]); // sync-hold (#1)
            const job = await store.getJob(decision.job.id);
            return send(res, 200, job ? jobToBody(job) : { quote_id: decision.job.id, status: "pending" }, cors);
          }
        }
      }

      // POST /quote/:id/assess — the #25-A wall (rate/honeypot/PII-validate/turnstile), then
      // startAssessment (preconditions/409, assessment ceiling, idempotency). Returns 202.
      const mAssess = url.pathname.match(/^\/quote\/([^/]+)\/assess$/);
      if (req.method === "POST" && mAssess) {
        const quoteId = mAssess[1];
        const parsed = await readBody(req);
        if (!parsed.ok) return send(res, 400, { error: "invalid_request", detail: "body must be JSON ≤ 64KB" }, cors);
        const ip = clientIp(req.socket.remoteAddress ?? "", req.headers["x-forwarded-for"] as string | undefined, config.trustedProxyHops);
        const rl = deps.rateLimiter.check(ipRateKey(ip), deps.clock.now());
        if (!rl.allowed) { log("rate_limit", { key: ipRateKey(ip) }); return send(res, 429, { error: "rate_limited" }, { ...cors, "retry-after": String(rl.retryAfterSec) }); }
        if (isHoneypotTripped(parsed.body)) { log("honeypot", {}); return send(res, 202, { assessment_id: assessmentId(), poll_after_ms: 1500 }, cors); } // plausible; no work
        const v = validateAssessBody(parsed.body);
        if (!v.ok) { log("assess_validation", { detail: v.error.detail }); return send(res, 400, v.error, cors); }
        if (config.turnstile.enabled && config.turnstile.secret) {
          const outcome = await verifyTurnstile((parsed.body as any)?.turnstile_token, config.turnstile.secret, ip, deps.fetchImpl);
          if (outcome.verdict === "fail") return send(res, 403, { error: "forbidden" }, cors);
        }
        const r = await startAssessment(assessDeps, quoteId, v.content_readiness);
        switch (r.kind) {
          case "not_found": return send(res, 404, { error: "quote_not_found" }, cors);
          case "precondition": return send(res, 409, { error: r.reason }, cors);
          case "ceiling": { log("assess_ceiling", {}); return send(res, 409, { error: r.reason }, cors); }
          case "existing":
          case "started": return send(res, 202, { assessment_id: r.assessment.id, poll_after_ms: 1500 }, cors);
        }
      }

      // GET /quote/:id/assessment — public projection ONLY (internal fields never here)
      const mAsmt = url.pathname.match(/^\/quote\/([^/]+)\/assessment$/);
      if (req.method === "GET" && mAsmt) {
        const a = await store.getAssessmentByQuote(mAsmt[1]);
        if (!a) return send(res, 404, { error: "not_found" }, cors);
        const raw = await store.getEventsSince(mAsmt[1], -1);
        const seq = raw.length ? raw[raw.length - 1].seq : -1;
        return send(res, 200, { ...projectAssessment(a), seq }, cors);
      }

      // GET /quote/:id  and  GET /quote/:id/events
      const m = url.pathname.match(/^\/quote\/([^/]+)(\/events)?$/);
      if (req.method === "GET" && m) {
        const id = m[1];
        const job = await store.getJob(id);
        if (!job) return send(res, 404, { error: "not_found" }, cors);
        if (m[2]) {
          const since = Number(url.searchParams.get("since") ?? "-1");
          const lang: Lang = url.searchParams.get("lang") === "en" ? "en" : "fr";
          const raw = await store.getEventsSince(id, Number.isFinite(since) ? since : -1);
          const events: { seq: number; type: string; text: string }[] = [];
          for (const ev of raw) { const p = projectPublic(ev, lang); if (p) events.push({ seq: ev.seq, type: p.type, text: p.text }); }
          const last_seq = raw.length ? raw[raw.length - 1].seq : since;
          return send(res, 200, { quote_id: id, events, last_seq, status: job.status }, cors);
        }
        return send(res, 200, jobToBody(job), cors);
      }

      return send(res, 404, { error: "not_found" }, cors);
    } catch (e) {
      console.error("handler error", (e as Error)?.message);
      return send(res, 500, { error: "internal" }, cors);
    }
  });
}
