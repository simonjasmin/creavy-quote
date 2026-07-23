// ENG-04 — GET /soumission/:quote_id + the GET rate-limiter (Ruling 1). Renders the STORED
// quote VERBATIM (never re-prices), inlines a completed assessment, server-computes the dates,
// gates 404/409/410, and stays zero-PII (T4). No price literals except the verbatim-pin sentinel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/service/server.ts";
import { loadServiceConfig } from "../src/service/config.ts";
import { MemoryStore } from "../src/service/store/memoryStore.ts";
import { RateLimiter } from "../src/service/rateLimiter.ts";
import { buildQuoteResponse } from "../src/service/buildResponse.ts";
import { pricingConfig as P } from "../src/pricing/index.ts";
import { FakeTransport, FakeClock } from "./helpers/replay.ts";

const T0 = 1_700_000_000_000, DAY = 86_400_000, ORIGIN = "https://creavy.netlify.app";

async function withServer(fn: (base: string, store: MemoryStore) => Promise<void>, over: Record<string, string> = {}) {
  const store = new MemoryStore();
  const config = loadServiceConfig({ ALLOWED_ORIGIN: ORIGIN, NODE_ENV: "staging", DATABASE_URL: "postgres://t", ...over });
  const server = createServer({ config, pricing: P, store, rateLimiter: new RateLimiter(config.rateLimit.windowMs, config.rateLimit.maxPerWindow), transport: new FakeTransport({}), clock: new FakeClock(T0) });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try { await fn(base, store); } finally { server.close(); }
}
const scan = (o: Record<string, unknown> = {}) => ({ canonical_origin: "https://gagnon.ca", core_pages: 4, blog_posts: 0, excluded: { archives: 0, media: 0, soft_404: 0, external: 0 }, languages: ["fr"], bilingual_mirror: false, needs_browser: false, needs_browser_reasons: [], review_flags: [], partial: false, detected_platform: "wordpress", detected_platform_confidence: "high", builders_detected: [], page_content: [{ url: "https://gagnon.ca", title: "Gagnon", text: "x", headings: [] }], ...o }) as any;

async function seed(store: MemoryStore, id: string, scanOver: Record<string, unknown>, createdAt = T0) {
  const built = buildQuoteResponse({ scan: scan(scanOver), answers: {}, no_site: false }, P);
  await store.createJob({ id, no_site: false, url: "https://gagnon.ca", normalized_url: "https://gagnon.ca", answers_hash: null, answers: {}, persona: null, origin: null, fresh_scan: true }, createdAt);
  await store.updateJob(id, { status: "completed", response: built.body }, createdAt);
  return built;
}

// ---- full payload on the FLAT register, no assessment ----
test("SM-01 flat soumission — verbatim projection + addressee + server-computed dates", async () => {
  await withServer(async (base, store) => {
    const built = await seed(store, "qt_flat", { core_pages: 4 });
    const r = await fetch(`${base}/soumission/qt_flat`);
    assert.equal(r.status, 200);
    const s = await r.json();
    assert.equal(s.quote_id, "qt_flat"); assert.equal(s.soumission, true);
    assert.equal(s.normalized_url, "https://gagnon.ca"); // addressee (a website URL, not PII)
    assert.equal(s.register, "flat");
    assert.equal(s.prepared_at, new Date(T0).toISOString());
    assert.equal(s.valid_until, new Date(T0 + 30 * DAY).toISOString(), "server computes D+30, client never does");
    assert.deepEqual(s.result, (built.body as any).result, "result rendered VERBATIM");
    assert.ok(s.result.payment_terms.installments.count === 12, "carries Ruling-2 payment_terms");
    assert.ok(!("assessment" in s), "no assessment inlined when none exists");
    // zero-PII (T4): no contact fields anywhere in the payload
    const flat = JSON.stringify(s).toLowerCase();
    for (const k of ["email", "courriel", "phone", "telephone", '"name"', "nom"]) assert.ok(!flat.includes(k), `no ${k}`);
  });
});

// ---- flat + a completed assessment INLINE; internals stripped ----
test("SM-02 flat soumission inlines completed assessment prose; internals never", async () => {
  await withServer(async (base, store) => {
    await seed(store, "qt_a", { core_pages: 4 });
    await store.createAssessment({ id: "as_1", quote_id: "qt_a", content_readiness: "ready", model: "m" }, T0);
    await store.updateAssessment("as_1", { status: "completed", prose_chunks: ["Votre site ", "est clair."], suggested_addons: [{ id: "copywriting_per_page", amount: 19000 }], complexity: "standard", complexity_factors: ["dated_design"], review_note: "SECRET", confidence: "high", flagged_for_review: true }, T0);
    const s = await (await fetch(`${base}/soumission/qt_a`)).json();
    assert.deepEqual(s.assessment.prose_chunks, ["Votre site ", "est clair."]);
    assert.ok(s.assessment.suggested_addons.some((x: any) => x.id === "copywriting_per_page"));
    for (const k of ["complexity", "complexity_factors", "review_note", "confidence", "flagged_for_review"]) assert.ok(!(k in s.assessment), `internal leak: ${k}`);
    assert.ok(!JSON.stringify(s).includes("SECRET"), "no internal prose leak");
  });
});

// ---- estimation register renders too (range verbatim); a non-completed assessment stays out ----
test("SM-03 estimation soumission — range verbatim; streaming assessment not inlined", async () => {
  await withServer(async (base, store) => {
    await seed(store, "qt_e", { core_pages: 9 }); // #35 band estimation
    await store.createAssessment({ id: "as_2", quote_id: "qt_e", content_readiness: "ready", model: "m" }, T0); // pending/streaming, not completed
    const s = await (await fetch(`${base}/soumission/qt_e`)).json();
    assert.equal(s.register, "estimation");
    assert.ok(s.result.range && s.result.range.min < s.result.range.max, "range rendered verbatim");
    assert.ok(!("assessment" in s), "only a COMPLETED assessment inlines");
  });
});

// ---- 404 / 409 not_completed / 409 no_price ----
test("SM-04 gates — 404 missing · 409 not_completed · 409 no_price (review)", async () => {
  await withServer(async (base, store) => {
    assert.equal((await fetch(`${base}/soumission/qt_missing`)).status, 404);
    await store.createJob({ id: "qt_pending", no_site: false, url: "u", normalized_url: "n", answers_hash: null, answers: {}, persona: null, origin: null, fresh_scan: true }, T0); // pending
    { const r = await fetch(`${base}/soumission/qt_pending`); assert.equal(r.status, 409); assert.equal((await r.json()).error, "not_completed"); }
    await seed(store, "qt_review", { core_pages: "30+" }); // review, no price
    { const r = await fetch(`${base}/soumission/qt_review`); assert.equal(r.status, 409); assert.equal((await r.json()).error, "no_price"); }
  });
});

// ---- expiry boundary → 410 with a machine reason ----
test("SM-05 410 at the expiry boundary (strict >), documented body", async () => {
  await withServer(async (base, store) => {
    await seed(store, "qt_old", { core_pages: 4 }, T0 - 30 * DAY - 1); // 30d + 1ms ago → expired
    const r = await fetch(`${base}/soumission/qt_old`);
    assert.equal(r.status, 410);
    const b = await r.json();
    assert.equal(b.error, "expired"); assert.equal(b.reason, "soumission_expired");
    assert.equal(b.valid_until, new Date(T0 - DAY - 1 + DAY).toISOString()); assert.ok(b.prepared_at);
    await seed(store, "qt_edge", { core_pages: 4 }, T0 - 30 * DAY); // valid_until === now → still valid
    assert.equal((await fetch(`${base}/soumission/qt_edge`)).status, 200, "boundary inclusive");
  });
});

// ---- verbatim render: a config price change never changes an already-issued soumission ----
test("SM-06 verbatim — soumission returns STORED numbers, never re-priced", async () => {
  await withServer(async (base, store) => {
    await store.createJob({ id: "qt_v", no_site: false, url: "u", normalized_url: "https://x.ca", answers_hash: null, answers: {}, persona: null, origin: null, fresh_scan: true }, T0);
    // a stored total no config could ever compute → proves the endpoint renders the record, not the mapper
    await store.updateJob("qt_v", { status: "completed", response: { indicative: true, basis: "scanned", register: "flat", review_required: false, result: { indicative_total: 111111, currency: "CAD", bundle: { tier: "standard", addons: [], modifiers: [] } } } }, T0);
    const s = await (await fetch(`${base}/soumission/qt_v`)).json();
    assert.equal(s.result.indicative_total, 111111, "renders the stored total verbatim (paper trail)");
  });
});

// ---- Ruling 1: GET limiter clears the island's polling worst case; trips beyond ----
test("SM-07 GET limiter — polling budget clears (86 req/60s at 700ms), trips past the limit", async () => {
  // Budget: the island's tightest loop is the 700 ms assessment stream ⇒ ⌈60000/700⌉ = 86 req/60s.
  // Default GET limit 300 ⇒ ~3.5× margin. Pin: 86 rapid polls never 429.
  await withServer(async (base, store) => {
    await seed(store, "qt_poll", { core_pages: 4 });
    for (let i = 0; i < 86; i++) assert.equal((await fetch(`${base}/quote/qt_poll`)).status, 200, `poll ${i} must not be limited`);
  });
  // and it DOES trip past the configured budget (id-enumeration protection) — 404s still count
  await withServer(async (base) => {
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await fetch(`${base}/soumission/qt_none`)).status;
    assert.equal(last, 429, "limiter trips past the budget");
  }, { GET_RATE_LIMIT_MAX: "3" });
  // /health stays exempt (uptime probes)
  await withServer(async (base) => {
    for (let i = 0; i < 4; i++) assert.equal((await fetch(`${base}/health`)).status, 200, "health never limited");
  }, { GET_RATE_LIMIT_MAX: "1" });
});
