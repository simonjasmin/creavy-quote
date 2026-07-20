import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scan } from "../src/crawl/scan.ts";
import { assessable } from "../src/assess/assessable.ts";
import { FakeTransport, FakeClock, type Scenario } from "./helpers/replay.ts";

// #32 step 6 — the assessable golden set. Real harvest yielded exactly ONE assessable
// site (toituresmarcelpouliot; the rest are ≥7/30+). No live network is available here,
// so the three shapes the benchmark needs are LABELLED-SYNTHETIC composites (manifest
// synthetic:true) — never mislabelled as real. Together they close the bilingual ×
// assessable cell that #28.1 exposed as untested on the priced path.

const REAL_INPUTS: Record<string, string> = {
  itemconstruction: "https://itemconstruction.com/", labarberie: "https://labarberie.com/",
  lasouche: "https://lasouche.ca/", mchenryplumbing: "https://www.mchenryplumbing.ca/",
  mtlplomberie: "https://www.mtlplomberie.ca/", paysagesgenest: "https://paysagesgenest.com/",
  pierrehamelin: "https://pierrehamelin.ca/", protectoit: "https://www.protectoit.com/",
  toituresmarcelpouliot: "http://toituresmarcelpouliot.com/",
};
const SYNTHETIC = ["syn-couvreur-dated", "syn-plomberie-bilingue", "syn-electricien-sain"];
const dirOf = (slug: string) => join("fixtures/golden", slug);
const load = (slug: string): Scenario => JSON.parse(readFileSync(join(dirOf(slug), "scenario.json"), "utf8"));
const manifest = (slug: string) => JSON.parse(readFileSync(join(dirOf(slug), "manifest.json"), "utf8"));
const inputOf = (slug: string) => REAL_INPUTS[slug] ?? manifest(slug).input;
const runSlug = (slug: string) => scan(new FakeTransport(load(slug)), new FakeClock(), inputOf(slug));

// ---- AG-01 audit: exactly the real assessable + the 3 labelled synthetics ----
test("AG-01 assessable golden set = toituresmarcelpouliot + 3 labelled synthetics", async () => {
  const slugs = readdirSync("fixtures/golden", { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dirOf(d.name), "scenario.json"))).map((d) => d.name);
  const assessableSlugs: string[] = [];
  for (const slug of slugs) if (assessable(await runSlug(slug))) assessableSlugs.push(slug);
  assert.deepEqual(assessableSlugs.sort(), ["syn-couvreur-dated", "syn-electricien-sain", "syn-plomberie-bilingue", "toituresmarcelpouliot"]);
  // every synthetic is LABELLED synthetic; the real one is not
  for (const s of SYNTHETIC) assert.equal(manifest(s).synthetic, true, `${s} manifest labelled synthetic`);
  assert.ok(!existsSync(join(dirOf("toituresmarcelpouliot"), "manifest.json")) || manifest("toituresmarcelpouliot").synthetic !== true, "real golden never labelled synthetic");
});

// ---- AG-02 findings site: dated signal observable IN THE RETAINED TEXT ----
test("AG-02 syn-couvreur-dated → assessable, 4 core, dated signal in retained text", async () => {
  const r = await runSlug("syn-couvreur-dated");
  assert.equal(assessable(r), true);
  assert.equal(r.core_pages, 4);
  assert.equal(r.bilingual_mirror, false);
  assert.equal(r.page_content.length, 4, "full core coverage");
  const text = r.page_content.map((p) => p.text).join(" ");
  assert.match(text, /© 2009|Internet Explorer|Flash/, "dated_design cue survives into Option-C text (markup alone would not)");
});

// ---- AG-03 bilingual mirror: the fixed RUNG 1 priced path, one core per pair ----
test("AG-03 syn-plomberie-bilingue → assessable, 3 core (paired), mirror via hreflang", async () => {
  const r = await runSlug("syn-plomberie-bilingue");
  assert.equal(assessable(r), true);
  assert.equal(r.core_pages, 3, "3 pairs → 3 core (not 6 — the #28.1 fix)");
  assert.equal(r.bilingual_mirror, true);
  assert.deepEqual(r.languages.slice().sort(), ["en", "fr"]);
  assert.ok(r.review_flags.includes("pairing_evidence:hreflang"));
  assert.ok(r.page_content.length >= 3, "≥1 member per pair retained");
  assert.ok(r.page_content.every((p) => p.text.length > 0));
});

// ---- AG-04 healthy calibration site: no dated cue, current year ----
test("AG-04 syn-electricien-sain → assessable, 5 core, healthy (no alarm cue)", async () => {
  const r = await runSlug("syn-electricien-sain");
  assert.equal(assessable(r), true);
  assert.equal(r.core_pages, 5);
  assert.equal(r.page_content.length, 5, "full core coverage");
  const text = r.page_content.map((p) => p.text).join(" ");
  assert.match(text, /© 2025/, "current copyright — a healthy signal");
  assert.doesNotMatch(text, /Internet Explorer|Flash|© 20(0|1)/, "no dated cue — the voice must not manufacture alarm");
});
