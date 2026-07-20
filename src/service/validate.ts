// POST /quote payload validation (#25-A step 4). All-or-nothing answers per contract §3;
// typed 400s (§5 shape). The URL goes through normalize() — N-22/N-23 route greenfield with
// ZERO crawl (the worker short-circuits), still a valid request.

import { normalize } from "../url/normalize.ts";

export const PAGES = ["1_2", "3_4", "5_plus"] as const;
export const COMPONENTS = ["none", "booking", "listings", "both"] as const;
export const LANGUAGES = ["fr", "fr_en"] as const;

export type Answers = {
  pages: (typeof PAGES)[number];
  component: (typeof COMPONENTS)[number];
  languages: (typeof LANGUAGES)[number];
  has_brand_assets: boolean;
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

export function validateQuoteRequest(body: unknown): ValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const no_site = b.no_site === true;
  const a = b.answers as Record<string, unknown> | undefined;

  if (!a || typeof a !== "object") return { ok: false, error: { error: "invalid_request", detail: "answers: required" } };
  if (!(PAGES as readonly string[]).includes(a.pages as string)) return enumErr("answers.pages", PAGES);
  if (!(COMPONENTS as readonly string[]).includes(a.component as string)) return enumErr("answers.component", COMPONENTS);
  if (!(LANGUAGES as readonly string[]).includes(a.languages as string)) return enumErr("answers.languages", LANGUAGES);
  if (typeof a.has_brand_assets !== "boolean") return { ok: false, error: { error: "invalid_request", detail: "answers.has_brand_assets: must be boolean" } };

  const answers: Answers = { pages: a.pages as any, component: a.component as any, languages: a.languages as any, has_brand_assets: a.has_brand_assets };
  const persona = typeof b.persona === "string" && b.persona.trim() ? b.persona.trim().slice(0, 64) : null;

  if (no_site) return { ok: true, request: { no_site: true, url: null, normalized_url: null, answers, persona } };

  if (typeof b.url !== "string" || !b.url.trim()) return { ok: false, error: { error: "invalid_request", detail: "url: required unless no_site=true" } };
  const n = normalize(b.url);
  if (!n.ok) return { ok: false, error: { error: "invalid_request", detail: `url: ${n.error}` } };

  return { ok: true, request: { no_site: false, url: b.url.trim(), normalized_url: n.identity, classification: n.classification, answers, persona } };
}
