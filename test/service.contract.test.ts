import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildQuoteResponse } from "../src/service/buildResponse.ts";
import { createServer } from "../src/service/server.ts";
import { loadServiceConfig } from "../src/service/config.ts";
import { MemoryStore } from "../src/service/store/memoryStore.ts";
import { RateLimiter } from "../src/service/rateLimiter.ts";
import { pricingConfig as P } from "../src/pricing/index.ts";
import { FakeTransport, FakeClock, type Scenario } from "./helpers/replay.ts";

// Contract v0.4 conformance. Prices are read FROM config (a drifted literal must fail).
const STD = P.tiers.standard.price_cents, PRO = P.tiers.pro.price_cents;
const BIL = (P.addons.bilingual.price as any).cents, BOOK = (P.addons.booking.price as any).cents;
const EXTRA = (P.addons.extra_page.price as any).cents, LOGO = (P.addons.logo_refresh.price as any).cents;
const CARE = P.care_plan.monthly_cents;

const scan = (o: Record<string, unknown> = {}) => ({ canonical_origin: "https://x.example", core_pages: 4, blog_posts: 0, excluded: { archives: 0, media: 0, soft_404: 0, external: 0 }, languages: ["fr"], bilingual_mirror: false, needs_browser: false, needs_browser_reasons: [], review_flags: [], partial: false, detected_platform: "wordpress", detected_platform_confidence: "high", builders_detected: [], page_content: [], ...o }) as any;
const ans = (o: Record<string, unknown> = {}) => ({ pages: "3_4", component: "none", languages: "fr", has_brand_assets: true, ...o }) as any;

// ---- E2 scanned flat: 4-page WP, bilingual site, wants bilingual, no brand assets ----
test("E2 scanned flat + bilingual add + analysis_details", () => {
  const r = buildQuoteResponse({ scan: scan({ bilingual_mirror: true }), answers: ans({ languages: "fr_en", has_brand_assets: false }), no_site: false }, P);
  assert.equal(r.status, "completed");
  assert.deepEqual(r.body.basis, "scanned"); assert.equal(r.body.register, "flat"); assert.equal(r.body.review_required, false);
  const res = r.body.result as any;
  assert.deepEqual(res.bundle, { tier: "standard", addons: ["bilingual"], modifiers: [] });
  assert.equal(res.indicative_total, STD + BIL);
  assert.deepEqual(res.suggested_addons, [{ id: "logo_refresh", amount: LOGO }]);
  assert.equal(res.care_plan_monthly, CARE);
  assert.deepEqual(res.reasons, ["cheapest_bundle", "bilingual_addon"]);
  assert.equal(res.core_pages, 4); assert.equal(res.detected_platform, "wordpress"); assert.equal(res.confidence, "high");
  assert.deepEqual(res.analysis_details, [{ item: "platform", value: "wordpress" }, { item: "pages", value: 4 }, { item: "language", value: "fr_en" }, { item: "https", value: true }]);
});

// ---- E3 scanned estimation: 5-page JS-heavy → softened ----
test("E3 scanned estimation (needs_browser) → range, medium confidence", () => {
  const r = buildQuoteResponse({ scan: scan({ core_pages: 5, needs_browser: true, detected_platform: "unknown", detected_platform_confidence: "low" }), answers: ans({ pages: "5_plus" }), no_site: false }, P);
  const res = r.body.result as any;
  assert.equal(r.body.register, "estimation"); assert.equal(r.body.review_required, true);
  assert.deepEqual(res.range, { min: STD + EXTRA, max: PRO });
  assert.equal(res.confidence, "medium");
  assert.ok(res.reasons.includes("needs_closer_look"));
  assert.equal(res.detected_platform, "unknown");
});

// ---- E4 declared no_site: booking + bilingual ----
test("E4 declared flat (no crawl fields)", () => {
  const r = buildQuoteResponse({ scan: null, answers: ans({ component: "booking", languages: "fr_en" }), no_site: true }, P);
  const res = r.body.result as any;
  assert.equal(r.body.basis, "declared"); assert.equal(r.body.register, "flat");
  assert.equal(res.bundle.tier, "standard");
  assert.deepEqual(res.bundle.addons.sort(), ["bilingual", "booking"]);
  assert.equal(res.indicative_total, STD + BIL + BOOK);
  assert.ok(res.reasons.includes("declared_basis"));
  assert.equal(res.core_pages, undefined, "no crawl fields on declared (#29.3)");
});

// ---- E5 review-required: 30+ → out_of_scope ----
test("E5 review-required (30+) → reason_code out_of_scope, no price", () => {
  const r = buildQuoteResponse({ scan: scan({ core_pages: "30+" }), answers: ans(), no_site: false }, P);
  const res = r.body.result as any;
  assert.equal(r.body.review_required, true);
  assert.equal(res.reason_code, "out_of_scope");
  assert.equal(res.indicative_total, undefined); assert.equal(res.range, undefined);
});

// ---- E7 declared/scanned band disagreement → estimation ----
test("E7 band disagreement (scanned 3 vs declared 5_plus) → estimation, low confidence", () => {
  const r = buildQuoteResponse({ scan: scan({ core_pages: 3 }), answers: ans({ pages: "5_plus" }), no_site: false }, P);
  const res = r.body.result as any;
  assert.equal(r.body.register, "estimation");
  assert.deepEqual(res.range, { min: STD, max: PRO });
  assert.equal(res.confidence, "low");
  assert.deepEqual(res.reasons, ["declared_scan_conflict"]);
  assert.equal(res.core_pages, 3); assert.equal(res.detected_platform, "wordpress"); assert.equal(res.confidence_platform, "high");
});

// ---- E8 component listings → Pro ----
test("E8 listings → Pro flat", () => {
  const r = buildQuoteResponse({ scan: scan({ core_pages: 4 }), answers: ans({ component: "listings" }), no_site: false }, P);
  const res = r.body.result as any;
  assert.equal(res.bundle.tier, "pro"); assert.equal(res.indicative_total, PRO);
  assert.ok(res.reasons.includes("listings_needs_pro"));
});

// ================= HTTP integration — the running app =================
const ORIGIN = "https://creavy.netlify.app";
async function withServer(transport: FakeTransport, fn: (base: string, store: MemoryStore) => Promise<void>, over: Record<string, string> = {}) {
  const store = new MemoryStore();
  const config = loadServiceConfig({ ALLOWED_ORIGIN: ORIGIN, NODE_ENV: "staging", RATE_LIMIT_MAX: "50", ...over });
  const server = createServer({ config, pricing: P, store, rateLimiter: new RateLimiter(config.rateLimit.windowMs, config.rateLimit.maxPerWindow), transport, clock: new FakeClock(1_700_000_000_000), syncHoldMs: 4000 });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as any).port;
  try { await fn(`http://127.0.0.1:${port}`, store); } finally { await new Promise<void>((r) => server.close(() => r())); }
}
const post = (base: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/quote`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const goldenScenario = (slug: string): Scenario => JSON.parse(readFileSync(`fixtures/golden/${slug}/scenario.json`, "utf8"));

test("HTTP E1 → pending or completed; poll GET reaches completed (scanned golden)", async () => {
  await withServer(new FakeTransport(goldenScenario("toituresmarcelpouliot")), async (base) => {
    const r = await post(base, { url: "http://toituresmarcelpouliot.com/", answers: ans() });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.match(body.quote_id, /^qt_/);
    assert.ok(["pending", "completed"].includes(body.status));
    // poll to terminal
    let job = body;
    for (let i = 0; i < 20 && job.status === "pending"; i++) job = await (await fetch(`${base}/quote/${body.quote_id}`)).json();
    assert.equal(job.status, "completed");
    assert.equal(job.basis, "scanned");
    assert.equal(job.result.bundle.tier, "standard"); // 4 core pages
    assert.equal(job.result.core_pages, 4);
  });
});

test("HTTP no_site declared → completed synchronously", async () => {
  await withServer(new FakeTransport({}), async (base) => {
    const r = await post(base, { no_site: true, answers: ans({ component: "booking", languages: "fr_en" }) });
    const body = await r.json();
    assert.equal(body.status, "completed"); assert.equal(body.basis, "declared");
    assert.equal(body.result.bundle.tier, "standard");
  });
});

test("HTTP unreachable (dns) → failed + book_a_call", async () => {
  const O = "https://dead.example";
  const scenario: Scenario = { [O + "/"]: { error: { kind: "dns" } }, ["https://www.dead.example/"]: { error: { kind: "dns" } } };
  await withServer(new FakeTransport(scenario), async (base) => {
    const r = await post(base, { url: "dead.example", answers: ans() });
    let body = await r.json();
    for (let i = 0; i < 20 && body.status === "pending"; i++) body = await (await fetch(`${base}/quote/${body.quote_id}`)).json();
    assert.equal(body.status, "failed");
    assert.equal(body.book_a_call, true);
    assert.ok(["nxdomain_greenfield", "unreachable"].includes(body.reason));
  });
});

test("HTTP GET unknown id → 404", async () => {
  await withServer(new FakeTransport({}), async (base) => {
    assert.equal((await fetch(`${base}/quote/qt_nope`)).status, 404);
  });
});

test("HTTP /health → ok", async () => {
  await withServer(new FakeTransport({}), async (base) => {
    const r = await fetch(`${base}/health`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, "ok");
  });
});

test("HTTP CORS: allowed origin echoed, preview allowed, rejected origin gets none", async () => {
  await withServer(new FakeTransport({}), async (base) => {
    const ok = await fetch(`${base}/health`, { headers: { origin: ORIGIN } });
    assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
    const preview = await fetch(`${base}/health`, { headers: { origin: "https://deploy-preview-9--creavy.netlify.app" } });
    assert.equal(preview.headers.get("access-control-allow-origin"), "https://deploy-preview-9--creavy.netlify.app");
    const bad = await fetch(`${base}/health`, { headers: { origin: "https://evil.com" } });
    assert.equal(bad.headers.get("access-control-allow-origin"), null);
  });
});

test("HTTP 429 carries Retry-After", async () => {
  await withServer(new FakeTransport({}), async (base) => {
    const r = await post(base, { no_site: true, answers: ans() });
    assert.equal(r.status, 200); // 1st ok
    const r2 = await post(base, { no_site: true, answers: ans() });
    assert.equal(r2.status, 429);
    assert.ok(Number(r2.headers.get("retry-after")) >= 1);
    assert.equal((await r2.json()).error, "rate_limited");
  }, { RATE_LIMIT_MAX: "1" });
});

test("HTTP events route projects public lines with seq", async () => {
  await withServer(new FakeTransport(goldenScenario("toituresmarcelpouliot")), async (base) => {
    const r = await post(base, { url: "http://toituresmarcelpouliot.com/", answers: ans() });
    const { quote_id } = await r.json();
    const ev = await (await fetch(`${base}/quote/${quote_id}/events?since=-1&lang=fr`)).json();
    assert.ok(Array.isArray(ev.events));
    assert.ok(ev.events.some((e: any) => e.type === "scan_started"));
    assert.ok(ev.events.every((e: any) => typeof e.seq === "number" && typeof e.text === "string"));
  });
});
