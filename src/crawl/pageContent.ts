// #32 A1 — Option-C content retention. Per fetched page we keep the *content* a
// human skims first: visible text + <title> + h1–h3 headings. ~1 % of raw HTML
// (recon §2). No new fetching — this repackages bodies scan already downloaded.
//
// FIREWALL NOTE (#32): retained text is attacker-controlled. It is NEVER a pricing
// input; it exists only to feed the stage-2 qualitative assessment, which can raise
// a review flag but can never move the deterministic price.

import { visibleText } from "./langDetect.ts";

export type PageContent = { url: string; text: string; title: string; headings: string[] };

// Strip tags + entities to whitespace, collapse. Literal accented chars (é) survive —
// only &entities; are dropped (CT-03: charset already decoded upstream, D-27).
const cleanInline = (s: string): string =>
  s.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

export function extractPageContent(url: string, html: string): PageContent {
  const title = cleanInline((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const headings: string[] = [];
  for (const m of html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const t = cleanInline(m[2]);
    if (t) headings.push(t);
  }
  return { url, text: visibleText(html), title, headings };
}
