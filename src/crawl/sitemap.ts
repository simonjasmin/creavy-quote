// Table C — sitemap discovery, parse, classification (S-01…S-24).
// Regex-based loc extraction (namespace-lenient S-10, entity-bomb-safe S-24 — no
// entity expansion). gzip sniffed by magic bytes (S-08). Trust rule S-20.

import { gunzipSync } from "node:zlib";
import type { Transport } from "./types.ts";
import { pairBilingual, dedupByIdentity, type HreflangGroup } from "./bilingual.ts";
import { type ScanEventEmitter, NOOP_EMITTER } from "./events.ts";
import type { PoliteScheduler } from "./scheduler.ts";
import { detectLang, visibleText } from "./langDetect.ts";
import { normalize } from "../url/normalize.ts";

const normId = (u: string): string => { const n = normalize(u); return n.ok ? n.identity : u; };

export const SITEMAP_INDEX_DEPTH = 2; // #4.1
export const CHILD_SITEMAPS = 5; // #4.1
export const CORE_CAP = 30; // #4.1 / inventory §3

export type ParsedSitemap = { type: "urlset" | "index" | "unparseable"; locs: string[]; alternates: HreflangGroup[] };
export type LocClass = "core" | "blog" | "archive" | "media";

export function parseSitemap(input: { body: string; bytes?: Uint8Array; contentEncoding?: string }, url: string): ParsedSitemap {
  let text = input.body;
  const gz = (input.bytes && input.bytes[0] === 0x1f && input.bytes[1] === 0x8b) || /gzip/i.test(input.contentEncoding || "") || /\.gz$/i.test(url);
  if (gz) { try { const src = input.bytes ? Buffer.from(input.bytes) : Buffer.from(text, "latin1"); text = gunzipSync(src).toString("utf8"); } catch { /* not really gz */ } }
  if (/^\s*(?:<!doctype html|<html\b)/i.test(text)) return { type: "unparseable", locs: [], alternates: [] }; // S-07 soft-404/HTML
  const isIndex = /<sitemapindex[\s>]/i.test(text);
  const locs: string[] = [];
  for (const m of text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?\s*<\/loc>/gi)) { // S-09/S-11 tolerant
    let loc = m[1].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#0*38;/g, "&"); // S-12
    if (!loc) continue;
    try { loc = new URL(loc, url).toString(); } catch { continue; } // S-13 relative
    locs.push(loc);
  }
  const alternates: HreflangGroup[] = []; // #28: sitemap xhtml:link hreflang groups (fr/en)
  for (const block of text.match(/<url\b[\s\S]*?<\/url>/gi) || []) {
    const g: HreflangGroup = [];
    for (const m of block.matchAll(/<xhtml:link\b[^>]*hreflang=["']([a-z]{2})[^>]*href=["']([^"']+)["']/gi)) { const l = m[1].toLowerCase(); if (l === "fr" || l === "en") g.push({ lang: l, url: m[2] }); }
    if (g.length >= 2) alternates.push(g);
  }
  if (locs.length === 0) return { type: "unparseable", locs: [], alternates: [] }; // S-09 zero locs → unparseable
  return { type: isIndex ? "index" : "urlset", locs, alternates };
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

// D-18 soft-404: HTTP 200 but the page says "not found" (FR + EN markers).
export function isSoft404(html: string): boolean {
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  const text = html.replace(/<[^>]+>/g, " ").slice(0, 4000);
  return /(page (non trouv|not found)|introuvable|erreur\s*404|error\s*404|404 (not found|error))/i.test(title) ||
    /(page non trouv[ée]+|page not found|cette page n['e]existe pas|nous n['e]avons pas (pu )?trouv)/i.test(text);
}

export type SitemapCrawl = {
  found: boolean;
  core: string[];
  blog: number;
  excluded: { archives: number; media: number; external: number; soft_404: number };
  languages: string[];
  bilingual_mirror: boolean;
  review_flags: string[];
  partial: boolean;
  overflow: boolean; // "30+"
  alternates: HreflangGroup[]; // #28 hreflang groups (sitemap xhtml:link)
  sampledLangs: Record<string, string>; // #28 content-detected lang of sampled pages (normId → fr|en|unknown)
  coreRaw: string[]; // #28 deduped core BEFORE bilingual collapse (scan runs the full ladder on this)
};

async function sequentialFetch(transport: Transport, urls: string[]) {
  const out = [];
  for (const u of urls) out.push(await transport.fetch(u, { maxHops: 3 }));
  return out;
}

async function fetchParse(transport: Transport, url: string): Promise<ParsedSitemap> {
  const res = await transport.fetch(url, { maxHops: 5 });
  if (res.error || res.status >= 400) return { type: "unparseable", locs: [] };
  return parseSitemap({ body: res.body, bytes: res.bytes, contentEncoding: res.headers["content-encoding"] }, res.url);
}

export async function crawlSitemaps(transport: Transport, origin: string, robotsSitemaps: string[] = [], emitter: ScanEventEmitter = NOOP_EMITTER, rootLang?: "fr" | "en", scheduler?: PoliteScheduler): Promise<SitemapCrawl> {
  const empty: SitemapCrawl = { found: false, core: [], blog: 0, excluded: { archives: 0, media: 0, external: 0, soft_404: 0 }, languages: [], bilingual_mirror: false, review_flags: [], partial: false, overflow: false, alternates: [], sampledLangs: {}, coreRaw: [] };
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
  const allAlternates: HreflangGroup[] = []; // #28
  async function ingest(parsed: ParsedSitemap, srcUrl: string, depth: number) {
    allAlternates.push(...parsed.alternates);
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
  const ex = { archives: 0, media: 0, external: 0, soft_404: 0 };
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
  const bi = pairBilingual(deduped, rootLang);
  const coreUrls = bi.core_urls;
  const flags = [...review];
  if (bi.suspected) flags.push("bilingual_suspected");

  // S-23 huge → 30+ short-circuit
  if (coreUrls.length > CORE_CAP) return { found: true, core: coreUrls.slice(0, CORE_CAP), coreRaw: deduped, blog, excluded: ex, languages: bi.languages, bilingual_mirror: bi.bilingual_mirror, review_flags: flags, partial, overflow: true, alternates: allAlternates, sampledLangs: {} };

  // S-20 stale-sitemap trust: sample-verify min(core,10)
  const sample = coreUrls.slice(0, Math.min(coreUrls.length, 10));
  // Thread 6: sample fetches go through the PoliteScheduler when scan provides one
  // (composition-level D-34); sequential otherwise (S-20 test path unchanged).
  const results = scheduler ? (await scheduler.fetchAll(sample)).results : await sequentialFetch(transport, sample);
  let bad = 0, n = 0, soft = 0;
  const sampledLangs: Record<string, string> = {};
  for (const r of results) {
    const isBad = !!r.error || r.status >= 400;
    const soft404 = !isBad && isSoft404(r.body); // Thread 7 / D-18
    if (isBad || soft404) bad++;
    if (soft404) soft++;
    if (!isBad && r.body) sampledLangs[normId(r.url)] = detectLang(visibleText(r.body)); // #28 tree-rung content guard
    emitter.emit("page_fetched", { n: ++n, approx: coreUrls.length }); // #24
  }
  if (sample.length > 0 && bad / sample.length > 0.30) return { ...empty, review_flags: [...flags, "stale_sitemap"] }; // distrust → link-crawl fallback
  ex.soft_404 = soft; // sample-detected soft-404s excluded from the core count (scan subtracts)

  return { found: true, core: coreUrls, coreRaw: deduped, blog, excluded: ex, languages: bi.languages, bilingual_mirror: bi.bilingual_mirror, review_flags: flags, partial, overflow: false, alternates: allAlternates, sampledLangs };
}
