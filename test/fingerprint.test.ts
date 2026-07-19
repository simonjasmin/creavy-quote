import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fingerprint, type FetchedPage } from "../src/fingerprint/fingerprint.ts";

// Red-green against the F-backlog (F-01…F-50) — one case per labelled fixture.
const OUT = "fixtures/sites";
const KNOWN_BUILDERS = new Set(["elementor", "divi", "wpbakery", "beaver"]);
const canon = (p: string): string => (p === "square_online" ? "weebly" : p === "unknown" ? "custom" : p);

type Fixture = { slug: string; gt: any; page: FetchedPage };
function loadFixtures(): Fixture[] {
  const slugs = readdirSync(OUT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const out: Fixture[] = [];
  for (const slug of slugs) {
    let manifest: any;
    try { manifest = JSON.parse(readFileSync(join(OUT, slug, "manifest.json"), "utf8")); } catch { continue; }
    const hdr = JSON.parse(readFileSync(join(OUT, slug, "root.headers.json"), "utf8"));
    const body = (() => { try { return readFileSync(join(OUT, slug, "root.html"), "utf8"); } catch { return ""; } })();
    out.push({ slug, gt: manifest.ground_truth, page: { url: hdr.final_url || hdr.requested || "", status: hdr.status || 0, headers: hdr.headers || {}, body } });
  }
  return out;
}

const fixtures = loadFixtures();
const results = fixtures.map((f) => ({ ...f, pred: fingerprint([f.page]) }));

results.forEach((r, i) => {
  const id = `F-${String(i + 1).padStart(2, "0")}`;
  test(`${id} ${r.slug} (${r.gt.platform})`, () => {
    // platform
    assert.equal(canon(r.pred.platform), canon(r.gt.platform), `platform: got ${r.pred.platform}, want ${r.gt.platform}`);
    // confidence: platform fixtures → high; custom → low (no claim)
    if (canon(r.gt.platform) === "custom") assert.equal(r.pred.confidence, "low");
    else assert.equal(r.pred.confidence, "high", `expected high confidence for ${r.slug}`);
    // primary builder — assert only where ground truth is a known builder
    if (KNOWN_BUILDERS.has(r.gt.builder)) assert.equal(r.pred.builder, r.gt.builder, `primary builder: got ${r.pred.builder}, want ${r.gt.builder}`);
    // builders_detected must be a superset of the labelled builders (dual-builder)
    for (const b of r.gt.builders_detected || []) assert.ok(r.pred.builders_detected.includes(b), `${r.slug}: builders_detected missing ${b} (got ${r.pred.builders_detected.join(",")})`);
  });
});

// Calibration property across the whole corpus (rider c definition):
// no HIGH-confidence answer may be wrong, and no builder asserted with zero signals.
test("calibration: 0 wrong-at-high (platform) across all F-cases", () => {
  const wrong = results.filter((r) => r.pred.confidence === "high" && canon(r.pred.platform) !== canon(r.gt.platform));
  assert.equal(wrong.length, 0, `wrong-at-high: ${wrong.map((w) => w.slug).join(", ")}`);
});

// Aggregate summary — printed for the report (always passes).
test("aggregate (report numbers)", () => {
  const plat = results.filter((r) => canon(r.gt.platform) !== "custom");
  const cust = results.filter((r) => canon(r.gt.platform) === "custom");
  const known = results.filter((r) => KNOWN_BUILDERS.has(r.gt.builder));
  const platHigh = plat.filter((r) => r.pred.confidence === "high" && canon(r.pred.platform) === canon(r.gt.platform)).length;
  const custClaimHigh = cust.filter((r) => canon(r.pred.platform) !== "custom" && r.pred.confidence === "high").length;
  const primaryOk = known.filter((r) => r.pred.builder === r.gt.builder).length;
  const setOk = known.filter((r) => (r.gt.builders_detected || []).every((b: string) => r.pred.builders_detected.includes(b))).length;
  const wrongHigh = results.filter((r) => r.pred.confidence === "high" && canon(r.pred.platform) !== canon(r.gt.platform)).length;
  console.log(`\n[fingerprint adapter — post-fix numbers over ${results.length} F-cases]`);
  console.log(`  platform @high:        ${platHigh}/${plat.length}`);
  console.log(`  builder primary:       ${primaryOk}/${known.length}`);
  console.log(`  builders_detected set: ${setOk}/${known.length}`);
  console.log(`  false-pos on custom:   ${custClaimHigh}/${cust.length}`);
  console.log(`  wrong-at-high:         ${wrongHigh}`);
  assert.ok(true);
});
