// Stage-2 LIVE staging smoke. Client against the deployed service: scan a real site → POST
// assess → poll → print the REAL streamed French prose + latency + the idempotency proof +
// the ceiling note. Run AFTER the founder adds ANTHROPIC_API_KEY to Railway and redeploys.
//
//   node spikes/smoke-2b-live.mjs <staging-base-url> [real-icp-url]
import { normalize } from "../src/url/normalize.ts";

const base = (process.argv[2] || "").replace(/\/+$/, "");
const rawScan = process.argv[3] || "toituresmarcelpouliot.com";
const n = normalize(rawScan); const scanUrl = n.ok ? n.identity : rawScan;
if (!base) { console.error("usage: node spikes/smoke-2b-live.mjs <staging-base-url> [real-icp-url]"); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (o) => JSON.stringify(o);

// 1. scan → completed (cache-busted so it's a fresh, assessable quote)
const cb = scanUrl + (scanUrl.includes("?") ? "&" : "?") + "cb=" + Date.now();
let q = await (await fetch(`${base}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ url: cb, answers: { pages: "3_4", component: "none", languages: "fr", has_brand_assets: true } }) })).json();
for (let i = 0; i < 30 && q.status === "pending"; i++) { await sleep(1500); q = await (await fetch(`${base}/quote/${q.quote_id}`)).json(); }
console.log(`# stage-2 live smoke — ${base}\nscan ${scanUrl} → ${q.status} (${q.register ?? q.review_required ? "review/estimation" : "flat"}), core=${q.result?.core_pages}`);
if (q.status !== "completed") { console.log("scan not completed — cannot assess:", j(q)); process.exit(1); }

// 2. assess → 202
const t0 = Date.now();
const a = await (await fetch(`${base}/quote/${q.quote_id}/assess`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ content_readiness: "partial" }) })).json();
console.log(`POST assess → ${j(a)}`);

// 3. poll assessment → completed, print prose verbatim
let asmt;
for (let i = 0; i < 40; i++) { asmt = await (await fetch(`${base}/quote/${q.quote_id}/assessment`)).json(); if (["completed", "unavailable"].includes(asmt.status)) break; await sleep(1000); }
const ms = Date.now() - t0;
console.log(`\n## assessment: ${asmt.status}  (${ms}ms)`);
console.log(`suggested_addons: ${j(asmt.suggested_addons)}`);
console.log(`internal fields present? ${["complexity", "complexity_factors", "review_note", "confidence", "flagged_for_review"].filter((k) => k in asmt).join(",") || "NONE ✅"}`);
console.log(`\n--- STREAMED FRENCH PROSE (verbatim) ---\n${(asmt.prose_chunks || []).join("")}\n---`);

// 4. idempotency: second POST → same assessment id, no second call
const a2 = await (await fetch(`${base}/quote/${q.quote_id}/assess`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ content_readiness: "partial" }) })).json();
console.log(`\nidempotency: 2nd POST assess → ${a2.assessment_id === a.assessment_id ? "SAME id ✅ (no second model call)" : "DIFFERENT id ❌"}`);
console.log(`ceiling: assessment daily ceiling is enforced at POST (50/day → 409 budget_exceeded).`);
