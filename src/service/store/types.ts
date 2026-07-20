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
  fresh_scan: boolean; // did this job enqueue a real crawl? (daily-ceiling accounting)
  // artifacts — invariant #2 raw columns kept even when empty
  crawl_facts: unknown | null; // the decision-#8 ScanResult (tour "scan_result"); repricing loop
  page_content: unknown | null; // #32 A1 retained Option-C content
  mapper_output: unknown | null; // #27 TierResult
  claude_assessment: unknown | null; // ALWAYS null in 2a (stage 2 / 2b)
  response: unknown | null; // the built contract result-body, cached for GET
  reason: string | null; // failure reason (§5 enum)
};

export type NewJob = Pick<Job, "id" | "no_site" | "url" | "normalized_url" | "answers_hash" | "answers" | "persona" | "fresh_scan">;

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
  close(): Promise<void>;
}
