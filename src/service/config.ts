// #34 / #22 — service config. Loader is PURE (takes an env map) so a missing required
// var is a testable hard-fail: the service refuses to boot rather than start half-config.
// Every wall limit lives here. No ANTHROPIC_API_KEY in a deployed environment (2a makes
// no model call) — its presence in staging/production is a boot error.

export const PREVIEW_ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+--creavy\.netlify\.app$/; // #33 (anchored, https-only)

export type ServiceConfig = {
  env: "production" | "staging" | "development";
  port: number;
  allowedOrigin: string; // exact production origin (#33)
  previewOriginPattern: RegExp; // #33 preview pattern (constant, not env)
  databaseUrl: string | null; // null → in-memory store (dev/test only)
  turnstile: { enabled: boolean; secret: string | null };
  rateLimit: { windowMs: number; maxPerWindow: number };
  dailyCeilings: { scans: number; assessments: number };
  trustedProxyHops: number; // trusted reverse-proxy hops for X-Forwarded-For
  cacheTtlMs: number; // #25-A step 7 freshness (24 h)
};

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = "ConfigError"; }
}

type Env = Record<string, string | undefined>;

export function loadServiceConfig(env: Env): ServiceConfig {
  const required = (k: string): string => {
    const v = env[k];
    if (!v || !v.trim()) throw new ConfigError(`missing required env: ${k}`);
    return v.trim();
  };
  const num = (k: string, def: number): number => {
    const v = env[k];
    if (v === undefined || v === "") return def;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new ConfigError(`env ${k} must be a non-negative number, got "${v}"`);
    return n;
  };
  const bool = (k: string, def: boolean): boolean => {
    const v = env[k];
    if (v === undefined || v === "") return def;
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
    throw new ConfigError(`env ${k} must be true/false, got "${v}"`);
  };

  const raw = env.NODE_ENV;
  const environment: ServiceConfig["env"] = raw === "production" ? "production" : raw === "staging" ? "staging" : "development";
  const deployed = environment === "production" || environment === "staging";

  // #34 guard: the deployed service must never carry the model key (2a = no model call).
  if (deployed && env.ANTHROPIC_API_KEY) {
    throw new ConfigError("ANTHROPIC_API_KEY must not be present in a deployed environment (#34 — 2a makes no model call)");
  }

  const allowedOrigin = required("ALLOWED_ORIGIN"); // hard-fail (#22)
  const turnstileEnabled = bool("TURNSTILE_ENABLED", false);
  const turnstileSecret = turnstileEnabled ? required("TURNSTILE_SECRET") : (env.TURNSTILE_SECRET?.trim() || null);

  const databaseUrl = env.DATABASE_URL?.trim() || null;
  if (environment === "production" && !databaseUrl) throw new ConfigError("missing required env: DATABASE_URL (required in production)");

  return {
    env: environment,
    port: num("PORT", 8080),
    allowedOrigin,
    previewOriginPattern: PREVIEW_ORIGIN_PATTERN,
    databaseUrl,
    turnstile: { enabled: turnstileEnabled, secret: turnstileSecret },
    rateLimit: { windowMs: num("RATE_LIMIT_WINDOW_MS", 60_000), maxPerWindow: num("RATE_LIMIT_MAX", 10) },
    dailyCeilings: { scans: num("DAILY_SCAN_CEILING", 200), assessments: num("DAILY_ASSESSMENT_CEILING", 50) },
    trustedProxyHops: num("TRUSTED_PROXY_HOPS", 1),
    cacheTtlMs: num("CACHE_TTL_MS", 24 * 60 * 60 * 1000),
  };
}
