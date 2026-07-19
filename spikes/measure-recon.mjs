// Read-only measurement for ASSESSMENT-RECON.md. Measures golden fixtures:
// full HTML vs extracted visible text vs text+metadata, with token estimates.
import { readFileSync, readdirSync } from "node:fs";
import { visibleText } from "../src/crawl/langDetect.ts";

const tok = (n) => Math.round(n / 4); // ~4 chars/token (rough, Latin text)
function metaBlob(h) {
  const t = (h.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  const d = (h.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || [])[1] || "";
  const hh = (h.match(/<h[1-3][^>]*>([^<]{0,120})/gi) || []).map((x) => x.replace(/<[^>]+>/g, "")).join(" | ");
  return (t + " " + d + " " + hh).slice(0, 800);
}

console.log("site                    pages  HTML_KB  text_KB  meta_KB  tokHTML  tokText  tokMeta  core");
let a = { pages: 0, html: 0, text: 0, meta: 0 };
for (const slug of readdirSync("fixtures/golden")) {
  let scen;
  try { scen = JSON.parse(readFileSync(`fixtures/golden/${slug}/scenario.json`, "utf8")); } catch { continue; }
  let pages = 0, html = 0, text = 0, meta = 0;
  for (const [url, spec] of Object.entries(scen)) {
    const b = spec.body;
    if (!b || !/<html|<!doctype/i.test(b) || url.includes("robots") || url.includes("sitemap")) continue;
    pages++; html += b.length; text += visibleText(b).length; meta += metaBlob(b).length;
  }
  const res = JSON.parse(readFileSync(`fixtures/golden/${slug}/scan-result.json`, "utf8"));
  a.pages += pages; a.html += html; a.text += text; a.meta += meta;
  const row = [slug.padEnd(22), String(pages).padStart(4), (html / 1024).toFixed(0).padStart(7), (text / 1024).toFixed(1).padStart(7),
    (meta / 1024).toFixed(1).padStart(7), String(tok(html)).padStart(7), String(tok(text)).padStart(7), String(tok(meta)).padStart(7), " " + res.core_pages];
  console.log(row.join("  "));
}
console.log(`\nTOTAL pages=${a.pages}  HTML=${(a.html / 1024).toFixed(0)}KB text=${(a.text / 1024).toFixed(0)}KB meta=${(a.meta / 1024).toFixed(1)}KB`);
console.log(`Compression: text is ${(100 * a.text / a.html).toFixed(0)}% of HTML; meta is ${(100 * a.meta / a.html).toFixed(1)}% of HTML`);
console.log(`Per-fetched-page avg: HTML ${tok(a.html / a.pages)} tok, text ${tok(a.text / a.pages)} tok, meta ${tok(a.meta / a.pages)} tok`);
