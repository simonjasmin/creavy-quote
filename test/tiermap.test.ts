import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTier, type TierMapInput } from "../src/tiermap/tiermap.ts";
import { pricingConfig as P } from "../src/pricing/index.ts";

// Expected totals are computed FROM the real config — a drifted hardcode must fail.
const PRESENCE = P.tiers.presence.price_cents, STANDARD = P.tiers.standard.price_cents, PRO = P.tiers.pro.price_cents;
const EXTRA = (P.addons.extra_page.price as any).cents, BILINGUAL = (P.addons.bilingual.price as any).cents;
const BOOKING = (P.addons.booking.price as any).cents, SEO = (P.addons.seo_migration.price as any).cents;
const LOGO = (P.addons.logo_refresh.price as any).cents;

const base = (o: Partial<TierMapInput> = {}): TierMapInput => ({ core_pages: 3, blog_posts: 0, bilingual_mirror: false, detected_platform: "wordpress", needs_browser: false, partial: false, review_flags: [], components: {}, ...o });
const run = (o: Partial<TierMapInput> = {}) => mapTier(base(o), P);

// ---- 27.2 shapes ----
test("T-01 1 page → Présence", () => { const r = run({ core_pages: 1 }); assert.equal(r.bundle?.tier, "presence"); assert.equal(r.indicative_total, PRESENCE); });
test("T-02 2 pages → Présence", () => assert.equal(run({ core_pages: 2 }).bundle?.tier, "presence"));
test("T-03 3 pages → Standard", () => { const r = run({ core_pages: 3 }); assert.equal(r.bundle?.tier, "standard"); assert.equal(r.indicative_total, STANDARD); });
test("T-04 4 pages → Standard", () => assert.equal(run({ core_pages: 4 }).bundle?.tier, "standard"));
test("T-05 5 pages, no component → Standard + 1 extra-page", () => { const r = run({ core_pages: 5 }); assert.equal(r.bundle?.tier, "standard"); assert.deepEqual(r.bundle?.addons, ["extra_page"]); assert.equal(r.indicative_total, STANDARD + EXTRA); });
test("T-06 6 pages, no component → Standard + 2 extra-page", () => { const r = run({ core_pages: 6 }); assert.equal(r.indicative_total, STANDARD + 2 * EXTRA); });
test("T-07 7 pages → review, no bundle", () => { const r = run({ core_pages: 7 }); assert.equal(r.bundle, null); assert.equal(r.review_required, true); });
test("T-08 30+ → out-of-scope, no bundle", () => { const r = run({ core_pages: "30+" }); assert.equal(r.bundle, null); assert.equal(r.review_required, true); });

// ---- 27.3 cheapest-bundle crossovers ----
test("T-09 bilingual-only (3p) → Standard+bilingual beats Pro", () => { const r = run({ core_pages: 3, bilingual_mirror: true }); assert.equal(r.bundle?.tier, "standard"); assert.equal(r.indicative_total, STANDARD + BILINGUAL); assert.ok(STANDARD + BILINGUAL < PRO); });
test("T-10 bilingual+booking+5p → Pro wins on arithmetic", () => { const r = run({ core_pages: 5, bilingual_mirror: true, components: { booking: true } }); assert.equal(r.bundle?.tier, "pro"); assert.equal(r.indicative_total, PRO); assert.ok(PRO < STANDARD + EXTRA + BILINGUAL + BOOKING); });
test("T-11 booking-only (3p) → Standard+booking", () => { const r = run({ core_pages: 3, components: { booking: true } }); assert.equal(r.bundle?.tier, "standard"); assert.equal(r.indicative_total, STANDARD + BOOKING); });
test("T-12 listings (4p) → Pro (only Pro covers listings)", () => { const r = run({ core_pages: 4, components: { listings: true } }); assert.equal(r.bundle?.tier, "pro"); });
test("T-13 bilingual (2p) → Standard+bilingual (Présence invalid w/ component)", () => { const r = run({ core_pages: 2, bilingual_mirror: true }); assert.equal(r.bundle?.tier, "standard"); });
test("T-14 e-commerce (Shopify) → review + ecommerce line", () => { const r = mapTier(base({ core_pages: 3, detected_platform: "shopify" }), P); assert.equal(r.review_required, true); assert.ok(r.bundle?.addons.includes("ecommerce")); });
test("T-15 bilingual+booking+listings (6p) → Pro (all included)", () => { const r = run({ core_pages: 6, bilingual_mirror: true, components: { booking: true, listings: true } }); assert.equal(r.bundle?.tier, "pro"); assert.equal(r.indicative_total, PRO); });

// ---- 27.5 blog rule ----
test("T-16 blog ≥ 5 → SEO migration auto-included (code)", () => { const r = run({ core_pages: 3, blog_posts: 5 }); assert.ok(r.bundle?.addons.includes("seo_migration")); assert.equal(r.indicative_total, STANDARD + SEO); assert.ok(r.reasons.includes("blog_migration_included")); });
test("T-17 blog < 5 → suggestion emitted with price (30.6) + code (30.5)", () => { const r = run({ core_pages: 3, blog_posts: 4 }); assert.ok(!r.bundle?.addons.includes("seo_migration")); assert.ok(r.reasons.includes("blog_migration_suggested")); assert.deepEqual(r.suggested_addons.find((s) => s.id === "seo_migration"), { id: "seo_migration", amount: SEO }); });
test("T-27 has_brand_assets:false → logo_refresh suggestion with config price (30.6)", () => { const r = run({ core_pages: 3, has_brand_assets: false }); assert.deepEqual(r.suggested_addons.find((s) => s.id === "logo_refresh"), { id: "logo_refresh", amount: LOGO }); });
test("T-28 reasons are stable snake_case codes; prose stays in reason_text (30.5)", () => { const r = run({ core_pages: 3, bilingual_mirror: true }); assert.ok(r.reasons.every((c) => /^[a-z0-9_]+$/.test(c)), "codes are snake_case"); assert.ok(r.reasons.includes("cheapest_bundle") && r.reasons.includes("bilingual_addon")); assert.ok(r.reason_text.length === r.reasons.length && r.reason_text.some((t) => /add-on/.test(t)), "prose parallels codes"); });

// ---- 27.6 blocking conditions ----
test("T-18 needs_browser → review", () => assert.equal(run({ needs_browser: true }).review_required, true));
test("T-19 robots_blocked → review", () => assert.equal(run({ review_flags: ["robots_blocked"] }).review_required, true));
test("T-20 partial → review", () => assert.equal(run({ partial: true }).review_required, true));
test("T-21 parked → no bundle, review (greenfield)", () => { const r = run({ review_flags: ["parked"] }); assert.equal(r.bundle, null); assert.equal(r.review_required, true); });
test("T-22 no_owned_site → no bundle, review (greenfield)", () => assert.equal(run({ review_flags: ["no_owned_site"] }).bundle, null));
test("T-23 no_html → no bundle, review (greenfield)", () => assert.equal(run({ review_flags: ["no_html"] }).bundle, null));
test("T-24 bilingual_suspected → review (bundle still computed)", () => { const r = run({ review_flags: ["bilingual_suspected"] }); assert.equal(r.review_required, true); assert.ok(r.bundle); });
test("T-25 anti_bot → review", () => assert.equal(run({ review_flags: ["anti_bot"] }).review_required, true));

// ---- config-drift guard ----
test("T-26 totals are read from config, not hardcoded", () => { assert.equal(run({ core_pages: 1 }).indicative_total, P.tiers.presence.price_cents); });
