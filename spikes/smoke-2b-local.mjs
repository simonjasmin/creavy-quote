// First REAL assessment, locally: a local server with the REAL opus model (key from .env,
// scoped to this subprocess) + a golden-fixture transport (a real site's captured content —
// toituresmarcelpouliot, 4 core, assessable). Scan → assess → stream → print real French
// prose + idempotency. Deterministic scan (golden), real model call. Zero deploy needed.
//
//   node --env-file=.env spikes/smoke-2b-local.mjs
import { readFileSync } from "node:fs";
import { createServer } from "../src/service/server.ts";
import { loadServiceConfig } from "../src/service/config.ts";
import { MemoryStore } from "../src/service/store/memoryStore.ts";
import { RateLimiter } from "../src/service/rateLimiter.ts";
import { realClock } from "../src/service/realClock.ts";
import { pricingConfig } from "../src/pricing/index.ts";
import { anthropicModel } from "../src/assess/anthropicModel.ts";
import { assessConfig } from "../src/assess/config.ts";
import { FakeTransport } from "../test/helpers/replay.ts";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error("run with: node --env-file=.env spikes/smoke-2b-local.mjs"); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (o) => JSON.stringify(o);

const scenario = JSON.parse(readFileSync("fixtures/golden/toituresmarcelpouliot/scenario.json", "utf8"));
const config = loadServiceConfig({ ALLOWED_ORIGIN: "https://creavy.netlify.app", NODE_ENV: "development", ANTHROPIC_API_KEY: key });
const server = createServer({
  config, pricing: pricingConfig, store: new MemoryStore(),
  rateLimiter: new RateLimiter(config.rateLimit.windowMs, config.rateLimit.maxPerWindow),
  transport: new FakeTransport(scenario), clock: realClock, syncHoldMs: 8000,
  assessmentModel: anthropicModel(key), assessmentModelId: assessConfig.model, assessLang: "fr",
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// 1. scan (golden) → completed assessable
let q = await (await fetch(`${base}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ url: "http://toituresmarcelpouliot.com/", answers: { pages: "3_4", component: "none", languages: "fr", has_brand_assets: true } }) })).json();
for (let i = 0; i < 20 && q.status === "pending"; i++) { await sleep(200); q = await (await fetch(`${base}/quote/${q.quote_id}`)).json(); }
console.log(`# first real assessment (local, real opus)\nscan → ${q.status}, core=${q.result?.core_pages}, platform=${q.result?.detected_platform}`);

// 2. assess (real model call) → poll → print prose
const t0 = Date.now();
const a = await (await fetch(`${base}/quote/${q.quote_id}/assess`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ content_readiness: "partial" }) })).json();
let asmt;
for (let i = 0; i < 60; i++) { asmt = await (await fetch(`${base}/quote/${q.quote_id}/assessment`)).json(); if (["completed", "unavailable"].includes(asmt.status)) break; await sleep(500); }
console.log(`assessment: ${asmt.status} (${Date.now() - t0}ms)`);
console.log(`suggested_addons: ${j(asmt.suggested_addons)}`);
console.log(`internal fields on the wire? ${["complexity", "complexity_factors", "review_note", "confidence", "flagged_for_review"].filter((k) => k in asmt).join(",") || "NONE ✅"}`);
console.log(`\n--- REAL FRENCH PROSE (verbatim) ---\n${(asmt.prose_chunks || []).join("")}\n---`);

// 3. idempotency
const a2 = await (await fetch(`${base}/quote/${q.quote_id}/assess`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ content_readiness: "partial" }) })).json();
console.log(`\nidempotency: 2nd POST → ${a2.assessment_id === a.assessment_id ? "SAME id ✅ (no second model call)" : "DIFFERENT ❌"}`);
server.close();
