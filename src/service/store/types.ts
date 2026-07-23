// Persistence seam. The app depends only on this interface, so the whole service is
// testable with MemoryStore (zero Postgres) and deployed with PgStore. The Job shape is
// RECONCILED with Phase 0 §8 `quotes` (Phase 0 wins on collision — see migrations
// 0001_quotes.sql for the flagged differences).

import type { ScanEvent } from "../../crawl/events.ts";

export type JobStatus = "pending" | "completed" | "failed";

export type Job = {
  id: string; // qt_...
  created_at: number; // epoch ms
  updated_at: number;
  status: JobStatus;
  no_site: boolean;
  url: string | null; // raw input; NULL for no_site (Phase 0's NOT NULL relaxed — #29.3)
  normalized_url: string | null; // normalize() identity; cache key (#25-A step 7)
  answers_hash: string | null; // (normalized_url, answers_hash) = A7 stage-2 key (used in 2b)
  answers: unknown;
  persona: string | null; // conversion funnel (Phase 0)
  origin: string | null; // #24 provenance — the POST Origin HEADER value only (no IP/UA/referer); never returned
  fresh_scan: boolean; // did this job enqueue a real crawl? (daily-ceiling accounting)
  // artifacts — invariant #2 raw columns kept even when empty
  crawl_facts: unknown | null; // the decision-#8 ScanResult (tour "scan_result"); repricing loop
  page_content: unknown | null; // #32 A1 retained Option-C content
  mapper_output: unknown | null; // #27 TierResult
  claude_assessment: unknown | null; // ALWAYS null in 2a (stage 2 / 2b)
  response: unknown | null; // the built contract result-body, cached for GET
  reason: string | null; // failure reason (§5 enum)
};

export type NewJob = Pick<Job, "id" | "no_site" | "url" | "normalized_url" | "answers_hash" | "answers" | "persona" | "origin" | "fresh_scan">;

// ---- Stage 2 (2b) — the assessment, keyed to a quote. NO email column, ever (treaty T4). ----
export type AssessmentStatus = "pending" | "streaming" | "completed" | "unavailable";
export type ContentReadiness = "ready" | "partial" | "none";

export type Assessment = {
  id: string; // as_...
  quote_id: string;
  status: AssessmentStatus;
  content_readiness: ContentReadiness;
  model: string | null;
  prose_chunks: string[]; // PUBLIC — streamed prose, in order
  suggested_addons: { id: string; amount: number }[]; // PUBLIC — refreshed by content_readiness
  // INTERNAL — never returned by GET /quote/:id/assessment:
  complexity: string | null;
  complexity_factors: string[] | null;
  review_note: string | null;
  confidence: string | null;
  flagged_for_review: boolean | null;
  reason: string | null; // unavailable reason (internal)
  created_at: number;
  updated_at: number;
};
export type NewAssessment = Pick<Assessment, "id" | "quote_id" | "content_readiness" | "model">;

export interface Store {
  createJob(job: NewJob, now: number): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  updateJob(id: string, patch: Partial<Job>, now: number): Promise<Job | null>;
  // #25-A step 7: freshest completed scan for this normalized_url within ttl.
  findFreshScan(normalizedUrl: string, now: number, ttlMs: number): Promise<Job | null>;
  // daily-ceiling accounting: fresh scans enqueued since a day boundary.
  countFreshScansSince(sinceMs: number): Promise<number>;
  // #24 event log (fire-and-forget append; a failed write logs, never stalls a scan).
  appendEvent(id: string, ev: ScanEvent): Promise<void>;
  getEventsSince(id: string, seq: number): Promise<ScanEvent[]>;
  // ---- stage 2 assessment ----
  createAssessment(a: NewAssessment, now: number): Promise<Assessment>;
  getAssessmentByQuote(quoteId: string): Promise<Assessment | null>; // idempotency (#32 A7)
  getAssessment(id: string): Promise<Assessment | null>;
  updateAssessment(id: string, patch: Partial<Assessment>, now: number): Promise<Assessment | null>;
  countAssessmentsSince(sinceMs: number): Promise<number>; // daily ceiling (each row = one model attempt)
  close(): Promise<void>;
}
