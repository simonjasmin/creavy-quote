// POST /quote payload validation (#25-A step 4). typed 400s (§5 shape). The URL goes through
// normalize() — N-22/N-23 route greenfield with ZERO crawl (the worker short-circuits), still
// a valid request.
//
// #36 OPTIONAL ANSWERS (scanned path): with a URL, EVERY answers field is optional — omit it
// (or send null) to leave it UNANSWERED. An unanswered field adds no declared need and can
// manufacture no conflict; the register comes from the scan alone (30.1: add needs, never
// erase evidence). Only an ANSWERED field is validated + priced. The no_site path is
// unchanged: with nothing to crawl, all four answers stay REQUIRED (typed 400 otherwise).

import { normalize } from "../url/normalize.ts";

export const PAGES = ["1_2", "3_4", "5_plus"] as const;
export const COMPONENTS = ["none", "booking", "listings", "both"] as const;
export const LANGUAGES = ["fr", "fr_en"] as const;

// #36 — every field optional on the scanned path (absent = unanswered). Required only for no_site.
export type Answers = {
  pages?: (typeof PAGES)[number];
  component?: (typeof COMPONENTS)[number];
  languages?: (typeof LANGUAGES)[number];
  has_brand_assets?: boolean;
};

export type ValidRequest = {
  no_site: boolean;
  url: string | null;
  normalized_url: string | null;
  classification?: "no_owned_site" | "platform_profile"; // N-22/N-23 → greenfield, zero crawl
  answers: Answers;
  persona: string | null;
};

export type ValidationError = { error: "invalid_request"; detail: string; allowed?: readonly string[] };
export type ValidationResult = { ok: true; request: ValidRequest } | { ok: false; error: ValidationError };

const enumErr = (field: string, allowed: readonly string[]): ValidationResult => ({ ok: false, error: { error: "invalid_request", detail: `${field}: out of enum`, allowed } });

const has = (v: unknown): boolean => v !== undefined && v !== null; // "answered"

export function validateQuoteRequest(body: unknown): ValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const no_site = b.no_site === true;
  if (b.answers != null && typeof b.answers !== "object") return { ok: false, error: { error: "invalid_request", detail: "answers: must be an object" } };
  const a = (b.answers ?? {}) as Record<string, unknown>;

  // Validate each field's VALUE only when ANSWERED — a bad enum is still a 400 on either path.
  if (has(a.pages) && !(PAGES as readonly string[]).includes(a.pages as string)) return enumErr("answers.pages", PAGES);
  if (has(a.component) && !(COMPONENTS as readonly string[]).includes(a.component as string)) return enumErr("answers.component", COMPONENTS);
  if (has(a.languages) && !(LANGUAGES as readonly string[]).includes(a.languages as string)) return enumErr("answers.languages", LANGUAGES);
  if (has(a.has_brand_assets) && typeof a.has_brand_assets !== "boolean") return { ok: false, error: { error: "invalid_request", detail: "answers.has_brand_assets: must be boolean" } };

  // Keep ONLY answered fields — an absent field is undefined, never a fabricated default (#36).
  const answers: Answers = {
    ...(has(a.pages) ? { pages: a.pages as Answers["pages"] } : {}),
    ...(has(a.component) ? { component: a.component as Answers["component"] } : {}),
    ...(has(a.languages) ? { languages: a.languages as Answers["languages"] } : {}),
    ...(has(a.has_brand_assets) ? { has_brand_assets: a.has_brand_assets as boolean } : {}),
  };
  const persona = typeof b.persona === "string" && b.persona.trim() ? b.persona.trim().slice(0, 64) : null;

  if (no_site) {
    // no_site prices from answers ALONE → all four REQUIRED (values already validated above).
    for (const k of ["pages", "component", "languages", "has_brand_assets"] as const)
      if (!has(a[k])) return { ok: false, error: { error: "invalid_request", detail: `answers.${k}: required for no_site` } };
    return { ok: true, request: { no_site: true, url: null, normalized_url: null, answers, persona } };
  }

  if (typeof b.url !== "string" || !b.url.trim()) return { ok: false, error: { error: "invalid_request", detail: "url: required unless no_site=true" } };
  const n = normalize(b.url);
  if (!n.ok) return { ok: false, error: { error: "invalid_request", detail: `url: ${n.error}` } };

  return { ok: true, request: { no_site: false, url: b.url.trim(), normalized_url: n.identity, classification: n.classification, answers, persona } };
}
