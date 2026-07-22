// #36 OPTIONAL ANSWERS on the scanned path. Absent answer = unanswered: adds no declared
// need, manufactures no conflict, contributes no answer-derived suggestion. The scan alone
// prices it (30.1: add needs, never erase evidence). no_site is unchanged — answers REQUIRED.
// Fixes the site's BUG-1 primed-defaults, which fabricated declared_scan_conflicts on every
// non-3_4 site and poisoned the launch conflict-rate telemetry. No price literals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuoteResponse } from "../src/service/buildResponse.ts";
import { validateQuoteRequest } from "../src/service/validate.ts";
import { pricingConfig as P } from "../src/pricing/index.ts";

const STD = P.tiers.standard.price_cents, PRES = P.tiers.presence.price_cents;
const BIL = (P.addons.bilingual.price as any).cents, BOOK = (P.addons.booking.price as any).cents;
const scan = (o: Record<string, unknown> = {}) => ({ canonical_origin: "https://x.example", core_pages: 4, blog_posts: 0, excluded: { archives: 0, media: 0, soft_404: 0, external: 0 }, languages: ["fr"], bilingual_mirror: false, needs_browser: false, needs_browser_reasons: [], review_flags: [], partial: false, detected_platform: "wordpress", detected_platform_confidence: "high", builders_detected: [], page_content: [], ...o }) as any;
const build = (s: any, answers: any) => buildQuoteResponse({ scan: s, answers, no_site: false }, P).body as any;

// ---- absent-all → flat scan-priced, NO conflict, NO suggestions, across page shapes ----
test("OA-01 absent-all answers → scan-priced, no conflict, no suggestions (1_2 / 3_4 / band-edge)", () => {
  // 1_2 shape (≤2 core) → Presence flat
  const p = build(scan({ core_pages: 2 }), {});
  assert.equal(p.register, "flat"); assert.equal(p.result.bundle.tier, "presence");
  assert.equal(p.result.indicative_total, PRES);
  // 3_4 shape (4 core) → Standard flat
  const s = build(scan({ core_pages: 4 }), {});
  assert.equal(s.register, "flat"); assert.equal(s.result.bundle.tier, "standard");
  assert.equal(s.result.indicative_total, STD);
  // band-edge (7 core) → #35 estimation band, still no conflict
  const b = build(scan({ core_pages: 7 }), {});
  assert.equal(b.register, "estimation"); assert.ok(b.result.reasons.includes("size_estimation_band"));
  // none manufacture a conflict, none carry answer-derived suggestions
  for (const r of [p, s, b]) {
    assert.ok(!r.result.reasons.includes("declared_scan_conflict"), "no fabricated conflict");
    assert.deepEqual(r.result.suggested_addons, [], "no suggestions from absent answers");
  }
});

// ---- absent answers can't move the register even when the scan band ≠ the OLD primed default
// (a 1_2 site no longer looks like a 3_4→1_2 conflict) ----
test("OA-02 absent pages never conflicts, whatever the scanned band", () => {
  for (const core of [1, 2, 5, 6]) {
    const r = build(scan({ core_pages: core }), {});
    assert.ok(!r.result.reasons.includes("declared_scan_conflict"), `core=${core}: no conflict`);
    assert.notEqual(r.register, undefined);
  }
});

// ---- partial subsets are first-class: an ANSWERED field adds its need/conflict exactly as today ----
test("OA-03 partial subsets — each answered field acts, absent ones don't", () => {
  // pages only, answered 5_plus on a scanned 4-page site → declared_scan_conflict (real answer)
  const conflict = build(scan({ core_pages: 4 }), { pages: "5_plus" });
  assert.equal(conflict.register, "estimation");
  assert.ok(conflict.result.reasons.includes("declared_scan_conflict"));
  // languages only → bilingual need added, no conflict, flat
  const bi = build(scan({ core_pages: 4 }), { languages: "fr_en" });
  assert.equal(bi.register, "flat"); assert.ok(bi.result.bundle.addons.includes("bilingual"));
  assert.equal(bi.result.indicative_total, STD + BIL);
  // component only → booking need added
  const bk = build(scan({ core_pages: 4 }), { component: "booking" });
  assert.ok(bk.result.bundle.addons.includes("booking"));
  assert.equal(bk.result.indicative_total, STD + BOOK);
  // has_brand_assets:false (answered) → logo suggestion; absent → none
  assert.ok(build(scan(), { has_brand_assets: false }).result.suggested_addons.some((s: any) => s.id === "logo_refresh"));
  assert.ok(!build(scan(), {}).result.suggested_addons.some((s: any) => s.id === "logo_refresh"));
});

// ---- validation: scanned URL-only is valid; bad enum still rejected; no_site still all-required ----
test("OA-04 validator — scanned optional, no_site required, enums still enforced", () => {
  assert.equal(validateQuoteRequest({ url: "example.com" }).ok, true, "URL-only, no answers → valid");
  assert.equal(validateQuoteRequest({ url: "example.com", answers: { pages: "1_2" } }).ok, true, "partial subset → valid");
  assert.equal(validateQuoteRequest({ url: "example.com", answers: { pages: null, component: null } }).ok, true, "explicit null = unanswered");
  assert.equal(validateQuoteRequest({ url: "example.com", answers: { pages: "9_plus" } }).ok, false, "answered but bad enum → 400");
  // no_site: answers required — answerless and partial both rejected with a typed 400
  const noAns = validateQuoteRequest({ no_site: true });
  assert.equal(noAns.ok, false); assert.ok((noAns as any).error.detail.includes("required for no_site"));
  assert.equal(validateQuoteRequest({ no_site: true, answers: { pages: "3_4" } }).ok, false, "no_site partial → 400");
  assert.equal(validateQuoteRequest({ no_site: true, answers: { pages: "3_4", component: "none", languages: "fr", has_brand_assets: true } }).ok, true);
});

// ---- back-compat: a FULL-answer request is byte-identical to pre-#36 behavior ----
test("OA-05 full answers → byte-identical result (back-compat)", () => {
  const full = { pages: "3_4", component: "booking", languages: "fr_en", has_brand_assets: false };
  const res = build(scan({ core_pages: 4 }), full).result;
  assert.deepEqual(res.bundle, { tier: "standard", addons: ["bilingual", "booking"], modifiers: [] });
  assert.equal(res.indicative_total, STD + BIL + BOOK);
  assert.deepEqual(res.base, { tier: "standard", amount: STD, from: "scan" });
  assert.deepEqual(res.additions.map((a: any) => a.code), ["bilingual", "booking"]);
  assert.ok(res.suggested_addons.some((s: any) => s.id === "logo_refresh"), "has_brand_assets:false → logo, unchanged");
  assert.ok(!res.reasons.includes("declared_scan_conflict"), "3_4 declared matches 4-page scan");
});
