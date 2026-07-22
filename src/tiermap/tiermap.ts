// #27 tier-mapping engine. PURE function of the decision-#8 scan result + pricing
// config — NO model call (that's stage 2). Cheapest valid bundle (27.3); Pro only
// when it is actually the cheapest way to cover the needs. Supersedes SPEC §8's
// pseudocode. Invariant #1 holds: this computes the price; it never asks a model.
//
// #30.5 — `reasons` are STABLE snake_case codes (append-only, never renamed); the
// human prose lives in `reason_text` and NEVER crosses the API.
// #30.6 — `suggested_addons: [{id, amount}]`, amounts read from config at emit time.

import type { PricingConfig } from "../pricing/loadPricingConfig.ts";

export type TierMapInput = {
  core_pages: number | "30+";
  blog_posts: number;
  bilingual_mirror: boolean;
  detected_platform: string;
  needs_browser: boolean;
  partial: boolean;
  review_flags: string[];
  components?: { booking?: boolean; listings?: boolean; ecommerce?: boolean };
  has_brand_assets?: boolean; // answer signal (addon suggestion only, #27.4/30.6)
};

export type TierBundle = { tier: string; addons: string[]; modifiers: string[] };
export type Suggestion = { id: string; amount: number };
export type PriceRange = { min: number; max: number };
// #27.9 price decomposition: base = scanned-pages tier (from scan ONLY), additions = config-
// priced refinement lines; a tier bump (→Standard/→Pro) is ONE `<tier>_bundle` line with
// `covers`. Invariant: base.amount + Σ additions.amount === total (flat) / range.min (estimation).
export type PriceBase = { tier: string; amount: number; from: "scan" };
export type Addition = { code: string; label_key: string; amount: number; covers?: string[] };
export type TierResult = {
  bundle: TierBundle | null;
  indicative_total: number | null;
  range?: PriceRange | null; // #35 size-estimation band — an instant range, exact price human-confirmed
  base?: PriceBase | null; // #27.9 decomposition anchor (scanned-pages tier); may differ from bundle.tier
  additions?: Addition[]; // #27.9 refinement line items (+ the tier-bump bundle line)
  review_required: boolean;
  reasons: string[]; // #30.5 stable codes (append-only)
  reason_text: string[]; // internal prose — never returned by the API
  suggested_addons: Suggestion[]; // #30.6 {id, amount cents}
};

// The scanned-pages tier bundle — Presence(≤2) / Standard(3-4) / Standard+extra(5-6). NO
// components, NO bilingual → INVARIANT to every declared answer (the mistap is unreachable).
export function pageBaseBundle(scannedCore: number, config: PricingConfig): { tier: string; amount: number } {
  const tm = config.tiermap;
  if (scannedCore <= tm.presence_max_pages) return { tier: "presence", amount: config.tiers.presence.price_cents };
  const ep = Math.max(0, scannedCore - tm.standard_base_pages);
  return { tier: "standard", amount: config.tiers.standard.price_cents + ep * flatCents(config, "extra_page") };
}

const flatCents = (config: PricingConfig, key: string): number => {
  const p = config.addons[key]?.price;
  return p && p.kind === "flat" ? p.cents : 0;
};

// #35 range derivation — ENUMERATOR ONLY, pure config arithmetic (no freehand numbers).
// lower = cheapest #27.3 bundle at the layout-reuse floor (distinct layouts = min(core, pro_base));
// upper = page = layout (no reuse) = Standard + extra_page × (core − standard_base).
const cheapestBundle = (n: number, config: PricingConfig): number => {
  const tm = config.tiermap, extra = flatCents(config, "extra_page"), opts: number[] = [];
  if (n <= tm.presence_max_pages) opts.push(config.tiers.presence.price_cents);
  const ep = Math.max(0, n - tm.standard_base_pages);
  if (n <= tm.pro_base_pages && ep <= tm.extra_page_cap) opts.push(config.tiers.standard.price_cents + ep * extra);
  if (n <= tm.pro_base_pages) opts.push(config.tiers.pro.price_cents);
  return Math.min(...opts);
};
export const sizeBandRange = (core: number, config: PricingConfig): PriceRange => {
  const tm = config.tiermap;
  const min = cheapestBundle(Math.min(core, tm.pro_base_pages), config); // layout-reuse floor
  const max = config.tiers.standard.price_cents + flatCents(config, "extra_page") * Math.max(0, core - tm.standard_base_pages); // page = layout
  return { min, max };
};

export function mapTier(input: TierMapInput, config: PricingConfig): TierResult {
  const tm = config.tiermap;
  const codes: string[] = [];
  const text: string[] = [];
  const say = (code: string, prose: string) => { codes.push(code); text.push(prose); };
  const flags = new Set(input.review_flags);
  const pages = input.core_pages;

  const bilingual = input.bilingual_mirror;
  const booking = !!input.components?.booking;
  const listings = !!input.components?.listings;
  const ecommerce = !!input.components?.ecommerce || input.detected_platform === "shopify"; // 27.4
  const blogHeavy = input.blog_posts >= tm.blog_seo_threshold; // 27.5

  // suggested_addons (30.6) — independent of tier; only when a bundle is offered.
  const suggestions = (): Suggestion[] => {
    const out: Suggestion[] = [];
    if (!blogHeavy && input.blog_posts > 0) out.push({ id: "seo_migration", amount: flatCents(config, "seo_migration") }); // 27.5 below-threshold
    if (input.has_brand_assets === false) out.push({ id: "logo_refresh", amount: flatCents(config, "logo_refresh") }); // 30.6
    return out;
  };
  const blocked = (code: string, prose: string): TierResult => {
    say(code, prose);
    return { bundle: null, indicative_total: null, review_required: true, reasons: codes, reason_text: text, suggested_addons: [] };
  };

  // ---- 27.6 hard blockers → no auto-bundle, email-capture ----
  if (flags.has("no_owned_site") || flags.has("parked") || flags.has("no_html")) return blocked("greenfield_no_price", "greenfield — nothing to price; skip stage-2");
  if (pages === "30+") return blocked("out_of_scope_30_plus", "30+ pages — out-of-scope path, book a call");
  if (typeof pages === "number" && pages >= tm.review_pages) {
    // #35 size-estimation band: a CLEAN 7..size_band_max site (no component, no OTHER review
    // trigger) gets an honest instant RANGE — page-count stacking overprices template-repeated
    // pages (layouts ≠ pages). > band ceiling, or any other complexity, → pure review as before.
    const otherTrigger = booking || listings || ecommerce || input.needs_browser || input.partial
      || flags.has("robots_blocked") || flags.has("anti_bot") || flags.has("bilingual_suspected");
    if (pages <= tm.size_band_max && !otherTrigger) {
      say("size_estimation_band", `${pages} core pages — layouts ≠ pages: an instant range, exact price human-confirmed`);
      const range = sizeBandRange(pages, config);
      // #27.9 rider 3 — the decomposition reconciles to range.min (the scanned-basis layout-floor
      // bundle); it's entirely page/layout-driven, so the whole floor sits in base, additions=[].
      const band = pageBaseBundle(Math.min(pages, tm.pro_base_pages), config);
      return { bundle: null, indicative_total: null, range, base: { tier: band.tier, amount: range.min, from: "scan" }, additions: [], review_required: true, reasons: codes, reason_text: text, suggested_addons: suggestions() };
    }
    return blocked("review_unusual_size", `${pages} core pages > ${tm.size_band_max} (or added complexity) — unusual shape, a human decides`);
  }

  const n = typeof pages === "number" ? Math.max(1, pages) : 1;

  // ---- 27.6 soft review triggers (bundle still computed for the founder panel) ----
  let review = false;
  const soft = (cond: boolean, code: string, prose: string) => { if (cond) { review = true; say(code, prose); } };
  soft(flags.has("bilingual_suspected"), "bilingual_suspected_review", "bilingual suspected — human confirms scope (never silently priced)");
  soft(ecommerce, "ecommerce_human_quote", "e-commerce → sur mesure (human_quote, #21)");
  soft(input.needs_browser, "needs_closer_look", "needs a closer look (JS-heavy)");
  soft(flags.has("robots_blocked"), "robots_blocked", "robots blocked — limited view");
  soft(input.partial, "partial_scan", "partial scan");
  soft(flags.has("anti_bot"), "anti_bot_challenge", "anti-bot challenge");

  // ---- 27.3 cheapest valid bundle ----
  const extra = flatCents(config, "extra_page"), biAdd = flatCents(config, "bilingual"), bkAdd = flatCents(config, "booking");
  const proInc = new Set(tm.pro_includes);
  const cands: { tier: string; total: number; addons: string[] }[] = [];
  if (n <= tm.presence_max_pages && !bilingual && !booking && !listings)
    cands.push({ tier: "presence", total: config.tiers.presence.price_cents, addons: [] });
  if (n <= tm.pro_base_pages && !listings) {
    const ep = Math.max(0, n - tm.standard_base_pages);
    if (ep <= tm.extra_page_cap) cands.push({ tier: "standard", total: config.tiers.standard.price_cents + ep * extra + (bilingual ? biAdd : 0) + (booking ? bkAdd : 0), addons: [...Array(ep).fill("extra_page"), ...(bilingual ? ["bilingual"] : []), ...(booking ? ["booking"] : [])] });
  }
  if (n <= tm.pro_base_pages)
    cands.push({ tier: "pro", total: config.tiers.pro.price_cents, addons: [...(bilingual && !proInc.has("bilingual") ? ["bilingual"] : []), ...(booking && !proInc.has("booking") ? ["booking"] : [])] });

  if (cands.length === 0) return blocked("review_no_clean_bundle", "no clean bundle covers this shape — review");
  cands.sort((a, b) => a.total - b.total || a.addons.length - b.addons.length); // cheapest; tie → simpler
  const best = cands[0];
  say("cheapest_bundle", `cheapest bundle: ${best.tier} (${(best.total / 100).toFixed(0)} CAD)${best.addons.length ? " + " + best.addons.join(", ") : ""}`);
  if (listings && best.tier === "pro") say("listings_needs_pro", "listings has no Standard add-on — only Pro covers it");
  if (bilingual) best.tier === "pro" ? say("bilingual_included_pro", "bilingual included in Pro") : say("bilingual_addon", "bilingual priced as an add-on");

  const addons = [...best.addons];
  let total = best.total;
  if (blogHeavy) { addons.push("seo_migration"); total += flatCents(config, "seo_migration"); say("blog_migration_included", "blog ≥ threshold: SEO migration audit included — rankings worth preserving"); }
  else if (input.blog_posts > 0) say("blog_migration_suggested", `${input.blog_posts} blog posts — SEO migration suggested (below the ${tm.blog_seo_threshold} auto-threshold)`);
  if (ecommerce) addons.push("ecommerce"); // human_quote line; contributes nothing to indicative_total

  const { base, additions } = decompose({ total, bestTier: best.tier, n, bilingual, booking, listings, blogHeavy, config });
  return { bundle: { tier: best.tier, addons, modifiers: [] }, indicative_total: total, base, additions, review_required: review, reasons: codes, reason_text: text, suggested_addons: suggestions() };
}

// #27.9 Option B — decompose the CHOSEN (#27.3-cheapest) total into base + additions WITHOUT
// changing the total. base = scanned-pages tier (invariant to declared answers). When the
// bundle tier BUMPS above the page-base tier (a component/crossover forcing Standard or Pro),
// the whole bump is ONE `<tier>_bundle` line carrying `covers` (the site renders included
// features from payload). No bump → clean config-priced refinement lines. seo_migration is a
// standalone blog-driven line in either case. Invariant: base.amount + Σ additions === total.
function decompose(a: { total: number; bestTier: string; n: number; bilingual: boolean; booking: boolean; listings: boolean; blogHeavy: boolean; config: PricingConfig }): { base: PriceBase; additions: Addition[] } {
  const b = pageBaseBundle(a.n, a.config);
  const base: PriceBase = { tier: b.tier, amount: b.amount, from: "scan" };
  const additions: Addition[] = [];
  const seoAmt = a.blogHeavy ? flatCents(a.config, "seo_migration") : 0;
  if (a.bestTier !== b.tier) {
    const covers = [...(a.bilingual ? ["bilingual"] : []), ...(a.booking ? ["booking"] : []), ...(a.listings ? ["listings"] : [])];
    additions.push({ code: `${a.bestTier}_bundle`, label_key: `bundle.${a.bestTier}`, amount: a.total - base.amount - seoAmt, covers });
  } else {
    if (a.bilingual) additions.push({ code: "bilingual", label_key: "addon.bilingual", amount: flatCents(a.config, "bilingual") });
    if (a.booking) additions.push({ code: "booking", label_key: "addon.booking", amount: flatCents(a.config, "booking") });
  }
  if (a.blogHeavy) additions.push({ code: "seo_migration", label_key: "addon.seo_migration", amount: flatCents(a.config, "seo_migration") });
  return { base, additions };
}
