// Table D1 — canonical-origin resolution (D-01…D-08). The network half of
// normalization (#16). Redirects are authoritative; apex/www unify; a root
// cross-domain redirect re-anchors once; a second stops the scan.

import type { Transport } from "./types.ts";

export type CanonicalResult = {
  origin: string;
  final_url: string;
  html: string;
  headers: Record<string, string>;
  status: number;
  notes: string[]; // scheme_upgraded, host_ambiguous, domain_moved, ...
  review_flags: string[];
  needs_browser: boolean;
  needs_browser_reasons: string[];
  error?: { kind: string; message: string };
};

function stripWww(host: string): string { return host.replace(/^www\./i, ""); }
function regDomain(host: string): string { const p = stripWww(host).split("."); return p.slice(-2).join("."); }

function metaRefreshTarget(html: string, base: string): string | null {
  const m = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"';]+)/i);
  if (!m) return null;
  try { return new URL(m[1].trim(), base).toString(); } catch { return null; }
}

function looksJsRedirect(html: string): boolean {
  const text = html.replace(/<[^>]+>/g, "").trim();
  const hasLinks = /<a\b[^>]*href=/i.test(html);
  return text.length < 2048 && !hasLinks && /(window\.)?location\s*(\.(href|replace|assign)\s*=|\.replace\s*\(|=)/i.test(html);
}

export async function resolveCanonical(transport: Transport, inputUrl: string): Promise<CanonicalResult> {
  const notes: string[] = [];
  const review: string[] = [];
  const inHost = (() => { try { return new URL(inputUrl).hostname; } catch { return ""; } })();
  const inScheme = (() => { try { return new URL(inputUrl).protocol.replace(":", ""); } catch { return "https"; } })();

  let res = await transport.fetch(inputUrl, { maxHops: 5 });
  if (res.error) {
    const kind = res.error.kind;
    const flag = kind === "redirect_loop" ? "redirect_loop" : kind === "too_many_redirects" ? "too_many_redirects" : kind;
    return { origin: new URL(inputUrl).origin, final_url: inputUrl, html: "", headers: {}, status: 0, notes, review_flags: [flag], needs_browser: false, needs_browser_reasons: [], error: res.error }; // D-06
  }

  // D-07 meta-refresh: treat as a redirect (one extra hop)
  const mr = metaRefreshTarget(res.body, res.url);
  if (mr && mr !== res.url) { notes.push("meta_refresh"); const r2 = await transport.fetch(mr, { maxHops: 5 }); if (!r2.error) res = r2; }

  let finalHost = new URL(res.url).hostname;

  // D-01 scheme upgrade
  if (inScheme === "http" && new URL(res.url).protocol === "https:") notes.push("scheme_upgraded");
  // D-02 apex↔www unify (canonical host = final)
  if (inHost && stripWww(inHost) === stripWww(finalHost) && inHost !== finalHost) notes.push("host_normalized");
  // D-04 cross-domain root redirect
  const hops = [...res.chain, res.url];
  const domains = new Set(hops.map((h) => { try { return regDomain(new URL(h).hostname); } catch { return h; } }));
  if (inHost && regDomain(inHost) !== regDomain(finalHost)) {
    notes.push("domain_moved");
    if (domains.size > 2) { review.push("domain_moved_twice"); } // second cross-domain hop → stop + flag
  }

  // D-03 apex AND www both 200 with no redirect → deterministic pick + host_ambiguous
  if (res.chain.length === 0) {
    const alt = stripWww(finalHost) === finalHost ? "www." + finalHost : stripWww(finalHost);
    const altUrl = new URL(res.url); altUrl.hostname = alt;
    const altRes = await transport.fetch(altUrl.toString(), { maxHops: 0 });
    if (!altRes.error && altRes.status === 200 && altRes.chain.length === 0) {
      notes.push("host_ambiguous");
      // (a) https already; (b) homepage rel=canonical; (c) internal-link majority; (d) www
      const canon = res.body.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
      if (canon) { try { finalHost = new URL(canon[1], res.url).hostname; } catch {} }
      else finalHost = "www." + stripWww(finalHost); // (d) default www
    }
  }

  const origin = new URL(res.url).protocol + "//" + finalHost + (new URL(res.url).port ? ":" + new URL(res.url).port : "");

  // D-08 JS-only redirect on a near-empty body
  const needsBrowser: string[] = [];
  if (looksJsRedirect(res.body)) needsBrowser.push("js_redirect");

  return { origin, final_url: res.url, html: res.body, headers: res.headers, status: res.status, notes, review_flags: review, needs_browser: needsBrowser.length > 0, needs_browser_reasons: needsBrowser };
}
