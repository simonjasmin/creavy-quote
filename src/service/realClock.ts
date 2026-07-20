// Production Clock for the crawl (25 s budget + polite spacing). Real time, real sleeps.
// Tests never touch this — they inject FakeClock.
import type { Clock } from "../crawl/types.ts";

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms))),
};
