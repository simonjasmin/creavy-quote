// Diagnose the exact review-cause chain for a live URL. Real transport, ONE polite pass
// (CreavyQuoteBot UA, robots respected, Set-Cookie stripped — the standing harvest rules,
// all already enforced by HttpTransport + scan). Prints scan facts → assessable() → the
// #27 mapper outcome with its stable reason codes, so the exact #27.6/#27.2 condition is named.
//
//   node spikes/diagnose-site.mjs <url>
import { scan } from "../src/crawl/scan.ts";
import { assessable } from "../src/assess/assessable.ts";
import { mapTier } from "../src/tiermap/tiermap.ts";
import { pricingConfig } from "../src/pricing/index.ts";
import { HttpTransport } from "../src/crawl/httpTransport.ts";
import { realClock } from "../src/service/realClock.ts";

const url = process.argv[2];
if (!url) { console.error("usage: node spikes/diagnose-site.mjs <url>"); process.exit(2); }

let r;
try { r = await scan(new HttpTransport(), realClock, url); }
catch (e) { console.log(`SCAN THREW for ${url}: ${e.message}`); process.exit(1); }

console.log(`== SCAN ${url}`);
console.log(`  canonical_origin : ${r.canonical_origin}`);
console.log(`  core_pages       : ${r.core_pages}   blog_posts: ${r.blog_posts}   bilingual_mirror: ${r.bilingual_mirror}`);
console.log(`  detected_platform: ${r.detected_platform} (${r.detected_platform_confidence})`);
console.log(`  needs_browser    : ${r.needs_browser} ${JSON.stringify(r.needs_browser_reasons)}   partial: ${r.partial}`);
console.log(`  review_flags     : ${JSON.stringify(r.review_flags)}`);
console.log(`  languages        : ${JSON.stringify(r.languages)}   page_content: ${r.page_content.length} pages`);
console.log(`  assessable()     : ${assessable(r)}`);

// neutral answers (component none, fr, brand assets present) → isolate scan-driven review causes
const input = { core_pages: r.core_pages, blog_posts: r.blog_posts, bilingual_mirror: r.bilingual_mirror, detected_platform: r.detected_platform, needs_browser: r.needs_browser, partial: r.partial, review_flags: r.review_flags, components: {}, has_brand_assets: true };
const t = mapTier(input, pricingConfig);
console.log(`== MAPTIER (neutral answers)`);
console.log(`  review_required  : ${t.review_required}   bundle: ${t.bundle ? t.bundle.tier + " [" + t.bundle.addons.join(",") + "]" : "null (no auto-price)"}`);
if (t.range) console.log(`  #35 band range   : [${t.range.min}, ${t.range.max}] cents (instant estimation, exact price human-confirmed)`);
console.log(`  reasons (codes)  : ${JSON.stringify(t.reasons)}`);
console.log(`  reason_text      : ${JSON.stringify(t.reason_text)}`);
