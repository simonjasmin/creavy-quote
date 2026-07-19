import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  extractLinks, classifyLink, countFromLinks, isSoft404, detectParked, detectUnderConstruction,
  isAntiBot, noHtmlContentType, escalationReasons, capHtml, classifyTransportError, decodeBody,
} from "../src/crawl/bounder.ts";
import { listCorpusSlugs, readManifest } from "./helpers/replay.ts";

const O = "https://x.example";
const H = O + "/";
const a = (href: string, t = "x") => `<a href="${href}">${t}</a>`;

test("D-09 one-pager: nav all #anchors → core_pages 1", () => {
  const r = countFromLinks(H, `<html>${a("#services")}${a("#contact")}</html>`, O);
  assert.equal(r.core_pages, 1);
});
test("D-10 nav pages counted; tel/mailto are contact signals, never pages", () => {
  const html = `<html>${a("/p1")}${a("/p2")}${a("/p3")}${a("/p4")}${a("mailto:h@x.ca")}${a("tel:+15145551212")}</html>`;
  const r = countFromLinks(H, html, O);
  assert.equal(r.core_pages, 5); // homepage + 4
  assert.equal(r.contact.tel, true); assert.equal(r.contact.mailto, true);
});
test("D-11 relative/../ and off-origin classification", () => {
  assert.equal(classifyLink(O + "/services", O), "core");
  assert.equal(classifyLink("https://other.com/y", O), "external");
});
test("D-12 <base href> resolves links against base", () => {
  const { links } = extractLinks(`<html><head><base href="${O}/sub/"></head><body>${a("page.html")}</body></html>`, "https://ignored.example/");
  assert.ok(links.includes(O + "/sub/page.html"));
});
test("D-13 unencoded space in href → encoded once", () => {
  const { links } = extractLinks(a("/nos services.html"), H);
  assert.ok(links.includes(O + "/nos%20services.html"));
});
test("D-14 rel=canonical surfaced", () => {
  const { canonical } = extractLinks(`<link rel="canonical" href="${O}/real">`, H);
  assert.equal(canonical, O + "/real");
});
test("D-15 cross-host canonical → platform_canonical review", () => {
  const r = countFromLinks(H, `<link rel="canonical" href="https://other.com/real">`, O);
  assert.ok(r.review_flags.includes("platform_canonical"));
});
test("D-16 fr/en mirrored trees via crawl → pair-dedup", () => {
  // #26: a genuine mirror pairs the HOMEPAGE too — include both /fr/ and /en/ roots.
  const html = `<html>${a("/en")}${a("/fr/services")}${a("/en/services")}${a("/fr/apropos")}${a("/en/apropos")}</html>`;
  const r = countFromLinks(O + "/fr/", html, O, "fr");
  assert.equal(r.bilingual_mirror, true); assert.deepEqual(r.languages, ["en", "fr"]);
});
test("D-17 archives (blog/page, category, author, date)", () => {
  for (const p of ["/blog/page/2", "/category/news/", "/author/jane/", "/2024/05/"]) assert.equal(classifyLink(O + p, O), "archive");
});
test("D-18 soft-404 markers (FR + EN)", () => {
  assert.equal(isSoft404("<title>Page non trouvée</title>"), true);
  assert.equal(isSoft404("<title>Page not found</title>"), true);
  assert.equal(isSoft404("<title>Accueil | Plomberie</title><body>Bienvenue</body>"), false);
});
test("D-19 traps (?month=, PHPSESSID, >2 query params)", () => {
  assert.equal(classifyLink(O + "/cal?month=5", O), "trap");
  assert.equal(classifyLink(O + "/x?PHPSESSID=abc", O), "trap");
  assert.equal(classifyLink(O + "/x?a=1&b=2&c=3", O), "trap");
});
test("D-20 subdomain link → related_property", () => {
  assert.equal(classifyLink("https://blog.x.example/post", O), "related_property");
});
test("D-21 frontier beyond cap → partial", () => {
  const links = Array.from({ length: 61 }, (_, i) => a(`/p${i}`)).join("");
  const r = countFromLinks(H, `<html>${links}</html>`, O);
  assert.equal(r.partial, true);
});
test("D-22 spa_shell escalation", () => {
  assert.deepEqual(escalationReasons(`<html><body><div id="root"></div><script src="/b.js"></script></body></html>`), ["spa_shell"]);
});
test("D-23 no_links_found escalation (scripts, no <a>, no sitemap)", () => {
  assert.deepEqual(escalationReasons(`<html><body><button onclick="go()">x</button><script src="/b.js"></script></body></html>`, false), ["no_links_found"]);
});
test("D-24 anti-bot challenge detected", () => {
  assert.equal(isAntiBot("<title>Just a moment...</title><div class='cf-browser-verification'>"), true);
});
test("D-25 real Wix/Squarespace/GoDaddy fixtures do NOT escalate", () => {
  const targets = ["wix", "squarespace"];
  let checked = 0;
  for (const slug of listCorpusSlugs()) {
    const gt = readManifest(slug).ground_truth;
    if (!targets.includes(gt.platform)) continue;
    const html = readFileSync(`fixtures/sites/${slug}/root.html`, "utf8");
    assert.deepEqual(escalationReasons(html, true), [], `${slug} (${gt.platform}) must not escalate`);
    checked++;
  }
  assert.ok(checked >= 2, "should check ≥2 SSR builder fixtures");
});
test("D-26/D-32 transport error classification", () => {
  assert.equal(classifyTransportError("tls").flag, "tls_invalid");
  assert.deepEqual(classifyTransportError("dns"), { flag: "nxdomain_greenfield", greenfield: true });
  assert.equal(classifyTransportError("refused").flag, "host_down");
  assert.equal(classifyTransportError("timeout").flag, "slow_host");
});
test("D-27 windows-1252 charset decodes accents", () => {
  const bytes = new Uint8Array([0xC9, 0x6C, 0x65, 0x63, 0x74, 0x72, 0x69, 0x63, 0x69, 0x74, 0xE9]); // "Électricité"
  assert.equal(decodeBody(bytes, "windows-1252"), "Électricité");
});
test("D-28 PDF/image content-type → no_html", () => {
  assert.equal(noHtmlContentType({ "content-type": "application/pdf" }), true);
  assert.equal(noHtmlContentType({ "content-type": "image/jpeg" }), true);
  assert.equal(noHtmlContentType({ "content-type": "text/html" }), false);
});
test("D-29 parked domain detected", () => { assert.equal(detectParked("<h1>This domain is for sale</h1>"), true); });
test("D-30 under-construction detected", () => { assert.equal(detectUnderConstruction("<h1>Site en construction</h1>"), true); });
test("D-31 5MB HTML → capped to 2MB + truncated", () => {
  const big = "<html>" + "x".repeat(5 * 1024 * 1024) + "</html>";
  const c = capHtml(big);
  assert.equal(c.truncated, true); assert.ok(c.html.length <= 2 * 1024 * 1024);
});
