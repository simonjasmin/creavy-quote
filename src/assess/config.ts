// #32 Fork 1 — the model id + params live in config, so the build is model-agnostic
// and the pick is a one-line change. `model` is set at the mid-tour GATE, once the
// founder chooses from the live benchmark (spikes/assess-benchmark.md). Until then it
// is null — tests inject a model and the benchmark passes ids explicitly, so nothing
// depends on a decided default before the gate.
//
// Kept OUT of the pricing config on purpose: invariant #3 is about PRICES living in one
// module. Model params are not prices.

export type AssessConfig = {
  model: string | null; // GATE: "claude-sonnet-4-6" | "claude-opus-4-8" (founder picks)
  max_tokens: number;
  temperature: number;
  delimiter: string; // separates the streamed prose from the JSON meta block
  prose_min_words: number; // voice spec (soft, prompt-guided + report-verified)
  prose_max_words: number;
  review_note_max_words: number;
};

export const assessConfig: AssessConfig = {
  model: null, // ← set at the gate
  max_tokens: 700,
  temperature: 0.4,
  delimiter: "\n===ASSESSMENT-META===\n",
  prose_min_words: 40,
  prose_max_words: 110,
  review_note_max_words: 60,
};
