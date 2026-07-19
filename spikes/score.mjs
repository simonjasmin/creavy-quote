// Fingerprint spike — scoring harness. SPIKE CODE — /spikes, never imported by src.
// Loads every labelled fixture, runs candidates A/B/C, and scores against
// rubric §6. Numbers only. Usage: node spikes/score.mjs [--per-site]

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { detectA, detectB, detectC } from "./detectors.mjs";

const OUT = "fixtures/sites";
const PER_SITE = process.argv.includes("--per-site");

function canon(pl) { if (pl === "square_online") return "weebly"; if (pl === "unknown") return "custom"; return pl; }
const isClaim = (pl) => canon(pl) !== "custom";
const KNOWN_BUILDERS = new Set(["divi", "elementor", "wpbakery", "beaver"]);

async function loadFixtures() {
  const dirs = (await readdir(OUT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  const out = [];
  for (const slug of dirs) {
    let manifest;
    try { manifest = JSON.parse(await readFile(join(OUT, slug, "manifest.json"), "utf8")); } catch { continue; }
    const hdr = JSON.parse(await readFile(join(OUT, slug, "root.headers.json"), "utf8"));
    const body = await readFile(join(OUT, slug, "root.html"), "utf8").catch(() => "");
    const page = { url: hdr.final_url || hdr.requested || "", status: hdr.status || 0, headers: hdr.headers || {}, body };
    out.push({ slug, gt: manifest.ground_truth, page });
  }
  return out;
}

async function scoreCandidate(name, fn, fixtures) {
  const rows = [];
  const t0 = performance.now();
  for (const fx of fixtures) {
    const r = await fn([fx.page]);
    rows.push({ slug: fx.slug, gt: fx.gt, pred: r });
  }
  const ms = performance.now() - t0;

  const N = rows.length;
  const platRows = rows.filter((r) => canon(r.gt.platform) !== "custom");
  const custRows = rows.filter((r) => canon(r.gt.platform) === "custom");
  const builderRows = rows.filter((r) => KNOWN_BUILDERS.has(r.gt.builder));

  const correct = (r) => canon(r.gt.platform) === canon(r.pred.platform);
  const high = (r) => r.pred.confidence === "high";

  const platCorrectHigh = platRows.filter((r) => correct(r) && high(r)).length;
  const platCorrectAny = platRows.filter((r) => correct(r)).length;
  const custClaimHigh = custRows.filter((r) => isClaim(r.pred.platform) && high(r)).length;
  const custClaimAny = custRows.filter((r) => isClaim(r.pred.platform)).length;
  const custCorrect = custRows.filter((r) => correct(r)).length; // pred is custom/unknown
  const wrongAtHigh = rows.filter((r) => high(r) && !correct(r)).length;
  const builderCorrect = builderRows.filter((r) => r.pred.builder === r.gt.builder).length;

  return {
    name, rows, ms,
    N, nPlat: platRows.length, nCust: custRows.length, nBuilder: builderRows.length,
    platAccHigh: platCorrectHigh / platRows.length,
    platAccAny: platCorrectAny / platRows.length,
    custClaimHigh, custClaimAny, custCorrect,
    wrongAtHigh,
    builderAcc: builderRows.length ? builderCorrect / builderRows.length : null,
    builderCorrect,
    msPerSite: ms / N,
  };
}

const fixtures = await loadFixtures();
console.log(`Corpus: ${fixtures.length} fixtures`);
const hist = {};
for (const f of fixtures) hist[f.gt.platform] = (hist[f.gt.platform] || 0) + 1;
console.log("Ground-truth histogram:", JSON.stringify(hist));

const results = [];
for (const [name, fn] of [["A (hand-rolled)", detectA], ["B (wappalyzer passive)", detectB], ["C (generator-only)", detectC]]) {
  results.push(await scoreCandidate(name, fn, fixtures));
}

const pct = (x) => (x == null ? "  n/a" : (100 * x).toFixed(1).padStart(5) + "%");
console.log("\n=== RUBRIC §6 SCORES ===");
console.log("candidate               plat@high  plat@any   builder   FP-custom(hi/any)  wrong@high  ms/site");
for (const r of results) {
  console.log(
    `${r.name.padEnd(24)}${pct(r.platAccHigh)}   ${pct(r.platAccAny)}  ${pct(r.builderAcc)}` +
    `      ${String(r.custClaimHigh).padStart(2)} / ${String(r.custClaimAny).padStart(2)}` +
    `           ${String(r.wrongAtHigh).padStart(3)}     ${r.msPerSite.toFixed(3)}`
  );
}
console.log(`\nn: platform fixtures=${results[0].nPlat}, custom fixtures=${results[0].nCust}, known-builder fixtures=${results[0].nBuilder}`);
console.log("plat@high = correct AND high-confidence, over platform fixtures (the rubric ≥90% target)");
console.log("FP-custom = platform claimed on a custom/static site (hi=high-confidence — the unforgivable failure)");
console.log("wrong@high = any high-confidence answer that is wrong (calibration; target 0)");

if (PER_SITE) {
  console.log("\n=== PER-SITE ===");
  console.log("slug".padEnd(32) + "GT".padEnd(14) + "A".padEnd(20) + "B".padEnd(20) + "C");
  for (let i = 0; i < fixtures.length; i++) {
    const gt = `${fixtures[i].gt.platform}${fixtures[i].gt.builder && fixtures[i].gt.builder !== "unknown" ? "/" + fixtures[i].gt.builder : ""}`;
    const cell = (r) => {
      const row = r.rows[i]; const b = row.pred.builder ? "/" + row.pred.builder : "";
      const ok = canon(row.gt.platform) === canon(row.pred.platform) ? "" : "✗";
      return `${row.pred.platform}${b}(${row.pred.confidence[0]})${ok}`;
    };
    console.log(fixtures[i].slug.padEnd(32) + gt.padEnd(14) + cell(results[0]).padEnd(20) + cell(results[1]).padEnd(20) + cell(results[2]));
  }
}
