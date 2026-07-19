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

export function pairBilingual(urls: string[]): BilingualResult {
  const groups = new Map<string, { langs: Set<string>; rep: string }>();
  const langsSeen = new Set<string>();
  for (const u of urls) {
    const { lang, key } = langKey(u);
    if (lang) langsSeen.add(lang);
    const g = groups.get(key) ?? { langs: new Set<string>(), rep: u };
    if (lang) g.langs.add(lang);
    groups.set(key, g);
  }
  let mirrored = false;
  for (const g of groups.values()) if (g.langs.size >= 2) mirrored = true;
  const bothLangs = langsSeen.has("fr") && langsSeen.has("en");
  // suspected: both fr+en exist but no key actually paired them (separate slugged trees)
  const suspected = bothLangs && !mirrored;
  return {
    core_urls: [...groups.values()].map((g) => g.rep),
    languages: [...langsSeen].sort(),
    bilingual_mirror: mirrored && bothLangs,
    suspected,
  };
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
