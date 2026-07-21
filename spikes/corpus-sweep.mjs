// Corpus outcome sweep — MEASUREMENT ONLY, no rule/threshold/config changes. Runs the real
// pipeline (scan → assessable → #27 mapper via buildQuoteResponse) over every fixture set
// that supports a FAITHFUL offline scan. NEVER mocks a fetch to force an outcome: full-crawl
// goldens/synthetics get a real replay; the root-only 50-site corpus is reported only as far
// as its sitemap faithfully allows (core band), the rest labelled not-measurable.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scan } from "../src/crawl/scan.ts";
import { assessable } from "../src/assess/assessable.ts";
import { buildQuoteResponse } from "../src/service/buildResponse.ts";
import { parseSitemap, classifyLoc } from "../src/crawl/sitemap.ts";
import { pricingConfig } from "../src/pricing/index.ts";
import { FakeTransport, FakeClock } from "../test/helpers/replay.ts";

const GOLDEN_INPUTS = {
  itemconstruction: "https://itemconstruction.com/", labarberie: "https://labarberie.com/",
  lasouche: "https://lasouche.ca/", mchenryplumbing: "https://www.mchenryplumbing.ca/",
  mtlplomberie: "https://www.mtlplomberie.ca/", paysagesgenest: "https://paysagesgenest.com/",
  pierrehamelin: "https://pierrehamelin.ca/", protectoit: "https://www.protectoit.com/",
  toituresmarcelpouliot: "http://toituresmarcelpouliot.com/",
};

const bandOf = (c) => (c === "30+" ? "5_plus" : c <= 2 ? "1_2" : c <= 4 ? "3_4" : "5_plus");

// Classify a scan into one of: flat | estimation | review | out_of_scope | greenfield.
// Band-matched neutral answers isolate SCAN-driven outcomes (no declared-vs-scanned conflict).
function classify(r) {
  const answers = { pages: bandOf(r.core_pages), component: "none", languages: "fr", has_brand_assets: true };
  const built = buildQuoteResponse({ scan: r, answers, no_site: false }, pricingConfig);
  if (built.status === "failed") return { outcome: "greenfield", reason: built.body.reason, reasons: [built.body.reason] };
  const res = built.body.result;
  const reasons = res.reasons || [];
  if (built.body.review_required && res.reason_code) {
    const rc = res.reason_code;
    if (rc === "out_of_scope") return { outcome: "out_of_scope", reason: rc, reasons };
    if (["parked", "no_html", "no_owned_site", "greenfield"].includes(rc)) return { outcome: "greenfield", reason: rc, reasons };
    return { outcome: "review", reason: rc, reasons }; // needs_review
  }
  return { outcome: built.body.register, reason: reasons.join("+"), reasons }; // flat | estimation
}

const coreBucket = (c) => (c === "30+" ? "30+" : c === 0 ? "0" : c <= 6 ? String(c) : "7-29");

// ---- SET A: full-crawl faithful (goldens + synthetics) ----
const rows = [];
for (const slug of readdirSync("fixtures/golden")) {
  const dir = join("fixtures/golden", slug);
  if (!existsSync(join(dir, "scenario.json"))) continue;
  const scenario = JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8"));
  const manifest = existsSync(join(dir, "manifest.json")) ? JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) : {};
  const input = GOLDEN_INPUTS[slug] ?? manifest.input;
  const synthetic = manifest.synthetic === true;
  const r = await scan(new FakeTransport(scenario), new FakeClock(), input);
  const c = classify(r);
  rows.push({ set: synthetic ? "golden-syn" : "golden-real", slug, core: r.core_pages, assessable: assessable(r), ...c });
}
for (const caseId of readdirSync("fixtures/synthetic")) {
  const p = join("fixtures/synthetic", caseId, "scenario.json");
  if (!existsSync(p)) continue;
  const scenario = JSON.parse(readFileSync(p, "utf8"));
  const rootKey = Object.keys(scenario).find((k) => /:\/\/[^/]+\/$/.test(k)) || Object.keys(scenario)[0];
  const input = new URL(rootKey).host;
  const r = await scan(new FakeTransport(scenario), new FakeClock(), input);
  const c = classify(r);
  rows.push({ set: "synthetic", slug: caseId, core: r.core_pages, assessable: assessable(r), ...c });
}

// ---- report SET A ----
const tally = (arr, key) => arr.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {});
console.log("### SET A — full-crawl faithful (scan → assessable → #27 mapper)\n");
console.log("slug".padEnd(26), "set".padEnd(12), "core".padEnd(5), "outcome".padEnd(12), "reason");
for (const r of rows.sort((a, b) => a.outcome.localeCompare(b.outcome))) console.log(r.slug.padEnd(26), r.set.padEnd(12), String(r.core).padEnd(5), r.outcome.padEnd(12), r.reason);

console.log("\nOUTCOME distribution:", JSON.stringify(tally(rows, "outcome")));
const reasonHist = {};
for (const r of rows) for (const c of r.reasons) reasonHist[c] = (reasonHist[c] || 0) + 1;
console.log("REASON-CODE histogram:", JSON.stringify(reasonHist));
const coreHist = {};
for (const r of rows) { const b = coreBucket(r.core); coreHist[b] = (coreHist[b] || 0) + 1; }
console.log("CORE-PAGE distribution:", JSON.stringify(coreHist));
const autoPriced = rows.filter((r) => r.outcome === "flat" || r.outcome === "estimation").length;
const realSites = rows.filter((r) => r.outcome !== "greenfield").length;
console.log(`AUTO-PRICE rate (flat+estimation over real sites): ${autoPriced}/${realSites} = ${(100 * autoPriced / realSites).toFixed(0)}%`);

// ---- SET B: 50-site corpus, sitemap-derived core band ONLY (root-only → no full scan) ----
console.log("\n### SET B — 50-site root-only corpus (sitemap-derived core band; NOT a full outcome)\n");
const bandHist = {};
let measurable = 0, notMeasurable = 0, indexNotExpandable = 0;
for (const slug of readdirSync("fixtures/sites")) {
  const dir = join("fixtures/sites", slug);
  const smPath = join(dir, "sitemap.xml");
  if (!existsSync(smPath)) { notMeasurable++; continue; }
  const hdr = existsSync(join(dir, "root.headers.json")) ? JSON.parse(readFileSync(join(dir, "root.headers.json"), "utf8")) : {};
  const origin = (() => { try { return new URL(hdr.final_url || hdr.requested || "https://" + slug).origin; } catch { return "https://x"; } })();
  const parsed = parseSitemap({ body: readFileSync(smPath, "utf8") }, origin + "/sitemap.xml");
  if (parsed.type === "index") { indexNotExpandable++; notMeasurable++; continue; } // needs child fetches (not root-only)
  if (parsed.type === "unparseable") { notMeasurable++; continue; }
  const core = parsed.locs.filter((l) => classifyLoc(l) === "core").length; // ROUGH: no pairing, no soft-404
  measurable++;
  const band = core === 0 ? "0" : core <= 6 ? String(core) : core <= 30 ? "7-30" : "30+";
  bandHist[band] = (bandHist[band] || 0) + 1;
}
console.log(`measurable (urlset sitemap): ${measurable}   not-measurable (no/​index/unparseable sitemap): ${notMeasurable} (of which index-not-expandable: ${indexNotExpandable})`);
console.log("SITEMAP-DERIVED core band (ROUGH — no bilingual pairing / no soft-404 subtraction):", JSON.stringify(bandHist));
