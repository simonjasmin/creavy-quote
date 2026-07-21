// Stage-2 assessment orchestration (2b). Idempotency (#32 A7: ≤1 model call per quote, EVER),
// preconditions (#32 A6), the assessment daily ceiling, and the wiring of the #32 library
// assess() over the STORED scan + page_content (never a re-crawl, #25-C). Every failure path
// lands on a terminal `unavailable` — the price never depends on this (treaty T5, #32 A5).

import { assess } from "../../assess/assess.ts";
import { assessable } from "../../assess/assessable.ts";
import { isAssessment } from "../../assess/types.ts";
import type { AssessmentModel } from "../../assess/model.ts";
import { PersistEmitter } from "../persistEmitter.ts";
import { assessmentId } from "../ids.ts";
import { contentSuggestions, mergeSuggestions } from "./contentSuggestions.ts";
import type { Store, Assessment, ContentReadiness } from "../store/types.ts";
import type { ScanResult } from "../../crawl/scan.ts";
import type { Clock } from "../../crawl/types.ts";
import type { ServiceConfig } from "../config.ts";
import type { PricingConfig } from "../../pricing/loadPricingConfig.ts";

export type AssessmentDeps = {
  store: Store;
  model: AssessmentModel | null; // null → no API key → unavailable (T5, stage 1½ intact)
  modelId: string | null;
  clock: Clock;
  serviceConfig: ServiceConfig;
  pricing: PricingConfig;
  lang: "fr" | "en";
};

export type StartResult =
  | { kind: "existing" | "started"; assessment: Assessment; done?: Promise<void> }
  | { kind: "not_found" }
  | { kind: "precondition"; reason: string } // 409
  | { kind: "ceiling"; reason: "budget_exceeded" }; // 409

const dayStart = (now: number): number => now - (now % 86_400_000);

// Reconstruct the ScanResult the model reads from stored columns (no re-crawl).
function reconstructScan(job: { crawl_facts: unknown; page_content: unknown }): ScanResult {
  return { ...(job.crawl_facts as object), page_content: job.page_content } as ScanResult;
}

export async function startAssessment(deps: AssessmentDeps, quoteId: string, content_readiness: ContentReadiness): Promise<StartResult> {
  const now = deps.clock.now();

  // 1. idempotency — one assessment per quote, EVER. Repeat → the existing row, no model call.
  const existing = await deps.store.getAssessmentByQuote(quoteId);
  if (existing) return { kind: "existing", assessment: existing };

  // 2. preconditions (#32 A6) — no row, no model call on failure (page unchanged, T5).
  const job = await deps.store.getJob(quoteId);
  if (!job) return { kind: "not_found" };
  if (job.status !== "completed") return { kind: "precondition", reason: "quote_not_completed" };
  const scan = reconstructScan(job);
  if (!job.crawl_facts || !assessable(scan)) return { kind: "precondition", reason: "not_assessable" };

  // 3. assessment daily ceiling (each row = one model attempt).
  if (await deps.store.countAssessmentsSince(dayStart(now)) >= deps.serviceConfig.dailyCeilings.assessments) {
    return { kind: "ceiling", reason: "budget_exceeded" };
  }

  // 4. create + invoke (fire-and-forget; the POST returns 202, the prose streams).
  const asmt = await deps.store.createAssessment({ id: assessmentId(), quote_id: quoteId, content_readiness, model: deps.modelId }, now);
  const base = ((job.mapper_output as any)?.suggested_addons ?? []) as { id: string; amount: number }[];
  const done = runModel(deps, asmt, scan, base).catch(() => {});
  return { kind: "started", assessment: asmt, done };
}

async function runModel(deps: AssessmentDeps, asmt: Assessment, scan: ScanResult, base: { id: string; amount: number }[]): Promise<void> {
  const now = () => deps.clock.now();
  // content_readiness feeds suggestions (code) + the note (model context) — NEVER pricing.
  const suggestions = mergeSuggestions(base, contentSuggestions(asmt.content_readiness, deps.pricing));

  if (!deps.model) { await deps.store.updateAssessment(asmt.id, { status: "unavailable", reason: "no_model", suggested_addons: suggestions }, now()); return; }

  await deps.store.updateAssessment(asmt.id, { status: "streaming", suggested_addons: suggestions }, now());
  const emitter = new PersistEmitter(deps.store, asmt.quote_id, deps.clock); // assessment_* on the quote's #24 spine
  const chunks: string[] = [];
  try {
    const r = await assess(scan, { lang: deps.lang, model: deps.model, modelId: deps.modelId ?? undefined, contentReadiness: asmt.content_readiness, emitter, onProse: (c) => chunks.push(c) });
    if (isAssessment(r)) {
      await deps.store.updateAssessment(asmt.id, {
        status: "completed", prose_chunks: chunks, suggested_addons: suggestions,
        complexity: r.complexity, complexity_factors: r.complexity_factors, review_note: r.review_note, confidence: r.confidence, flagged_for_review: r.flagged_for_review,
      }, now());
    } else {
      await deps.store.updateAssessment(asmt.id, { status: "unavailable", reason: r.reason, prose_chunks: chunks, suggested_addons: suggestions }, now());
    }
  } catch (e) {
    await deps.store.updateAssessment(asmt.id, { status: "unavailable", reason: "error", suggested_addons: suggestions }, now());
  }
}

// PUBLIC projection (#24 default-deny) — the ONLY fields that ship. Internal fields
// (complexity_factors, review_note, confidence, flagged_for_review) are omitted BY
// CONSTRUCTION: they are never read here.
export function projectAssessment(a: Assessment): Record<string, unknown> {
  return {
    assessment_id: a.id,
    status: a.status,
    prose_chunks: a.prose_chunks,
    suggested_addons: a.suggested_addons,
  };
}
