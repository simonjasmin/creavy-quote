// #32 Fork 1 — the model seam. assess() depends only on this interface, so it is fully
// model-agnostic: tests inject a replay model (recorded fixtures, zero live calls), the
// benchmark injects a live Anthropic-backed model, production injects the chosen one.
//
// stream() yields text chunks in order (A4 live prose). The transcript is the model's
// prose, then the config delimiter, then a JSON meta block — assess() splits the two.

export type AssessRequest = {
  model: string;
  system: string;
  user: string; // the untrusted-data payload (facts + delimited page content)
  max_tokens: number;
  temperature: number;
};

export interface AssessmentModel {
  stream(req: AssessRequest): AsyncIterable<string>;
}
