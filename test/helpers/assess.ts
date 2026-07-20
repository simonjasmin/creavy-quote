// Assess-side test helpers. A scripted model replays a transcript with ZERO live calls
// (the deterministic offline harness); a fake scan builds a minimal assessable ScanResult.

import type { AssessmentModel, AssessRequest } from "../../src/assess/model.ts";
import { assessConfig } from "../../src/assess/config.ts";
import type { ScanResult } from "../../src/crawl/scan.ts";
import type { PageContent } from "../../src/crawl/pageContent.ts";

// Build a full model transcript: prose, delimiter, then the JSON meta block.
export function transcript(prose: string, meta: Record<string, unknown>): string {
  return prose + assessConfig.delimiter + JSON.stringify(meta);
}

export const validMeta = (o: Partial<Record<string, unknown>> = {}) => ({
  complexity: "standard",
  complexity_factors: ["thin_but_clean"],
  review_note: "internal note for the founder",
  confidence: "high",
  flagged_for_review: false,
  ...o,
});

// A scripted AssessmentModel. Streams `text` in fixed-size chunks (so delimiter-straddle
// is exercised), or throws to simulate a model/transport failure. Records the request.
export function scriptedModel(text: string, opts: { chunkSize?: number; fail?: Error; onReq?: (r: AssessRequest) => void; calls?: { n: number } } = {}): AssessmentModel {
  const size = opts.chunkSize ?? 7;
  return {
    async *stream(req: AssessRequest) {
      opts.onReq?.(req);
      if (opts.calls) opts.calls.n++;
      if (opts.fail) throw opts.fail;
      for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
    },
  };
}

const homepage = (): PageContent => ({
  url: "https://roof.example/",
  title: "Toitures — Accueil",
  headings: ["Nos services", "Contact"],
  text: "Réfection de toiture à Québec. Bardeaux, membrane, réparation. Estimation gratuite.",
});

// A minimal ASSESSABLE ScanResult (4 core, wordpress high-confidence, clean).
export function fakeScan(o: Partial<ScanResult> = {}): ScanResult {
  return {
    canonical_origin: "https://roof.example",
    core_pages: 4,
    blog_posts: 0,
    excluded: { archives: 0, media: 0, soft_404: 0, external: 0 },
    languages: ["fr"],
    bilingual_mirror: false,
    needs_browser: false,
    needs_browser_reasons: [],
    review_flags: [],
    partial: false,
    detected_platform: "wordpress",
    detected_platform_confidence: "high",
    builders_detected: [],
    page_content: [homepage()],
    ...o,
  };
}
