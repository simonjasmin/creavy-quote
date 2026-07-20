// CORS per #33: the exact production origin (from env) PLUS deploy-preview origins matching
// the anchored, https-only pattern ^https://[a-z0-9-]+--creavy\.netlify\.app$. Everything
// else gets no Access-Control-Allow-Origin header → the browser blocks it. Supersedes the
// contract §7 / #30.4 "production-origin-only" line (flagged for a contract bump to v0.5).

export function corsOriginAllowed(origin: string | undefined, allowedOrigin: string, previewPattern: RegExp): boolean {
  if (!origin) return false;
  return origin === allowedOrigin || previewPattern.test(origin);
}

// Headers to attach to a response. Empty object when the origin is not allowed (no ACAO).
export function corsHeaders(origin: string | undefined, allowedOrigin: string, previewPattern: RegExp): Record<string, string> {
  if (!corsOriginAllowed(origin, allowedOrigin, previewPattern)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin as string,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  };
}
