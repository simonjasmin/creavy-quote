// #32 step 7 — the replay harness. An offline AssessmentModel that streams a RECORDED
// transcript, so assess() tests are deterministic with ZERO live calls. Recordings are
// produced by spikes/record-assess.mjs (chosen model, post-gate) and committed under
// fixtures/assess/. Same interface as the live model — assess() can't tell them apart.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AssessmentModel } from "./model.ts";

export type Recording = {
  slug: string;
  lang: "fr" | "en";
  model: string; // the model that produced it ("provisional" before the gate)
  transcript: string; // prose + delimiter + JSON meta
  provisional?: boolean; // true = hand-authored stand-in, NOT a live recording
};

// Stream a recorded transcript in fixed-size chunks (exercises delimiter-straddle).
export function replayModel(transcript: string, chunkSize = 11): AssessmentModel {
  return {
    async *stream() {
      for (let i = 0; i < transcript.length; i += chunkSize) yield transcript.slice(i, i + chunkSize);
    },
  };
}

export const RECORDINGS_DIR = "fixtures/assess";
const recordingPath = (dir: string, slug: string, lang: string) => join(dir, `${slug}.${lang}.json`);

export function loadRecording(slug: string, lang: "fr" | "en", dir = RECORDINGS_DIR): Recording | null {
  const p = recordingPath(dir, slug, lang);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Recording) : null;
}
