import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRobots, fetchRobots } from "../src/crawl/robots.ts";
import { FakeTransport, listCorpusSlugs } from "./helpers/replay.ts";

const O = "https://x.example";
const tx = (scenario: any) => new FakeTransport(scenario);

test("R-01 robots 404 → allow all + robots_absent", async () => {
  const p = await fetchRobots(tx({ [O + "/robots.txt"]: { status: 404 } }), O);
  assert.equal(p.source, "allow_all"); assert.equal(p.allows("/anything"), true); assert.ok(p.notes.includes("robots_absent"));
});
test("R-02 robots 403 → allow all (RFC 9309)", async () => {
  const p = await fetchRobots(tx({ [O + "/robots.txt"]: { status: 403 } }), O);
  assert.equal(p.allows("/wp-admin/"), true);
});
test("R-03 robots 503 → disallow expansion + review", async () => {
  const p = await fetchRobots(tx({ [O + "/robots.txt"]: { status: 503 } }), O);
  assert.equal(p.source, "disallow_all"); assert.equal(p.allows("/x"), false); assert.ok(p.notes.includes("robots_5xx")); assert.ok(p.notes.some((n) => n.startsWith("review")));
});
test("R-04 robots redirect (apex→www) followed", async () => {
  const p = await fetchRobots(tx({
    [O + "/robots.txt"]: { status: 301, location: "https://www.x.example/robots.txt" },
    ["https://www.x.example/robots.txt"]: { status: 200, body: "User-agent: *\nDisallow: /a" },
  }), O);
  assert.equal(p.source, "parsed"); assert.equal(p.allows("/a/b"), false); assert.equal(p.allows("/b"), true);
});
test("R-05 robots redirect loop → unavailable (like 5xx)", async () => {
  const p = await fetchRobots(tx({ [O + "/robots.txt"]: { status: 301, location: O + "/robots.txt" } }), O);
  assert.equal(p.source, "disallow_all"); assert.ok(p.notes.includes("robots_redirect_loop"));
});
test("R-06 200 but HTML body → treat as absent", async () => {
  const p = await fetchRobots(tx({ [O + "/robots.txt"]: { status: 200, body: "<!DOCTYPE html><html><body>404</body></html>" } }), O);
  assert.equal(p.source, "allow_all"); assert.ok(p.notes.includes("robots_absent"));
});
test("R-07 named group beats * (specific wins)", () => {
  const p = parseRobots("User-agent: *\nDisallow: /\nUser-agent: creavyquotebot\nDisallow: /admin/", O);
  assert.equal(p.allows("/page"), true); assert.equal(p.allows("/admin/x"), false);
});
test("R-08 mixed-case directives parse", () => {
  const p = parseRobots("USER-AGENT: *\nDISALLOW: /x", O);
  assert.equal(p.allows("/x/y"), false); assert.equal(p.allows("/y"), true);
});
test("R-09 canonical WordPress default", () => {
  const p = parseRobots("User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php", O);
  assert.equal(p.allows("/wp-admin/"), false); assert.equal(p.allows("/wp-admin/admin-ajax.php"), true);
  // and: every corpus robots.txt parses without throwing
  for (const slug of listCorpusSlugs()) {
    let body: string;
    try { body = readFileSync(join("fixtures/sites", slug, "robots.txt"), "utf8"); } catch { continue; }
    assert.doesNotThrow(() => parseRobots(body, "https://" + slug));
  }
});
test("R-10 Disallow: / full block", () => {
  const p = parseRobots("User-agent: *\nDisallow: /", O);
  assert.equal(p.allows("/anything"), false); assert.equal(p.allows("/"), false);
});
test("R-11 wildcard * and end-anchor $", () => {
  const p = parseRobots("User-agent: *\nDisallow: /*?s=\nDisallow: /*.pdf$", O);
  assert.equal(p.allows("/search?s=x"), false); assert.equal(p.allows("/file.pdf"), false);
  assert.equal(p.allows("/file.pdfx"), true); assert.equal(p.allows("/page"), true);
});
test("R-12 longest-match wins; exact tie → Allow", () => {
  const p = parseRobots("User-agent: *\nDisallow: /a/\nAllow: /a/b", O);
  assert.equal(p.allows("/a/b"), true); assert.equal(p.allows("/a/c"), false);
  const q = parseRobots("User-agent: *\nDisallow: /x\nAllow: /x", O);
  assert.equal(q.allows("/x"), true);
});
test("R-13 Crawl-delay applied as-is (#15)", () => {
  assert.equal(parseRobots("User-agent: *\nCrawl-delay: 10", O).crawlDelayMs, 10000);
});
test("R-14 multiple Sitemap lines incl cross-host", () => {
  const p = parseRobots(`Sitemap: ${O}/sitemap.xml\nSitemap: https://cdn.other.com/s.xml\nUser-agent: *\nDisallow:`, O);
  assert.equal(p.sitemaps.length, 2); assert.ok(p.sitemaps.includes("https://cdn.other.com/s.xml"));
});
test("R-15 relative Sitemap resolved against origin", () => {
  const p = parseRobots("Sitemap: /sitemap.xml\nUser-agent: *\nDisallow:", O);
  assert.equal(p.sitemaps[0], O + "/sitemap.xml");
});
test("R-16 BOM/CRLF/comments/blank lines tolerated", () => {
  const p = parseRobots("﻿# hello\r\nUser-agent: *\r\n\r\nDisallow: /x # trailing\r\n", O);
  assert.equal(p.allows("/x/y"), false);
});
test("R-17 unknown directives ignored", () => {
  const p = parseRobots("User-agent: *\nHost: example.com\nNoindex: /x\nDisallow: /y", O);
  assert.equal(p.allows("/x"), true); assert.equal(p.allows("/y"), false);
});
test("R-18 >500KB → parse prefix + truncated note", () => {
  const big = "User-agent: *\nDisallow: /z\n" + "# pad\n".repeat(120000);
  const p = parseRobots(big, O);
  assert.ok(p.notes.includes("truncated")); assert.equal(p.allows("/z/a"), false);
});
test("R-19 non-UTF-8 replacement chars keep parsing", () => {
  const p = parseRobots("User-agent: *\nDisallow: /caf�\nDisallow: /y", O);
  assert.equal(p.allows("/y"), false);
});
test("R-20 octet-stream but valid text → parsed anyway", async () => {
  const p = await fetchRobots(tx({ [O + "/robots.txt"]: { status: 200, headers: { "content-type": "application/octet-stream" }, body: "User-agent: *\nDisallow: /q" } }), O);
  assert.equal(p.source, "parsed"); assert.equal(p.allows("/q/x"), false);
});
