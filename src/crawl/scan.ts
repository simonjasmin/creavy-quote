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

export type ScanResult = BounderResult & { detected_platform: string; builders_detected: string[] };

function finalize(base: BounderResult, extra: Partial<ScanResult>): ScanResult {
  const merged = { ...base, ...extra } as ScanResult;
  merged.review_flags = [...new Set(merged.review_flags)];
  merged.needs_browser_reasons = [...new Set(merged.needs_browser_reasons)];
  merged.needs_browser = merged.needs_browser || merged.needs_browser_reasons.length > 0;
  return merged;
}

export async function scan(transport: Transport, _clock: Clock, inputUrl: string): Promise<ScanResult> {
  const n = normalize(inputUrl);
  const startUrl = n.ok ? n.identity : inputUrl;

  if (n.ok && n.classification === "no_owned_site") // N-22
    return finalize(emptyBounder("https://" + n.host), { detected_platform: "none", builders_detected: [], review_flags: ["no_owned_site"] });
  if (n.ok && n.classification === "platform_profile") // N-23
    return finalize(emptyBounder("https://" + n.host), { detected_platform: "unknown", builders_detected: [], review_flags: ["platform_profile"] });

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

  const robots = await fetchRobots(transport, canon.origin);

  let core: number | "30+" = 1;
  let blog = 0;
  let excluded = { archives: 0, media: 0, soft_404: 0, external: 0 };
  let languages: string[] = [];
  let bilingual = false;
  let partial = false;
  let sitemapFound = false;

  if (robots.source === "disallow_all" || !robots.allows("/")) { // #12/R-10 full block → homepage only
    base.review_flags.push("robots_blocked");
    if (robots.source === "disallow_all") base.review_flags.push("review:robots");
    core = 1;
  } else {
    const sm = await crawlSitemaps(transport, canon.origin, robots.sitemaps);
    const smTrusted = sm.found && !sm.review_flags.includes("stale_sitemap") && !sm.review_flags.includes("sitemap_off_domain_distrust");
    if (smTrusted) {
      sitemapFound = true;
      core = sm.overflow ? "30+" : Math.max(1, sm.core.length);
      blog = sm.blog; excluded = { ...sm.excluded, soft_404: 0 };
      languages = sm.languages; bilingual = sm.bilingual_mirror; partial = sm.partial;
      base.review_flags.push(...sm.review_flags);
    } else {
      const cnt = countFromLinks(canon.final_url, html, canon.origin); // link-crawl fallback (S-02/S-20)
      core = cnt.core_pages; blog = cnt.blog_posts; excluded = cnt.excluded;
      languages = cnt.languages; bilingual = cnt.bilingual_mirror; partial = cnt.partial;
      base.review_flags.push(...sm.review_flags, ...cnt.review_flags);
    }
  }

  for (const r of escalationReasons(html, sitemapFound)) base.needs_browser_reasons.push(r); // D-22/D-23

  const fp = fingerprint([{ url: canon.final_url, status: canon.status, headers, body: html }]);

  return finalize(base, {
    core_pages: core, blog_posts: blog, excluded, languages, bilingual_mirror: bilingual,
    partial, detected_platform: fp.platform, builders_detected: fp.builders_detected,
  });
}
