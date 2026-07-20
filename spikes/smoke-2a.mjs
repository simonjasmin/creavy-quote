// Local smoke for the Phase 2a service — a REAL HTTP server on localhost, exercised over
// the wire. No Railway, no Postgres, no network: MemoryStore + a golden-fixture transport
// stand in for the deploy so the five ratified behaviours are demonstrated deterministically.
// The staging URL + a live-network run are the founder's deploy step (see the gate report).
import { readFileSync } from "node:fs";
import { createServer } from "../src/service/server.ts";
import { loadServiceConfig } from "../src/service/config.ts";
import { MemoryStore } from "../src/service/store/memoryStore.ts";
import { RateLimiter } from "../src/service/rateLimiter.ts";
import { realClock } from "../src/service/realClock.ts";
import { pricingConfig } from "../src/pricing/index.ts";
import { FakeTransport } from "../test/helpers/replay.ts";

const ORIGIN = "https://creavy.netlify.app";
const scenario = JSON.parse(readFileSync("fixtures/golden/toituresmarcelpouliot/scenario.json", "utf8"));
const config = loadServiceConfig({ ALLOWED_ORIGIN: ORIGIN, NODE_ENV: "development", RATE_LIMIT_MAX: "3", TRUSTED_PROXY_HOPS: "0" });
const store = new MemoryStore();
const server = createServer({
  config, pricing: pricingConfig, store,
  rateLimiter: new RateLimiter(config.rateLimit.windowMs, config.rateLimit.maxPerWindow),
  transport: new FakeTransport(scenario), clock: realClock, syncHoldMs: 500,
  log: (layer, d) => console.log(`   · wall: ${layer} ${d ? JSON.stringify(d) : ""}`),
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const answers = { pages: "3_4", component: "none", languages: "fr", has_brand_assets: true };
const line = (s) => console.log(s);
const j = (o) => JSON.stringify(o);

line(`# Phase 2a — local smoke transcript (${base}, MemoryStore, golden-fixture transport)\n`);

// 1) scanned quote → completion via poll
line(`## 1. Scanned quote → completion via poll (ICP golden: toituresmarcelpouliot.com)`);
let r = await fetch(`${base}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ url: "http://toituresmarcelpouliot.com/", answers }) });
let body = await r.json();
line(`POST /quote → ${r.status} ${j(body)}`);
for (let i = 0; i < 40 && body.status === "pending"; i++) { await new Promise((x) => setTimeout(x, 200)); body = await (await fetch(`${base}/quote/${body.quote_id}`)).json(); }
line(`GET /quote/${body.quote_id} → ${j(body)}`);
const ev = await (await fetch(`${base}/quote/${body.quote_id}/events?since=-1&lang=fr`)).json();
line(`GET /quote/:id/events → ${ev.events.length} public lines, e.g. ${j(ev.events.slice(0, 3))}\n`);

// 2) no-site declared quote
line(`## 2. No-site declared quote (answers only: booking + bilingual)`);
r = await fetch(`${base}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ no_site: true, answers: { ...answers, component: "booking", languages: "fr_en" } }) });
line(`POST /quote → ${r.status} ${j(await r.json())}\n`);

// 3) 429 from a rate-limit burst
line(`## 3. Rate-limit burst (RATE_LIMIT_MAX=3)`);
for (let i = 1; i <= 4; i++) {
  const rr = await fetch(`${base}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ no_site: true, answers }) });
  line(`POST /quote #${i} → ${rr.status}${rr.status === 429 ? ` (Retry-After: ${rr.headers.get("retry-after")}s) ${j(await rr.json())}` : ""}`);
}
line("");

// 4) rejected CORS origin
line(`## 4. CORS (#33)`);
const good = await fetch(`${base}/health`, { headers: { origin: ORIGIN } });
line(`GET /health  Origin ${ORIGIN} → ACAO: ${good.headers.get("access-control-allow-origin")}`);
const preview = await fetch(`${base}/health`, { headers: { origin: "https://deploy-preview-12--creavy.netlify.app" } });
line(`GET /health  Origin deploy-preview-12--creavy.netlify.app → ACAO: ${preview.headers.get("access-control-allow-origin")}`);
const evil = await fetch(`${base}/health`, { headers: { origin: "https://evil.com" } });
line(`GET /health  Origin evil.com → ACAO: ${evil.headers.get("access-control-allow-origin") ?? "(none — blocked)"}\n`);

// 5) /health
line(`## 5. Health`);
const h = await fetch(`${base}/health`);
line(`GET /health → ${h.status} ${j(await h.json())}`);

server.close();
