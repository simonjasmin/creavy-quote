// E3 acceptance-gate deliverable: p95 FAST-PATH scan latency measured AGAINST STAGING (the
// real deployed service, real HttpTransport crawls each URL). Cache-busted (a unique ?cb per
// URL → a distinct normalized_url → #25-A cache miss → a genuine fresh scan). One polite pass
// each. Latency = POST /quote → GET reports a terminal state (completed/failed). Gate: p95 < 8 s.
//
//   node spikes/latency-staging.mjs [base-url] [extra-url ...]
const base = (process.argv[2] || "https://creavy-quote-production.up.railway.app").replace(/\/+$/, "");
const extra = process.argv.slice(3);
// golden real sites + the two live E2 sites (staging crawls from Railway's network, so even
// URLs that don't resolve from here are measured). Harvested URLs get appended once curated.
const URLS = [
  "https://itemconstruction.com/", "https://labarberie.com/", "https://lasouche.ca/",
  "https://www.mchenryplumbing.ca/", "https://www.mtlplomberie.ca/", "https://paysagesgenest.com/",
  "https://pierrehamelin.ca/", "https://www.protectoit.com/", "http://toituresmarcelpouliot.com/",
  "https://elevatek.ca/", "https://toitureshogue.com/", ...extra,
];
const answers = { pages: "3_4", component: "none", languages: "fr", has_brand_assets: true };
const runTag = String(Date.now()); // unique per run → guarantees a cache miss (fresh scan)
const cacheBust = (u) => u + (u.includes("?") ? "&" : "?") + "cb=" + runTag;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
for (const raw of URLS) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: cacheBust(raw), answers }), signal: AbortSignal.timeout(15000) });
    if (r.status !== 200) { rows.push({ url: raw, ms: null, status: `POST ${r.status}` }); continue; }
    let body = await r.json();
    while (body.status === "pending" && Date.now() - t0 < 40000) { await sleep(1500); body = await (await fetch(`${base}/quote/${body.quote_id}`, { signal: AbortSignal.timeout(15000) })).json(); }
    rows.push({ url: raw, ms: Date.now() - t0, status: body.status, register: body.register, review: body.review_required });
  } catch (e) { rows.push({ url: raw, ms: null, status: "ERR:" + e.message }); }
  await sleep(Math.max(700, 7500 - (Date.now() - t0))); // pace POSTs ≥7.5 s apart → never trip the rate limit (clean sample)
}

const ok = rows.filter((r) => r.ms != null);
const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => (lat.length ? lat[Math.max(0, Math.ceil((p / 100) * lat.length) - 1)] : NaN);
console.log("url".padEnd(40), "ms".padStart(7), "status");
for (const r of rows) console.log(r.url.padEnd(40), String(r.ms ?? "—").padStart(7), `${r.status}${r.register ? " " + r.register : ""}`);
console.log(`\nn=${ok.length}/${rows.length} measured  |  p50=${pct(50)}ms  p95=${pct(95)}ms  max=${Math.max(...lat)}ms  min=${Math.min(...lat)}ms`);
console.log(`GATE p95 < 8000ms: ${pct(95) < 8000 ? "PASS ✅" : "FAIL ❌"}  (p95=${pct(95)}ms)`);
