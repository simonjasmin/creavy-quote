// Fingerprint spike — the three candidate detectors.
// SPIKE CODE — /spikes, never imported by src.
//
// All three are PASSIVE: they consume an already-fetched page and make zero
// requests (SPEC #3 "HTTP-only"; spike design constraint #1). Interface mirrors
// the proposed frozen shape: fingerprint(pages: FetchedPage[]) -> result.
//   FetchedPage = { url, status, headers, body }
//   result      = { platform, builder, confidence, signals_matched }

import { readFile } from "node:fs/promises";

// ----- shared passive parsing -----
export function lcHeaders(headers) {
  const o = {};
  for (const [k, v] of Object.entries(headers || {})) o[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  return o;
}
export function extractMeta(body) {
  const meta = {};
  const re = /<meta\b[^>]*>/gi;
  for (const tag of body.match(re) || []) {
    const name = (tag.match(/\b(?:name|property|http-equiv)=["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent=["']([^"']*)["']/i) || [])[1];
    if (name) meta[name.toLowerCase()] = content ?? "";
  }
  return meta;
}
export function extractScripts(body) {
  const out = [];
  for (const m of body.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) out.push(m[1]);
  return out;
}
function host(url) { try { return new URL(url).hostname; } catch { return ""; } }

// ============================================================
// Candidate A — hand-rolled signal table (brief §4). Headers → assets/DOM →
// generator → class heuristics. Deterministic signal = high; supporting = medium;
// nothing = custom/low. Zero deps.
// ============================================================
export function detectA(pages) {
  const p = pages[0];
  const h = lcHeaders(p.headers);
  const b = p.body || "";
  const meta = extractMeta(b);
  const gen = meta["generator"] || "";
  const link = h["link"] || "";
  const hh = host(p.url || "");
  const sig = [];
  const S = (x) => (sig.push(x), true);

  // WP builder sub-detection (used when platform resolves to WordPress)
  const builder =
    (/\/plugins\/elementor(?:-pro)?\//.test(b) || /elementor-(?:page|widget|element|section)/.test(b) || /^elementor/i.test(gen)) ? "elementor" :
    (/\/themes\/Divi\//.test(b) || /\bet_pb_/.test(b) || /^divi/i.test(gen)) ? "divi" :
    (/\bvc_row\b/.test(b) || /js_composer/.test(b)) ? "wpbakery" :
    (/\bfl-builder\b/.test(b) || /\/uploads\/bb-plugin\//.test(b)) ? "beaver" : "unknown";

  // Deterministic checks, closed/e-comm platforms before WordPress.
  if (h["x-shopid"] || h["x-shopify-stage"] || /cdn\.shopify\.com|shopifycdn\.com/.test(b) || /myshopify\.com/.test(hh))
    return done("shopify", "high", sig, S(h["x-shopid"] ? "hdr:x-shopid" : /shopifycdn/.test(b) ? "asset:shopifycdn" : "asset:cdn.shopify.com"));
  if (h["x-wix-request-id"] || h["x-wix-renderer-server"] || /wixstatic\.com|parastorage\.com/.test(b))
    return done("wix", "high", sig, S(h["x-wix-request-id"] ? "hdr:x-wix-request-id" : "asset:parastorage/wixstatic"));
  if (/squarespace/i.test(h["server"] || "") || /<!--\s*This is Squarespace/i.test(b) || /static1\.squarespace\.com/.test(b))
    return done("squarespace", "high", sig, S(/squarespace/i.test(h["server"] || "") ? "hdr:server=Squarespace" : "asset:static1.squarespace.com"));
  if (/data-wf-(site|page)/.test(b) || /assets\.website-files\.com|\.website-files\.com/.test(b))
    return done("webflow", "high", sig, S(/data-wf-/.test(b) ? "dom:data-wf-site" : "asset:website-files.com"));
  if (/dd-cdn\.multiscreensite\.com|multiscreensite\.com|cdn-website\.com/.test(b))
    return done("duda", "high", sig, S("asset:multiscreensite/cdn-website"));
  if (/cdn\d*\.editmysite\.com|editmysite\.com/.test(b) || /square online/i.test(gen))
    return done("weebly", "high", sig, S(/square online/i.test(gen) ? "gen:Square Online" : "asset:editmysite.com"));
  if (/img\d*\.wsimg\.com|wsimg\.com/.test(b))
    return done("godaddy", "high", sig, S("asset:wsimg.com"));
  if (/framerusercontent\.com/.test(b)) return done("framer", "high", sig, S("asset:framerusercontent.com"));
  if (/(?:^|\/\/|\.)carrd\.co/.test(b)) return done("carrd", "high", sig, S("asset:carrd.co"));
  if (/joomla/i.test(h["x-content-encoded-by"] || "") || /joomla/i.test(gen) || /\/media\/jui\//.test(b))
    return done("joomla", "high", sig, S("joomla:gen/header/jui"));
  if (/drupal/i.test(h["x-generator"] || "") || /\/sites\/default\/files\//.test(b) || /Drupal\.settings/.test(b))
    return done("drupal", "high", sig, S("drupal:gen/sites-default-files"));
  // WordPress (deterministic)
  if (/\/wp-content\//.test(b) || /\/wp-includes\//.test(b) || /rel=["']https:\/\/api\.w\.org\//.test(link) || /\/xmlrpc\.php/.test(h["x-pingback"] || "")) {
    S(/wp-content|wp-includes/.test(b) ? "asset:/wp-content|/wp-includes" : "hdr:api.w.org");
    return done("wordpress", "high", sig, true, builder);
  }

  // Supporting-only (medium)
  if (/wix\.com website builder/i.test(gen)) return done("wix", "medium", sig, S("gen:Wix (supporting)"));
  if (/^wordpress/i.test(gen) || /\/wp-json\//.test(b) || /wp-emoji/.test(b)) return done("wordpress", "medium", sig, S("gen/wp-json/wp-emoji (supporting)"), builder);
  if (/squarespace/i.test(gen)) return done("squarespace", "medium", sig, S("gen:Squarespace (supporting)"));

  // Fallback
  return done("custom", "low", sig, S("no platform signal"));

  function done(platform, confidence, signals, _added, bld) {
    const r = { platform, confidence, signals_matched: signals.slice() };
    if (platform === "wordpress" && bld && bld !== "unknown") r.builder = bld;
    return r;
  }
}

// ============================================================
// Candidate C — generator-meta only. Trivial baseline: map the <meta generator>
// value to a platform by exact platform NAME. Plugin generators (Elementor,
// AIOSEO, WP Rocket, WPML, Site Kit, …) are intentionally NOT resolved — a
// generator-only baseline cannot know a plugin implies WordPress.
// ============================================================
export function detectC(pages) {
  const gen = (extractMeta(pages[0].body || "")["generator"] || "").toLowerCase();
  const MAP = [
    ["wix", "wix"], ["squarespace", "squarespace"], ["shopify", "shopify"], ["webflow", "webflow"],
    ["duda", "duda"], ["square online", "weebly"], ["weebly", "weebly"], ["joomla", "joomla"],
    ["drupal", "drupal"], ["wordpress", "wordpress"],
  ];
  for (const [needle, plat] of MAP) if (gen.includes(needle)) return { platform: plat, confidence: "high", signals_matched: [`generator:${gen}`] };
  return { platform: "unknown", confidence: "low", signals_matched: gen ? [`generator:${gen} (unmapped)`] : ["no generator"] };
}

// ============================================================
// Candidate B — Wappalyzer-fork (enthec/webappanalyzer, GPL-3.0) ruleset behind
// a thin PASSIVE evaluator, filtered to the platform techs (brief §4/§6).
// Supports the passive Wappalyzer fields: headers, meta, html, scriptSrc, url.
// EXCLUDES js/dom/cookies (js+dom need a browser; Set-Cookie is stripped) — that
// exclusion is the HTTP-only constraint, and its cost is part of the finding.
// ============================================================
const PLATFORM_MAP = {
  WordPress: "wordpress", Wix: "wix", Squarespace: "squarespace", Shopify: "shopify",
  Webflow: "webflow", Duda: "duda", Weebly: "weebly", Joomla: "joomla", Drupal: "drupal",
  Framer: "framer", Carrd: "carrd",
};
const BUILDER_MAP = {
  Elementor: "elementor", Divi: "divi", "Beaver Builder": "beaver",
  "WPBakery Page Builder": "wpbakery", "Visual Composer Website Builder": "wpbakery",
};

let _techCache = null;
async function loadTechs() {
  if (_techCache) return _techCache;
  const techs = {};
  for (const L of ["a", "b", "d", "e", "f", "j", "s", "w"]) {
    try { Object.assign(techs, JSON.parse(await readFile(`spikes/wappalyzer/technologies/${L}.json`, "utf8"))); } catch {}
  }
  const wanted = { ...PLATFORM_MAP, ...BUILDER_MAP };
  _techCache = {};
  for (const name of Object.keys(wanted)) if (techs[name]) _techCache[name] = techs[name];
  return _techCache;
}

function parsePattern(str) {
  const parts = String(str).split("\\;");
  let confidence = 100;
  for (const t of parts.slice(1)) { const m = t.match(/^confidence:(\d+)/); if (m) confidence = Number(m[1]); }
  let re = null;
  try { re = new RegExp(parts[0], "i"); } catch { re = null; }
  return { re, confidence, raw: parts[0] };
}
function asArray(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

function matchField(patterns, value) {
  // returns matched confidence (0 if none). Empty pattern = presence check.
  let best = 0;
  for (const p of asArray(patterns)) {
    const { re, confidence, raw } = parsePattern(p);
    if (raw === "") { best = Math.max(best, confidence); continue; }
    if (re && re.test(value)) best = Math.max(best, confidence);
  }
  return best;
}

function evalTech(def, ctx) {
  let conf = 0;
  const hit = [];
  if (def.headers) for (const [k, pat] of Object.entries(def.headers)) {
    const v = ctx.headers[k.toLowerCase()];
    if (v !== undefined) { const c = matchField(pat, v); if (c) { conf = Math.max(conf, c); hit.push(`hdr:${k}`); } }
  }
  if (def.meta) for (const [k, pat] of Object.entries(def.meta)) {
    const v = ctx.meta[k.toLowerCase()];
    if (v !== undefined) { const c = matchField(pat, v); if (c) { conf = Math.max(conf, c); hit.push(`meta:${k}`); } }
  }
  if (def.html) { const c = matchField(def.html, ctx.body); if (c) { conf = Math.max(conf, c); hit.push("html"); } }
  if (def.scriptSrc) for (const s of ctx.scripts) { const c = matchField(def.scriptSrc, s); if (c) { conf = Math.max(conf, c); hit.push("scriptSrc"); break; } }
  if (def.url) { const c = matchField(def.url, ctx.url); if (c) { conf = Math.max(conf, c); hit.push("url"); } }
  // js / dom / cookies intentionally skipped (browser-only / stripped) — passive constraint.
  return { conf, hit };
}

export async function detectB(pages) {
  const p = pages[0];
  const techs = await loadTechs();
  const ctx = {
    headers: lcHeaders(p.headers),
    meta: extractMeta(p.body || ""),
    body: p.body || "",
    scripts: extractScripts(p.body || ""),
    url: p.url || "",
  };
  const detected = {}; // name -> {conf, hit}
  for (const [name, def] of Object.entries(techs)) {
    const r = evalTech(def, ctx);
    if (r.conf > 0) detected[name] = r;
  }
  // platform = best-confidence platform-category tech
  let platform = null, pconf = 0, psig = [];
  for (const [name, r] of Object.entries(detected)) {
    if (PLATFORM_MAP[name] && r.conf >= pconf) { platform = PLATFORM_MAP[name]; pconf = r.conf; psig = r.hit.map((h) => `${name}:${h}`); }
  }
  // builder (WP) — implies WordPress if platform not already set
  let builder = null, bsig = [];
  for (const [name, r] of Object.entries(detected)) {
    if (BUILDER_MAP[name]) { builder = BUILDER_MAP[name]; bsig = r.hit.map((h) => `${name}:${h}`); if (!platform) { platform = "wordpress"; pconf = Math.max(pconf, r.conf); } }
  }
  if (!platform) return { platform: "custom", confidence: "low", signals_matched: ["no platform tech matched (passive)"] };
  const confidence = pconf >= 100 ? "high" : pconf >= 50 ? "medium" : "low";
  const out = { platform, confidence, signals_matched: [...psig, ...bsig] };
  if (platform === "wordpress" && builder) out.builder = builder;
  return out;
}

export const CANDIDATES = { A: detectA, B: detectB, C: detectC };
