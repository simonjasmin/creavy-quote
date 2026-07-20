// In-memory Store — the test + local-dev implementation (zero Postgres). Same interface
// as PgStore, so every wall/handler/contract test runs against this and the deployed
// service swaps in PgStore. Non-persistent: a restart loses everything (dev only).

import type { Store, Job, NewJob } from "./types.ts";
import type { ScanEvent } from "../../crawl/events.ts";

export class MemoryStore implements Store {
  private jobs = new Map<string, Job>();
  private events = new Map<string, ScanEvent[]>();

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

  async close(): Promise<void> { /* no-op */ }
}
