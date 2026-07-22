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

// #31 analysis_details — whitelisted. #31.1 grows it to SEVEN items (adds page_titles +
// blog_posts, both DETERMINISTIC scan facts, no confidence gating). The firewall is unchanged:
// the model's analysis stays behind the email; internals never ship here.
const TITLE_CAP = 80;
function analysisDetails(scan: ScanResult): { item: string; value: unknown }[] {
  const out: { item: string; value: unknown }[] = [];
  const p = scan.detected_platform;
  if (scan.detected_platform_confidence === "high" && p && !["none", "unknown", "custom"].includes(p)) out.push({ item: "platform", value: p });
  if (typeof scan.core_pages === "number") out.push({ item: "pages", value: scan.core_pages });
  out.push({ item: "language", value: scan.bilingual_mirror ? "fr_en" : "fr" });
  if (p === "shopify") out.push({ item: "ecommerce", value: true });
  if (scan.canonical_origin.startsWith("https://")) out.push({ item: "https", value: true });
  // #31.1 page_titles — up to 5 core-page titles from retained Option-C content (literal); omit if empty.
  const titles = (scan.page_content ?? []).map((pc) => (pc.title || "").trim()).filter(Boolean).slice(0, 5)
    .map((t) => (t.length > TITLE_CAP ? t.slice(0, TITLE_CAP - 1).trimEnd() + "…" : t));
  if (titles.length) out.push({ item: "page_titles", value: titles });
  // #31.1 blog_posts — the count, only when > 0.
  if (typeof scan.blog_posts === "number" && scan.blog_posts > 0) out.push({ item: "blog_posts", value: scan.blog_posts });
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
        result: { bundle: t.bundle, indicative_total: t.indicative_total, base: t.base ? { ...t.base, from: "declared" } : t.base, additions: t.additions, currency: "CAD", suggested_addons: t.suggested_addons, care_plan_monthly: care, reasons: [...t.reasons, "declared_basis"] },
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
  const highConf = scan.detected_platform_confidence === "high" && !["none", "unknown"].includes(scan.detected_platform);
  const platformField = highConf ? { detected_platform: scan.detected_platform, confidence_platform: "high" } : { detected_platform: "unknown" };

  // #35 size-estimation band → estimation register with the config-derived range (7..size_band_max)
  if (t.range) {
    // #27.9 rider 3 — decomposition reconciles to range.min (scanned-basis layout floor)
    const result: Record<string, unknown> = { range: t.range, base: t.base, additions: t.additions, currency: "CAD", confidence: "medium", suggested_addons: t.suggested_addons, reasons: t.reasons, core_pages: scan.core_pages, ...platformField };
    const ad = analysisDetails(scan); // #31 panel on estimation too (same whitelist + #23 gating)
    if (ad.length) result.analysis_details = ad;
    return { status: "completed", body: { indicative: true, basis: "scanned", register: "estimation", review_required: true, result } };
  }

  // review with no price (30+, greenfield content, > band ceiling)
  if (!t.bundle) {
    const code = reviewReasonCode(t.reasons, scan.review_flags);
    return { status: "completed", body: { indicative: true, basis: "scanned", review_required: true, result: { reason_code: code, currency: "CAD", reasons: [code] } } };
  }

  // #36 — a conflict needs an ANSWERED page band; absent → no declared band, register from scan alone.
  const bandConflict = answers.pages != null && typeof scan.core_pages === "number" && pagesToBand(scan.core_pages) !== answers.pages;

  // ---- estimation: band disagreement (30.1) OR a soft review trigger (#29.4) ----
  if (bandConflict || t.review_required) {
    // #27.9 rider 3 — range.min is the SCANNED-basis floor (t.indicative_total); a declared band
    // never moves it below the evidence (the mistap, symmetric to declaring more). The
    // decomposition (t.base + t.additions) reconciles to range.min exactly.
    const min = t.indicative_total!;
    const adEst = analysisDetails(scan); // #31 panel on the soft/band-conflict estimation too
    return {
      status: "completed",
      body: {
        indicative: true, basis: "scanned", register: "estimation", review_required: true,
        result: {
          range: { min, max: proTotal }, base: t.base, additions: t.additions, currency: "CAD", confidence: bandConflict ? "low" : "medium",
          suggested_addons: t.suggested_addons, reasons: bandConflict ? ["declared_scan_conflict"] : t.reasons,
          core_pages: scan.core_pages, ...platformField,
          ...(adEst.length ? { analysis_details: adEst } : {}),
        },
      },
    };
  }

  // ---- flat: bands agree, no review ----
  const result: Record<string, unknown> = {
    bundle: t.bundle, indicative_total: t.indicative_total, base: t.base, additions: t.additions, currency: "CAD",
    suggested_addons: t.suggested_addons, care_plan_monthly: care, reasons: t.reasons,
    core_pages: scan.core_pages, detected_platform: highConf ? scan.detected_platform : "unknown", confidence: scan.detected_platform_confidence,
  };
  const ad = analysisDetails(scan);
  if (ad.length) result.analysis_details = ad;
  return { status: "completed", body: { indicative: true, basis: "scanned", register: "flat", review_required: false, result } };
}
