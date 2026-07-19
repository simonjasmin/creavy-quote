import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/crawl/scan.ts";
import { FakeTransport, FakeClock, syntheticScenario, type Scenario } from "./helpers/replay.ts";

const clock = () => new FakeClock();
const run = (scenario: Scenario, url: string) => scan(new FakeTransport(scenario), clock(), url);

const wpHome = (links: string[]) =>
  `<html><head><link rel="stylesheet" href="/wp-content/themes/x/style.css"></head><body>${links.map((l) => `<a href="${l}">x</a>`).join("")}</body></html>`;
const urlset = (locs: string[]) => `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const ok = (locs: string[]): Scenario => Object.fromEntries(locs.map((l) => [l, { status: 200, body: "ok" }]));

test("scan: happy path with sitemap → #8 object (core, platform)", async () => {
  const O = "https://plomber.example";
  const locs = [O + "/", O + "/services", O + "/contact"];
  const scenario: Scenario = {
    ...ok(locs), // stale-verify targets first, so the real homepage below is not overwritten
    [O + "/"]: { status: 200, body: wpHome(["/services", "/contact"]) },
    ["https://www.plomber.example/"]: { status: 404 },
    [O + "/robots.txt"]: { status: 200, body: `User-agent: *\nDisallow:\nSitemap: ${O}/sitemap.xml` },
    [O + "/sitemap.xml"]: { status: 200, body: urlset(locs) },
  };
  const r = await run(scenario, "plomber.example");
  assert.equal(r.canonical_origin, O);
  assert.equal(r.core_pages, 3);
  assert.equal(r.detected_platform, "wordpress");
  assert.equal(r.needs_browser, false);
});

test("scan: robots Disallow:/ → robots_blocked, homepage only", async () => {
  const O = "https://blocked.example";
  const scenario: Scenario = {
    [O + "/"]: { status: 200, body: wpHome(["/a", "/b"]) },
    ["https://www.blocked.example/"]: { status: 404 },
    [O + "/robots.txt"]: { status: 200, body: "User-agent: *\nDisallow: /" },
  };
  const r = await run(scenario, "blocked.example");
  assert.equal(r.core_pages, 1);
  assert.ok(r.review_flags.includes("robots_blocked"));
});

test("scan: sitemap-less → link-crawl fallback (homepage nav)", async () => {
  const O = "https://nomap.example";
  const scenario: Scenario = {
    [O + "/"]: { status: 200, body: wpHome(["/services", "/about", "/contact"]) },
    ["https://www.nomap.example/"]: { status: 404 },
    [O + "/robots.txt"]: { status: 404 },
  };
  const r = await run(scenario, "nomap.example");
  assert.equal(r.core_pages, 4); // homepage + 3 nav
  assert.ok(r.review_flags.includes("sitemap_absent"));
});

test("scan: bilingual fr/en sitemap → bilingual_mirror + languages, one core per pair", async () => {
  const O = "https://bili.example";
  const locs = [O + "/fr/services", O + "/en/services", O + "/fr/apropos", O + "/en/apropos"];
  const scenario: Scenario = {
    [O + "/"]: { status: 200, body: wpHome(["/fr/services"]) },
    ["https://www.bili.example/"]: { status: 404 },
    [O + "/robots.txt"]: { status: 200, body: `User-agent: *\nDisallow:\nSitemap: ${O}/sitemap.xml` },
    [O + "/sitemap.xml"]: { status: 200, body: urlset(locs) },
    ...ok(locs),
  };
  const r = await run(scenario, "bili.example");
  assert.equal(r.bilingual_mirror, true);
  assert.deepEqual(r.languages, ["en", "fr"]);
  assert.equal(r.core_pages, 2);
});

test("scan: DNS NXDOMAIN → nxdomain_greenfield (no site)", async () => {
  const r = await run({ "https://gone.example/": { error: { kind: "dns" } } }, "gone.example");
  assert.ok(r.review_flags.includes("nxdomain_greenfield"));
  assert.equal(r.detected_platform, "none");
});

test("scan: parked domain (synthetic fixture) → parked, no platform", async () => {
  const { scenario } = syntheticScenario("parked");
  const r = await run(scenario, "parked.example");
  assert.ok(r.review_flags.includes("parked"));
  assert.equal(r.core_pages, 0);
});

test("scan: SPA shell (synthetic fixture) → needs_browser spa_shell", async () => {
  const { scenario } = syntheticScenario("spa-shell");
  const r = await run(scenario, "spa.example");
  assert.equal(r.needs_browser, true);
  assert.ok(r.needs_browser_reasons.includes("spa_shell"));
});

test("scan: social URL → no_owned_site short-circuit", async () => {
  const r = await run({}, "facebook.com/plomberie-xyz");
  assert.ok(r.review_flags.includes("no_owned_site"));
});
