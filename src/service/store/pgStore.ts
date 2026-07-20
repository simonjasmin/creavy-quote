// Postgres Store — deploy implementation. NOT exercised by `node --test` (no DB in the
// sandbox); verified by the staging smoke run. Same interface as MemoryStore. The flat
// Phase-0 analytics columns (tier/price/detected_platform/...) stay NULL in 2a — the
// jsonb artifacts (crawl_facts, mapper_output) carry everything (invariant #2).

import pg from "pg";
import type { Store, Job, NewJob } from "./types.ts";
import type { ScanEvent } from "../../crawl/events.ts";

const toMs = (t: unknown): number => (t instanceof Date ? t.getTime() : new Date(t as string).getTime());

function rowToJob(r: any): Job {
  return {
    id: r.id, created_at: toMs(r.created_at), updated_at: toMs(r.updated_at), status: r.status,
    no_site: r.no_site, url: r.url, normalized_url: r.normalized_url, answers_hash: r.answers_hash,
    answers: r.answers, persona: r.persona, fresh_scan: r.fresh_scan,
    crawl_facts: r.crawl_facts, page_content: r.page_content, mapper_output: r.mapper_output,
    claude_assessment: r.claude_assessment, response: r.response, reason: r.reason,
  };
}

export class PgStore implements Store {
  private pool: pg.Pool;
  constructor(databaseUrl: string) { this.pool = new pg.Pool({ connectionString: databaseUrl, max: 5 }); }

  async createJob(j: NewJob, now: number): Promise<Job> {
    const ts = new Date(now);
    const { rows } = await this.pool.query(
      `INSERT INTO quotes (id, created_at, updated_at, status, no_site, url, normalized_url, answers_hash, answers, persona, fresh_scan)
       VALUES ($1,$2,$2,'pending',$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING *`,
      [j.id, ts, j.no_site, j.url, j.normalized_url, j.answers_hash, JSON.stringify(j.answers), j.persona, j.fresh_scan],
    );
    return rowToJob(rows[0]);
  }

  async getJob(id: string): Promise<Job | null> {
    const { rows } = await this.pool.query("SELECT * FROM quotes WHERE id=$1", [id]);
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async updateJob(id: string, patch: Partial<Job>, now: number): Promise<Job | null> {
    const cols: string[] = [];
    const vals: unknown[] = [id];
    const put = (col: string, val: unknown, json = false) => { vals.push(json ? JSON.stringify(val) : val); cols.push(`${col}=$${vals.length}${json ? "::jsonb" : ""}`); };
    if (patch.status !== undefined) put("status", patch.status);
    if (patch.crawl_facts !== undefined) put("crawl_facts", patch.crawl_facts, true);
    if (patch.page_content !== undefined) put("page_content", patch.page_content, true);
    if (patch.mapper_output !== undefined) put("mapper_output", patch.mapper_output, true);
    if (patch.claude_assessment !== undefined) put("claude_assessment", patch.claude_assessment, true);
    if (patch.response !== undefined) put("response", patch.response, true);
    if (patch.reason !== undefined) put("reason", patch.reason);
    vals.push(new Date(now)); cols.push(`updated_at=$${vals.length}`);
    const { rows } = await this.pool.query(`UPDATE quotes SET ${cols.join(", ")} WHERE id=$1 RETURNING *`, vals);
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async findFreshScan(normalizedUrl: string, now: number, ttlMs: number): Promise<Job | null> {
    const since = new Date(now - ttlMs);
    const { rows } = await this.pool.query(
      `SELECT * FROM quotes WHERE normalized_url=$1 AND status='completed' AND fresh_scan=true AND created_at >= $2 ORDER BY created_at DESC LIMIT 1`,
      [normalizedUrl, since],
    );
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async countFreshScansSince(sinceMs: number): Promise<number> {
    const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM quotes WHERE fresh_scan=true AND created_at >= $1`, [new Date(sinceMs)]);
    return rows[0]?.n ?? 0;
  }

  async appendEvent(id: string, ev: ScanEvent): Promise<void> {
    await this.pool.query(`UPDATE quotes SET event_log = coalesce(event_log,'[]'::jsonb) || $2::jsonb WHERE id=$1`, [id, JSON.stringify(ev)]);
  }

  async getEventsSince(id: string, seq: number): Promise<ScanEvent[]> {
    const { rows } = await this.pool.query("SELECT event_log FROM quotes WHERE id=$1", [id]);
    const log: ScanEvent[] = rows[0]?.event_log ?? [];
    return log.filter((e) => e.seq > seq);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
