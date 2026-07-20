// In-memory sliding-window rate limiter (#25-A step 2). A plain Map keyed by ipRateKey;
// injected clock (never wall-clock) so W-tests are deterministic. Single-instance MVP —
// state is per-process, which is the ratified posture.

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private windowMs: number;
  private max: number;
  constructor(windowMs: number, max: number) { this.windowMs = windowMs; this.max = max; }

  // Records the hit when allowed; on rejection returns Retry-After seconds (≥1).
  check(key: string, now: number): { allowed: boolean; retryAfterSec: number } {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now; // max=0 → no recorded hit; retry after a full window
      const retryMs = this.windowMs - (now - oldest);
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSec: 0 };
  }
}
