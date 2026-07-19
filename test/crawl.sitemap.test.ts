import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { parseSitemap, classifyLoc, childHint, crawlSitemaps } from "../src/crawl/sitemap.ts";
import { FakeTransport, type Scenario } from "./helpers/replay.ts";

const O = "https://x.example";
const urlset = (locs: string[]) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const index = (kids: string[]) => `<?xml version="1.0"?><sitemapindex>${kids.map((k) => `<sitemap><loc>${k}</loc></sitemap>`).join("")}</sitemapindex>`;
const ok200 = (locs: string[]): Scenario => Object.fromEntries(locs.map((l) => [l, { status: 200, body: "<html>ok</html>" }]));

// ---- pure parse/classify ----
test("S-03 plain urlset with N locs", () => {
  const p = parseSitemap({ body: urlset([O + "/a", O + "/b", O + "/c"]) }, O + "/sitemap.xml");
  assert.equal(p.type, "urlset"); assert.equal(p.locs.length, 3);
});
test("S-07 sitemap URL returns HTML → unparseable", () => {
  assert.equal(parseSitemap({ body: "<!doctype html><html>404</html>" }, O + "/sitemap.xml").type, "unparseable");
});
test("S-08 gzip body (with + without header) decompresses", () => {
  const gz = gzipSync(Buffer.from(urlset([O + "/a"])));
  const withHdr = parseSitemap({ body: gz.toString("latin1"), bytes: new Uint8Array(gz), contentEncoding: "gzip" }, O + "/sitemap.xml");
  const noHdr = parseSitemap({ body: gz.toString("latin1"), bytes: new Uint8Array(gz) }, O + "/sitemap.xml.gz");
  assert.deepEqual(withHdr.locs, [O + "/a"]); assert.deepEqual(noHdr.locs, [O + "/a"]);
});
test("S-09 malformed XML (unclosed container) → tolerant loc extraction; zero locs → unparseable", () => {
  // unclosed <urlset> mid-file, complete <loc>s → both extracted
  assert.equal(parseSitemap({ body: `<urlset><url><loc>${O}/a</loc></url><url><loc>${O}/b</loc></url>` }, O + "/s.xml").locs.length, 2);
  assert.equal(parseSitemap({ body: "<urlset></urlset>" }, O + "/s.xml").type, "unparseable");
});
test("S-10 missing/wrong xmlns → parse anyway", () => {
  assert.equal(parseSitemap({ body: "<urlset><url><loc>" + O + "/a</loc></url></urlset>" }, O + "/s.xml").locs.length, 1);
});
test("S-11 <loc> whitespace / CDATA unwrapped", () => {
  const p = parseSitemap({ body: `<urlset><url><loc>  <![CDATA[${O}/a]]>\n</loc></url></urlset>` }, O + "/s.xml");
  assert.deepEqual(p.locs, [O + "/a"]);
});
test("S-12 &amp; decoded once", () => {
  const p = parseSitemap({ body: `<urlset><url><loc>${O}/a?x=1&amp;y=2</loc></url></urlset>` }, O + "/s.xml");
  assert.equal(p.locs[0], O + "/a?x=1&y=2");
});
test("S-13 relative loc resolved against sitemap URL", () => {
  const p = parseSitemap({ body: "<urlset><url><loc>/page</loc></url></urlset>" }, O + "/sub/sitemap.xml");
  assert.equal(p.locs[0], O + "/page");
});
test("S-17/S-18 classification by URL + child hint", () => {
  assert.equal(childHint("wp-sitemap-posts-page-1.xml"), "core");
  assert.equal(childHint("wp-sitemap-posts-post-1.xml"), "blog");
  assert.equal(childHint("wp-sitemap-taxonomies-category-1.xml"), "archive");
  assert.equal(childHint("page-sitemap.xml"), "core");
  assert.equal(childHint("post-sitemap.xml"), "blog");
  assert.equal(childHint("category-sitemap.xml"), "archive");
  assert.equal(classifyLoc(O + "/about"), "core");
  assert.equal(classifyLoc(O + "/category/news/"), "archive");
  assert.equal(classifyLoc(O + "/2024/05/my-post"), "blog");
});
test("S-19 media/attachment → media", () => {
  assert.equal(classifyLoc(O + "/wp-content/uploads/2024/img.jpg"), "media");
  assert.equal(classifyLoc(O + "/?attachment_id=42"), "media");
});
test("S-21 garbage lastmod ignored, never crashes", () => {
  const p = parseSitemap({ body: `<urlset><url><loc>${O}/a</loc><lastmod>0000-00-00</lastmod></url></urlset>` }, O + "/s.xml");
  assert.deepEqual(p.locs, [O + "/a"]);
});
test("S-24 XML entity bomb → no expansion, locs still extracted, fast", () => {
  const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><urlset><url><loc>${O}/a</loc></url></urlset>`;
  const t0 = performance.now();
  const p = parseSitemap({ body: bomb }, O + "/s.xml");
  assert.deepEqual(p.locs, [O + "/a"]); assert.ok(performance.now() - t0 < 50);
});

// ---- orchestration ----
test("S-01 discovery order: robots sitemap first", async () => {
  const locs = [O + "/", O + "/services"];
  const tx = new FakeTransport({ [O + "/robots-sm.xml"]: { body: urlset(locs) }, ...ok200(locs) });
  const r = await crawlSitemaps(tx, O, [O + "/robots-sm.xml"]);
  assert.equal(r.found, true); assert.equal(r.core.length, 2);
});
test("S-02 nothing found → sitemap_absent", async () => {
  const tx = new FakeTransport({}); // all 404
  const r = await crawlSitemaps(tx, O, []);
  assert.equal(r.found, false); assert.ok(r.review_flags.includes("sitemap_absent"));
});
test("S-04 index with 6 children → fetch 5, partial + capped", async () => {
  const kids = Array.from({ length: 6 }, (_, i) => `${O}/child-${i}.xml`);
  const scen: Scenario = { [O + "/sitemap.xml"]: { body: index(kids) } };
  const coreLocs: string[] = [];
  kids.slice(0, 5).forEach((k, i) => { const loc = `${O}/p${i}`; coreLocs.push(loc); scen[k] = { body: urlset([loc]) }; });
  Object.assign(scen, ok200(coreLocs));
  const r = await crawlSitemaps(new FakeTransport(scen), O, []);
  assert.equal(r.core.length, 5); assert.equal(r.partial, true); assert.ok(r.review_flags.includes("sitemap_children_capped"));
});
test("S-05 index with 40 children → 30+ overflow", async () => {
  const kids = Array.from({ length: 40 }, (_, i) => `${O}/c${i}.xml`);
  const r = await crawlSitemaps(new FakeTransport({ [O + "/sitemap.xml"]: { body: index(kids) } }), O, []);
  assert.equal(r.overflow, true); assert.ok(r.review_flags.includes("out_of_icp_scope"));
});
test("S-06 robots-listed sitemap 404 → fall through + note", async () => {
  const scen: Scenario = { [O + "/robots-sm.xml"]: { status: 404 }, [O + "/sitemap.xml"]: { body: urlset([O + "/a"]) }, ...ok200([O + "/a"]) };
  const r = await crawlSitemaps(new FakeTransport(scen), O, [O + "/robots-sm.xml"]);
  assert.equal(r.found, true); assert.ok(r.review_flags.includes("stale_robots_sitemap"));
});
test("S-14/S-16 dedupe identity-equal locs (tracking/slash/fragment)", async () => {
  const locs = [O + "/a", O + "/a/", O + "/a?utm_source=x", O + "/a#top"];
  const r = await crawlSitemaps(new FakeTransport({ [O + "/sitemap.xml"]: { body: urlset(locs) }, ...ok200([O + "/a"]) }), O, []);
  assert.equal(r.core.length, 1);
});
test("S-15 majority off-domain → distrust", async () => {
  const locs = [O + "/a", "https://other.com/b", "https://other.com/c"];
  const r = await crawlSitemaps(new FakeTransport({ [O + "/sitemap.xml"]: { body: urlset(locs) } }), O, []);
  assert.ok(r.review_flags.includes("sitemap_off_domain_distrust"));
});
test("S-20 stale sitemap: >30% non-200 → distrust + stale_sitemap", async () => {
  const locs = [O + "/a", O + "/b", O + "/c", O + "/d"]; // 2 of 4 will 404 = 50%
  const scen: Scenario = { [O + "/sitemap.xml"]: { body: urlset(locs) }, [O + "/a"]: { status: 200, body: "x" }, [O + "/b"]: { status: 200, body: "x" }, [O + "/c"]: { status: 404 }, [O + "/d"]: { status: 404 } };
  const r = await crawlSitemaps(new FakeTransport(scen), O, []);
  assert.ok(r.review_flags.includes("stale_sitemap")); assert.equal(r.found, false);
});
test("S-22 fr/en mirror → bilingual_mirror, one core per pair", async () => {
  const locs = [O + "/fr/services", O + "/en/services", O + "/fr/about", O + "/en/about"];
  const r = await crawlSitemaps(new FakeTransport({ [O + "/sitemap.xml"]: { body: urlset(locs) }, ...ok200(locs) }), O, []);
  assert.equal(r.bilingual_mirror, true); assert.deepEqual(r.languages, ["en", "fr"]); assert.equal(r.core.length, 2);
});
test("S-23 huge sitemap → 30+ short-circuit", async () => {
  const locs = Array.from({ length: 35 }, (_, i) => `${O}/p${i}`);
  const r = await crawlSitemaps(new FakeTransport({ [O + "/sitemap.xml"]: { body: urlset(locs) } }), O, []);
  assert.equal(r.overflow, true);
});
