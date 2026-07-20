import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { scan } from "../src/crawl/scan.ts";
import { assess } from "../src/assess/assess.ts";
import { assessable } from "../src/assess/assessable.ts";
import { isAssessment } from "../src/assess/types.ts";
import { replayModel, loadRecording, RECORDINGS_DIR, type Recording } from "../src/assess/replayModel.ts";
import { FakeTransport, FakeClock, type Scenario } from "./helpers/replay.ts";

// #32 step 7 — the replay harness. assess() runs against RECORDED transcripts with zero
// live calls. The committed self-test proves the offline path now; per-site recordings
// (produced by spikes/record-assess.mjs with the chosen model post-gate) are auto-replayed
// as soon as they exist — the suite covers the gate's output without any test change.

const scanSlug = async (slug: string): Promise<any> => {
  const dir = join("fixtures/golden", slug);
  const scenario = JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8")) as Scenario;
  const manifest = existsSync(join(dir, "manifest.json")) ? JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) : {};
  const input = manifest.input ?? (slug === "toituresmarcelpouliot" ? "http://toituresmarcelpouliot.com/" : "https://" + slug + "/");
  return scan(new FakeTransport(scenario), new FakeClock(), input);
};

// ---- RP-01 the harness replays a committed transcript through the real pipeline ----
test("RP-01 replayModel + assess() reproduce a recorded assessment offline", async () => {
  const rec = loadRecording("_selftest", "fr");
  assert.ok(rec, "self-test recording present");
  const r = await assess(await scanSlug("syn-couvreur-dated"), { lang: "fr", model: replayModel(rec!.transcript), modelId: rec!.model });
  assert.ok(isAssessment(r), "recorded transcript parses to an Assessment");
  if (isAssessment(r)) {
    assert.ok(r.assessment.includes("L'estimation est juste en dessous"));
    assert.equal(r.complexity, "standard");
    assert.ok(r.complexity_factors.includes("dated_design"));
    assert.equal(r.lang, "fr");
  }
});

// ---- RP-02 pre-gate: no per-site recordings yet; loader is coherent ----
test("RP-02 loadRecording returns null when a recording is absent", () => {
  assert.equal(loadRecording("nonexistent-site", "fr"), null);
});

// ---- RP-03 auto-replay: every per-site recording (post-gate) reproduces an Assessment ----
test("RP-03 all committed per-site recordings replay to a valid Assessment", async () => {
  if (!existsSync(RECORDINGS_DIR)) return; // dir always exists once the self-test lands
  const files = readdirSync(RECORDINGS_DIR).filter((f) => /\.(fr|en)\.json$/.test(f) && !f.startsWith("_"));
  // pre-gate this is empty (only _selftest.*). post-gate the recorder fills it in.
  for (const f of files) {
    const rec = JSON.parse(readFileSync(join(RECORDINGS_DIR, f), "utf8")) as Recording;
    const s = await scanSlug(rec.slug);
    assert.ok(assessable(s), `${rec.slug} is assessable`);
    const r = await assess(s, { lang: rec.lang, model: replayModel(rec.transcript), modelId: rec.model });
    assert.ok(isAssessment(r), `${f} replays to an Assessment`);
  }
  assert.ok(true, `${files.length} per-site recording(s) replayed (0 pre-gate; the recorder fills these post-gate)`);
});
