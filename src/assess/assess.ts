// #32 — assess(scan, opts). Stage-2 qualitative assessment. PURE of pricing: it can raise
// a review flag but never moves a number (the #32 firewall). Model-agnostic (Fork 1) via
// the injected AssessmentModel. Failure-tolerant (A5): every failure returns a typed
// AssessmentUnavailable so the deterministic price still renders. A6: refuses non-assessable
// scans outright, even if a caller forgets #27.6 routing.

import type { ScanResult } from "../crawl/scan.ts";
import { assessable } from "./assessable.ts";
import { assessConfig } from "./config.ts";
import { buildSystem } from "./prompt/system.ts";
import { buildUser } from "./prompt/payload.ts";
import type { AssessmentModel } from "./model.ts";
import { type ScanEventEmitter, NOOP_EMITTER } from "../crawl/events.ts";
import {
  COMPLEXITY, CONFIDENCE, COMPLEXITY_FACTORS,
  type AssessResult, type AssessLang, type ComplexityFactor,
} from "./types.ts";

export type AssessOpts = {
  lang: AssessLang;
  model: AssessmentModel; // injected (replay in tests, live in prod/benchmark)
  modelId?: string; // overrides config.model (the benchmark passes ids explicitly)
  onProse?: (chunk: string) => void; // A4: prose streams here, meta never does
  emitter?: ScanEventEmitter; // A4: assessment_started/chunk/complete onto the #24 spine
  contentReadiness?: string; // 2b/T2 — owner-declared context for the note only (not a pricing input)
};

// Forward only the PROSE side of the stream to onProse, stopping cleanly at the delimiter
// even when it straddles two chunks (hold back the last delim-1 chars until confirmed).
function proseForwarder(delim: string, onProse?: (c: string) => void) {
  let buf = "";
  let sent = 0;
  let done = false;
  return (chunk: string) => {
    if (done || !onProse) { buf += chunk; return; }
    buf += chunk;
    const idx = buf.indexOf(delim);
    if (idx >= 0) {
      if (idx > sent) onProse(buf.slice(sent, idx));
      sent = idx;
      done = true;
      return;
    }
    const safe = Math.max(sent, buf.length - (delim.length - 1)); // don't emit a partial delimiter
    if (safe > sent) { onProse(buf.slice(sent, safe)); sent = safe; }
  };
}

const wordCount = (s: string) => (s.trim().match(/\S+/g) || []).length;

// Strip an accidental ```json … ``` fence the model may wrap the meta in.
function stripFence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (m ? m[1] : s).trim();
}

function parseTranscript(raw: string, lang: AssessLang): AssessResult {
  const delim = assessConfig.delimiter;
  const idx = raw.indexOf(delim);
  if (idx < 0) return { ok: false, reason: "invalid_output", detail: "no meta delimiter" };
  const prose = raw.slice(0, idx).trim();
  if (!prose) return { ok: false, reason: "invalid_output", detail: "empty prose" };

  let meta: any;
  try { meta = JSON.parse(stripFence(raw.slice(idx + delim.length))); }
  catch { return { ok: false, reason: "invalid_output", detail: "meta is not JSON" }; }
  if (!meta || typeof meta !== "object") return { ok: false, reason: "invalid_output", detail: "meta not an object" };

  // closed-enum validation — an injected value cannot mint a new enum member
  if (!(COMPLEXITY as readonly string[]).includes(meta.complexity)) return { ok: false, reason: "invalid_output", detail: "complexity out of enum" };
  if (!(CONFIDENCE as readonly string[]).includes(meta.confidence)) return { ok: false, reason: "invalid_output", detail: "confidence out of enum" };
  if (!Array.isArray(meta.complexity_factors) || !meta.complexity_factors.every((f: unknown) => (COMPLEXITY_FACTORS as readonly string[]).includes(f as string)))
    return { ok: false, reason: "invalid_output", detail: "complexity_factors out of enum" };
  if (typeof meta.flagged_for_review !== "boolean") return { ok: false, reason: "invalid_output", detail: "flagged_for_review not boolean" };
  if (typeof meta.review_note !== "string") return { ok: false, reason: "invalid_output", detail: "review_note not a string" };

  const factors = [...new Set(meta.complexity_factors as ComplexityFactor[])];
  // Soft length guard (#32 gate addition): prose over the cap LOGS an internal
  // `length_over_cap` note and flags for a human look — it NEVER rejects the output.
  const words = wordCount(prose);
  const over = words > assessConfig.prose_max_words;
  const review_note = over ? `${meta.review_note} [length_over_cap: ${words}w > ${assessConfig.prose_max_words}]`.trim() : meta.review_note;
  return {
    ok: true,
    complexity: meta.complexity,
    complexity_factors: factors,
    assessment: prose,
    review_note,
    confidence: meta.confidence,
    flagged_for_review: meta.flagged_for_review || over,
    lang,
  };
}

export async function assess(scan: ScanResult, opts: AssessOpts): Promise<AssessResult> {
  // A6 — hard-guard: never invoke the model on a non-assessable scan.
  if (!assessable(scan)) return { ok: false, reason: "not_assessable" };

  const modelId = opts.modelId ?? assessConfig.model;
  if (!modelId) return { ok: false, reason: "model_error", detail: "no model configured (pending gate) and none injected" };

  const emitter = opts.emitter ?? NOOP_EMITTER;
  const system = buildSystem(opts.lang);
  const user = buildUser(scan, { contentReadiness: opts.contentReadiness });
  // A4: the prose streams onto the #24 spine as it generates; meta NEVER does.
  const onProse = (c: string) => { emitter.emit("assessment_chunk", { text: c }); opts.onProse?.(c); };
  const forward = proseForwarder(assessConfig.delimiter, onProse);

  emitter.emit("assessment_started", { lang: opts.lang });
  let raw = "";
  try {
    for await (const chunk of opts.model.stream({ model: modelId, system, user, max_tokens: assessConfig.max_tokens })) {
      raw += chunk;
      forward(chunk);
    }
  } catch (e) {
    emitter.emit("assessment_unavailable", {}); // honest terminal event (A5)
    return { ok: false, reason: "model_error", detail: String((e as Error)?.message ?? e) };
  }

  const parsed = parseTranscript(raw, opts.lang);
  // Terminal event carries INTERNALS for the founder panel only — the public projection
  // ignores the data and renders a fixed string, so nothing internal ever ships (A4).
  if (parsed.ok) emitter.emit("assessment_complete", { complexity: parsed.complexity, confidence: parsed.confidence, flagged_for_review: parsed.flagged_for_review, factor_count: parsed.complexity_factors.length });
  else emitter.emit("assessment_unavailable", {});
  return parsed;
}
