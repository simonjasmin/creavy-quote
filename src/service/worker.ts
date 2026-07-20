// In-process scan worker. Consumes an enqueued job: runs scan() through the injected
// transport + scheduler (SSRF hardening rides along — no new fetch paths), streams events
// to the store (#24), then completes the job. Single-instance MVP posture (Phase 0). A
// crawl throw degrades to a failed job with book-a-call — never a hang (Phase-0 invariant).

import { scan as runScan } from "../crawl/scan.ts";
import { PersistEmitter } from "./persistEmitter.ts";
import { completeJob, failJob } from "./completion.ts";
import type { Store } from "./store/types.ts";
import type { Transport, Clock } from "../crawl/types.ts";
import type { ValidRequest } from "./validate.ts";
import type { PricingConfig } from "../pricing/loadPricingConfig.ts";

export type WorkerDeps = { store: Store; transport: Transport; clock: Clock; pricing: PricingConfig };

export async function processJob(deps: WorkerDeps, jobId: string, request: ValidRequest, reviewFlags: string[] = []): Promise<void> {
  const { store, transport, clock, pricing } = deps;
  try {
    const emitter = new PersistEmitter(store, jobId, clock);
    const scan = await runScan(transport, clock, request.url!, emitter);
    if (reviewFlags.length) scan.review_flags = [...new Set([...scan.review_flags, ...reviewFlags])];
    await completeJob(store, jobId, { scan, answers: request.answers, no_site: false }, pricing, clock.now());
  } catch (e) {
    console.error(`scan failed (${jobId})`, (e as Error)?.message);
    await failJob(store, jobId, "unreachable", clock.now());
  }
}
