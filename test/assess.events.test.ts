import { test } from "node:test";
import assert from "node:assert/strict";
import { assess } from "../src/assess/assess.ts";
import { RecordingEmitter } from "../src/crawl/events.ts";
import { projectStream, projectPublic } from "../src/crawl/eventProjection.ts";
import { scriptedModel, transcript, validMeta, fakeScan } from "./helpers/assess.ts";

// #32 A4 — the assessment streams onto the #24 spine: assessment_started → prose chunks →
// assessment_complete. Public-projection tests prove prose streams, internals never ship,
// and the honesty rule holds (no fabricated events, no synthetic delays).

const PROSE = "Votre site a quatre pages bien construites. Le contenu est clair et à jour. " +
  "Une refonte moderniserait l'image sans repartir de zéro. L'estimation est juste en dessous.";
const META = validMeta({ complexity: "standard", complexity_factors: ["thin_but_clean", "dated_design"], review_note: "SECRET founder-only note", confidence: "high", flagged_for_review: true });

async function run(text: string, lang: "fr" | "en" = "fr") {
  const em = new RecordingEmitter();
  const streamed: string[] = [];
  const r = await assess(fakeScan(), { lang, model: scriptedModel(text, { chunkSize: 7 }), modelId: "test", emitter: em, onProse: (c) => streamed.push(c) });
  return { r, events: em.events, streamed };
}

// ---- EV-01 prose streams token-by-token; started first, complete last ----
test("EV-01 prose streams as assessment_chunk; started → chunks → complete", async () => {
  const { r, events } = await run(transcript(PROSE, META));
  assert.ok(r.ok);
  assert.equal(events[0].type, "assessment_started");
  assert.equal(events[events.length - 1].type, "assessment_complete");
  const chunks = events.filter((e) => e.type === "assessment_chunk");
  assert.ok(chunks.length > 1, "prose arrives in multiple chunks");
  assert.equal(chunks.map((e) => e.data!.text).join(""), PROSE, "chunks reconstruct the prose exactly");
});

// ---- EV-02 internals NEVER ship through the public projection ----
test("EV-02 public projection ships prose + fixed strings, never internals", async () => {
  const { events } = await run(transcript(PROSE, META));
  const stream = projectStream(events, "fr");
  // an SSE consumer CONCATENATES chunk text (no separators) to rebuild the prose
  const prose = stream.filter((s) => s.type === "assessment_chunk").map((s) => s.text).join("");
  assert.equal(prose, PROSE, "prose reaches the prospect intact");
  assert.ok(stream.some((s) => s.type === "assessment_complete" && s.text === "Analyse détaillée prête"), "complete renders a fixed string");
  // …internals absent from every projected line
  const allText = stream.map((s) => s.text).join("");
  for (const secret of ["SECRET founder-only note", "thin_but_clean", "dated_design"]) {
    assert.ok(!allText.includes(secret), `internal leak: ${secret}`);
  }
  // the complete event carries internals in raw data, but projection drops them
  const complete = events.find((e) => e.type === "assessment_complete")!;
  assert.equal(complete.data!.confidence, "high", "raw event has internals (founder panel)");
  assert.equal(projectPublic(complete, "fr")!.text, "Analyse détaillée prête", "…but the public text is fixed");
});

// ---- EV-03 the meta block never streams as prose ----
test("EV-03 delimiter + JSON meta never appear in the streamed prose", async () => {
  const { events } = await run(transcript(PROSE, META));
  const proseText = events.filter((e) => e.type === "assessment_chunk").map((e) => e.data!.text).join("");
  assert.ok(!proseText.includes("==="), "no delimiter in prose");
  assert.ok(!proseText.includes("complexity"), "no meta keys in prose");
  assert.ok(!proseText.includes("review_note"), "no review_note in prose");
});

// ---- EV-04 honesty — only real events, no fabricated ones, no synthetic delays ----
test("EV-04 event stream is exactly started + real chunks + complete (nothing fabricated)", async () => {
  const { events } = await run(transcript(PROSE, META));
  const types = new Set(events.map((e) => e.type));
  assert.deepEqual([...types].sort(), ["assessment_chunk", "assessment_complete", "assessment_started"]);
  // ts is 0 throughout (no clock injected, no injected sleeps) — timing isn't fabricated
  assert.ok(events.every((e) => e.ts === 0), "no synthetic timing");
});

// ---- EV-05 model failure → assessment_unavailable terminal, no complete ----
test("EV-05 model failure → assessment_unavailable (book-a-call), no assessment_complete", async () => {
  const em = new RecordingEmitter();
  const r = await assess(fakeScan(), { lang: "fr", model: scriptedModel("", { fail: new Error("boom") }), modelId: "test", emitter: em });
  assert.equal(r.ok, false);
  assert.ok(em.events.some((e) => e.type === "assessment_unavailable"));
  assert.ok(!em.events.some((e) => e.type === "assessment_complete"));
  const term = em.events.find((e) => e.type === "assessment_unavailable")!;
  assert.equal(projectPublic(term, "fr")!.text, "Notre équipe prépare votre analyse détaillée.");
});

// ---- EV-06 A6 not_assessable → the model never fires, nothing streams ----
test("EV-06 non-assessable scan → zero assessment events", async () => {
  const em = new RecordingEmitter();
  await assess(fakeScan({ core_pages: "30+" }), { lang: "fr", model: scriptedModel(transcript(PROSE, META)), modelId: "test", emitter: em });
  assert.equal(em.events.length, 0, "A6: no events at all");
});

// ---- EN prose streams under en projection ----
test("EV-07 EN assessment streams under the en projection", async () => {
  const en = "Your site has four solid pages. The content is clear. The estimate is just below.";
  const { events } = await run(transcript(en, validMeta({ confidence: "medium" })), "en");
  const stream = projectStream(events, "en");
  const prose = stream.filter((s) => s.type === "assessment_chunk").map((s) => s.text).join("");
  assert.equal(prose, en);
  assert.ok(stream.some((s) => s.type === "assessment_complete" && s.text === "Detailed analysis ready"));
});
