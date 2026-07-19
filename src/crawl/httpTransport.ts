// Production HTTP transport (no browser). Manual redirect following so the
// redirect chain, loops, and hop cap are observable (D1/D-05/D-06). Strips
// Set-Cookie. UA per #15.

import { lookup } from "node:dns/promises";
import type { Transport, FetchResult, FetchOpts } from "./types.ts";
import { isBlockedHost, isIpLiteral } from "./ssrf.ts";

export const BOT_UA = "CreavyQuoteBot/1.0 (+https://creavy.com/bot)"; // #15

function lower(h: Headers): Record<string, string> {
  const o: Record<string, string> = {};
  h.forEach((v, k) => { if (k.toLowerCase() !== "set-cookie") o[k.toLowerCase()] = v; });
  return o;
}
function classify(e: any): FetchResult["error"] {
  const code = e?.cause?.code || e?.code || e?.name || "";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(String(code))) return { kind: "dns", message: String(code) };
  if (/ECONNREFUSED/i.test(String(code))) return { kind: "refused", message: String(code) };
  if (/ABORT|TimeoutError|UND_ERR_HEADERS_TIMEOUT|ETIMEDOUT/i.test(String(code))) return { kind: "timeout", message: String(code) };
  if (/CERT|TLS|SSL|DEPTH_ZERO|SELF_SIGNED|ERR_TLS/i.test(String(code))) return { kind: "tls", message: String(code) };
  return { kind: "other", message: String(code || e) };
}

export class HttpTransport implements Transport {
  async fetch(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
    const maxHops = opts.maxHops ?? 5;
    const timeoutMs = opts.timeoutMs ?? 8000;
    const chain: string[] = [];
    const visited = new Set<string>();
    let cur = url;
    while (true) {
      // SSRF (#25 Part B), per-hop before connect. Uniform failure (kind "blocked").
      let host = "";
      try {
        const u = new URL(cur);
        if (!/^https?:$/.test(u.protocol)) return { url: cur, status: 0, headers: {}, body: "", chain, error: { kind: "blocked", message: "bad_scheme" } };
        host = u.hostname;
      } catch { return { url: cur, status: 0, headers: {}, body: "", chain, error: { kind: "blocked", message: "bad_url" } }; }
      if (isBlockedHost(host).blocked) return { url: cur, status: 0, headers: {}, body: "", chain, error: { kind: "blocked", message: "ssrf" } };
      if (!isIpLiteral(host)) {
        try {
          const addrs = await lookup(host, { all: true }); // resolve, then check the IP before connect
          for (const a of addrs) if (isBlockedHost(a.address).blocked) return { url: cur, status: 0, headers: {}, body: "", chain, error: { kind: "blocked", message: "ssrf" } };
        } catch (e) { return { url: cur, status: 0, headers: {}, body: "", chain, error: classify(e) }; }
      }
      let res: Response;
      try {
        res = await fetch(cur, { redirect: "manual", headers: { "user-agent": BOT_UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        return { url: cur, status: 0, headers: {}, body: "", chain, error: classify(e) };
      }
      const headers = lower(res.headers);
      if (res.status >= 300 && res.status < 400 && headers["location"]) {
        if (visited.has(cur)) return { url: cur, status: res.status, headers, body: "", chain, error: { kind: "redirect_loop", message: "loop" } };
        visited.add(cur); chain.push(cur);
        if (chain.length > maxHops) return { url: cur, status: res.status, headers, body: "", chain, error: { kind: "too_many_redirects", message: "hop cap" } };
        try { cur = new URL(headers["location"], cur).toString(); } catch { return { url: cur, status: res.status, headers, body: "", chain, error: { kind: "other", message: "bad location" } }; }
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const body = new TextDecoder("utf-8").decode(buf.subarray(0, 2 * 1024 * 1024));
      return { url: cur, status: res.status, headers, body, bytes: buf, chain };
    }
  }
}
