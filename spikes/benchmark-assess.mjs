// #32 step 7 / Fork 1 — the model benchmark. Runs BOTH candidates live on every
// assessable golden (both languages where bilingual), captures prose + latency + tokens,
// and writes spikes/assess-benchmark.md for the GATE. The founder reads real output +
// real latency, then picks — same principle as the voice pick.
//
//   ANTHROPIC_API_KEY=… node spikes/benchmark-assess.mjs
//
// No key → prints how to run and exits WITHOUT overwriting the committed pre-gate report.
import { writeFileSync } from "node:fs";
import { assess } from "../src/assess/assess.ts";
import { isAssessment } from "../src/assess/types.ts";
import { anthropicModel } from "../src/assess/anthropicModel.ts";
import { listAssessableGoldens } from "./_assessable.mjs";

const MODELS = ["claude-sonnet-4-6", "claude-opus-4-8"]; // Fork 1 candidates
const key = process.env.ANTHROPIC_API_KEY;

if (!key) {
  console.log("No ANTHROPIC_API_KEY set — benchmark not run.");
  console.log("To produce spikes/assess-benchmark.md with live side-by-side output:");
  console.log("  ANTHROPIC_API_KEY=sk-... node spikes/benchmark-assess.mjs");
  console.log("Candidates:", MODELS.join(" vs "));
  process.exit(0);
}

const goldens = await listAssessableGoldens();
const rows = [];
for (const g of goldens) {
  for (const lang of g.langs) {
    for (const model of MODELS) {
      const stats = {};
      let prose = "";
      const t0 = Date.now();
      const r = await assess(g.scan, { lang, model: anthropicModel(key, stats), modelId: model, onProse: (c) => (prose += c) });
      const s = stats.last ?? { input_tokens: 0, output_tokens: 0, ms: Date.now() - t0 };
      rows.push({
        slug: g.slug, synthetic: g.synthetic, lang, model,
        ok: isAssessment(r), complexity: r.ok ? r.complexity : "—", confidence: r.ok ? r.confidence : "—",
        flagged: r.ok ? r.flagged_for_review : false, factors: r.ok ? r.complexity_factors.join(", ") : "—",
        prose: r.ok ? r.assessment : `(unavailable: ${r.reason})`, words: prose.trim().split(/\s+/).filter(Boolean).length,
        ms: s.ms, in_tok: s.input_tokens, out_tok: s.output_tokens,
      });
      console.log(`${g.slug} [${lang}] ${model}: ${r.ok ? r.complexity + "/" + r.confidence : r.reason} — ${s.ms}ms, ${s.out_tok} out-tok, ${rows.at(-1).words}w`);
    }
  }
}

// ---- write the report ----
const esc = (s) => String(s).replace(/\|/g, "\\|");
let md = `# Assessment model benchmark (#32 Fork 1) — GATE input\n\n`;
md += `Live run over ${goldens.length} assessable golden(s), both languages where bilingual. Candidates: **${MODELS.join("** vs **")}**.\n\n`;
md += `## Summary — latency & tokens\n\n| site | lang | model | complexity | conf | flag | words | latency | out-tok |\n|---|---|---|---|---|---|--:|--:|--:|\n`;
for (const r of rows) md += `| ${esc(r.slug)}${r.synthetic ? " *(syn)*" : ""} | ${r.lang} | ${r.model} | ${r.complexity} | ${r.confidence} | ${r.flagged ? "⚑" : ""} | ${r.words} | ${r.ms}ms | ${r.out_tok} |\n`;
md += `\n## Side-by-side prose\n\n`;
const byCase = {};
for (const r of rows) (byCase[`${r.slug} [${r.lang}]`] ??= []).push(r);
for (const [caseName, rs] of Object.entries(byCase)) {
  md += `### ${caseName}${rs[0].synthetic ? " *(labelled-synthetic)*" : ""}\n\n`;
  for (const r of rs) md += `**${r.model}** — ${r.complexity}/${r.confidence}${r.flagged ? " ⚑" : ""} · factors: ${r.factors}\n\n> ${r.prose}\n\n`;
}
writeFileSync("spikes/assess-benchmark.md", md);
console.log(`\nWrote spikes/assess-benchmark.md (${rows.length} rows).`);
