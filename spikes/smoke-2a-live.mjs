// Live staging smoke for Phase 2a. A pure HTTP CLIENT against the DEPLOYED service — the
// scanned case gives it a real ICP URL, so the deployed service exercises its real
// HttpTransport (one polite pass). Writes spikes/smoke-2a-live-transcript.md with
// expected-vs-actual per behaviour, so any failure names itself. Exit code is nonzero if
// any behaviour fails.
//
//   node spikes/smoke-2a-live.mjs <staging-base-url> [real-icp-url]
//   e.g. node spikes/smoke-2a-live.mjs https://creavy-quote-staging.up.railway.app https://a-real-small-trades-site.ca/
//
// No secrets, no ANTHROPIC_API_KEY (2a makes no model call). Run this AFTER `railway up` +
// `/health` is green; relay the transcript + URL + ALLOWED_ORIGIN to the gate.
import { writeFileSync } from "node:fs";

const base = (process.argv[2] || "").replace(/\/+$/, "");
const scanUrl = process.argv[3] || "https://toituresmarcelpouliot.com/"; // a real small ICP site; override as needed
const PROD_ORIGIN_HINT = "https://creavy.netlify.app"; // for the CORS check; the service's ALLOWED_ORIGIN must match
if (!base) { console.error("usage: node spikes/smoke-2a-live.mjs <staging-base-url> [real-icp-url]"); process.exit(2); }

const POST = (body, headers = {}) => fetch(`${base}/quote`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const answers = { pages: "3_4", component: "none", languages: "fr", has_brand_assets: true };
const results = [];
const record = (behavior, expected, actual, pass) => { results.push({ behavior, expected, actual, pass }); console.log(`${pass ? "PASS" : "FAIL"} — ${behavior}\n   expected: ${expected}\n   actual:   ${actual}`); };
const summarize = (o) => JSON.stringify(o).slice(0, 400);

async function run() {
  // 1) scanned quote → completion via poll (real ICP URL, one polite pass)
  try {
    const r = await POST({ url: scanUrl, answers });
    let body = await r.json();
    const started = Date.now();
    while (body.status === "pending" && Date.now() - started < 35_000) { // contract §6 client ceiling
      await new Promise((x) => setTimeout(x, 1500)); // contract §6 poll interval
      body = await (await fetch(`${base}/quote/${body.quote_id}`)).json();
    }
    const terminal = body.status === "completed" || body.status === "failed";
    const shaped = body.indicative === true && (body.status === "failed" ? body.book_a_call === true : !!(body.result?.bundle || body.result?.range || body.result?.reason_code));
    record("1. scanned → terminal via poll (real ICP URL)", `status∈{completed,failed} via poll, indicative:true, contract-shaped result (${scanUrl})`, `status=${body.status} ${summarize(body)}`, terminal && shaped);
  } catch (e) { record("1. scanned → terminal via poll (real ICP URL)", "terminal, contract-shaped", `THREW ${e.message}`, false); }

  // 2) no-site declared quote
  try {
    const body = await (await POST({ no_site: true, answers: { ...answers, component: "booking", languages: "fr_en" } })).json();
    const ok = body.status === "completed" && body.basis === "declared" && !!body.result?.bundle?.tier && typeof body.result?.indicative_total === "number";
    record("2. no-site declared → completed", "status:completed, basis:declared, result.bundle.tier + indicative_total", summarize(body), ok);
  } catch (e) { record("2. no-site declared → completed", "completed declared", `THREW ${e.message}`, false); }

  // 3) 429 from a rate-limit burst
  try {
    let seen429 = false, tries = 0, retryAfter = null;
    for (let i = 0; i < 20 && !seen429; i++) {
      tries++;
      const rr = await POST({ no_site: true, answers });
      if (rr.status === 429) { seen429 = true; retryAfter = rr.headers.get("retry-after"); }
    }
    record("3. rate-limit burst → 429 + Retry-After", "a 429 with Retry-After≥1 within the burst", seen429 ? `429 after ${tries} POSTs, Retry-After=${retryAfter}s` : `no 429 in 20 POSTs (RATE_LIMIT_MAX too high for this burst?)`, seen429 && Number(retryAfter) >= 1);
  } catch (e) { record("3. rate-limit burst → 429 + Retry-After", "429 + Retry-After", `THREW ${e.message}`, false); }

  // 4) CORS (#33): allowed echoed, preview echoed, rejected → none
  try {
    const acao = async (origin) => (await fetch(`${base}/health`, { headers: { origin } })).headers.get("access-control-allow-origin");
    const prod = await acao(PROD_ORIGIN_HINT);
    const preview = await acao("https://deploy-preview-7--creavy.netlify.app");
    const evil = await acao("https://evil.com");
    const ok = evil === null && preview === "https://deploy-preview-7--creavy.netlify.app";
    const prodNote = prod === PROD_ORIGIN_HINT ? "echoed" : `NOT echoed (ALLOWED_ORIGIN ≠ ${PROD_ORIGIN_HINT}? — set the hint to the real origin)`;
    record("4. CORS #33 (preview allowed, evil blocked)", "preview origin echoed; evil.com → no ACAO", `prod=${prod} (${prodNote}); preview=${preview}; evil=${evil ?? "(none)"}`, ok);
  } catch (e) { record("4. CORS #33", "preview echoed, evil blocked", `THREW ${e.message}`, false); }

  // 5) /health
  try {
    const r = await fetch(`${base}/health`);
    const body = await r.json();
    record("5. /health", "200 {status:ok}", `${r.status} ${summarize(body)}`, r.status === 200 && body.status === "ok");
  } catch (e) { record("5. /health", "200 ok", `THREW ${e.message}`, false); }
}

await run();

const passed = results.filter((r) => r.pass).length;
const allPass = passed === results.length;
let md = `# Phase 2a — LIVE staging smoke transcript\n\n`;
md += `- **Staging URL:** ${base}\n- **Scanned ICP URL:** ${scanUrl}\n- **Result:** ${passed}/${results.length} behaviours passed${allPass ? " ✅" : " — SEE FAILURES ⚠"}\n\n`;
md += `| # | behaviour | expected | actual | result |\n|---|---|---|---|:--:|\n`;
for (const r of results) md += `| | ${r.behavior} | ${String(r.expected).replace(/\|/g, "\\|")} | ${String(r.actual).replace(/\|/g, "\\|").slice(0, 300)} | ${r.pass ? "✅" : "❌"} |\n`;
md += `\n> Relay this file + the staging URL + the resolved \`ALLOWED_ORIGIN\` to the gate.\n`;
writeFileSync("spikes/smoke-2a-live-transcript.md", md);
console.log(`\n${passed}/${results.length} passed — wrote spikes/smoke-2a-live-transcript.md`);
process.exit(allPass ? 0 : 1);
