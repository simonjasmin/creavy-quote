// Pure URL normalizer — Table A (N-01…N-30) of the crawl edge-case inventory,
// governed by decision #10 (permissive repair, never guessy). No network: the
// network half (canonical-origin resolution, D-01…D-04) lives elsewhere.
//
// Canonical choices (documented, consistent across the table):
//  - trailing slash stripped except root "/" (N-06: /services ≡ /services/).
//  - host is ASCII/punycode, lowercased (N-03, N-13); path case preserved (N-04).
//  - percent-encodings uppercased, reserved never decoded (N-12).
//  - tracking params stripped, survivors sorted for a stable identity (N-09).
//  - fragment always dropped (N-07, N-08).

export type NormalizeOk = {
  ok: true;
  identity: string;
  scheme: string;
  host: string;
  notes: string[];
  classification?: "no_owned_site" | "platform_profile";
};
export type NormalizeErr = { ok: false; error: "empty" | "too_long" | "invalid_host" | "unsupported_scheme" | "invalid_url" };
export type NormalizeResult = NormalizeOk | NormalizeErr;

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|msclkid|mc_cid|mc_eid|ref)$/i;
const INDEX_FILE = /\/index\.(?:html?|php)$/i;
const NO_OWNED_SITE = ["facebook.com", "m.facebook.com", "fb.com", "instagram.com", "linktr.ee", "business.site", "pagesjaunes.ca"];
const PLATFORM_PROFILE = ["remax-quebec.com", "remax.ca", "centris.ca", "realtor.ca"];

const err = (error: NormalizeErr["error"]): NormalizeErr => ({ ok: false, error });

export function normalize(input: string): NormalizeResult {
  const notes: string[] = [];
  let raw = input.trim(); // N-02
  if (raw === "") return err("empty");
  if (raw.length > 2000) return err("too_long"); // N-28
  if (/\s/.test(raw)) return err("invalid_host"); // N-27 interior whitespace — don't guess (#10)

  // Scheme handling ---------------------------------------------------------
  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch) {
    const s = schemeMatch[1].toLowerCase();
    if (s === "http" || s === "https") {
      if (/^https?:\/(?!\/)/i.test(raw)) { raw = raw.replace(/^(https?):\/(?!\/)/i, "$1://"); notes.push("repaired"); } // N-20 https:/x
    } else {
      return err("unsupported_scheme"); // N-19 mailto:/ftp:/file:
    }
  } else if (/^https?\/\//i.test(raw)) {
    raw = raw.replace(/^(https?)\/\//i, "$1://"); notes.push("repaired"); // N-20 https//x
  } else if (raw.startsWith("//")) {
    raw = "https:" + raw; // N-17 protocol-relative
  } else {
    raw = "https://" + raw; // N-01 default scheme
  }

  // Userinfo strip (N-18) BEFORE parse, so "user:pass@" can't hide interior junk
  raw = raw.replace(/^(https?:\/\/)[^/@]*@/i, (_m, p1) => { notes.push("suspicious_input"); return p1; });

  let url: URL;
  try { url = new URL(raw); } catch { return err("invalid_url"); }

  // Interior whitespace in the authority → don't guess (N-27)
  if (/\s/.test(url.hostname) || url.hostname === "") return err("invalid_host");

  const scheme = url.protocol.replace(/:$/, "").toLowerCase(); // N-26
  const host = url.hostname.toLowerCase().replace(/\.$/, ""); // N-03; punycode IDN (N-13); strip FQDN dot (N-29)

  // Port: URL drops default 80/443; flag anything else (N-05)
  let portPart = "";
  if (url.port) { portPart = ":" + url.port; notes.push("unusual_port"); }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) notes.push("ip_literal"); // N-21

  // Path (N-14 collapse, N-15 dot-segments via URL, N-16 index, N-06 trailing) ---
  let path = url.pathname.replace(/\/{2,}/g, "/"); // N-14
  if (INDEX_FILE.test(path)) path = path.replace(/index\.(?:html?|php)$/i, ""); // N-16
  path = path.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase()); // N-12 uppercase hex
  if (path.length > 1) path = path.replace(/\/+$/, ""); // N-06 strip trailing (not root)
  if (path === "") path = "/"; // N-25 empty path → root

  // Query (N-09 strip tracking + sort; N-10 keep meaningful queries) ---------
  const kept: [string, string][] = [];
  for (const [k, v] of url.searchParams) if (!TRACKING.test(k)) kept.push([k, v]);
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const query = kept.map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join("&");

  const identity = `${scheme}://${host}${portPart}${path}${query ? "?" + query : ""}`; // fragment dropped (N-07/N-08)

  const result: NormalizeOk = { ok: true, identity, scheme, host, notes };
  if (NO_OWNED_SITE.some((d) => host === d || host.endsWith("." + d))) result.classification = "no_owned_site"; // N-22
  else if (PLATFORM_PROFILE.some((d) => host === d || host.endsWith("." + d))) result.classification = "platform_profile"; // N-23
  return result;
}
