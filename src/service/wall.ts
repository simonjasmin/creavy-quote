// The #25-A wall — an explicit pipeline in the RATIFIED ORDER (the order is law). Each
// rejection layer logs its name (#25-A observability). Everything except a fresh crawl is
// resolved here; only `enqueue` hands off to the worker. Injected store/clock/rate-limiter/
// fetch keep it fully testable (W-01…W-10) with zero network and zero Postgres.

import { clientIp, ipRateKey } from "./clientIp.ts";
import { isHoneypotTripped } from "./honeypot.ts";
import { validateQuoteRequest, type ValidRequest, type ValidationError } from "./validate.ts";
import { verifyTurnstile, type FetchLike } from "./turnstile.ts";
import { completeJob } from "./completion.ts";
import { randomId } from "./ids.ts";
import type { ServiceConfig } from "./config.ts";
import type { Store, Job } from "./store/types.ts";
import type { RateLimiter } from "./rateLimiter.ts";
import type { Clock } from "../crawl/types.ts";
import type { ScanResult } from "../crawl/scan.ts";
import type { PricingConfig } from "../pricing/loadPricingConfig.ts";

export type WallLog = (layer: string, detail?: Record<string, unknown>) => void;

export type WallDecision =
  | { kind: "rate_limited"; retryAfterSec: number }
  | { kind: "honeypot"; quoteId: string }
  | { kind: "invalid"; error: ValidationError }
  | { kind: "turnstile_rejected" }
  | { kind: "completed"; job: Job; via: "declared" | "cache_hit" | "email_capture" }
  | { kind: "enqueue"; job: Job; request: ValidRequest; reviewFlags: string[] };

export type WallDeps = {
  config: ServiceConfig;
  pricing: PricingConfig;
  store: Store;
  rateLimiter: RateLimiter;
  clock: Clock;
  fetchImpl?: FetchLike;
  log?: WallLog;
};

export type WallInput = { remoteAddr: string; headers: Record<string, string | undefined>; body: unknown };

const dayStart = (now: number): number => now - (now % 86_400_000);

export async function runWall(input: WallInput, deps: WallDeps): Promise<WallDecision> {
  const { config, pricing, store, rateLimiter, clock } = deps;
  const log = deps.log ?? (() => {});
  const now = clock.now();

  // 1. client IP (trusted-proxy hop only; IPv6 keyed on /64)
  const ip = clientIp(input.remoteAddr, input.headers["x-forwarded-for"], config.trustedProxyHops);
  const key = ipRateKey(ip);

  // 2. rate limit. On a block, log the RESOLVED key + the raw chain so the effective ceiling
  // is diagnosable: if bursts get ~N×MAX through, the source resolved to N keys — either a
  // dual-stack client (v4+v6) or TRUSTED_PROXY_HOPS ≠ the platform's real proxy depth.
  const rl = rateLimiter.check(key, now);
  if (!rl.allowed) {
    log("rate_limit", { key, resolved_ip: ip, xff: input.headers["x-forwarded-for"] ?? null, hops: config.trustedProxyHops });
    return { kind: "rate_limited", retryAfterSec: rl.retryAfterSec };
  }

  // 3. honeypot → silent accept-and-drop (plausible id, no job, no scan)
  if (isHoneypotTripped(input.body)) { const quoteId = randomId(); log("honeypot", { quoteId }); return { kind: "honeypot", quoteId }; }

  // 4. payload validation via normalize() (typed 400; N-22/N-23 route greenfield, zero crawl)
  const v = validateQuoteRequest(input.body);
  if (!v.ok) { log("validation", { detail: v.error.detail }); return { kind: "invalid", error: v.error }; }
  const request = v.request;

  // 5. Turnstile siteverify (config-gated; unreachable → fail open + review flag)
  const reviewFlags: string[] = [];
  if (config.turnstile.enabled && config.turnstile.secret) {
    const token = (input.body as Record<string, unknown> | null)?.turnstile_token as string | undefined;
    const outcome = await verifyTurnstile(token, config.turnstile.secret, ip, deps.fetchImpl);
    if (outcome.verdict === "fail") { log("turnstile", { verdict: "fail" }); return { kind: "turnstile_rejected" }; }
    if (outcome.verdict === "fail_open") { log("turnstile", { verdict: "fail_open" }); reviewFlags.push("turnstile_unreachable"); }
  }

  const isScan = !request.no_site && !!request.normalized_url;
  const newJob = (fresh_scan: boolean) => store.createJob({ id: randomId(), no_site: request.no_site, url: request.url, normalized_url: request.normalized_url, answers_hash: null, answers: request.answers, persona: request.persona, fresh_scan }, now);

  // 6. daily ceiling (scans only) → email-capture mode (not an error)
  if (isScan) {
    const scansToday = await store.countFreshScansSince(dayStart(now));
    if (scansToday >= config.dailyCeilings.scans) {
      log("ceiling", { scansToday, ceiling: config.dailyCeilings.scans });
      const job = await newJob(false);
      const done = await store.updateJob(job.id, {
        status: "completed", reason: "budget_exceeded",
        response: { indicative: true, basis: "scanned", review_required: true, result: { reason_code: "budget_exceeded", currency: "CAD", reasons: ["budget_exceeded"] }, book_a_call: true },
      }, now);
      return { kind: "completed", job: done!, via: "email_capture" };
    }
  }

  // 7. cache lookup (scans only) — hit → reuse the crawl, RE-PRICE for these answers, zero spend
  if (isScan) {
    const cached = await store.findFreshScan(request.normalized_url!, now, config.cacheTtlMs);
    if (cached && cached.crawl_facts) {
      log("cache_hit", { normalized_url: request.normalized_url });
      const job = await newJob(false); // cache hit does NOT count against the scan ceiling
      const scan = { ...(cached.crawl_facts as object), page_content: cached.page_content } as ScanResult;
      const done = await completeJob(store, job.id, { scan, answers: request.answers, no_site: false }, pricing, now);
      return { kind: "completed", job: done, via: "cache_hit" };
    }
  }

  // 8a. declared (no_site) → complete synchronously, no crawl
  if (request.no_site) {
    const job = await newJob(false);
    const done = await completeJob(store, job.id, { scan: null, answers: request.answers, no_site: true }, pricing, now);
    return { kind: "completed", job: done, via: "declared" };
  }

  // 8b. enqueue a fresh crawl (counts against the ceiling)
  const job = await newJob(true);
  return { kind: "enqueue", job, request, reviewFlags };
}
