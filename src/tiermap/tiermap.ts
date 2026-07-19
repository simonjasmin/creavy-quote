// #27 tier-mapping engine. PURE function of the decision-#8 scan result + pricing
// config — NO model call (that's stage 2). Cheapest valid bundle (27.3); Pro only
// when it is actually the cheapest way to cover the needs. Supersedes SPEC §8's
// pseudocode. Invariant #1 holds: this computes the price; it never asks a model.

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
};

export type TierBundle = { tier: string; addons: string[]; modifiers: string[] };
export type TierResult = { bundle: TierBundle | null; indicative_total: number | null; review_required: boolean; reasons: string[] };

const flatCents = (config: PricingConfig, key: string): number => {
  const p = config.addons[key]?.price;
  return p && p.kind === "flat" ? p.cents : 0;
};

export function mapTier(input: TierMapInput, config: PricingConfig): TierResult {
  const tm = config.tiermap;
  const reasons: string[] = [];
  const flags = new Set(input.review_flags);
  const pages = input.core_pages;

  const bilingual = input.bilingual_mirror;
  const booking = !!input.components?.booking;
  const listings = !!input.components?.listings;
  const ecommerce = !!input.components?.ecommerce || input.detected_platform === "shopify"; // 27.4
  const blogHeavy = input.blog_posts >= tm.blog_seo_threshold; // 27.5

  // ---- 27.6 hard blockers → no auto-bundle, email-capture ----
  if (flags.has("no_owned_site") || flags.has("parked") || flags.has("no_html")) {
    reasons.push("greenfield — nothing to price; skip stage-2");
    return { bundle: null, indicative_total: null, review_required: true, reasons };
  }
  if (pages === "30+") { reasons.push("30+ pages — out-of-scope path, book a call"); return { bundle: null, indicative_total: null, review_required: true, reasons }; }
  if (typeof pages === "number" && pages >= tm.review_pages) { reasons.push(`${pages} core pages ≥ ${tm.review_pages} — unusual shape, a human decides`); return { bundle: null, indicative_total: null, review_required: true, reasons }; }

  const n = typeof pages === "number" ? Math.max(1, pages) : 1;

  // ---- 27.6 soft review triggers (bundle still computed for the founder panel) ----
  let review = false;
  const soft = (cond: boolean, why: string) => { if (cond) { review = true; reasons.push(why); } };
  soft(flags.has("bilingual_suspected"), "bilingual suspected — human confirms scope (never silently priced)");
  soft(ecommerce, "e-commerce → sur mesure (human_quote, #21)");
  soft(input.needs_browser, "needs a closer look (JS-heavy)");
  soft(flags.has("robots_blocked"), "robots blocked — limited view");
  soft(input.partial, "partial scan");
  soft(flags.has("anti_bot"), "anti-bot challenge");

  // ---- 27.3 cheapest valid bundle ----
  const extra = flatCents(config, "extra_page"), biAdd = flatCents(config, "bilingual"), bkAdd = flatCents(config, "booking");
  const proInc = new Set(tm.pro_includes);
  const cands: { tier: string; total: number; addons: string[] }[] = [];

  // Présence — 1-2 simple pages, no heavy component
  if (n <= tm.presence_max_pages && !bilingual && !booking && !listings)
    cands.push({ tier: "presence", total: config.tiers.presence.price_cents, addons: [] });
  // Standard — bilingual/booking as add-ons, extra pages stacked; no listings add-on exists
  if (n <= tm.pro_base_pages && !listings) {
    const ep = Math.max(0, n - tm.standard_base_pages);
    if (ep <= tm.extra_page_cap) {
      const addons = [...Array(ep).fill("extra_page"), ...(bilingual ? ["bilingual"] : []), ...(booking ? ["booking"] : [])];
      cands.push({ tier: "standard", total: config.tiers.standard.price_cents + ep * extra + (bilingual ? biAdd : 0) + (booking ? bkAdd : 0), addons });
    }
  }
  // Pro — includes bilingual/booking/listings flat
  if (n <= tm.pro_base_pages) {
    const addons = [...(bilingual && !proInc.has("bilingual") ? ["bilingual"] : []), ...(booking && !proInc.has("booking") ? ["booking"] : [])];
    cands.push({ tier: "pro", total: config.tiers.pro.price_cents, addons });
  }

  if (cands.length === 0) { reasons.push("no clean bundle covers this shape — review"); return { bundle: null, indicative_total: null, review_required: true, reasons }; }
  cands.sort((a, b) => a.total - b.total || a.addons.length - b.addons.length); // cheapest; tie → simpler
  const best = cands[0];
  reasons.push(`cheapest bundle: ${best.tier} (${(best.total / 100).toFixed(0)} CAD)${best.addons.length ? " + " + best.addons.join(", ") : ""}`);
  if (best.tier === "pro" && bilingual) reasons.push("bilingual included in Pro");

  const addons = [...best.addons];
  let total = best.total;
  if (blogHeavy) { addons.push("seo_migration"); total += flatCents(config, "seo_migration"); reasons.push("blog ≥ threshold: SEO migration audit included — rankings worth preserving"); }
  else if (input.blog_posts > 0) reasons.push(`${input.blog_posts} blog posts — SEO migration suggested (below the ${tm.blog_seo_threshold} auto-threshold)`);
  if (ecommerce) addons.push("ecommerce"); // human_quote line; contributes nothing to indicative_total

  return { bundle: { tier: best.tier, addons, modifiers: [] }, indicative_total: total, review_required: review, reasons };
}
