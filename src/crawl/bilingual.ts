// Bilingual pair-dedup (#18, S-22, D-16). PRICING-CRITICAL: a fr/en mirror is one
// bilingual site, not double the pages. hreflang is authoritative when available
// (page HTML); otherwise the path/subdomain mirror heuristic. Never sum both trees.

import { normalize } from "../url/normalize.ts";

const LANG_PREFIX = /^\/(fr|en)(?:-(?:ca|us|fr|gb))?(?=\/|$)/i;

// Returns the language (if any) and a language-agnostic key for grouping mirrors.
export function langKey(u: string): { lang?: string; key: string } {
  let url: URL;
  try { url = new URL(u); } catch { return { key: u }; }
  let host = url.hostname.toLowerCase();
  let path = url.pathname.replace(/\/+$/, "") || "/";
  let lang: string | undefined;

  const sub = host.match(/^(fr|en)\./i);
  if (sub) { lang = sub[1].toLowerCase(); host = host.replace(/^(fr|en)\./i, ""); }
  const pm = path.match(LANG_PREFIX);
  if (pm) { lang = pm[1].toLowerCase(); path = path.replace(LANG_PREFIX, "") || "/"; }
  const q = url.searchParams.get("lang");
  if (q && /^(fr|en)/i.test(q)) lang = q.slice(0, 2).toLowerCase();

  return { lang, key: host + path };
}

export type BilingualResult = {
  core_urls: string[]; // one representative per mirrored key
  languages: string[];
  bilingual_mirror: boolean;
  suspected: boolean; // two language trees present but not 1:1 pairable (translated slugs)
};

// #26 (extends #18): pair prefix-less roots against a language-prefixed tree in
// BOTH directions (fr-root + /en/, en-root + /fr/). `rootLang` is the content-
// inferred language of the root tree; prefix-less URLs inherit it. Pair criterion:
// exact path correspondence after prefix strip AND a language DIFFERENCE (same
// detected language on both sides → no pair; guards false merges that under-count).
export function pairBilingual(urls: string[], rootLang?: "fr" | "en"): BilingualResult {
  const groups = new Map<string, Map<string, string>>(); // key -> lang -> representative url
  for (const u of urls) {
    const lk = langKey(u);
    const lang = lk.lang ?? rootLang; // #26: roots inherit the inferred root language
    let g = groups.get(lk.key);
    if (!g) { g = new Map(); groups.set(lk.key, g); }
    const slot = lang ?? "_none";
    if (!g.has(slot)) g.set(slot, u);
  }
  const realLangs = (g: Map<string, string>) => [...g.keys()].filter((l) => l !== "_none");
  const langsSeen = new Set<string>();
  for (const g of groups.values()) for (const l of realLangs(g)) langsSeen.add(l);
  const bothLangs = langsSeen.has("fr") && langsSeen.has("en");

  const pairedKeys = [...groups.values()].filter((g) => realLangs(g).length >= 2).length; // distinct langs only (same-lang guard)
  const treeFr = [...groups.values()].filter((g) => g.has("fr")).length;
  const treeEn = [...groups.values()].filter((g) => g.has("en")).length;
  const smaller = Math.min(treeFr, treeEn);
  const homeKey = [...groups.keys()].sort((a, b) => a.length - b.length)[0]; // shortest key = homepage/root
  const homepagePaired = homeKey ? realLangs(groups.get(homeKey)!).length >= 2 : false;

  // #26 item 4: homepage pairs AND ≥ half the smaller tree pairs → mirror; else a
  // prefixed tree present but below the bar → suspected (human review).
  const mirror = bothLangs && smaller > 0 && homepagePaired && pairedKeys >= Math.ceil(smaller / 2);
  const suspected = bothLangs && !mirror;

  return {
    core_urls: [...groups.values()].map((g) => [...g.values()][0]), // one rep/key: paired mirrors dedupe, unpaired count once
    languages: [...langsSeen].sort(),
    bilingual_mirror: mirror,
    suspected,
  };
}

// ===== #28 bilingual evidence ladder: hreflang → path → tree =====
export type Lang = "fr" | "en";
export type HreflangGroup = { lang: string; url: string }[];
export type BilingualThresholds = { tree_lang_purity: number; min_tree_pages: number; min_size_ratio: number };
export type BilingualResolved = { core_urls: string[]; languages: string[]; bilingual_mirror: boolean; suspected: boolean; pairing_evidence?: "hreflang" | "path" | "tree" };

const normId = (u: string): string => { const n = normalize(u); return n.ok ? n.identity : u; };

// hreflang alternates in a page <head> (fr/en only; x-default ignored).
export function extractHeadHreflang(html: string): HreflangGroup {
  const out: HreflangGroup = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    const hl = (tag.match(/hreflang=["']?([a-z]{2})/i) || [])[1];
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    if (hl && href && (hl === "fr" || hl === "en")) out.push({ lang: hl, url: href });
  }
  return out;
}

// Tree-level pairing (rung 3): mirror WITHOUT page pairs when the guards hold.
function resolveTree(urls: string[], rootLang: Lang | undefined, sampledLang: Record<string, string>, th: BilingualThresholds): BilingualResolved {
  const byLang: Record<Lang, string[]> = { fr: [], en: [] };
  for (const u of urls) { const l = (langKey(u).lang ?? rootLang) as Lang | undefined; if (l === "fr" || l === "en") byLang[l].push(u); }
  const frN = byLang.fr.length, enN = byLang.en.length;
  const both = frN > 0 && enN > 0;
  if (frN < th.min_tree_pages || enN < th.min_tree_pages) return mono(urls, both); // substantiality (kills the stub case)
  if (Math.min(frN, enN) / Math.max(frN, enN) < th.min_size_ratio) return mono(urls, true); // size correspondence
  // content-purity false-merge guard: each sampled tree ≥ purity of its language
  const purityOk = (tree: string[], lang: Lang) => {
    const s = tree.map((u) => sampledLang[normId(u)]).filter((x) => x && x !== "unknown");
    return s.length === 0 ? true : s.filter((x) => x === lang).length / s.length >= th.tree_lang_purity;
  };
  if (!purityOk(byLang.fr, "fr") || !purityOk(byLang.en, "en")) return mono(urls, true);
  const larger = frN >= enN ? byLang.fr : byLang.en; // count the larger tree per #18
  return { core_urls: larger, languages: ["en", "fr"], bilingual_mirror: true, suspected: false, pairing_evidence: "tree" };
}
function mono(urls: string[], suspected: boolean): BilingualResolved {
  return { core_urls: urls, languages: [], bilingual_mirror: false, suspected };
}

export function resolveBilingual(coreUrls: string[], opts: { rootLang?: Lang; hreflangGroups?: HreflangGroup[]; sampledLangByUrl?: Record<string, string>; thresholds: BilingualThresholds }): BilingualResolved {
  const deduped = dedupByIdentity(coreUrls);

  // RUNG 1 — hreflang (authoritative). fr+en alternate groups pair exactly, translated slugs and all.
  const groups = (opts.hreflangGroups || []).filter((g) => { const ls = new Set(g.map((a) => a.lang)); return ls.has("fr") && ls.has("en"); });
  if (groups.length >= 1) {
    const inGroup = new Set<string>();
    for (const g of groups) for (const a of g) inGroup.add(normId(a.url));
    const unpaired = deduped.filter((u) => !inGroup.has(normId(u)));
    return { core_urls: [...groups.map((g) => g[0].url), ...unpaired], languages: ["en", "fr"], bilingual_mirror: true, suspected: false, pairing_evidence: "hreflang" };
  }

  // RUNG 2 — path correspondence (labarberie's rung).
  const path = pairBilingual(deduped, opts.rootLang);
  if (path.bilingual_mirror) return { ...path, pairing_evidence: "path" };

  // RUNG 3 — tree-level, guarded.
  const tree = resolveTree(deduped, opts.rootLang, opts.sampledLangByUrl || {}, opts.thresholds);
  if (tree.bilingual_mirror) return tree;

  return { core_urls: path.core_urls, languages: path.languages, bilingual_mirror: false, suspected: path.suspected || tree.suspected };
}

// dedup by normalized identity (S-16, D-14): shared identity function.
export function dedupByIdentity(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const n = normalize(u);
    const id = n.ok ? n.identity : u;
    if (!seen.has(id)) { seen.add(id); out.push(u); }
  }
  return out;
}
