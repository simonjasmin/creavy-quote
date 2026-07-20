// #32 step 7 — the replay-fixture recorder. AFTER the gate, runs the CHOSEN model over
// each assessable golden (both languages where bilingual) and writes the RAW transcript to
// fixtures/assess/<slug>.<lang>.json, so the suite replays deterministic, offline output.
//
//   ANTHROPIC_API_KEY=… node spikes/record-assess.mjs claude-sonnet-4-6
//
// Bypasses assess()'s parsing to capture the exact raw transcript (prose + delimiter +
// meta), then validates it by replaying through assess(). No key / no model → prints usage.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildSystem } from "../src/assess/prompt/system.ts";
import { buildUser } from "../src/assess/prompt/payload.ts";
import { assessConfig } from "../src/assess/config.ts";
import { anthropicModel } from "../src/assess/anthropicModel.ts";
import { replayModel, RECORDINGS_DIR } from "../src/assess/replayModel.ts";
import { assess } from "../src/assess/assess.ts";
import { isAssessment } from "../src/assess/types.ts";
import { listAssessableGoldens } from "./_assessable.mjs";

const key = process.env.ANTHROPIC_API_KEY;
const model = process.argv[2] || assessConfig.model;
if (!key || !model) {
  console.log("Usage: ANTHROPIC_API_KEY=sk-... node spikes/record-assess.mjs <model-id>");
  console.log("  <model-id> defaults to assessConfig.model (set at the gate). Currently:", assessConfig.model);
  process.exit(0);
}

mkdirSync(RECORDINGS_DIR, { recursive: true });
const goldens = await listAssessableGoldens();
for (const g of goldens) {
  for (const lang of g.langs) {
    const client = anthropicModel(key);
    let transcript = "";
    for await (const chunk of client.stream({ model, system: buildSystem(lang), user: buildUser(g.scan), max_tokens: assessConfig.max_tokens, temperature: assessConfig.temperature })) transcript += chunk;
    // validate by replaying through the real pipeline
    const r = await assess(g.scan, { lang, model: replayModel(transcript), modelId: model });
    const rec = { slug: g.slug, lang, model, transcript, provisional: false };
    writeFileSync(join(RECORDINGS_DIR, `${g.slug}.${lang}.json`), JSON.stringify(rec, null, 2) + "\n");
    console.log(`recorded ${g.slug}.${lang} — ${isAssessment(r) ? r.complexity + "/" + r.confidence : "INVALID: " + r.reason}`);
  }
}
console.log(`\nWrote ${goldens.length} site(s) to ${RECORDINGS_DIR}/. Re-run node --test to replay.`);
