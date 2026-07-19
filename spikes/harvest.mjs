// Fixture harvester for the fingerprint spike.
// SPIKE CODE — lives under /spikes, never imported by src.
// Fetches root + robots.txt + sitemap.xml per site with the Creavy bot UA,
// strips Set-Cookie, caps body at 2 MB, and prints a platform-signal digest
// so ground truth can be labelled by hand. One polite pass per site.
//
// Usage: node spikes/harvest.mjs [extra-url ...]

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const UA = "CreavyQuoteBot/1.0 (+https://creavy.com/bot)";
const OUT = "fixtures/sites";
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const CONCURRENCY = 5;

const BASE_URLS = [
  // plumbers
  "https://plombierdemontreal.com/", "https://plomberiemontreal.ca/", "https://pureplomberie.com/",
  "https://www.plomberiefdussault.ca/", "https://www.plombiermontreal.com/", "https://www.mchenryplumbing.ca/",
  "https://www.mtlplomberie.ca/", "https://www.plomberie-chauffage-montreal.ca/", "https://plomberexpert.ca/",
  // roofers
  "https://www.toiture-quebec.ca/", "https://www.toituredelacapitale.com/", "https://toitureqc.com/",
  "https://toiturealpha.ca/", "https://www.l2toiture.com/", "http://toituresmarcelpouliot.com/", "https://www.protectoit.com/",
  // hvac
  "https://www.expair.ca/", "https://www.refrigerationeverest.com/", "https://airclimatisationvs.ca/", "https://www.lajoiecvac.com/",
  // electricians
  "https://quebecelectricien.ca/", "https://boucherlortie.com/", "https://www.robertgingrasinc.com/",
  "https://csmelectrique.com/", "https://pierrehamelin.ca/",
  // landscapers
  "https://amenagementdupaysage.com/", "https://paysagistevilledequebec.ca/", "https://www.amenagementpaysager.ca/",
  "https://xavierpaysagiste.com/", "https://www.artisansdupaysage.com/", "https://paysagesgenest.com/",
];

// If explicit URLs are passed, harvest ONLY those (avoid re-fetching the base set).
const extra = process.argv.slice(2);
const urls = extra.length ? extra : BASE_URLS;

function slugFor(u) {
  const h = new URL(u).hostname.replace(/^www\./, "");
  return h.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function headersToObject(headers) {
  const o = {};
  for (const [k, v] of headers) if (k.toLowerCase() !== "set-cookie") o[k] = v;
  return o; // Node's fetch never surfaces Set-Cookie via iteration; excluded anyway.
}

async function politeFetch(u) {
  const res = await fetch(u, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const body = buf.subarray(0, MAX_BYTES).toString("utf8");
  return { finalUrl: res.url, status: res.status, headers: headersToObject(res.headers), body, truncated: buf.length > MAX_BYTES };
}

async function tryText(u) {
  try {
    const res = await fetch(u, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { status: res.status, text: null };
    const t = (await res.text()).slice(0, MAX_BYTES);
    return { status: res.status, text: t, finalUrl: res.url };
  } catch (e) {
    return { status: 0, text: null, error: String(e?.cause?.code || e?.name || e) };
  }
}

// Quick, generous signal sniff purely to speed human labelling (NOT a detector).
function sniff(headers, body) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const b = body || "";
  const gen = (b.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i) || [])[1] || null;
  const s = [];
  if (/\/wp-content\//.test(b) || /\/wp-includes\//.test(b) || /rel=["']https:\/\/api\.w\.org\//.test(h["link"] || "")) s.push("wordpress");
  if (/\/plugins\/elementor\/|elementor-/.test(b)) s.push("wp:elementor");
  if (/\/themes\/Divi\/|et_pb_/.test(b)) s.push("wp:divi");
  if (/vc_row/.test(b)) s.push("wp:wpbakery");
  if (/fl-builder/.test(b)) s.push("wp:beaver");
  if (h["x-wix-request-id"] || /wixstatic\.com|parastorage\.com/.test(b) || /Wix\.com Website Builder/i.test(gen || "")) s.push("wix");
  if (/<!--\s*This is Squarespace/i.test(b) || /static1\.squarespace\.com/.test(b) || /squarespace/i.test(gen || "")) s.push("squarespace");
  if (/img1\.wsimg\.com|wsimg\.com/.test(b)) s.push("godaddy");
  if (/editmysite\.com/.test(b) || /weebly/i.test(gen || "")) s.push("weebly");
  if (h["x-shopid"] || h["x-shopify-stage"] || /cdn\.shopify\.com|myshopify\.com/.test(b)) s.push("shopify");
  if (/data-wf-(site|page)|assets\.website-files\.com|website-files\.com/.test(b) || /webflow/i.test(gen || "")) s.push("webflow");
  if (/cdn-website\.com|multiscreensite\.com/.test(b)) s.push("duda");
  if (/joomla/i.test(gen || "") || /\/media\/jui\/|option=com_/.test(b)) s.push("joomla");
  if (/drupal/i.test(h["x-generator"] || "") || /\/sites\/default\/files\//.test(b)) s.push("drupal");
  if (/framerusercontent\.com/.test(b)) s.push("framer");
  if (/carrd\.co/.test(b)) s.push("carrd");
  return { generator: gen, server: h["server"] || null, xpb: h["x-powered-by"] || null, signals: s };
}

async function harvestOne(u) {
  const slug = slugFor(u);
  const dir = join(OUT, slug);
  const origin = new URL(u).origin;
  try {
    const r = await politeFetch(u);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "root.html"), r.body);
    await writeFile(join(dir, "root.headers.json"), JSON.stringify({ requested: u, final_url: r.finalUrl, status: r.status, truncated: r.truncated, headers: r.headers }, null, 2));

    const robots = await tryText(origin + "/robots.txt");
    if (robots.text && !/<html/i.test(robots.text)) await writeFile(join(dir, "robots.txt"), robots.text);
    const sm = await tryText(origin + "/sitemap.xml");
    if (sm.text && /<(urlset|sitemapindex)/i.test(sm.text)) await writeFile(join(dir, "sitemap.xml"), sm.text);

    const sn = sniff(r.headers, r.body);
    return { slug, ok: true, status: r.status, final: r.finalUrl, robots: robots.status, sitemap: sm.status, ...sn };
  } catch (e) {
    await mkdir(dir, { recursive: true });
    const err = { requested: u, error: String(e?.cause?.code || e?.name || e), message: String(e?.message || "") };
    await writeFile(join(dir, "root.headers.json"), JSON.stringify(err, null, 2));
    return { slug, ok: false, status: 0, error: err.error };
  }
}

async function runPool(items, n, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return out;
}

const results = await runPool(urls, CONCURRENCY, harvestOne);
console.log("\n=== HARVEST DIGEST ===");
for (const r of results) {
  if (!r.ok) { console.log(`✗ ${r.slug.padEnd(34)} ERROR ${r.error}`); continue; }
  const sig = (r.signals || []).join(",") || "(none)";
  console.log(`✓ ${r.slug.padEnd(34)} ${String(r.status).padEnd(4)} rob:${r.robots} sm:${r.sitemap} | gen:${r.generator || "-"} srv:${r.server || "-"} | ${sig}`);
}
console.log(`\nSites: ${results.length} · ok: ${results.filter((r) => r.ok).length} · errors: ${results.filter((r) => !r.ok).length}`);
