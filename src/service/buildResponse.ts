// The contract v0.4 response builder — the #27 mapper + the #30.1/30.2 reconciliation
// layer, translated into the exact GET /quote/:id body. Every example E2…E8 is pinned by
// the conformance tests. Prices come from config, never literals. The mapper owns the
// number (invariant #1); this only shapes it and adds crawl-derived fields + #31 panel.

import { mapTier, type TierMapInput } from "../tiermap/tiermap.ts";
import type { PricingConfig } from "../pricing/loadPricingConfig.ts";
import type { Answers } from "./validate.ts";
import type { ScanResult } from "../crawl/scan.ts";

const bandToPages = (b: Answers["pages"]): number => (b === "1_2" ? 2 : b === "3_4" ? 4 : 6);
const pagesToBand = (n: number): Answers["pages"] => (n <= 2 ? "1_2" : n <= 4 ? "3_4" : "5_plus");
const componentsOf = (c: Answers["component"]) => ({ booking: c === "booking" || c === "both", listings: c === "listings" || c === "both" });

const TRANSPORT_FAIL = new Set(["unreachable", "host_down", "slow_host", "tls_invalid"]);

export type BuiltResponse = { status: "completed" | "failed"; body: Record<string, unknown> };

function reviewReasonCode(mapperReasons: string[], reviewFlags: string[]): string {
  if (mapperReasons.includes("out_of_scope_30_plus")) return "out_of_scope";
  if (mapperReasons.includes("greenfield_no_price")) {
    for (const f of ["no_owned_site", "parked", "no_html"]) if (reviewFlags.includes(f)) return f;
    return "greenfield";
  }
  return "needs_review";
}

// #31 analysis_details — whitelisted, high-confidence-only, https true-only, no booking.
function analysisDetails(scan: ScanResult): { item: string; value: unknown }[] {
  const out: { item: string; value: unknown }[] = [];
  const p = scan.detected_platform;
  if (scan.detected_platform_confidence === "high" && p && !["none", "unknown", "custom"].includes(p)) out.push({ item: "platform", value: p });
  if (typeof scan.core_pages === "number") out.push({ item: "pages", value: scan.core_pages });
  out.push({ item: "language", value: scan.bilingual_mirror ? "fr_en" : "fr" });
  if (p === "shopify") out.push({ item: "ecommerce", value: true });
  if (scan.canonical_origin.startsWith("https://")) out.push({ item: "https", value: true });
  return out;
}

export function buildQuoteResponse(args: { scan: ScanResult | null; answers: Answers; no_site: boolean }, config: PricingConfig): BuiltResponse {
  const { scan, answers, no_site } = args;
  const proTotal = config.tiers.pro.price_cents;
  const care = config.care_plan.monthly_cents;

  // ---- declared (no_site) — price the DESIRED build from answers, no crawl fields ----
  if (no_site || !scan) {
    const input: TierMapInput = {
      core_pages: bandToPages(answers.pages), blog_posts: 0, bilingual_mirror: answers.languages === "fr_en",
      detected_platform: "unknown", needs_browser: false, partial: false, review_flags: [],
      components: componentsOf(answers.component), has_brand_assets: answers.has_brand_assets,
    };
    const t = mapTier(input, config);
    if (!t.bundle) {
      return { status: "completed", body: { indicative: true, basis: "declared", review_required: true, result: { reason_code: reviewReasonCode(t.reasons, []), currency: "CAD", reasons: [reviewReasonCode(t.reasons, [])] } } };
    }
    return {
      status: "completed",
      body: {
        indicative: true, basis: "declared", register: "flat", review_required: false,
        result: { bundle: t.bundle, indicative_total: t.indicative_total, currency: "CAD", suggested_addons: t.suggested_addons, care_plan_monthly: care, reasons: [...t.reasons, "declared_basis"] },
      },
    };
  }

  // ---- scanned: transport failures → failed (uniform, no SSRF oracle) ----
  if (scan.review_flags.includes("nxdomain_greenfield")) return { status: "failed", body: { indicative: true, reason: "nxdomain_greenfield", book_a_call: true } };
  if (scan.review_flags.some((f) => TRANSPORT_FAIL.has(f))) return { status: "failed", body: { indicative: true, reason: "unreachable", book_a_call: true } };

  // scanned facts + declared needs ADD (never erase evidence, 30.1)
  const input: TierMapInput = {
    core_pages: scan.core_pages, blog_posts: scan.blog_posts,
    bilingual_mirror: scan.bilingual_mirror || answers.languages === "fr_en",
    detected_platform: scan.detected_platform, needs_browser: scan.needs_browser, partial: scan.partial,
    review_flags: scan.review_flags, components: componentsOf(answers.component), has_brand_assets: answers.has_brand_assets,
  };
  const t = mapTier(input, config);

  // review with no price (30+, greenfield content, unusual size)
  if (!t.bundle) {
    const code = reviewReasonCode(t.reasons, scan.review_flags);
    return { status: "completed", body: { indicative: true, basis: "scanned", review_required: true, result: { reason_code: code, currency: "CAD", reasons: [code] } } };
  }

  const highConf = scan.detected_platform_confidence === "high" && !["none", "unknown"].includes(scan.detected_platform);
  const bandConflict = typeof scan.core_pages === "number" && pagesToBand(scan.core_pages) !== answers.pages;

  // ---- estimation: band disagreement (30.1) OR a soft review trigger (#29.4) ----
  if (bandConflict || t.review_required) {
    let min = t.indicative_total!;
    if (bandConflict) {
      const declaredT = mapTier({ ...input, core_pages: bandToPages(answers.pages) }, config);
      if (declaredT.indicative_total != null) min = Math.min(min, declaredT.indicative_total);
    }
    const platformField = highConf ? { detected_platform: scan.detected_platform, confidence_platform: "high" } : { detected_platform: "unknown" };
    return {
      status: "completed",
      body: {
        indicative: true, basis: "scanned", register: "estimation", review_required: true,
        result: {
          range: { min, max: proTotal }, currency: "CAD", confidence: bandConflict ? "low" : "medium",
          suggested_addons: t.suggested_addons, reasons: bandConflict ? ["declared_scan_conflict"] : t.reasons,
          core_pages: scan.core_pages, ...platformField,
        },
      },
    };
  }

  // ---- flat: bands agree, no review ----
  const result: Record<string, unknown> = {
    bundle: t.bundle, indicative_total: t.indicative_total, currency: "CAD",
    suggested_addons: t.suggested_addons, care_plan_monthly: care, reasons: t.reasons,
    core_pages: scan.core_pages, detected_platform: highConf ? scan.detected_platform : "unknown", confidence: scan.detected_platform_confidence,
  };
  const ad = analysisDetails(scan);
  if (ad.length) result.analysis_details = ad;
  return { status: "completed", body: { indicative: true, basis: "scanned", register: "flat", review_required: false, result } };
}
