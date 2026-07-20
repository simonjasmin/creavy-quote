import { test } from "node:test";
import assert from "node:assert/strict";
import { runWall } from "../src/service/wall.ts";
import { loadServiceConfig } from "../src/service/config.ts";
import { MemoryStore } from "../src/service/store/memoryStore.ts";
import { RateLimiter } from "../src/service/rateLimiter.ts";
import { HONEYPOT_FIELD } from "../src/service/honeypot.ts";
import { pricingConfig } from "../src/pricing/index.ts";
import { normalize } from "../src/url/normalize.ts";
import { FakeClock } from "./helpers/replay.ts";

const ORIGIN = "https://creavy.netlify.app";
const T0 = 1_700_000_000_000;

function mkDeps(envOver: Record<string, string> = {}, fetchImpl?: any) {
  const clock = new FakeClock(T0);
  const store = new MemoryStore();
  const config = loadServiceConfig({ ALLOWED_ORIGIN: ORIGIN, NODE_ENV: "staging", RATE_LIMIT_MAX: "5", ...envOver });
  const rateLimiter = new RateLimiter(config.rateLimit.windowMs, config.rateLimit.maxPerWindow);
  const logs: string[] = [];
  const deps = { config, pricing: pricingConfig, store, rateLimiter, clock, fetchImpl, log: (l: string) => logs.push(l) };
  return { deps, store, clock, logs };
}
const validBody = (over: Record<string, unknown> = {}) => ({ url: "https://plombier-test.ca", answers: { pages: "3_4", component: "none", languages: "fr", has_brand_assets: true }, ...over });
const input = (body: unknown, headers: Record<string, string> = {}, remoteAddr = "203.0.113.5") => ({ remoteAddr, headers, body });
const scanResult = (over: Record<string, unknown> = {}) => ({ canonical_origin: "https://plombier-test.ca", core_pages: 4, blog_posts: 0, excluded: { archives: 0, media: 0, soft_404: 0, external: 0 }, languages: ["fr"], bilingual_mirror: false, needs_browser: false, needs_browser_reasons: [], review_flags: [], partial: false, detected_platform: "wordpress", detected_platform_confidence: "high", builders_detected: [], page_content: [], ...over });

// ---- W-01 order: a rate-limited request never reaches siteverify ----
test("W-01 rate-limited request never reaches Turnstile siteverify", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { json: async () => ({ success: true }) }; };
  const { deps } = mkDeps({ RATE_LIMIT_MAX: "1", TURNSTILE_ENABLED: "true", TURNSTILE_SECRET: "s" }, fetchImpl);
  await runWall(input(validBody({ turnstile_token: "t" })), deps); // 1st: reaches turnstile
  assert.equal(calls, 1, "first request verified");
  const d2 = await runWall(input(validBody({ turnstile_token: "t" })), deps); // 2nd: rate-limited
  assert.equal(d2.kind, "rate_limited");
  assert.equal(calls, 1, "rate-limited request did NOT call siteverify (order proven)");
});

// ---- W-02 honeypot → plausible id, writes no job ----
test("W-02 honeypot → plausible id, no job written, no scan", async () => {
  const { deps, store } = mkDeps();
  const d = await runWall(input(validBody({ [HONEYPOT_FIELD]: "botfill" })), deps);
  assert.equal(d.kind, "honeypot");
  assert.match((d as any).quoteId, /^qt_[0-9a-f]{12}$/);
  assert.equal(await store.getJob((d as any).quoteId), null, "no job persisted");
  assert.equal(await store.countFreshScansSince(0), 0, "no scan enqueued");
});

// ---- W-03 each rejection layer logs its name (#25-A observability) ----
test("W-03 each rejection layer logs its name", async () => {
  { const { deps, logs } = mkDeps({ RATE_LIMIT_MAX: "0" }); await runWall(input(validBody()), deps); assert.ok(logs.includes("rate_limit")); }
  { const { deps, logs } = mkDeps(); await runWall(input(validBody({ [HONEYPOT_FIELD]: "x" })), deps); assert.ok(logs.includes("honeypot")); }
  { const { deps, logs } = mkDeps(); await runWall(input(validBody({ answers: { pages: "bad", component: "none", languages: "fr", has_brand_assets: true } })), deps); assert.ok(logs.includes("validation")); }
  { const { deps, logs } = mkDeps({ DAILY_SCAN_CEILING: "0" }); await runWall(input(validBody()), deps); assert.ok(logs.includes("ceiling")); }
});

// ---- W-04 ceiling flip → email-capture mode (not an error) ----
test("W-04 daily ceiling exceeded → email-capture payload", async () => {
  const { deps, store, clock } = mkDeps({ DAILY_SCAN_CEILING: "2" });
  await store.createJob({ id: "qt_a", no_site: false, url: "u", normalized_url: "n", answers_hash: null, answers: {}, persona: null, fresh_scan: true }, clock.now());
  await store.createJob({ id: "qt_b", no_site: false, url: "u", normalized_url: "n", answers_hash: null, answers: {}, persona: null, fresh_scan: true }, clock.now());
  const d = await runWall(input(validBody()), deps);
  assert.equal(d.kind, "completed");
  assert.equal((d as any).via, "email_capture");
  assert.equal(((d as any).job.response as any).result.reason_code, "budget_exceeded");
});

// ---- W-05 cache hit skips enqueue (zero spend) ----
test("W-05 cache hit → reuse crawl, re-price, no fresh scan enqueued", async () => {
  const { deps, store, clock } = mkDeps();
  const nurl = (normalize("https://plombier-test.ca") as any).identity;
  const seed = await store.createJob({ id: "qt_seed", no_site: false, url: "https://plombier-test.ca", normalized_url: nurl, answers_hash: null, answers: {}, persona: null, fresh_scan: true }, clock.now());
  const { page_content, ...facts } = scanResult();
  await store.updateJob(seed.id, { status: "completed", crawl_facts: facts, page_content, response: { indicative: true } }, clock.now());
  const before = await store.countFreshScansSince(0);
  const d = await runWall(input(validBody()), deps);
  assert.equal(d.kind, "completed");
  assert.equal((d as any).via, "cache_hit");
  assert.equal(await store.countFreshScansSince(0), before, "no NEW fresh scan counted");
  assert.equal(((d as any).job.response as any).basis, "scanned");
});

// ---- W-06 Retry-After value present on rate-limit decision ----
test("W-06 rate-limit decision carries Retry-After seconds", async () => {
  const { deps } = mkDeps({ RATE_LIMIT_MAX: "0" });
  const d = await runWall(input(validBody()), deps);
  assert.equal(d.kind, "rate_limited");
  assert.ok((d as any).retryAfterSec >= 1);
});

// ---- W-07 IPv6 /64 keying (same subnet shares the bucket) ----
test("W-07 two IPv6 addresses in one /64 share the rate-limit bucket", async () => {
  const { deps } = mkDeps({ RATE_LIMIT_MAX: "1", TRUSTED_PROXY_HOPS: "0" });
  const a = await runWall(input(validBody(), {}, "2001:db8:aa:bb::1"), deps);
  const b = await runWall(input(validBody(), {}, "2001:db8:aa:bb::99"), deps);
  assert.notEqual(a.kind, "rate_limited");
  assert.equal(b.kind, "rate_limited", "same /64 → second is limited");
});

// ---- W-08 trusted-proxy ignores spoofed X-Forwarded-For ----
test("W-08 spoofed X-Forwarded-For cannot dodge the rate limit", async () => {
  const { deps } = mkDeps({ RATE_LIMIT_MAX: "1", TRUSTED_PROXY_HOPS: "1" });
  const a = await runWall(input(validBody(), { "x-forwarded-for": "1.1.1.1, 198.51.100.9" }, "10.0.0.1"), deps);
  const b = await runWall(input(validBody(), { "x-forwarded-for": "2.2.2.2, 198.51.100.9" }, "10.0.0.1"), deps);
  assert.notEqual(a.kind, "rate_limited");
  assert.equal(b.kind, "rate_limited", "the real client IP (198.51.100.9) is keyed, not the spoof");
});

// ---- W-09 validation → typed 400 ----
test("W-09 invalid answers → typed invalid_request with allowed[]", async () => {
  const { deps } = mkDeps();
  const d = await runWall(input(validBody({ answers: { pages: "3_4", component: "nope", languages: "fr", has_brand_assets: true } })), deps);
  assert.equal(d.kind, "invalid");
  assert.equal((d as any).error.error, "invalid_request");
  assert.deepEqual((d as any).error.allowed, ["none", "booking", "listings", "both"]);
});

// ---- W-10 Turnstile: reached-invalid → reject; unreachable → fail open + review flag ----
test("W-10 Turnstile fail → rejected; unreachable → fail open with review flag", async () => {
  const rej = mkDeps({ TURNSTILE_ENABLED: "true", TURNSTILE_SECRET: "s" }, async () => ({ json: async () => ({ success: false }) }));
  assert.equal((await runWall(input(validBody({ turnstile_token: "bad" })), rej.deps)).kind, "turnstile_rejected");

  const open = mkDeps({ TURNSTILE_ENABLED: "true", TURNSTILE_SECRET: "s" }, async () => { throw new Error("network"); });
  const d = await runWall(input(validBody({ turnstile_token: "t" })), open.deps);
  assert.equal(d.kind, "enqueue");
  assert.ok((d as any).reviewFlags.includes("turnstile_unreachable"));
  assert.ok(open.logs.includes("turnstile"));
});
