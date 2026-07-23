// #37 payment-terms DISPLAY data — installments of the SAME fixed total. Not a price change,
// not a subscription, no premium/interest. The final versement absorbs integer-cents rounding
// so the schedule reconciles EXACTLY. FLAT register only; care_plan stays fully separate.
// No price literals — months + all amounts derive from config.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuoteResponse } from "../src/service/buildResponse.ts";
import { PAGES, COMPONENTS, LANGUAGES } from "../src/service/validate.ts";
import { loadPricingConfig, PricingConfigError } from "../src/pricing/loadPricingConfig.ts";
import { rawPricingConfig } from "../src/pricing/pricing.config.ts";
import { pricingConfig as P } from "../src/pricing/index.ts";

const M = P.payment_terms_months, CARE = P.care_plan.monthly_cents;
const scan = (o: Record<string, unknown> = {}) => ({ canonical_origin: "https://x.example", core_pages: 4, blog_posts: 0, excluded: { archives: 0, media: 0, soft_404: 0, external: 0 }, languages: ["fr"], bilingual_mirror: false, needs_browser: false, needs_browser_reasons: [], review_flags: [], partial: false, detected_platform: "wordpress", detected_platform_confidence: "high", builders_detected: [], page_content: [], ...o }) as any;

function assertSchedule(pt: any, total: number, label: string) {
  assert.ok(pt, `${label}: payment_terms present`);
  assert.equal(pt.months, M, `${label}: months from config`);
  assert.equal(pt.monthly_amount, Math.floor(total / M), `${label}: monthly = floor(total/months)`);
  // the invariant, EXACTLY — final absorbs rounding
  assert.equal((M - 1) * pt.monthly_amount + pt.final_amount, total, `${label}: schedule reconciles to total`);
  assert.ok(Number.isInteger(pt.monthly_amount) && Number.isInteger(pt.final_amount), `${label}: integer cents`);
  assert.ok(pt.final_amount >= pt.monthly_amount, `${label}: final absorbs the remainder`);
}

// ---- reconciliation across EVERY tier + addition combination (flat register) ----
test("PT-01 schedule reconciles to indicative_total for every tier + addition combo", () => {
  let checked = 0;
  for (const pages of PAGES)
    for (const component of COMPONENTS)
      for (const languages of LANGUAGES)
        for (const has_brand_assets of [true, false]) {
          const r = buildQuoteResponse({ scan: null, answers: { pages, component, languages, has_brand_assets }, no_site: true }, P);
          const res = r.body.result as any;
          if (r.body.register !== "flat") continue; // ecommerce etc. → not flat, skip
          assertSchedule(res.payment_terms, res.indicative_total, `${pages}/${component}/${languages}`);
          checked++;
        }
  assert.ok(checked >= 12, `covered ${checked} flat combos (Presence/Standard/Pro + additions)`);
  // scanned flat too (not just declared)
  const s = buildQuoteResponse({ scan: scan({ core_pages: 4 }), answers: {}, no_site: false }, P).body as any;
  assert.equal(s.register, "flat");
  assertSchedule(s.result.payment_terms, s.result.indicative_total, "scanned-flat");
});

// ---- FLAT register ONLY — estimation / review / no-price OMIT it (absent, not null) ----
test("PT-02 payment_terms only on flat; absent elsewhere", () => {
  const band = buildQuoteResponse({ scan: scan({ core_pages: 9 }), answers: {}, no_site: false }, P).body as any; // #35 estimation
  assert.equal(band.register, "estimation");
  assert.ok(!("payment_terms" in band.result), "band estimation omits payment_terms");
  const soft = buildQuoteResponse({ scan: scan({ core_pages: 5, needs_browser: true }), answers: {}, no_site: false }, P).body as any;
  assert.equal(soft.register, "estimation");
  assert.ok(!("payment_terms" in soft.result), "soft estimation omits payment_terms");
  const review = buildQuoteResponse({ scan: scan({ core_pages: "30+" }), answers: {}, no_site: false }, P).body as any;
  assert.equal(review.review_required, true);
  assert.ok(!("payment_terms" in review.result), "review/no-price omits payment_terms");
});

// ---- care_plan stays fully separate — never inside the schedule ----
test("PT-03 care_plan is separate; the schedule reconciles to the build total WITHOUT it", () => {
  const res = buildQuoteResponse({ scan: scan({ core_pages: 4 }), answers: {}, no_site: false }, P).body.result as any;
  assert.equal(res.care_plan_monthly, CARE, "care_plan present alongside");
  const pt = res.payment_terms;
  assert.equal((M - 1) * pt.monthly_amount + pt.final_amount, res.indicative_total, "schedule = build total, care excluded");
  assert.notEqual((M - 1) * pt.monthly_amount + pt.final_amount, res.indicative_total + CARE, "care never folded in");
});

// ---- config discipline (#22): payment_terms_months must be an integer ≥ 2 ----
test("PT-04 loader rejects a missing / degenerate payment_terms_months", () => {
  assert.throws(() => loadPricingConfig({ ...rawPricingConfig, payment_terms_months: 1 }), PricingConfigError);
  assert.throws(() => loadPricingConfig({ ...rawPricingConfig, payment_terms_months: 0 }), PricingConfigError);
  const { payment_terms_months, ...without } = rawPricingConfig as any;
  assert.throws(() => loadPricingConfig(without), PricingConfigError);
  assert.equal(loadPricingConfig(rawPricingConfig).payment_terms_months, 12);
});
