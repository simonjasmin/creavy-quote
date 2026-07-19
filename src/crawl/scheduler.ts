// D-34 — polite scheduler. ≤ 2 concurrent per host, ~300 ms spacing between
// request starts per host, under the total crawl budget (the universal governor
// #9). All timing goes through the injectable Clock so the invariant is provable.

import type { Transport, Clock, FetchResult } from "./types.ts";

export const PER_HOST = 2; // §4.1 concurrency
export const HOST_SPACING_MS = 300; // §4.1
export const CRAWL_BUDGET_MS = 25000; // §4.1

function hostOf(u: string): string { try { return new URL(u).host; } catch { return u; } }

export type ScheduleResult = { results: FetchResult[]; partial: boolean; elapsed: number };

export class PoliteScheduler {
  private transport: Transport;
  private clock: Clock;
  private perHost: number;
  private spacingMs: number;
  private budgetMs: number;
  private timeoutMs: number;

  constructor(transport: Transport, clock: Clock, opts: { perHost?: number; spacingMs?: number; budgetMs?: number; timeoutMs?: number } = {}) {
    this.transport = transport;
    this.clock = clock;
    this.perHost = opts.perHost ?? PER_HOST;
    this.spacingMs = opts.spacingMs ?? HOST_SPACING_MS;
    this.budgetMs = opts.budgetMs ?? CRAWL_BUDGET_MS;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  async fetchAll(urls: string[]): Promise<ScheduleResult> {
    const start = this.clock.now();
    const results: FetchResult[] = [];
    let partial = false;
    const groups = new Map<string, string[]>();
    for (const u of urls) { const h = hostOf(u); const arr = groups.get(h) ?? []; arr.push(u); groups.set(h, arr); }
    await Promise.all([...groups.entries()].map(([h, list]) => this.runHost(list, results, start, () => { partial = true; })));
    return { results, partial, elapsed: this.clock.now() - start };
  }

  private async runHost(list: string[], results: FetchResult[], start: number, markPartial: () => void): Promise<void> {
    let idx = 0;
    let lastStart = -Infinity;
    const worker = async () => {
      while (idx < list.length) {
        if (this.clock.now() - start > this.budgetMs) { markPartial(); return; } // #9 budget governor / D-33
        const url = list[idx++];
        const wait = Math.max(0, lastStart + this.spacingMs - this.clock.now());
        if (wait > 0) await this.clock.sleep(wait); // ~300 ms spacing between starts
        lastStart = this.clock.now();
        results.push(await this.transport.fetch(url, { timeoutMs: this.timeoutMs }));
      }
    };
    await Promise.all(Array.from({ length: this.perHost }, () => worker()));
  }
}
