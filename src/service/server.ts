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
import type { ServiceConfig } from "./config.ts";
import type { Store, Job } from "./store/types.ts";
import type { RateLimiter } from "./rateLimiter.ts";
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

  return httpCreateServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const origin = req.headers.origin as string | undefined;
    const cors = corsHeaders(origin, config.allowedOrigin, config.previewOriginPattern);

    try {
      if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }

      // GET /health — includes contract_version so a consumer can detect version skew
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok", env: config.env, contract_version: contractVersion }, cors);

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
