// #27.9 price decomposition (Option B) — base (scanned-pages tier, invariant to declared
// answers) + additions (config-priced refinement lines; a tier bump is ONE <tier>_bundle line
// with covers). Invariant: base.amount + Σ additions === total (flat) / range.min (estimation).
// #27.3 totals are PRESERVED (the Pro crossover discount is a pricing feature; strict additivity
// is display only). care_plan stays OUTSIDE the sum. NO price literals — all from config.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTier, pageBaseBundle, type TierMapInput } from "../src/tiermap/tiermap.ts";
import { buildQuoteResponse } from "../src/service/buildResponse.ts";
import { pricingConfig as P } from "../src/pricing/index.ts";

const STD = P.tiers.standard.price_cents, PRO = P.tiers.pro.price_cents, PRES = P.tiers.presence.price_cents;
const flat = (k: string) => { const p = P.addons[k]?.price; return p && p.kind === "flat" ? p.cents : 0; };
const EXTRA = flat("extra_page"), BI = flat("bilingual"), BK = flat("booking"), SEO = flat("seo_migration");
const CARE = P.care_plan.monthly_cents;

const inp = (o: Partial<TierMapInput> = {}): TierMapInput => ({
  core_pages: 4, blog_posts: 0, bilingual_mirror: false, detected_platform: "wordpress",
  needs_browser: false, partial: false, review_flags: [], components: {}, has_brand_assets: true, ...o,
});
const sumOf = (t: any) => t.base.amount + t.additions.reduce((s: number, a: any) => s + a.amount, 0);

// ---- reconciliation across the whole combination space (flat) ----
test("D-01 flat: base + Σ additions === indicative_total for every addition combination", () => {
  for (const pages of [1, 2, 3, 4, 5, 6]) {
    for (const bilingual of [false, true]) {
      for (const component of [{}, { booking: true }, { listings: true }, { booking: true, listings: true }]) {
        for (const blog of [0, P.tiermap.blog_seo_threshold]) {
          const t = mapTier(inp({ core_pages: pages, bilingual_mirror: bilingual, components: component, blog_posts: blog }), P);
          if (!t.bundle) continue; // review shapes carry no decomposition
          assert.equal(sumOf(t), t.indicative_total, `pages=${pages} bi=${bilingual} comp=${JSON.stringify(component)} blog=${blog}`);
          assert.equal(t.base.from, "scan");
        }
      }
    }
  }
});

// ---- each refinement is exactly its config-priced line (no tier bump) ----
test("D-02 refinements emit exactly their config price on the Standard path", () => {
  const bi = mapTier(inp({ bilingual_mirror: true }), P);
  assert.deepEqual(bi.additions, [{ code: "bilingual", label_key: "addon.bilingual", amount: BI }]);
  const bk = mapTier(inp({ components: { booking: true } }), P);
  assert.deepEqual(bk.additions, [{ code: "booking", label_key: "addon.booking", amount: BK }]);
  // both → two clean lines, no covers (rider 2: simple additions omit covers)
  const both = mapTier(inp({ bilingual_mirror: true, components: { booking: true } }), P);
  assert.deepEqual(both.additions.map((a: any) => a.code), ["bilingual", "booking"]);
  assert.ok(both.additions.every((a: any) => !("covers" in a)), "simple additions omit covers");
  // blogHeavy → standalone seo_migration line
  const seo = mapTier(inp({ blog_posts: P.tiermap.blog_seo_threshold }), P);
  assert.ok(seo.additions.some((a: any) => a.code === "seo_migration" && a.amount === SEO));
});

// ---- rider 1: displayed tier (bundle.tier) MAY differ from the arithmetic anchor (base.tier) ----
test("D-03 rider 1 — a Pro-bundle quote carries bundle.tier=pro AND base.tier=standard", () => {
  const t = mapTier(inp({ components: { listings: true } }), P); // 4p listings → Pro
  assert.equal(t.bundle!.tier, "pro");
  assert.equal(t.base.tier, "standard");
  assert.equal(t.base.amount, STD);
  assert.equal(sumOf(t), PRO);
});

// ---- rider 2: the pro_bundle line lists covers[]; the crossover keeps #27.3's cheaper total ----
test("D-04 rider 2 — pro_bundle line carries covers[]; total is the #27.3 cheapest (429k, not 446k additive)", () => {
  const t = mapTier(inp({ core_pages: 5, bilingual_mirror: true, components: { booking: true } }), P); // crossover
  assert.equal(t.bundle!.tier, "pro");
  assert.equal(t.indicative_total, PRO, "#27.3 preserved — Pro (429k), not additive 446k");
  const pb = t.additions.find((a: any) => a.code === "pro_bundle");
  assert.ok(pb, "one pro_bundle line");
  assert.deepEqual(pb!.covers, ["bilingual", "booking"]);
  assert.equal(t.base.amount + pb!.amount, PRO, "base + pro_bundle reconciles to the preserved total");
});

// ---- Presence→Standard bump is one standard_bundle line, still reconciles ----
test("D-05 tier bump Presence→Standard → one standard_bundle line, sum === total", () => {
  const t = mapTier(inp({ core_pages: 2, components: { booking: true } }), P); // 2p can't be Presence with a component
  assert.equal(t.base.tier, "presence"); assert.equal(t.base.amount, PRES);
  assert.equal(t.bundle!.tier, "standard");
  const sb = t.additions.find((a: any) => a.code === "standard_bundle");
  assert.ok(sb && sb.covers!.includes("booking"));
  assert.equal(sumOf(t), t.indicative_total);
});

// ---- rider 3: estimation reconciles to range.min (scanned-basis) ----
test("D-06 rider 3 — band + soft estimation: base + Σ additions === range.min", () => {
  const band = mapTier(inp({ core_pages: 9 }), P); // #35 band
  assert.ok(band.range); assert.equal(sumOf(band), band.range!.min);
  const soft = mapTier(inp({ core_pages: 5, needs_browser: true }), P); // soft review keeps a bundle
  assert.equal(soft.base.amount + soft.additions.reduce((s: number, a: any) => s + a.amount, 0), soft.indicative_total);
});

// ---- the MISTAP: a declared page band never moves base (structurally unreachable) ----
test("D-07 mistap — declared 5_plus on a scanned 4-page site leaves base at the scanned tier", () => {
  const scan: any = { canonical_origin: "https://x.example", core_pages: 4, blog_posts: 0, bilingual_mirror: false, detected_platform: "wordpress", detected_platform_confidence: "high", needs_browser: false, partial: false, review_flags: [], page_content: [] };
  const declared4 = buildQuoteResponse({ scan, answers: { pages: "3_4", component: "none", languages: "fr", has_brand_assets: true }, no_site: false }, P);
  const mistap = buildQuoteResponse({ scan, answers: { pages: "5_plus", component: "none", languages: "fr", has_brand_assets: true }, no_site: false }, P);
  // matching band → flat; the mistap → estimation register (declared_scan_conflict) — but base is IDENTICAL
  assert.equal(declared4.body.register, "flat");
  assert.equal(mistap.body.register, "estimation");
  const b1 = (declared4.body.result as any).base, b2 = (mistap.body.result as any).base;
  assert.deepEqual(b2, b1, "base unmoved by the declared band");
  assert.equal(b2.amount, STD, "still the scanned 4-page Standard base");
  // and range.min is the scanned-basis floor, never dropped by the declared band
  assert.equal((mistap.body.result as any).range.min, STD);
});

// ---- care_plan is OUTSIDE base/additions/total ----
test("D-08 care_plan_monthly never appears in base/additions/total", () => {
  const r = buildQuoteResponse({ scan: { canonical_origin: "https://x.example", core_pages: 4, blog_posts: 0, bilingual_mirror: false, detected_platform: "wordpress", detected_platform_confidence: "high", needs_browser: false, partial: false, review_flags: [], page_content: [] } as any, answers: { pages: "3_4", component: "none", languages: "fr", has_brand_assets: true }, no_site: false }, P);
  const res = r.body.result as any;
  assert.equal(res.care_plan_monthly, CARE);
  assert.equal(res.base.amount + res.additions.reduce((s: number, a: any) => s + a.amount, 0), res.indicative_total);
  assert.notEqual(res.indicative_total, res.indicative_total + CARE); // care not folded in
  assert.ok(!res.additions.some((a: any) => a.amount === CARE), "care_plan is not an addition");
});

// ---- pageBaseBundle is a pure function of scanned pages (the anchor) ----
test("D-09 pageBaseBundle: Presence≤2, Standard 3-4, Standard+extra 5-6 — pages only", () => {
  assert.deepEqual(pageBaseBundle(1, P), { tier: "presence", amount: PRES });
  assert.deepEqual(pageBaseBundle(2, P), { tier: "presence", amount: PRES });
  assert.deepEqual(pageBaseBundle(4, P), { tier: "standard", amount: STD });
  assert.deepEqual(pageBaseBundle(6, P), { tier: "standard", amount: STD + 2 * EXTRA });
});
