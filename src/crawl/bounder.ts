// Table D2/D3/D4 — counting & classification (D-09…D-21), escalation reasons
// (D-22…D-25), transport & content edges (D-26…D-33). Triage-grade: when
// ambiguous, emit a review flag, not a confident wrong number.

import type { Transport } from "./types.ts";
import { classifyLoc, CORE_CAP } from "./sitemap.ts";
import { pairBilingual, dedupByIdentity } from "./bilingual.ts";

export const HTML_READ_CAP = 2 * 1024 * 1024;
export const FETCH_CAP = 60;

function stripWww(h: string): string { return h.replace(/^www\./i, ""); }
function regDomain(h: string): string { return stripWww(h).split(".").slice(-2).join("."); }

export type LinkClass = "core" | "blog" | "archive" | "media" | "external" | "related_property" | "trap";

export type ExtractedLinks = { links: string[]; tel: boolean; mailto: boolean; canonical?: string; anchorOnly: boolean };

export function extractLinks(html: string, base: string): ExtractedLinks {
  const baseHref = (html.match(/<base[^>]+href=["']([^"']+)["']/i) || [])[1]; // D-12
  let b = base; if (baseHref) { try { b = new URL(baseHref, base).toString(); } catch {} }
  const links = new Set<string>();
  let tel = false, mailto = false, anyHref = false, anyReal = false;
  for (const m of html.matchAll(/<a\b[^>]*\shref=["']([^"']*)["']/gi)) {
    anyHref = true;
    let href = m[1].trim();
    if (href === "" || href.startsWith("#")) continue; // D-09 anchor nav is not a page
    if (/^mailto:/i.test(href)) { mailto = true; continue; } // D-10 contact signal
    if (/^tel:/i.test(href)) { tel = true; continue; } // D-10
    if (/^(javascript|data):/i.test(href)) continue;
    if (/\s/.test(href)) href = encodeURI(href); // D-13 encode unencoded space once
    anyReal = true;
    try { links.add(new URL(href, b).toString()); } catch {}
  }
  const canon = (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) || [])[1]; // D-14
  return { links: [...links], tel, mailto, canonical: canon ? (() => { try { return new URL(canon, b).toString(); } catch { return undefined; } })() : undefined, anchorOnly: anyHref && !anyReal };
}

export function classifyLink(url: string, origin: string): LinkClass {
  let u: URL, o: URL;
  try { u = new URL(url); o = new URL(origin); } catch { return "external"; }
  if (regDomain(u.hostname) !== regDomain(o.hostname)) return "external"; // D-11
  if (stripWww(u.hostname) !== stripWww(o.hostname)) return "related_property"; // D-20 subdomain
  const qCount = [...u.searchParams].length;
  if (/PHPSESSID/i.test(u.search) || /[?&](month|date|calendar|from|to)=/i.test(u.search) || qCount > 2) return "trap"; // D-19
  return classifyLoc(url); // core/blog/archive/media (D-17, S-19)
}

// D-18 soft-404 lives in sitemap.ts (shared content classification; avoids a cycle).
export { isSoft404 } from "./sitemap.ts";
export function detectParked(html: string): boolean { // D-29
  return /(domain (is |may be )?for sale|buy this domain|domain parking|sedoparking|parked (free|domain|by)|this domain is parked|acheter ce domaine)/i.test(html);
}
export function detectUnderConstruction(html: string): boolean { // D-30
  return /(under construction|coming soon|site en construction|en construction|bient[oô]t (disponible|en ligne)|maintenance mode|nous revenons)/i.test(html);
}
export function isAntiBot(html: string, headers: Record<string, string> = {}): boolean { // D-24
  return /(cf-browser-verification|cf_chl_|challenge-platform|Just a moment\.\.\.|Checking your browser before|Attention Required!|Enable JavaScript and cookies to continue|Access denied.*Ray ID)/i.test(html);
}
export function noHtmlContentType(headers: Record<string, string> = {}): boolean { // D-28
  return /(application\/pdf|^image\/)/i.test(headers["content-type"] || "");
}
export function escalationReasons(html: string, hasSitemap = true): string[] { // D-22, D-23
  const reasons: string[] = [];
  const hasScripts = /<script\b/i.test(html);
  const hasLinks = /<a\b[^>]*\shref=/i.test(html);
  const emptyRoot = /<div[^>]+id=["'](?:root|app|__next)["'][^>]*>\s*<\/div>/i.test(html) || /<(?:astro-island)\b/i.test(html);
  if (html.length < 2048 && hasScripts && emptyRoot) reasons.push("spa_shell"); // D-22 empty mount is the signal
  else if (!hasLinks && hasScripts && !hasSitemap) reasons.push("no_links_found"); // D-23 onclick-only nav
  return reasons;
}
export function capHtml(html: string): { html: string; truncated: boolean } { // D-31
  return html.length > HTML_READ_CAP ? { html: html.slice(0, HTML_READ_CAP), truncated: true } : { html, truncated: false };
}
export function classifyTransportError(kind: string): { flag: string; greenfield: boolean } { // D-32
  if (kind === "dns") return { flag: "nxdomain_greenfield", greenfield: true }; // no site = greenfield lead
  if (kind === "refused") return { flag: "host_down", greenfield: false };
  if (kind === "timeout") return { flag: "slow_host", greenfield: false };
  if (kind === "tls") return { flag: "tls_invalid", greenfield: false }; // D-26 (retry unverified elsewhere)
  // #25 D-40: a blocked private/reserved destination is indistinguishable from any
  // other failed fetch — no internal-port-scan oracle. Shares the generic surface.
  return { flag: "unreachable", greenfield: false }; // "blocked" | "other" | ...
}
export function decodeBody(bytes: Uint8Array, charset?: string): string { // D-27
  const cs = (charset || "utf-8").toLowerCase();
  try { return new TextDecoder(cs).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}

// D2 link-crawl counter (the sitemap-less fallback). Classifies homepage links,
// dedups, pairs bilingual mirrors, caps at CORE_CAP (partial when frontier remains).
export type CountResult = {
  core_pages: number | "30+";
  blog_posts: number;
  excluded: { archives: number; media: number; soft_404: number; external: number };
  languages: string[];
  bilingual_mirror: boolean;
  contact: { tel: boolean; mailto: boolean };
  review_flags: string[];
  partial: boolean;
};

export function countFromLinks(homepageUrl: string, html: string, origin: string, rootLang?: "fr" | "en"): CountResult {
  const { links, tel, mailto, canonical } = extractLinks(html, homepageUrl);
  const ex = { archives: 0, media: 0, soft_404: 0, external: 0 };
  const coreUrls: string[] = [homepageUrl]; // the homepage is always a core page
  let blog = 0;
  const flags: string[] = [];
  if (canonical) { try { if (regDomain(new URL(canonical).hostname) !== regDomain(new URL(origin).hostname)) flags.push("platform_canonical"); } catch {} } // D-15
  let partial = false;
  const frontier = dedupByIdentity(links);
  let considered = 0;
  for (const link of frontier) {
    if (considered >= FETCH_CAP) { partial = true; flags.push("fetch_cap"); break; } // D-21
    considered++;
    const cls = classifyLink(link, origin);
    if (cls === "external") { ex.external++; continue; }
    if (cls === "related_property") { ex.external++; flags.push("related_property"); continue; } // D-20
    if (cls === "media") { ex.media++; continue; }
    if (cls === "archive" || cls === "trap") { ex.archives++; continue; }
    if (cls === "blog") { blog++; continue; }
    coreUrls.push(link);
  }
  const deduped = dedupByIdentity(coreUrls);
  const bi = pairBilingual(deduped, rootLang);
  if (bi.suspected) flags.push("bilingual_suspected");
  let core: number | "30+" = bi.core_urls.length;
  if (bi.core_urls.length > CORE_CAP) { core = "30+"; partial = true; flags.push("out_of_icp_scope"); } // D-09 caps
  return { core_pages: core, blog_posts: blog, excluded: ex, languages: bi.languages, bilingual_mirror: bi.bilingual_mirror, contact: { tel, mailto }, review_flags: [...new Set(flags)], partial };
}
