import { test } from "node:test";
import assert from "node:assert/strict";
import { loadServiceConfig, ConfigError, PREVIEW_ORIGIN_PATTERN } from "../src/service/config.ts";
import { clientIp, ipRateKey } from "../src/service/clientIp.ts";
import { RateLimiter } from "../src/service/rateLimiter.ts";
import { corsOriginAllowed, corsHeaders } from "../src/service/cors.ts";

const ORIGIN = "https://creavy.netlify.app";

// ---- config (#22 hard-fail; #34 no-key guard) ----
test("CFG-01 missing ALLOWED_ORIGIN → refuses to boot", () => {
  assert.throws(() => loadServiceConfig({ NODE_ENV: "staging" }), ConfigError);
});
test("CFG-02 valid minimal staging config loads with defaults", () => {
  const c = loadServiceConfig({ ALLOWED_ORIGIN: ORIGIN, NODE_ENV: "staging" });
  assert.equal(c.allowedOrigin, ORIGIN);
  assert.equal(c.turnstile.enabled, false); // staging starts disabled
  assert.equal(c.databaseUrl, null); // memory fallback allowed off-production
  assert.equal(c.dailyCeilings.scans, 200);
});
test("CFG-03 ANTHROPIC_API_KEY in a deployed env → boot error (#34)", () => {
  assert.throws(() => loadServiceConfig({ ALLOWED_ORIGIN: ORIGIN, NODE_ENV: "staging", ANTHROPIC_API_KEY: "sk-x" }), ConfigError);
});
test("CFG-04 ANTHROPIC_API_KEY ignored in development (local spikes)", () => {
  const c = loadServiceConfig({ ALLOWED_ORIGIN: ORIGIN, NODE_ENV: "development", ANTHROPIC_API_KEY: "sk-x" });
  assert.equal(c.env, "development");
});
test("CFG-05 production without DATABASE_URL → boot error", () => {
  assert.throws(() => loadServiceConfig({ ALLOWED_ORIGIN: ORIGIN, NODE_ENV: "production" }), ConfigError);
});
test("CFG-06 TURNSTILE_ENABLED without secret → boot error", () => {
  assert.throws(() => loadServiceConfig({ ALLOWED_ORIGIN: ORIGIN, NODE_ENV: "staging", TURNSTILE_ENABLED: "true" }), ConfigError);
});
test("CFG-07 bad numeric env → boot error", () => {
  assert.throws(() => loadServiceConfig({ ALLOWED_ORIGIN: ORIGIN, RATE_LIMIT_MAX: "abc" }), ConfigError);
});

// ---- client IP / trusted proxy / IPv6 /64 ----
test("IP-01 one trusted hop → real client from XFF", () => {
  assert.equal(clientIp("10.0.0.1", "203.0.113.7", 1), "203.0.113.7");
});
test("IP-02 spoofed XFF from an untrusted hop is ignored (W-08)", () => {
  // attacker prepends a fake IP; the trusted proxy appends the attacker's real IP
  assert.equal(clientIp("10.0.0.1", "1.2.3.4, 198.51.100.9", 1), "198.51.100.9");
});
test("IP-03 zero trusted hops → socket peer, XFF ignored", () => {
  assert.equal(clientIp("198.51.100.9", "1.2.3.4", 0), "198.51.100.9");
});
test("IP-04 IPv4-mapped IPv6 + port normalized", () => {
  assert.equal(clientIp("::ffff:203.0.113.7", undefined, 0), "203.0.113.7");
});
test("IP-05 IPv6 /64 keying — same subnet shares a bucket (W-07)", () => {
  const a = ipRateKey("2001:db8:abcd:1234::1");
  const b = ipRateKey("2001:db8:abcd:1234:ff:ff:ff:ff");
  assert.equal(a, b, "same /64 → same key");
  assert.notEqual(a, ipRateKey("2001:db8:abcd:9999::1"), "different /64 → different key");
});

// ---- rate limiter ----
test("RL-01 sliding window: allows max, then blocks with Retry-After, then slides", () => {
  const rl = new RateLimiter(60_000, 2);
  assert.equal(rl.check("k", 0).allowed, true);
  assert.equal(rl.check("k", 1000).allowed, true);
  const blocked = rl.check("k", 2000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1);
  assert.equal(rl.check("k", 61_001).allowed, true, "window slid past the first hit");
});

// ---- CORS #33 ----
test("CORS-01 exact production origin allowed", () => assert.equal(corsOriginAllowed(ORIGIN, ORIGIN, PREVIEW_ORIGIN_PATTERN), true));
test("CORS-02 deploy-preview origin allowed (anchored pattern)", () => {
  assert.equal(corsOriginAllowed("https://deploy-preview-42--creavy.netlify.app", ORIGIN, PREVIEW_ORIGIN_PATTERN), true);
});
test("CORS-03 http preview rejected (https-only)", () => {
  assert.equal(corsOriginAllowed("http://deploy-preview-42--creavy.netlify.app", ORIGIN, PREVIEW_ORIGIN_PATTERN), false);
});
test("CORS-04 lookalike origin rejected (fully anchored)", () => {
  assert.equal(corsOriginAllowed("https://evil--creavy.netlify.app.attacker.com", ORIGIN, PREVIEW_ORIGIN_PATTERN), false);
  assert.equal(corsOriginAllowed("https://creavy.netlify.app.evil.com", ORIGIN, PREVIEW_ORIGIN_PATTERN), false);
});
test("CORS-05 allowed origin → ACAO echoed; rejected → none", () => {
  assert.equal(corsHeaders(ORIGIN, ORIGIN, PREVIEW_ORIGIN_PATTERN)["Access-Control-Allow-Origin"], ORIGIN);
  assert.equal(corsHeaders("https://evil.com", ORIGIN, PREVIEW_ORIGIN_PATTERN)["Access-Control-Allow-Origin"], undefined);
});
