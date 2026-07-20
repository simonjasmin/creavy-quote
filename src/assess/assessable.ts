// #32 step 3 — the ONE assessability predicate. A single source of truth used in
// three places: CT-06's coverage guarantee, the A6 hard-guard inside assess(), and
// stage-2 invocation. Derived from A3 (which scans route to the model) reconciled
// with #27.2 (auto-quote ceiling) and #27.6 (hard blockers).
//
// A scan is assessable when the model SHOULD run on it. Soft flags that still let the
// model run (caveated): `bilingual_suspected`, `anti_bot` (A3). Everything below routes
// the scan away to book-a-call and the model never fires.

import { pricingConfig } from "../pricing/index.ts";
import type { PageContent } from "../crawl/pageContent.ts";

// Flags that route a scan AWAY from the model. Greenfield (A6) + transport failures
// (no content to read) + limited-view blockers (A3). NOT here: bilingual_suspected,
// anti_bot — those are soft, the model runs and caveats.
export const BLOCKING_FLAGS: ReadonlySet<string> = new Set([
  "no_owned_site", "parked", "no_html", "nxdomain_greenfield", "platform_profile",
  "under_construction", "robots_blocked",
  "host_down", "slow_host", "unreachable", "tls_invalid", // transport errors → no content
]);

// Structural param (not `ScanResult`) so this stays free of a scan.ts import cycle.
export type AssessableScan = {
  core_pages: number | "30+";
  detected_platform: string;
  needs_browser: boolean;
  partial: boolean;
  review_flags: string[];
  page_content?: PageContent[];
};

export function assessable(scan: AssessableScan): boolean {
  if (scan.detected_platform === "none") return false; // greenfield sentinel
  if (scan.detected_platform === "shopify") return false; // e-commerce → human_quote (#27.4/#21)
  if (scan.needs_browser) return false; // JS-heavy → a human looks (A3)
  if (scan.partial) return false; // partial view (A3)
  if (scan.review_flags.some((f) => BLOCKING_FLAGS.has(f))) return false;
  const c = scan.core_pages;
  if (c === "30+" || typeof c !== "number") return false; // out-of-scope (#27.2)
  const ceiling = pricingConfig.tiermap.review_pages - 1; // #27.2: ≥ review_pages → review
  return c >= 1 && c <= ceiling;
}
