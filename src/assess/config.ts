// #32 Fork 1 — the model id + params live in config, so the build is model-agnostic and
// the pick was a one-line change. Founder picked **claude-opus-4-8** at the gate (benchmark
// in spikes/assess-benchmark.md). `temperature` is intentionally ABSENT: opus-4-8 deprecates
// it (manages sampling internally). The anthropicModel keeps a drop-and-retry layer as
// defense against future param drift, so the model still works if a temperature ever slips in.
//
// Kept OUT of the pricing config on purpose: invariant #3 is about PRICES living in one
// module. Model params are not prices.

export type AssessConfig = {
  model: string | null; // founder gate pick
  max_tokens: number;
  delimiter: string; // separates the streamed prose from the JSON meta block
  prose_min_words: number; // voice spec (soft, prompt-guided + report-verified)
  prose_max_words: number;
  review_note_max_words: number;
};

export const assessConfig: AssessConfig = {
  model: "claude-opus-4-8", // ← founder gate pick (2026-07-20)
  max_tokens: 700,
  delimiter: "\n===ASSESSMENT-META===\n",
  prose_min_words: 40,
  prose_max_words: 110,
  review_note_max_words: 60,
};
