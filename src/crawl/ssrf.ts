// SPEC #25 Part B — SSRF guard. A service that fetches arbitrary user URLs is an
// SSRF engine unless constrained. Blocks private/reserved destinations. Pure +
// synchronous: works on IP literals and localhost-by-name without DNS. The real
// transport additionally resolves hostnames and re-checks the resolved IP; the
// per-hop redirect check reuses this on every hop (D-01…D-08). DNS rebinding is
// accepted residual risk for MVP (§14 thread).

export type HostVerdict = { blocked: boolean; reason?: string };

function isIPv4(h: string): boolean { return /^\d{1,3}(\.\d{1,3}){3}$/.test(h); }

function blockedV4(h: string): HostVerdict {
  const o = h.split(".").map(Number);
  if (o.some((n) => n > 255)) return { blocked: true, reason: "invalid_ip" };
  const [a, b] = o;
  if (a === 127) return { blocked: true, reason: "loopback" };
  if (a === 10) return { blocked: true, reason: "private" };
  if (a === 172 && b >= 16 && b <= 31) return { blocked: true, reason: "private" };
  if (a === 192 && b === 168) return { blocked: true, reason: "private" };
  if (a === 169 && b === 254) return { blocked: true, reason: "link_local" }; // incl. 169.254.169.254 cloud metadata
  if (a === 0) return { blocked: true, reason: "reserved" }; // 0.0.0.0/8
  if (a >= 224 && a <= 239) return { blocked: true, reason: "multicast" };
  if (a === 255 && b === 255) return { blocked: true, reason: "broadcast" };
  return { blocked: false };
}

function blockedV6(raw: string): HostVerdict {
  const h = raw.toLowerCase();
  if (h === "::1") return { blocked: true, reason: "loopback" };
  if (h === "::" || h === "::0") return { blocked: true, reason: "reserved" };
  // IPv4-mapped ::ffff:a.b.c.d → check the embedded v4
  const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return blockedV4(mapped[1]);
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return { blocked: true, reason: "unique_local" }; // fc00::/7 (incl. fd00::/8)
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return { blocked: true, reason: "link_local" }; // fe80::/10
  if (/^ff[0-9a-f]{2}:/.test(h)) return { blocked: true, reason: "multicast" }; // ff00::/8
  return { blocked: false };
}

// Pure check for IP literals + localhost-by-name. Hostnames return not-blocked
// here (the transport resolves + re-checks them).
export function isBlockedHost(host: string): HostVerdict {
  const h = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return { blocked: true, reason: "localhost" };
  if (isIPv4(h)) return blockedV4(h);
  if (h.includes(":")) return blockedV6(h);
  return { blocked: false };
}

// True IP-literal test (for the N-21 note vs reject decision).
export function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[/, "").replace(/\]$/, "");
  return isIPv4(h) || (h.includes(":") && /^[0-9a-f:.]+$/i.test(h));
}
