// Shared job completion — the single place a job transitions to completed/failed. Used by
// the worker (after a fresh scan), the declared path (no crawl), and cache hits (reuse the
// scan, re-price for THESE answers). Splits page_content from crawl_facts so crawl_facts is
// the #8 object (invariant #2 repricing loop) and content rides its own column (#32 A1).

import type { Store, Job } from "./store/types.ts";
import type { ScanResult } from "../crawl/scan.ts";
import type { Answers } from "./validate.ts";
import type { PricingConfig } from "../pricing/loadPricingConfig.ts";
import { buildQuoteResponse } from "./buildResponse.ts";

export async function completeJob(
  store: Store,
  id: string,
  args: { scan: ScanResult | null; answers: Answers; no_site: boolean },
  config: PricingConfig,
  now: number,
): Promise<Job> {
  const built = buildQuoteResponse(args, config);
  const patch: Partial<Job> = {
    status: built.status,
    response: built.body,
    mapper_output: (built.body.result as unknown) ?? null,
  };
  if (args.scan) {
    const { page_content, ...facts } = args.scan; // crawl_facts = #8 object; content split out
    patch.crawl_facts = facts;
    patch.page_content = page_content;
  }
  if (built.status === "failed") patch.reason = (built.body.reason as string) ?? "unreachable";
  return (await store.updateJob(id, patch, now))!;
}

export async function failJob(store: Store, id: string, reason: string, now: number): Promise<Job> {
  return (await store.updateJob(id, {
    status: "failed", reason,
    response: { indicative: true, reason, book_a_call: true },
  }, now))!;
}
