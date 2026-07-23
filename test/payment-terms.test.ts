// #37 → ENG-04 Ruling 2 payment-terms — MACHINE FIELDS ONLY. Installments of the SAME fixed
// total: payment_terms.installments = { count, amount_cents, final_amount_cents }. amount =
// round(total/count); final absorbs the remainder so (count-1)·amount + final === total, with
// |amount − final| ≤ 11. FLAT register only; care_plan stays fully separate. Single-payment
// mode carries no fields (the amount is indicative_total). No price literals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuoteResponse } from "../src/service/buildResponse.ts";
import { PAGES, COMPONENTS, LANGUAGES } from "../src/service/validate.ts";
import { loadPricingConfig, PricingConfigError } from "../src/pricing/loadPricingConfig.ts";
import { rawPricingConfig } from "../src/pricing/pricing.config.ts";
import { pricingConfig as P } from "../src/pricing/index.ts";

const M = P.payment_terms_months, CARE = P.care_plan.monthly_cents;
const scan = (o: Record<string, unknown> = {}) => ({ canonical_origin: "https://x.example", core_pages: 4, blog_posts: 0, excluded: { archives: 0, media: 0, soft_404: 0, external: 0 }, languages: ["fr"], bilingual_mirror: false, needs_browser: false, needs_browser_reasons: [], review_flags: [], partial: false, detected_platform: "wordpress", detected_platform_confidence: "high", builders_detected: [], page_content: [], ...o }) as any;
const build = (s: any, answers: any) => buildQuoteResponse({ scan: s, answers, no_site: false }, P).body as any;

function assertSchedule(pt: any, total: number, label: string) {
  assert.ok(pt && pt.installments, `${label}: payment_terms.installments present`);
  const { count, amount_cents, final_amount_cents } = pt.installments;
  assert.equal(count, M, `${label}: count from config`);
  assert.equal(amount_cents, Math.round(total / M), `${label}: amount = round(total/count)`);
  assert.equal((M - 1) * amount_cents + final_amount_cents, total, `${label}: (count-1)·amount + final === total`);
  assert.ok(Math.abs(amount_cents - final_amount_cents) <= 11, `${label}: |amount − final| ≤ 11`);
  assert.ok(Number.isInteger(amount_cents) && Number.isInteger(final_amount_cents), `${label}: integer cents`);
  // machine fields only — no prose keys leak into the payload
  for (const k of ["label", "label_fr", "text", "sentence", "note"]) assert.ok(!(k in pt), `${label}: no prose key ${k}`);
}

// ---- reconciliation across EVERY tier + addition combination (flat register) ----
test("PT-01 installments reconcile to indicative_total for every tier + addition combo", () => {
  let checked = 0;
  for (const pages of PAGES)
    for (const component of COMPONENTS)
      for (const languages of LANGUAGES)
        for (const has_brand_assets of [true, false]) {
          const r = buildQuoteResponse({ scan: null, answers: { pages, component, languages, has_brand_assets }, no_site: true }, P);
          const res = r.body.result as any;
          if (r.body.register !== "flat") continue;
          assertSchedule(res.payment_terms, res.indicative_total, `${pages}/${component}/${languages}`);
          checked++;
        }
  assert.ok(checked >= 12, `covered ${checked} flat combos`);
  const s = buildQuoteResponse({ scan: scan({ core_pages: 4 }), answers: {}, no_site: false }, P).body as any;
  assert.equal(s.register, "flat");
  assertSchedule(s.result.payment_terms, s.result.indicative_total, "scanned-flat");
});

// ---- the ratified worked examples (Ruling 2) ----
test("PT-05 worked examples — 338000¢ → {28167, 28163}; 279000¢ → {23250, 23250}", () => {
  // 279000 = Standard flat (4p, no add-on) → both equal
  const clean = build(scan({ core_pages: 4 }), {}).result;
  assert.equal(clean.indicative_total, 279000);
  assert.deepEqual(clean.payment_terms.installments, { count: 12, amount_cents: 23250, final_amount_cents: 23250 });
  // 338000 = Standard + booking add-on (4p base, no tier bump) → final absorbs the remainder
  const rounded = build(scan({ core_pages: 4 }), { component: "booking" }).result;
  assert.equal(rounded.indicative_total, 338000);
  assert.deepEqual(rounded.payment_terms.installments, { count: 12, amount_cents: 28167, final_amount_cents: 28163 });
});

// ---- FLAT register ONLY — estimation / review / no-price OMIT it (absent, not null) ----
test("PT-02 payment_terms only on flat; absent elsewhere", () => {
  const band = buildQuoteResponse({ scan: scan({ core_pages: 9 }), answers: {}, no_site: false }, P).body as any;
  assert.equal(band.register, "estimation");
  assert.ok(!("payment_terms" in band.result), "band estimation omits payment_terms");
  const soft = buildQuoteResponse({ scan: scan({ core_pages: 5, needs_browser: true }), answers: {}, no_site: false }, P).body as any;
  assert.ok(!("payment_terms" in soft.result), "soft estimation omits payment_terms");
  const review = buildQuoteResponse({ scan: scan({ core_pages: "30+" }), answers: {}, no_site: false }, P).body as any;
  assert.ok(!("payment_terms" in review.result), "review/no-price omits payment_terms");
});

// ---- care_plan stays fully separate — never inside the schedule ----
test("PT-03 care_plan separate; schedule reconciles to the build total WITHOUT it", () => {
  const res = buildQuoteResponse({ scan: scan({ core_pages: 4 }), answers: {}, no_site: false }, P).body.result as any;
  assert.equal(res.care_plan_monthly, CARE);
  const { count, amount_cents, final_amount_cents } = res.payment_terms.installments;
  assert.equal((count - 1) * amount_cents + final_amount_cents, res.indicative_total, "= build total, care excluded");
  assert.notEqual((count - 1) * amount_cents + final_amount_cents, res.indicative_total + CARE, "care never folded in");
});

// ---- config discipline (#22): payment_terms_months must be an integer ≥ 2 ----
test("PT-04 loader rejects a missing / degenerate payment_terms_months", () => {
  assert.throws(() => loadPricingConfig({ ...rawPricingConfig, payment_terms_months: 1 }), PricingConfigError);
  const { payment_terms_months, ...without } = rawPricingConfig as any;
  assert.throws(() => loadPricingConfig(without), PricingConfigError);
  assert.equal(loadPricingConfig(rawPricingConfig).payment_terms_months, 12);
});
