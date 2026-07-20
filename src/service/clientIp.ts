// Client-IP extraction that trusts ONLY our reverse-proxy hops (#25-A step 1). A spoofed
// X-Forwarded-For from an untrusted hop can never move the keyed IP. Rate-limit keying
// collapses IPv6 to its /64 (a single subscriber controls a whole /64).

// Strip brackets, IPv4 port, and IPv4-mapped-IPv6 prefix; lowercase.
function normalizeIp(raw: string): string {
  let ip = (raw || "").trim();
  if (ip.startsWith("[")) { const end = ip.indexOf("]"); if (end > 0) ip = ip.slice(1, end); }
  else if ((ip.match(/:/g) || []).length === 1) ip = ip.split(":")[0]; // ipv4:port
  ip = ip.replace(/^::ffff:/i, ""); // ipv4-mapped ipv6
  return ip.toLowerCase();
}

// chain = [...XFF, socketPeer]. The last `trustedProxyHops` entries are our infra; the
// client is the entry just before them. hops=0 → trust nothing, use the socket peer.
export function clientIp(remoteAddr: string, xffHeader: string | undefined, trustedProxyHops: number): string {
  if (trustedProxyHops <= 0) return normalizeIp(remoteAddr);
  const xff = (xffHeader ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const chain = [...xff, remoteAddr];
  const idx = chain.length - 1 - trustedProxyHops;
  return normalizeIp(idx >= 0 ? chain[idx] : chain[0]);
}

function expandIpv6(ip: string): string[] {
  const parts = ip.split("::");
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length > 1 && parts[1] ? parts[1].split(":") : [];
  const missing = Math.max(0, 8 - head.length - tail.length);
  return [...head, ...Array(missing).fill("0"), ...tail].map((g) => (g || "0").padStart(4, "0")).slice(0, 8);
}

// Rate-limit bucket key: full IPv4, or the /64 network for IPv6.
export function ipRateKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  return expandIpv6(ip).slice(0, 4).join(":") + "::/64";
}
