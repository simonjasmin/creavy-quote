// Table B — robots policy (R-01…R-20). Ownership principle #11: behave as a
// stranger; full robots respect for expansion. RFC 9309 status handling; #13
// robots-error policy; #15 crawl-delay applied as-is (budget governs extremes).

import type { Transport } from "./types.ts";

export const BOT_UA_TOKEN = "creavyquotebot"; // full UA: CreavyQuoteBot/1.0 (+https://creavy.com/bot)
export const ROBOTS_PARSE_CAP = 500 * 1024; // #4.1

type Rule = { allow: boolean; pattern: string; re: RegExp; len: number };

export type RobotsPolicy = {
  allows(path: string): boolean; // for EXPANSION; the submitted URL is always fetched (#11)
  sitemaps: string[];
  crawlDelayMs: number | null;
  source: "parsed" | "allow_all" | "disallow_all";
  notes: string[];
};

function patternToRegex(pat: string): RegExp {
  const anchored = pat.endsWith("$"); // R-11 end-anchor
  const core = anchored ? pat.slice(0, -1) : pat;
  const escaped = core.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"); // R-11 wildcard
  return new RegExp("^" + escaped + (anchored ? "$" : ""));
}

export function parseRobots(raw: string, origin = "https://x", ua = BOT_UA_TOKEN): RobotsPolicy {
  const notes: string[] = [];
  let text = raw;
  if (text.length > ROBOTS_PARSE_CAP) { text = text.slice(0, ROBOTS_PARSE_CAP); notes.push("truncated"); } // R-18
  text = text.replace(/^﻿/, ""); // R-16 BOM
  if (/^\s*(?:<!doctype html|<html\b)/i.test(text)) return { allows: () => true, sitemaps: [], crawlDelayMs: null, source: "allow_all", notes: ["robots_absent"] }; // R-06

  const sitemaps: string[] = [];
  const groups: { agents: string[]; rules: Rule[]; delay: number | null }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (let line of text.split(/\r\n|\r|\n/)) { // R-16 CRLF
    line = line.replace(/#.*/, "").trim(); // comments (R-16)
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase(); // R-08 case-insensitive
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "sitemap") { try { sitemaps.push(new URL(value, origin).toString()); } catch {} continue; } // R-14/R-15
    if (!cur) continue;
    if (field === "disallow") { if (value === "") continue; cur.rules.push({ allow: false, pattern: value, re: patternToRegex(value), len: value.length }); }
    else if (field === "allow") { cur.rules.push({ allow: true, pattern: value, re: patternToRegex(value), len: value.length }); }
    else if (field === "crawl-delay") { const n = parseFloat(value); if (!isNaN(n)) cur.delay = n * 1000; } // R-13, #15
    // unknown directives ignored (R-17)
  }

  // group selection: most specific matching agent; a named group beats "*" (R-07)
  let chosen: (typeof groups)[number] | null = null;
  let bestLen = -1;
  for (const g of groups) for (const a of g.agents) {
    if (a !== "*" && ua.includes(a) && a.length > bestLen) { chosen = g; bestLen = a.length; }
  }
  if (!chosen) chosen = groups.find((g) => g.agents.includes("*")) ?? null;
  if (!chosen) return { allows: () => true, sitemaps, crawlDelayMs: null, source: "allow_all", notes: [...notes, "robots_absent"] };

  const rules = chosen.rules;
  const allows = (path: string): boolean => {
    let best: Rule | null = null;
    for (const r of rules) if (r.re.test(path)) { if (!best || r.len > best.len || (r.len === best.len && r.allow)) best = r; } // longest; tie→allow (R-12)
    return best ? best.allow : true;
  };
  return { allows, sitemaps, crawlDelayMs: chosen.delay, source: "parsed", notes };
}

// Full-disallow-for-expansion policy (5xx/unreachable #13; or Disallow:/ full block #12)
function disallowExpansion(note: string, sitemaps: string[] = []): RobotsPolicy {
  return { allows: () => false, sitemaps, crawlDelayMs: null, source: "disallow_all", notes: [note, "review:robots"] };
}

export async function fetchRobots(transport: Transport, origin: string, ua = BOT_UA_TOKEN): Promise<RobotsPolicy> {
  const res = await transport.fetch(origin + "/robots.txt", { maxHops: 5 }); // R-04 follow redirects
  if (res.error) return disallowExpansion(res.error.kind === "redirect_loop" ? "robots_redirect_loop" : "robots_unreachable"); // R-05, #13
  if (res.status >= 400 && res.status < 500) return { allows: () => true, sitemaps: [], crawlDelayMs: null, source: "allow_all", notes: [res.status === 404 ? "robots_absent" : "robots_4xx"] }; // R-01/R-02 RFC 9309
  if (res.status >= 500) return disallowExpansion("robots_5xx"); // R-03
  return parseRobots(res.body, origin, ua); // 200 (R-06 HTML handled in parse; R-20 octet-stream parsed anyway)
}
