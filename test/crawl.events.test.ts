import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scan } from "../src/crawl/scan.ts";
import { RecordingEmitter, safeEmitter, type ScanEvent } from "../src/crawl/events.ts";
import { projectPublic, projectStream, PUBLIC_WHITELIST } from "../src/crawl/eventProjection.ts";
import { FakeTransport, FakeClock, syntheticScenario, type Scenario } from "./helpers/replay.ts";

const bili = () => JSON.parse(readFileSync("fixtures/synthetic/bilingual/scenario.json", "utf8")) as Scenario;

async function scanWithEvents(scenario: Scenario, url: string) {
  const clock = new FakeClock();
  const em = new RecordingEmitter(clock);
  const result = await scan(new FakeTransport(scenario), clock, url, em);
  return { result, events: em.events };
}

test("#24 spine: append-only, seq-ordered, starts/ends with scan_started/scan_complete", async () => {
  const { events } = await scanWithEvents(bili(), "bili-golden.example");
  assert.equal(events[0].type, "scan_started");
  assert.equal(events.at(-1)!.type, "scan_complete");
  for (let i = 0; i < events.length; i++) assert.equal(events[i].seq, i); // dense, ordered, append-only
});

test("#24 public projection is DEFAULT-DENY (internal events never ship)", async () => {
  const { events } = await scanWithEvents(bili(), "bili-golden.example");
  const publicTypes = new Set(projectStream(events, "fr").map((e) => e.type));
  for (const secret of ["robots_checked", "review_flag_raised", "needs_browser", "scan_partial"]) {
    assert.ok(!publicTypes.has(secret), `${secret} must never be public`);
    assert.ok(!PUBLIC_WHITELIST.has(secret));
  }
});

test("#24 MOAT LINE: bilingual golden fires bilingual_paired with the FR template", async () => {
  const { result, events } = await scanWithEvents(bili(), "bili-golden.example");
  assert.equal(result.bilingual_mirror, true); // detection actually happened
  const fr = projectStream(events, "fr");
  const line = fr.find((e) => e.type === "bilingual_paired");
  assert.ok(line, "bilingual_paired must reach the public stream");
  assert.equal(line!.text, "Versions française et anglaise détectées — comptées comme un seul site bilingue");
  // EN template too
  const en = projectStream(events, "en").find((e) => e.type === "bilingual_paired");
  assert.equal(en!.text, "French and English versions detected — counted as a single bilingual site");
});

test("#24 platform line gated to high confidence (#23); raw data never ships", async () => {
  // high-confidence WordPress → public line present, no internal fields
  const hi = projectPublic({ seq: 0, ts: 0, type: "platform_detected", data: { platform: "wordpress", confidence: "high" } }, "fr");
  assert.deepEqual(hi, { type: "platform_detected", text: "Site wordpress détecté" });
  // medium confidence → suppressed
  const med = projectPublic({ seq: 0, ts: 0, type: "platform_detected", data: { platform: "wix", confidence: "medium" } }, "fr");
  assert.equal(med, null);
});

test("#24 honesty: every public line maps to a real spine event in order", async () => {
  const { events } = await scanWithEvents(bili(), "bili-golden.example");
  const pub = projectStream(events, "fr");
  // each projected line corresponds to a real event of a whitelisted type, in order
  let idx = -1;
  for (const p of pub) {
    const next = events.findIndex((e, i) => i > idx && e.type === p.type);
    assert.ok(next > idx, "public order follows spine order");
    idx = next;
  }
});

test("#24+#28 MOAT on a REAL golden site: labarberie fires bilingual_paired", async () => {
  const scenario = JSON.parse(readFileSync("fixtures/golden/labarberie/scenario.json", "utf8")) as Scenario;
  const clock = new FakeClock();
  const em = new RecordingEmitter(clock);
  const r = await scan(new FakeTransport(scenario), clock, "https://labarberie.com/", em);
  assert.equal(r.bilingual_mirror, true, "real bilingual golden");
  const line = projectStream(em.events, "fr").find((e) => e.type === "bilingual_paired");
  assert.ok(line, "bilingual_paired reaches the public stream on a real site");
  assert.equal(line!.text, "Versions française et anglaise détectées — comptées comme un seul site bilingue");
});

test("#24 fire-and-forget: a throwing consumer cannot break a scan", async () => {
  const scenario = syntheticScenario("parked").scenario;
  const throwing = { emit() { throw new Error("slow/broken consumer"); } };
  const r = await scan(new FakeTransport(scenario), new FakeClock(), "parked.example", safeEmitter(throwing));
  assert.ok(r.review_flags.includes("parked")); // scan still completed correctly
});
