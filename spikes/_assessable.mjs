// Shared: the assessable golden set the benchmark + recorder run over. Runs scan() on
// each golden scenario and keeps only assessable() ones, with the language(s) to assess
// (both fr+en where the site is a bilingual mirror — the tour's "both languages where
// bilingual").
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scan } from "../src/crawl/scan.ts";
import { assessable } from "../src/assess/assessable.ts";
import { FakeTransport, FakeClock } from "../test/helpers/replay.ts";

// Real goldens' input URLs differ from their slugs (real domains) — a wrong input scans
// to homepage-only core=1 and mislabels a 30+ site as assessable. Every real golden MUST
// be listed here; synthetics carry their input in manifest.json.
const REAL_INPUTS = {
  itemconstruction: "https://itemconstruction.com/",
  labarberie: "https://labarberie.com/",
  lasouche: "https://lasouche.ca/",
  mchenryplumbing: "https://www.mchenryplumbing.ca/",
  mtlplomberie: "https://www.mtlplomberie.ca/",
  paysagesgenest: "https://paysagesgenest.com/",
  pierrehamelin: "https://pierrehamelin.ca/",
  protectoit: "https://www.protectoit.com/",
  toituresmarcelpouliot: "http://toituresmarcelpouliot.com/",
};

export async function listAssessableGoldens() {
  const out = [];
  for (const slug of readdirSync("fixtures/golden")) {
    const dir = join("fixtures/golden", slug);
    if (!existsSync(join(dir, "scenario.json"))) continue;
    const scenario = JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8"));
    const manifest = existsSync(join(dir, "manifest.json")) ? JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) : {};
    const input = REAL_INPUTS[slug] ?? manifest.input;
    if (!input) throw new Error(`no input URL for golden ${slug} (add to REAL_INPUTS or a manifest)`);
    const r = await scan(new FakeTransport(scenario), new FakeClock(), input);
    if (!assessable(r)) continue;
    const langs = r.bilingual_mirror ? ["fr", "en"] : [r.languages[0] === "en" ? "en" : "fr"];
    out.push({ slug, input, scan: r, langs, synthetic: manifest.synthetic === true });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}
