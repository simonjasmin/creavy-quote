// #32 Fork 1 — the LIVE AssessmentModel (Anthropic Messages API, streaming). Used ONLY by
// the spikes (benchmark + recording) and, later, production wiring. The test suite NEVER
// imports this, so there is zero network in `node --test`. Model id comes from the request
// (model-agnostic) — the same code drives both benchmark candidates.

import type { AssessmentModel, AssessRequest } from "./model.ts";

const API = "https://api.anthropic.com/v1/messages";

export type LiveStats = { input_tokens: number; output_tokens: number; ms: number };

// A live model that also records usage/latency for the benchmark (Fork 1).
export function anthropicModel(apiKey: string, stats?: { last?: LiveStats }): AssessmentModel {
  return {
    async *stream(req: AssessRequest) {
      const started = Date.now();
      const res = await fetch(API, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: req.model, max_tokens: req.max_tokens, temperature: req.temperature,
          system: req.system, messages: [{ role: "user", content: req.user }], stream: true,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`anthropic ${res.status}: ${await res.text().catch(() => "")}`);

      let inTok = 0, outTok = 0;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let ev: any;
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") yield ev.delta.text as string;
          if (ev.type === "message_start") inTok = ev.message?.usage?.input_tokens ?? inTok;
          if (ev.type === "message_delta") outTok = ev.usage?.output_tokens ?? outTok;
        }
      }
      if (stats) stats.last = { input_tokens: inTok, output_tokens: outTok, ms: Date.now() - started };
    },
  };
}
