// Generates the fingerprint TDD backlog (F-01…) from the labelled corpus.
// SPIKE CODE — /spikes. One case per fixture, table-driven like the edge-case inventory.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = "fixtures/sites";
const dirs = (await readdir(OUT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();

const rows = [];
for (const slug of dirs) {
  let m;
  try { m = JSON.parse(await readFile(join(OUT, slug, "manifest.json"), "utf8")); } catch { continue; }
  rows.push({ slug, ...m.ground_truth });
}

const lines = [];
lines.push("# Fingerprint adapter — TDD backlog (F-01…)");
lines.push("");
lines.push("> Generated from the labelled corpus (`fixtures/sites/*/manifest.json`) by");
lines.push("> `spikes/genBacklog.mjs`. One case per fixture, table-driven like the crawl");
lines.push("> edge-case inventory. Each case: load the fixture's `root.html` + `root.headers.json`,");
lines.push("> run the adopted adapter, assert `platform` / `builder` / `confidence`.");
lines.push("> `confidence`: **high** where a deterministic signal exists; **low** for custom/static");
lines.push("> (no platform claim). Builder asserted only where ground truth is a known builder.");
lines.push("");
lines.push("| ID | Fixture | Expect platform | Primary builder | builders_detected | Expect confidence |");
lines.push("|----|---------|-----------------|-----------------|-------------------|-------------------|");
rows.forEach((r, i) => {
  const id = `F-${String(i + 1).padStart(2, "0")}`;
  const conf = r.platform === "custom" ? "low (no claim)" : "high";
  const bld = r.builder && r.builder !== "unknown" ? r.builder : (r.platform === "wordpress" ? "— (any/none)" : "—");
  const bd = (r.builders_detected && r.builders_detected.length) ? r.builders_detected.join("+") : "—";
  lines.push(`| ${id} | ${r.slug} | ${r.platform} | ${bld} | ${bd} | ${conf} |`);
});
lines.push("");
lines.push("**Calibration properties (assert across the whole table):**");
lines.push("- Zero platform claims on any `custom` fixture (the unforgivable failure).");
lines.push("- Zero *wrong* answers at `high` confidence.");
lines.push("- Every `high`-confidence claim carries ≥1 deterministic signal in `signals_matched`.");
lines.push("");
await writeFile("spikes/fingerprint-tdd-backlog.md", lines.join("\n"));
console.log(`Wrote spikes/fingerprint-tdd-backlog.md with ${rows.length} cases.`);
