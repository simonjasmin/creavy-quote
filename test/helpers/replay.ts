// Fake transport + clock + fixture-scenario loaders. Shared by every crawl test.
// Zero network. Extends the spike's fixture-loading idea into a replayable transport.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Transport, Clock, FetchResult, FetchOpts } from "../../src/crawl/types.ts";
import { isBlockedHost } from "../../src/crawl/ssrf.ts";

export type ResponseSpec = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  bodyFile?: string; // relative to the fixture dir
  gzip?: boolean; // gzip the body (and optionally omit content-encoding — S-08)
  gzipNoHeader?: boolean;
  location?: string; // redirect target (implies 301 if status unset)
  error?: { kind: FetchResult["error"] extends infer E ? (E extends { kind: infer K } ? K : never) : never; message?: string };
  delayMs?: number; // simulated latency (advances the clock; can trigger timeout)
};

export type Scenario = Record<string, ResponseSpec>;

export class FakeClock implements Clock {
  private t: number;
  constructor(start = 0) { this.t = start; }
  now(): number { return this.t; }
  async sleep(ms: number): Promise<void> { this.t += Math.max(0, ms); }
  advance(ms: number): void { this.t += ms; }
}

function lc(h: Record<string, string> = {}): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() !== "set-cookie") o[k.toLowerCase()] = String(v);
  return o;
}

export class FakeTransport implements Transport {
  readonly requests: string[] = [];
  private inflight = 0;
  maxInflightSeen = 0;
  readonly perHostInflight: Record<string, number> = {};
  readonly perHostMaxSeen: Record<string, number> = {};

  private scenario: Scenario;
  private dir: string;
  private clock: FakeClock;
  private opts: { strict?: boolean };
  constructor(scenario: Scenario, dir = ".", clock = new FakeClock(), opts: { strict?: boolean } = {}) {
    this.scenario = scenario; this.dir = dir; this.clock = clock; this.opts = opts;
  }

  private hostOf(u: string): string { try { return new URL(u).host; } catch { return u; } }

  private body(spec: ResponseSpec): { body: string; bytes?: Uint8Array; headers: Record<string, string> } {
    let text = spec.body ?? (spec.bodyFile ? readFileSync(join(this.dir, spec.bodyFile), "utf8") : "");
    const headers = lc(spec.headers);
    if (spec.gzip || spec.gzipNoHeader) {
      const gz = gzipSync(Buffer.from(text, "utf8"));
      if (!spec.gzipNoHeader) headers["content-encoding"] = "gzip";
      return { body: gz.toString("latin1"), bytes: new Uint8Array(gz), headers };
    }
    return { body: text, headers };
  }

  async fetch(url: string, o: FetchOpts = {}): Promise<FetchResult> {
    const maxHops = o.maxHops ?? 5;
    const chain: string[] = [];
    const visited = new Set<string>();
    let cur = url;

    // concurrency accounting (D-34): count this fetch as in flight for its host
    const host = this.hostOf(url);
    this.inflight++; this.maxInflightSeen = Math.max(this.maxInflightSeen, this.inflight);
    this.perHostInflight[host] = (this.perHostInflight[host] || 0) + 1;
    this.perHostMaxSeen[host] = Math.max(this.perHostMaxSeen[host] || 0, this.perHostInflight[host]);
    await Promise.resolve(); // yield so concurrent fetches genuinely overlap (D-34 measurement)
    try {
      while (true) {
        this.requests.push(cur);
        // SSRF (#25 Part B), per-hop before "connect": block non-http(s) schemes and
        // private/reserved/localhost destinations. Uniform failure (kind "blocked").
        try {
          const u = new URL(cur);
          if (!/^https?:$/.test(u.protocol)) return { url: cur, status: 0, headers: {}, body: "", chain, error: { kind: "blocked", message: "bad_scheme" } };
          if (isBlockedHost(u.hostname).blocked) return { url: cur, status: 0, headers: {}, body: "", chain, error: { kind: "blocked", message: "ssrf" } };
        } catch { return { url: cur, status: 0, headers: {}, body: "", chain, error: { kind: "blocked", message: "bad_url" } }; }
        const spec = this.scenario[cur];
        if (!spec) {
          if (this.opts.strict) throw new Error(`no fixture for ${cur}`);
          return { url: cur, status: 404, headers: {}, body: "", chain };
        }
        if (spec.delayMs) {
          if (o.timeoutMs && spec.delayMs > o.timeoutMs) { this.clock.advance(o.timeoutMs); return { url: cur, status: 0, headers: {}, body: "", chain, error: { kind: "timeout", message: "timed out" } }; }
          this.clock.advance(spec.delayMs);
        }
        if (spec.error) return { url: cur, status: 0, headers: {}, body: "", chain, error: { kind: spec.error.kind as any, message: spec.error.message ?? spec.error.kind } };
        const status = spec.status ?? (spec.location ? 301 : 200);
        const { body, bytes, headers } = this.body(spec);
        const loc = spec.location ?? headers["location"];
        if (status >= 300 && status < 400 && loc) {
          if (visited.has(cur)) return { url: cur, status, headers, body: "", chain, error: { kind: "redirect_loop", message: "loop" } };
          visited.add(cur);
          chain.push(cur);
          if (chain.length > maxHops) return { url: cur, status, headers, body: "", chain, error: { kind: "too_many_redirects", message: "hop cap" } };
          cur = new URL(loc, cur).toString();
          continue;
        }
        return { url: cur, status, headers, body, bytes, chain };
      }
    } finally {
      this.inflight--; this.perHostInflight[host]--;
    }
  }
}

// ---- scenario builders ----

// Build a scenario from a corpus fixture dir (root + robots + sitemap).
export function corpusScenario(slug: string): { scenario: Scenario; dir: string; origin: string } {
  const dir = join("fixtures/sites", slug);
  const hdr = JSON.parse(readFileSync(join(dir, "root.headers.json"), "utf8"));
  const origin = new URL(hdr.final_url || hdr.requested).origin;
  const scenario: Scenario = {};
  scenario[origin + "/"] = { status: hdr.status || 200, headers: hdr.headers || {}, bodyFile: "root.html" };
  if (hdr.final_url && hdr.final_url !== origin + "/") scenario[hdr.final_url] = scenario[origin + "/"];
  if (existsSync(join(dir, "robots.txt"))) scenario[origin + "/robots.txt"] = { status: 200, headers: { "content-type": "text/plain" }, bodyFile: "robots.txt" };
  if (existsSync(join(dir, "sitemap.xml"))) scenario[origin + "/sitemap.xml"] = { status: 200, headers: { "content-type": "application/xml" }, bodyFile: "sitemap.xml" };
  return { scenario, dir, origin };
}

// Load a synthetic scenario (fixtures/synthetic/<case>/scenario.json).
export function syntheticScenario(caseId: string): { scenario: Scenario; dir: string } {
  const dir = join("fixtures/synthetic", caseId);
  const scenario = JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8")) as Scenario;
  return { scenario, dir };
}

export function listCorpusSlugs(): string[] {
  return readdirSync("fixtures/sites", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

export function readManifest(slug: string): any {
  return JSON.parse(readFileSync(join("fixtures/sites", slug, "manifest.json"), "utf8"));
}
