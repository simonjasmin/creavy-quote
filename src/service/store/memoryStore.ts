// In-memory Store — the test + local-dev implementation (zero Postgres). Same interface
// as PgStore, so every wall/handler/contract test runs against this and the deployed
// service swaps in PgStore. Non-persistent: a restart loses everything (dev only).

import type { Store, Job, NewJob, Assessment, NewAssessment } from "./types.ts";
import type { ScanEvent } from "../../crawl/events.ts";

export class MemoryStore implements Store {
  private jobs = new Map<string, Job>();
  private events = new Map<string, ScanEvent[]>();
  private assessments = new Map<string, Assessment>();

  async createJob(j: NewJob, now: number): Promise<Job> {
    const job: Job = {
      ...j, created_at: now, updated_at: now, status: "pending",
      crawl_facts: null, page_content: null, mapper_output: null, claude_assessment: null, response: null, reason: null,
    };
    this.jobs.set(job.id, structuredClone(job));
    return structuredClone(job);
  }

  async getJob(id: string): Promise<Job | null> {
    const j = this.jobs.get(id);
    return j ? structuredClone(j) : null;
  }

  async updateJob(id: string, patch: Partial<Job>, now: number): Promise<Job | null> {
    const j = this.jobs.get(id);
    if (!j) return null;
    const next = { ...j, ...patch, id: j.id, created_at: j.created_at, updated_at: now };
    this.jobs.set(id, next);
    return structuredClone(next);
  }

  async findFreshScan(normalizedUrl: string, now: number, ttlMs: number): Promise<Job | null> {
    let best: Job | null = null;
    for (const j of this.jobs.values()) {
      if (j.normalized_url !== normalizedUrl) continue;
      if (j.status !== "completed" || !j.fresh_scan) continue; // only real completed crawls seed the cache
      if (now - j.created_at > ttlMs) continue;
      if (!best || j.created_at > best.created_at) best = j;
    }
    return best ? structuredClone(best) : null;
  }

  async countFreshScansSince(sinceMs: number): Promise<number> {
    let n = 0;
    for (const j of this.jobs.values()) if (j.fresh_scan && j.created_at >= sinceMs) n++;
    return n;
  }

  async appendEvent(id: string, ev: ScanEvent): Promise<void> {
    const list = this.events.get(id) ?? [];
    list.push(ev);
    this.events.set(id, list);
  }

  async getEventsSince(id: string, seq: number): Promise<ScanEvent[]> {
    return (this.events.get(id) ?? []).filter((e) => e.seq > seq).map((e) => structuredClone(e));
  }

  async createAssessment(a: NewAssessment, now: number): Promise<Assessment> {
    const asmt: Assessment = {
      ...a, status: "pending", prose_chunks: [], suggested_addons: [],
      complexity: null, complexity_factors: null, review_note: null, confidence: null, flagged_for_review: null,
      reason: null, created_at: now, updated_at: now,
    };
    this.assessments.set(asmt.id, structuredClone(asmt));
    return structuredClone(asmt);
  }
  async getAssessmentByQuote(quoteId: string): Promise<Assessment | null> {
    for (const a of this.assessments.values()) if (a.quote_id === quoteId) return structuredClone(a);
    return null;
  }
  async getAssessment(id: string): Promise<Assessment | null> {
    const a = this.assessments.get(id);
    return a ? structuredClone(a) : null;
  }
  async updateAssessment(id: string, patch: Partial<Assessment>, now: number): Promise<Assessment | null> {
    const a = this.assessments.get(id);
    if (!a) return null;
    const next = { ...a, ...patch, id: a.id, quote_id: a.quote_id, created_at: a.created_at, updated_at: now };
    this.assessments.set(id, next);
    return structuredClone(next);
  }
  async countAssessmentsSince(sinceMs: number): Promise<number> {
    let n = 0;
    for (const a of this.assessments.values()) if (a.created_at >= sinceMs) n++;
    return n;
  }

  async close(): Promise<void> { /* no-op */ }
}
