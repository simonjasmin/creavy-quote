// Table C — sitemap discovery, parse, classification (S-01…S-24).
// Regex-based loc extraction (namespace-lenient S-10, entity-bomb-safe S-24 — no
// entity expansion). gzip sniffed by magic bytes (S-08). Trust rule S-20.

import { gunzipSync } from "node:zlib";
import type { Transport } from "./types.ts";
import { pairBilingual, dedupByIdentity } from "./bilingual.ts";

export const SITEMAP_INDEX_DEPTH = 2; // #4.1
export const CHILD_SITEMAPS = 5; // #4.1
export const CORE_CAP = 30; // #4.1 / inventory §3

export type ParsedSitemap = { type: "urlset" | "index" | "unparseable"; locs: string[] };
export type LocClass = "core" | "blog" | "archive" | "media";

export function parseSitemap(input: { body: string; bytes?: Uint8Array; contentEncoding?: string }, url: string): ParsedSitemap {
  let text = input.body;
  const gz = (input.bytes && input.bytes[0] === 0x1f && input.bytes[1] === 0x8b) || /gzip/i.test(input.contentEncoding || "") || /\.gz$/i.test(url);
  if (gz) { try { const src = input.bytes ? Buffer.from(input.bytes) : Buffer.from(text, "latin1"); text = gunzipSync(src).toString("utf8"); } catch { /* not really gz */ } }
  if (/^\s*(?:<!doctype html|<html\b)/i.test(text)) return { type: "unparseable", locs: [] }; // S-07 soft-404/HTML
  const isIndex = /<sitemapindex[\s>]/i.test(text);
  const locs: string[] = [];
  for (const m of text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?\s*<\/loc>/gi)) { // S-09/S-11 tolerant
    let loc = m[1].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#0*38;/g, "&"); // S-12
    if (!loc) continue;
    try { loc = new URL(loc, url).toString(); } catch { continue; } // S-13 relative
    locs.push(loc);
  }
  if (locs.length === 0) return { type: "unparseable", locs: [] }; // S-09 zero locs → unparseable
  return { type: isIndex ? "index" : "urlset", locs };
}

// Child-sitemap filename → class hint (S-18)
export function childHint(url: string): LocClass | undefined {
  const u = url.toLowerCase();
  if (/posts-page|page-sitemap|pages-sitemap|\/pages?-\d/.test(u)) return "core";
  if (/posts-post|post-sitemap|posts-sitemap|\/blog-/.test(u)) return "blog";
  if (/taxonom|category|\/tags?-|author|users/.test(u)) return "archive";
  return undefined;
}

export function classifyLoc(loc: string, hint?: LocClass): LocClass {
  let path = "/";
  try { const u = new URL(loc); path = u.pathname + u.search; } catch {}
  if (/\/wp-content\/uploads\//i.test(path) || /[?&]attachment_id=/i.test(path)) return "media"; // S-19
  if (hint) return hint;
  if (/\/(?:category|categorie|tag|author|auteur|product-category|topic)s?\//i.test(path) || /\/(?:blog\/)?page\/\d+/i.test(path)) return "archive"; // S-17, pagination
  if (/\/\d{4}\/\d{2}\/[^/]+/.test(path)) return "blog"; // dated post permalink
  if (/\/\d{4}(?:\/\d{2})?\/?$/.test(path)) return "archive"; // bare date archive
  return "core";
}

export type SitemapCrawl = {
  found: boolean;
  core: string[];
  blog: number;
  excluded: { archives: number; media: number; external: number };
  languages: string[];
  bilingual_mirror: boolean;
  review_flags: string[];
  partial: boolean;
  overflow: boolean; // "30+"
};

async function fetchParse(transport: Transport, url: string): Promise<ParsedSitemap> {
  const res = await transport.fetch(url, { maxHops: 5 });
  if (res.error || res.status >= 400) return { type: "unparseable", locs: [] };
  return parseSitemap({ body: res.body, bytes: res.bytes, contentEncoding: res.headers["content-encoding"] }, res.url);
}

export async function crawlSitemaps(transport: Transport, origin: string, robotsSitemaps: string[] = []): Promise<SitemapCrawl> {
  const empty: SitemapCrawl = { found: false, core: [], blog: 0, excluded: { archives: 0, media: 0, external: 0 }, languages: [], bilingual_mirror: false, review_flags: [], partial: false, overflow: false };
  const candidates = dedupByIdentity([...robotsSitemaps, origin + "/sitemap.xml", origin + "/sitemap_index.xml", origin + "/wp-sitemap.xml"]); // S-01

  const robotsSet = new Set(robotsSitemaps);
  const review: string[] = [];
  let root: { url: string; parsed: ParsedSitemap } | null = null;
  for (const c of candidates) {
    const parsed = await fetchParse(transport, c);
    if (parsed.type !== "unparseable") { root = { url: c, parsed }; break; } // S-01 first parseable
    if (robotsSet.has(c)) review.push("stale_robots_sitemap"); // S-06 robots-listed sitemap 404s → fall through + note
  }
  if (!root) return { ...empty, review_flags: [...review, "sitemap_absent"] }; // S-02 → link-crawl fallback

  let partial = false;
  const originHost = new URL(origin).host;

  // gather (loc, hint) pairs, recursing indexes
  const pages: { loc: string; hint?: LocClass }[] = [];
  async function ingest(parsed: ParsedSitemap, srcUrl: string, depth: number) {
    if (parsed.type === "index") {
      if (parsed.locs.length > CORE_CAP) { review.push("out_of_icp_scope"); throw { overflow: true }; } // S-05 40 children → 30+
      const children = parsed.locs.slice(0, CHILD_SITEMAPS);
      if (parsed.locs.length > CHILD_SITEMAPS) { partial = true; review.push("sitemap_children_capped"); } // S-04
      if (depth >= SITEMAP_INDEX_DEPTH) { partial = true; return; }
      for (const child of children) {
        const p = await fetchParse(transport, child);
        if (p.type === "unparseable") { review.push("stale_robots_sitemap"); continue; } // S-06
        await ingest(p, child, depth + 1);
      }
    } else {
      for (const loc of parsed.locs) pages.push({ loc, hint: childHint(srcUrl) });
    }
  }
  try { await ingest(root.parsed, root.url, 0); }
  catch (e: any) { if (e?.overflow) return { ...empty, found: true, overflow: true, review_flags: review }; throw e; }

  // classify + dedup
  const core: string[] = [];
  const ex = { archives: 0, media: 0, external: 0 };
  let blog = 0;
  let offDomain = 0;
  const seenIds = new Set<string>();
  for (const { loc, hint } of pages) {
    let host = ""; try { host = new URL(loc).host; } catch {}
    if (host && host !== originHost && host.replace(/^www\./, "") !== originHost.replace(/^www\./, "")) { ex.external++; offDomain++; continue; } // S-15 off-domain
    const cls = classifyLoc(loc, hint);
    if (cls === "media") { ex.media++; continue; }
    if (cls === "archive") { ex.archives++; continue; }
    if (cls === "blog") { blog++; continue; }
    core.push(loc);
  }
  // S-15 majority off-domain → distrust
  if (offDomain > 0 && offDomain >= pages.length / 2) return { ...empty, review_flags: ["sitemap_off_domain_distrust"] };

  // S-16 dedup + S-22 bilingual pairing
  const deduped = dedupByIdentity(core);
  const bi = pairBilingual(deduped);
  const coreUrls = bi.core_urls;
  const flags = [...review];
  if (bi.suspected) flags.push("bilingual_suspected");

  // S-23 huge → 30+ short-circuit
  if (coreUrls.length > CORE_CAP) return { found: true, core: coreUrls.slice(0, CORE_CAP), blog, excluded: ex, languages: bi.languages, bilingual_mirror: bi.bilingual_mirror, review_flags: flags, partial, overflow: true };

  // S-20 stale-sitemap trust: sample-verify min(core,10)
  const sample = coreUrls.slice(0, Math.min(coreUrls.length, 10));
  let bad = 0;
  for (const u of sample) { const r = await transport.fetch(u, { maxHops: 3 }); if (r.error || r.status >= 400) bad++; }
  if (sample.length > 0 && bad / sample.length > 0.30) return { ...empty, review_flags: [...flags, "stale_sitemap"] }; // distrust → link-crawl fallback

  return { found: true, core: coreUrls, blog, excluded: ex, languages: bi.languages, bilingual_mirror: bi.bilingual_mirror, review_flags: flags, partial, overflow: false };
}
