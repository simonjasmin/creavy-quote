// Platform fingerprint adapter — SPEC amendment #23 (hand-rolled passive signal
// table). HTTP-only, ZERO network requests: consumes pages the bounder already
// fetched. Builder precedence is content > install (rider c); confidence is
// coverage-capped (rider a). Every scan should log signals_matched + confidence
// for the regression-by-fixture loop (rider b).

export type FetchedPage = { url: string; status: number; headers: Record<string, string | string[]>; body: string };
export type Confidence = "high" | "medium" | "low";
export type FingerprintResult = {
  platform: string; // wordpress|wix|squarespace|shopify|duda|weebly|webflow|godaddy|joomla|drupal|framer|carrd|custom|unknown
  builder?: string; // primary WP builder
  builders_detected: string[]; // all builders present (dual-builder sites)
  theme?: string;
  version?: string;
  confidence: Confidence;
  signals_matched: string[];
};

// Rider (a): platforms with zero labeled corpus fixtures cannot emit `high`.
// First production hit lands at medium → review → fixture → cap lifts (rider b).
export const ZERO_COVERAGE = new Set(["webflow", "godaddy", "joomla", "drupal", "framer", "carrd"]);

// ----- passive parsing helpers -----
function lcHeaders(headers: Record<string, string | string[]>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers || {})) o[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  return o;
}
function extractMeta(body: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const tag of body.match(/<meta\b[^>]*>/gi) || []) {
    const name = (tag.match(/\b(?:name|property|http-equiv)=["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent=["']([^"']*)["']/i) || [])[1];
    if (name) meta[name.toLowerCase()] = content ?? "";
  }
  return meta;
}
function safeHost(url: string): string { try { return new URL(url).hostname; } catch { return ""; } }
function countMatches(re: RegExp, s: string): number { return (s.match(re) || []).length; }

// ----- builder classification (rider c: content > install) -----
type BuilderScan = { content: number; install: number };
function scanBuilders(body: string): Record<string, BuilderScan> {
  return {
    elementor: {
      content: countMatches(/elementor-(?:page|section|column|container|element|widget|button)/gi, body),
      install: countMatches(/elementor-(?:default|global|kit)|\/plugins\/elementor(?:-pro)?\//gi, body),
    },
    divi: {
      content: countMatches(/\bet_pb_/g, body),
      install: countMatches(/\/themes\/Divi\//gi, body),
    },
    wpbakery: {
      content: countMatches(/\bvc_row\b|js_composer/gi, body),
      install: countMatches(/\/plugins\/js_composer\//gi, body),
    },
    beaver: {
      content: countMatches(/\bfl-(?:builder|node|row|module)\b/gi, body),
      install: countMatches(/\/(?:uploads\/bb-plugin|plugins\/bb-plugin)\//gi, body),
    },
  };
}
function resolveBuilders(body: string): { primary?: string; detected: string[]; signals: string[] } {
  const scans = scanBuilders(body);
  const present: { name: string; score: number; content: number }[] = [];
  const signals: string[] = [];
  for (const [name, s] of Object.entries(scans)) {
    if (s.content > 0 || s.install > 0) {
      present.push({ name, score: s.content * 1000 + s.install, content: s.content });
      signals.push(`builder:${name}:${s.content ? "content" : "install"}`);
    }
  }
  if (present.length === 0) return { detected: [], signals };
  present.sort((a, b) => b.score - a.score);
  const detected = present.map((p) => p.name).sort();
  // content beats install; install-only never claims primary over another's content
  return { primary: present[0].name, detected, signals };
}

function themeSlug(body: string): string | undefined {
  const m = body.match(/\/wp-content\/themes\/([a-z0-9_-]+)\//i);
  return m ? m[1] : undefined;
}

// ----- main -----
export function fingerprint(pages: FetchedPage[]): FingerprintResult {
  const root = pages[0] ?? { url: "", status: 0, headers: {}, body: "" };
  const h = lcHeaders(root.headers);
  const body = pages.map((p) => p.body || "").join("\n");
  const meta = extractMeta(body);
  const gen = meta["generator"] || "";
  const link = h["link"] || "";
  const host = safeHost(root.url || "");

  const cap = (platform: string, confidence: Confidence): Confidence =>
    ZERO_COVERAGE.has(platform) && confidence === "high" ? "medium" : confidence;

  const finalize = (platform: string, confidence: Confidence, signals: string[]): FingerprintResult => {
    const r: FingerprintResult = { platform, builders_detected: [], confidence: cap(platform, confidence), signals_matched: signals };
    if (platform === "wordpress") {
      const b = resolveBuilders(body);
      r.builders_detected = b.detected;
      if (b.primary) r.builder = b.primary;
      r.signals_matched = [...signals, ...b.signals];
      const t = themeSlug(body);
      if (t) r.theme = t;
    }
    return r;
  };

  // --- deterministic: closed / e-comm platforms before WordPress ---
  if (h["x-shopid"] || h["x-shopify-stage"] || /cdn\.shopify\.com|shopifycdn\.com/.test(body) || /myshopify\.com/.test(host))
    return finalize("shopify", "high", ["shopify:deterministic"]);
  if (h["x-wix-request-id"] || h["x-wix-renderer-server"] || /wixstatic\.com|parastorage\.com/.test(body))
    return finalize("wix", "high", ["wix:deterministic"]);
  if (/squarespace/i.test(h["server"] || "") || /<!--\s*This is Squarespace/i.test(body) || /static1\.squarespace\.com/.test(body))
    return finalize("squarespace", "high", ["squarespace:deterministic"]);
  if (/data-wf-(?:site|page)/.test(body) || /\.website-files\.com/.test(body))
    return finalize("webflow", "high", ["webflow:deterministic"]); // ZERO_COVERAGE → capped to medium
  if (/dd-cdn\.multiscreensite\.com|multiscreensite\.com|cdn-website\.com/.test(body))
    return finalize("duda", "high", ["duda:deterministic"]);
  if (/cdn\d*\.editmysite\.com|editmysite\.com/.test(body) || /square online/i.test(gen))
    return finalize("weebly", "high", ["weebly:deterministic"]);
  if (/img\d*\.wsimg\.com|wsimg\.com/.test(body))
    return finalize("godaddy", "high", ["godaddy:deterministic"]); // ZERO_COVERAGE → capped
  if (/framerusercontent\.com/.test(body)) return finalize("framer", "high", ["framer:deterministic"]); // capped
  if (/(?:^|\/\/|\.)carrd\.co/.test(body)) return finalize("carrd", "high", ["carrd:deterministic"]); // capped
  if (/joomla/i.test(h["x-content-encoded-by"] || "") || /joomla/i.test(gen) || /\/media\/jui\//.test(body))
    return finalize("joomla", "high", ["joomla:deterministic"]); // capped
  if (/drupal/i.test(h["x-generator"] || "") || /\/sites\/default\/files\//.test(body) || /Drupal\.settings/.test(body))
    return finalize("drupal", "high", ["drupal:deterministic"]); // capped
  if (/\/wp-content\//.test(body) || /\/wp-includes\//.test(body) || /rel=["']https:\/\/api\.w\.org\//.test(link) || /\/xmlrpc\.php/.test(h["x-pingback"] || ""))
    return finalize("wordpress", "high", ["wordpress:deterministic"]);

  // --- supporting-only (medium) ---
  if (/wix\.com website builder/i.test(gen)) return finalize("wix", "medium", ["wix:generator"]);
  if (/^wordpress/i.test(gen) || /\/wp-json\//.test(body) || /wp-emoji/.test(body)) return finalize("wordpress", "medium", ["wordpress:supporting"]);
  if (/squarespace/i.test(gen)) return finalize("squarespace", "medium", ["squarespace:generator"]);

  // --- fallback ---
  return { platform: "custom", builders_detected: [], confidence: "low", signals_matched: ["no platform signal"] };
}
