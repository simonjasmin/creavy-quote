// scan(url) — the fast-path composition. normalize → canonical origin → robots →
// sitemap | link-crawl → bounder → fingerprint → the decision-#8 result object.
// Zero browser: needs_browser is an OUTPUT, never a code path.

import type { Transport, Clock, BounderResult } from "./types.ts";
import { emptyBounder } from "./types.ts";
import { normalize } from "../url/normalize.ts";
import { resolveCanonical } from "./canonical.ts";
import { fetchRobots } from "./robots.ts";
import { crawlSitemaps } from "./sitemap.ts";
import {
  countFromLinks, detectParked, detectUnderConstruction, isAntiBot, noHtmlContentType,
  escalationReasons, capHtml, classifyTransportError,
} from "./bounder.ts";
import { fingerprint } from "../fingerprint/fingerprint.ts";
import { type ScanEventEmitter, NOOP_EMITTER } from "./events.ts";
import { inferRootLang } from "./langDetect.ts";
import { PoliteScheduler } from "./scheduler.ts";
import { resolveBilingual, extractHeadHreflang } from "./bilingual.ts";
import { extractPageContent, type PageContent } from "./pageContent.ts";
import { pricingConfig } from "../pricing/index.ts";

// #32 A1 — retained Option-C content rides the scan result (never a pricing input).
export type ScanResult = BounderResult & {
  detected_platform: string;
  detected_platform_confidence: "high" | "medium" | "low"; // #23: gates naming the platform in prose
  builders_detected: string[];
  page_content: PageContent[];
};

const normId = (u: string): string => { const nn = normalize(u); return nn.ok ? nn.identity : u; };

// Dedup retained pages by normalized identity, keeping the first (homepage-first).
function dedupContent(pages: PageContent[]): PageContent[] {
  const seen = new Set<string>();
  const out: PageContent[] = [];
  for (const p of pages) { const id = normId(p.url); if (seen.has(id)) continue; seen.add(id); out.push(p); }
  return out;
}

function finalize(base: BounderResult, extra: Partial<ScanResult>): ScanResult {
  const merged = { page_content: [] as PageContent[], detected_platform_confidence: "low" as const, ...base, ...extra } as ScanResult;
  merged.review_flags = [...new Set(merged.review_flags)];
  merged.needs_browser_reasons = [...new Set(merged.needs_browser_reasons)];
  merged.needs_browser = merged.needs_browser || merged.needs_browser_reasons.length > 0;
  return merged;
}

export async function scan(transport: Transport, clock: Clock, inputUrl: string, emitter: ScanEventEmitter = NOOP_EMITTER): Promise<ScanResult> {
  emitter.emit("scan_started", { url: inputUrl });
  const n = normalize(inputUrl);
  const startUrl = n.ok ? n.identity : inputUrl;
  emitter.emit("url_normalized", { host: n.ok ? n.host : inputUrl });

  if (n.ok && n.classification === "no_owned_site") { // N-22
    emitter.emit("review_flag_raised", { flag: "no_owned_site" }); emitter.emit("scan_complete", {});
    return finalize(emptyBounder("https://" + n.host), { detected_platform: "none", builders_detected: [], review_flags: ["no_owned_site"] });
  }
  if (n.ok && n.classification === "platform_profile") { // N-23
    emitter.emit("review_flag_raised", { flag: "platform_profile" }); emitter.emit("scan_complete", {});
    return finalize(emptyBounder("https://" + n.host), { detected_platform: "unknown", builders_detected: [], review_flags: ["platform_profile"] });
  }

  const canon = await resolveCanonical(transport, startUrl);
  const base = emptyBounder(canon.origin);
  base.review_flags.push(...canon.review_flags, ...canon.notes.filter((x) => x === "host_ambiguous" || x === "domain_moved"));
  base.needs_browser_reasons.push(...canon.needs_browser_reasons);

  if (canon.error) { // D-32
    const c = classifyTransportError(canon.error.kind);
    return finalize(base, { core_pages: 0, review_flags: [...base.review_flags, c.flag], detected_platform: c.greenfield ? "none" : "unknown", builders_detected: [] });
  }

  const html = capHtml(canon.html).html;
  const headers = canon.headers;

  if (noHtmlContentType(headers)) // D-28
    return finalize(base, { core_pages: 0, review_flags: [...base.review_flags, "no_html"], detected_platform: "none", builders_detected: [] });
  if (detectParked(html)) // D-29
    return finalize(base, { core_pages: 0, review_flags: [...base.review_flags, "parked"], detected_platform: "none", builders_detected: [] });
  if (detectUnderConstruction(html)) base.review_flags.push("under_construction"); // D-30
  if (isAntiBot(html, headers)) base.review_flags.push("anti_bot"); // D-24

  const rootLang = inferRootLang(html); // #26: content-inferred root-tree language
  const scheduler = new PoliteScheduler(transport, clock); // thread 6: composition-level politeness (D-34)

  const robots = await fetchRobots(transport, canon.origin);
  emitter.emit("robots_checked", { blocked: robots.source === "disallow_all" || !robots.allows("/") });

  let core: number | "30+" = 1;
  let blog = 0;
  let excluded = { archives: 0, media: 0, soft_404: 0, external: 0 };
  let languages: string[] = [];
  let bilingual = false;
  let partial = false;
  let sitemapFound = false;
  let pairingEvidence: string | undefined;
  let sampled: PageContent[] = []; // #32 A1: sitemap-sample page content (link-crawl retains homepage only)

  if (robots.source === "disallow_all" || !robots.allows("/")) { // #12/R-10 full block → homepage only
    base.review_flags.push("robots_blocked");
    if (robots.source === "disallow_all") base.review_flags.push("review:robots");
    core = 1;
  } else {
    const sm = await crawlSitemaps(transport, canon.origin, robots.sitemaps, emitter, rootLang, scheduler);
    const smTrusted = sm.found && !sm.review_flags.includes("stale_sitemap") && !sm.review_flags.includes("sitemap_off_domain_distrust");
    if (sm.found) emitter.emit("sitemap_found", { count: sm.overflow ? "30+" : sm.core.length }); else emitter.emit("sitemap_absent", {});
    if (smTrusted) {
      sitemapFound = true;
      sampled = sm.sampledContent; // #32 A1: full-core content on the sitemap path
      // #28 evidence ladder: homepage-head hreflang + sitemap xhtml:link alternates → path → tree.
      const hreflangGroups = [extractHeadHreflang(html), ...sm.alternates].filter((g) => g.length >= 2);
      const bi = resolveBilingual(sm.coreRaw, { rootLang, hreflangGroups, sampledLangByUrl: sm.sampledLangs, thresholds: pricingConfig.bilingual });
      pairingEvidence = bi.pairing_evidence;
      core = sm.overflow ? "30+" : Math.max(1, bi.core_urls.length - sm.excluded.soft_404); // #28 pairing dedup + thread 7
      blog = sm.blog; excluded = sm.excluded;
      languages = bi.languages; bilingual = bi.bilingual_mirror; partial = sm.partial;
      base.review_flags.push(...sm.review_flags.filter((f) => f !== "bilingual_suspected")); // the ladder re-decides
      if (bi.suspected) base.review_flags.push("bilingual_suspected");
      if (pairingEvidence) base.review_flags.push("pairing_evidence:" + pairingEvidence); // reasons[] (internal)
    } else {
      const cnt = countFromLinks(canon.final_url, html, canon.origin, rootLang); // link-crawl fallback (S-02/S-20)
      core = cnt.core_pages; blog = cnt.blog_posts; excluded = cnt.excluded;
      languages = cnt.languages; bilingual = cnt.bilingual_mirror; partial = cnt.partial;
      base.review_flags.push(...sm.review_flags, ...cnt.review_flags);
    }
  }

  for (const r of escalationReasons(html, sitemapFound)) base.needs_browser_reasons.push(r); // D-22/D-23

  const fp = fingerprint([{ url: canon.final_url, status: canon.status, headers, body: html }]);

  // Event spine (#24) — every event is a fact just computed; fire-and-forget.
  emitter.emit("platform_detected", { platform: fp.platform, builder: fp.builder ?? null, confidence: fp.confidence });
  if (fp.builder) emitter.emit("builder_detected", { builder: fp.builder, confidence: fp.confidence });
  if (bilingual) emitter.emit("bilingual_paired", { languages, pairing_evidence: pairingEvidence }); // the moat line (evidence internal-only)
  if (blog > 0) emitter.emit("blog_classified", { count: blog });
  emitter.emit("core_count_progress", { count: core });
  if (base.needs_browser_reasons.length) emitter.emit("needs_browser", { reasons: base.needs_browser_reasons });
  for (const f of new Set(base.review_flags)) emitter.emit("review_flag_raised", { flag: f });
  if (partial) emitter.emit("scan_partial", {});
  emitter.emit("scan_complete", {});

  // #32 A1: homepage content always retained; sitemap path adds the sampled core pages.
  // For an assessable site (≤6 core, all sampled), this is 100 % core-page coverage.
  const page_content = dedupContent([extractPageContent(canon.final_url, html), ...sampled]);

  return finalize(base, {
    core_pages: core, blog_posts: blog, excluded, languages, bilingual_mirror: bilingual,
    partial, detected_platform: fp.platform, detected_platform_confidence: fp.confidence,
    builders_detected: fp.builders_detected, page_content,
  });
}
