// POST /quote/:id/assess body validation — refuses PII BY CONSTRUCTION (treaty T4). The body
// is `{content_readiness}` only; the honeypot + Turnstile transport fields may ride along (the
// #25-A wall reads them). Any other key, or any email-shaped value anywhere, is a 400 — the
// quote service must never receive an email (keeps #29.1 zero-PII + the single Loi 25 path).

import type { ContentReadiness } from "../store/types.ts";

export const READINESS: readonly ContentReadiness[] = ["ready", "partial", "none"];
const ALLOWED_KEYS = new Set(["content_readiness", "company_website", "turnstile_token"]);
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;

export type AssessBodyResult =
  | { ok: true; content_readiness: ContentReadiness }
  | { ok: false; error: { error: string; detail?: string; allowed?: readonly string[] } };

export function validateAssessBody(body: unknown): AssessBodyResult {
  const b = (body ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(b)) {
    if (!ALLOWED_KEYS.has(k)) return { ok: false, error: { error: "invalid_request", detail: `unexpected field: ${k} (no PII — T4)` } };
  }
  for (const v of Object.values(b)) {
    if (typeof v === "string" && EMAIL_RE.test(v)) return { ok: false, error: { error: "pii_refused", detail: "email-shaped value rejected — PII lives only in Netlify Forms (T4)" } };
  }
  if (!(READINESS as readonly string[]).includes(b.content_readiness as string)) {
    return { ok: false, error: { error: "invalid_request", detail: "content_readiness: out of enum", allowed: READINESS } };
  }
  return { ok: true, content_readiness: b.content_readiness as ContentReadiness };
}
