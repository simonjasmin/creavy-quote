// #32 A2 — the assessment output schema. QUALITATIVE ONLY. `complexity` is a flavour,
// never a tier and never priced (invariant #1 / the #32 firewall). Closed enums so an
// injected value in crawled text can never mint a new one.

export const COMPLEXITY = ["low", "standard", "elevated"] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;
export const COMPLEXITY_FACTORS = [
  "minimal_content", "thin_but_clean", "dense_content", "multilingual_content",
  "ecommerce_present", "booking_flow_present", "heavy_media", "dated_design", "custom_functionality",
] as const;

export type Complexity = (typeof COMPLEXITY)[number];
export type Confidence = (typeof CONFIDENCE)[number];
export type ComplexityFactor = (typeof COMPLEXITY_FACTORS)[number];
export type AssessLang = "fr" | "en";

// The successful assessment. `assessment` is the prospect-facing prose (streamed, A4);
// everything else is INTERNAL and must never reach a prospect (see the public projection).
export type Assessment = {
  ok: true;
  complexity: Complexity;
  complexity_factors: ComplexityFactor[]; // internal
  assessment: string; // prose, form's language — the ONLY prospect-facing field
  review_note: string; // internal, founder-facing
  confidence: Confidence; // internal — gates whether prose ships (#23)
  flagged_for_review: boolean; // internal — model requests a human look
  lang: AssessLang;
};

// A5 — the typed unavailable. The deterministic price NEVER depends on this module, so
// any failure here degrades to book-a-call while the price still renders.
export type AssessmentUnavailable = {
  ok: false;
  reason: "not_assessable" | "model_error" | "invalid_output" | "refused";
  detail?: string; // internal only — never shown to a prospect
};

export type AssessResult = Assessment | AssessmentUnavailable;

export const isAssessment = (r: AssessResult): r is Assessment => r.ok === true;
