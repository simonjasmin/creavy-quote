// Golden-set harvester. Runs the real scan() per site through a RecordingTransport
// that captures every request/response as a replayable scenario.json. Polite by
// construction (scan fetches sequentially). Set-Cookie stripped. UA #15.
// Usage: node spikes/harvest-golden.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scan } from "../src/crawl/scan.ts";
import { FakeClock } from "../test/helpers/replay.ts";

const UA = "CreavyQuoteBot/1.0 (+https://creavy.com/bot)";
const TIMEOUT = 12000;

class RecordingTransport {
  constructor() { this.scenario = {}; }
  async fetch(url, opts = {}) {
    const maxHops = opts.maxHops ?? 5;
    const chain = []; const visited = new Set(); let cur = url;
    while (true) {
      let res;
      try { res = await fetch(cur, { redirect: "manual", headers: { "user-agent": UA }, signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT) }); }
      catch (e) { const kind = errKind(e); this.scenario[cur] = { error: { kind } }; return { url: cur, status: 0, headers: {}, body: "", chain, error: { kind, message: String(e) } }; }
      const headers = {}; res.headers.forEach((v, k) => { if (k.toLowerCase() !== "set-cookie") headers[k.toLowerCase()] = v; });
      if (res.status >= 300 && res.status < 400 && headers["location"]) {
        this.scenario[cur] = { status: res.status, headers: { location: headers["location"] } };
        if (visited.has(cur) || chain.length >= maxHops) return { url: cur, status: res.status, headers, body: "", chain, error: { kind: visited.has(cur) ? "redirect_loop" : "too_many_redirects" } };
        visited.add(cur); chain.push(cur); cur = new URL(headers["location"], cur).toString(); continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const body = new TextDecoder("utf-8").decode(buf.subarray(0, 2 * 1024 * 1024));
      this.scenario[cur] = { status: res.status, headers, body };
      return { url: cur, status: res.status, headers, body, bytes: buf, chain };
    }
  }
}
function errKind(e) { const c = String(e?.cause?.code || e?.name || ""); if (/ENOTFOUND|EAI_AGAIN/i.test(c)) return "dns"; if (/ECONNREFUSED/i.test(c)) return "refused"; if (/Timeout|ABORT/i.test(c)) return "timeout"; if (/CERT|TLS|SSL/i.test(c)) return "tls"; return "other"; }

const DEFAULT_SITES = [
  ["labarberie", "https://labarberie.com/"],
  ["lasouche", "https://lasouche.ca/"],
  ["paysagesgenest", "https://paysagesgenest.com/"],
  ["itemconstruction", "https://itemconstruction.com/"],
  ["pierrehamelin", "https://pierrehamelin.ca/"],
  ["protectoit", "https://www.protectoit.com/"],
  ["toituresmarcelpouliot", "http://toituresmarcelpouliot.com/"],
];
// argv: slug=url pairs → harvest only those
const argvSites = process.argv.slice(2).map((a) => a.split("="));
const SITES = argvSites.length ? argvSites : DEFAULT_SITES;

for (const [slug, url] of SITES) {
  const tx = new RecordingTransport();
  let result;
  try { result = await scan(tx, new FakeClock(), url); }
  catch (e) { console.log(`${slug}: SCAN ERROR ${e?.message}`); continue; }
  const dir = join("fixtures/golden", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "scenario.json"), JSON.stringify(tx.scenario, null, 1));
  await writeFile(join(dir, "scan-result.json"), JSON.stringify(result, null, 2));
  const reqs = Object.keys(tx.scenario).length;
  console.log(`${slug.padEnd(22)} plat=${(result.detected_platform || "").padEnd(11)} core=${String(result.core_pages).padEnd(4)} blog=${String(result.blog_posts).padEnd(3)} langs=${JSON.stringify(result.languages).padEnd(12)} bi=${result.bilingual_mirror} nb=${result.needs_browser} reqs=${reqs} flags=${result.review_flags.join(",")}`);
}
