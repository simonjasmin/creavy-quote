import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractPageContent } from "../src/crawl/pageContent.ts";
import { decodeBody } from "../src/crawl/bounder.ts";
import { scan } from "../src/crawl/scan.ts";
import { assessable } from "../src/assess/assessable.ts";
import { FakeTransport, FakeClock, type Scenario } from "./helpers/replay.ts";

// #32 A1 — Option-C content retention (CT-01…CT-06). Extractor is pure; scan-side
// retention is replayed through the fake transport (zero network). CT-06 is the
// full-core-coverage guarantee, gated by the single assessable() predicate.

const wpHead = `<link rel="stylesheet" href="/wp-content/themes/x/style.css">`;
const page = (title: string, body: string, wp = false) =>
  `<html><head><title>${title}</title>${wp ? wpHead : ""}</head><body>${body}</body></html>`;
const urlset = (locs: string[]) => `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

// ---- CT-01 script/style bodies excluded from retained text ----
test("CT-01 script + style content excluded from retained text", () => {
  const html = page("T", `<style>.x{color:crimson}</style><script>var SECRET_TOKEN=42;</script><h1>Toiture</h1><p>Réfection de toiture à Québec</p>`);
  const pc = extractPageContent("https://x.example/", html);
  assert.ok(pc.text.includes("Réfection de toiture à Québec"), "visible text kept");
  assert.ok(!/SECRET_TOKEN/.test(pc.text), "script body excluded from text");
  assert.ok(!/crimson/.test(pc.text), "style body excluded from text");
});

// ---- CT-02 title + h1–h3 captured, deeper headings ignored ----
test("CT-02 title + h1–h3 headings captured (h4 ignored)", () => {
  const html = page("Toitures MP — Accueil", `<h1>Nos services</h1><h2>Toiture résidentielle</h2><h3>Bardeaux</h3><h4>ignore-moi</h4>`);
  const pc = extractPageContent("https://x.example/", html);
  assert.equal(pc.title, "Toitures MP — Accueil");
  assert.deepEqual(pc.headings, ["Nos services", "Toiture résidentielle", "Bardeaux"]);
});

// ---- CT-03 charset survival — é intact through extraction (reuse the D-27 path) ----
test("CT-03 charset survival — é intact in title/headings/text (D-27 fixture)", () => {
  const bytes = new Uint8Array([0xC9, 0x6C, 0x65, 0x63, 0x74, 0x72, 0x69, 0x63, 0x69, 0x74, 0xE9]); // "Électricité" windows-1252
  const word = decodeBody(bytes, "windows-1252");
  assert.equal(word, "Électricité"); // D-27 invariant holds before we extract
  const pc = extractPageContent("https://x.example/", page(word, `<h1>${word}</h1><p>${word} générale à Montréal</p>`));
  assert.equal(pc.title, "Électricité");
  assert.ok(pc.headings.includes("Électricité"));
  assert.ok(pc.text.includes("Électricité générale"), "accents survive into visible text");
});

// ---- CT-04 retention on the sitemap path — content for every core page ----
test("CT-04 retention on the sitemap path — one content entry per core page", async () => {
  const O = "https://roof.example";
  const locs = [O + "/", O + "/services", O + "/contact"];
  const scenario: Scenario = {
    [O + "/"]: { status: 200, body: page("Accueil", `<h1>Plomberie</h1><p>Contenu Accueil</p><a href="/services">s</a>`, true) },
    [O + "/services"]: { status: 200, body: page("Services", `<h1>Services</h1><p>Contenu Services à Québec</p>`) },
    [O + "/contact"]: { status: 200, body: page("Contact", `<h1>Contact</h1><p>Contenu Contact</p>`) },
    ["https://www.roof.example/"]: { status: 404 },
    [O + "/robots.txt"]: { status: 200, body: `User-agent: *\nDisallow:\nSitemap: ${O}/sitemap.xml` },
    [O + "/sitemap.xml"]: { status: 200, body: urlset(locs) },
  };
  const r = await scan(new FakeTransport(scenario), new FakeClock(), "roof.example");
  assert.equal(r.core_pages, 3);
  assert.equal(r.page_content.length, 3);
  assert.ok(r.page_content.every((p) => p.text.length > 0 && p.title.length > 0), "each retained page carries text + title");
  assert.deepEqual(r.page_content.map((p) => p.title).sort(), ["Accueil", "Contact", "Services"]);
});

// ---- CT-05 retention on the link-crawl path — homepage-only (documented limit) ----
test("CT-05 retention on the link-crawl path — homepage content retained", async () => {
  const O = "https://nomap.example";
  const home = page("Accueil Plomberie", `<h1>Plomberie XYZ</h1><p>Service de plomberie à Laval</p><a href="/services">s</a><a href="/contact">c</a>`, true);
  const scenario: Scenario = {
    [O + "/"]: { status: 200, body: home },
    ["https://www.nomap.example/"]: { status: 404 },
    [O + "/robots.txt"]: { status: 404 },
  };
  const r = await scan(new FakeTransport(scenario), new FakeClock(), "nomap.example");
  assert.ok(r.review_flags.includes("sitemap_absent"), "link-crawl path taken");
  assert.equal(r.core_pages, 3); // homepage + 2 nav links counted…
  assert.equal(r.page_content.length, 1, "…but only the homepage is fetched, so only it is retained");
  assert.equal(r.page_content[0].title, "Accueil Plomberie");
  assert.ok(r.page_content[0].text.includes("plomberie à Laval"));
});

// ---- CT-06 the guarantee: assessable ⇒ full core-page content coverage ----
// Property-style over a real golden + synthetics. Sitemap-path assessable scans get
// 100 % core-page coverage (bilingual pairs collapsed in core_pages, ≥1 member kept);
// the link-crawl path retains the homepage only (fetched-only — surfaced, not hidden).
const biLocs = (O: string) => [O + "/fr/services", O + "/en/services", O + "/fr/contact", O + "/en/contact"];
const bilingualScenario = (): { input: string; scenario: Scenario } => {
  const O = "https://bili.example";
  const locs = biLocs(O);
  return {
    input: "bili.example",
    scenario: {
      [O + "/"]: { status: 200, body: page("Accueil", `<h1>Accueil</h1><p>Bienvenue</p><a href="/fr/services">s</a>`, true) },
      ["https://www.bili.example/"]: { status: 404 },
      [O + "/robots.txt"]: { status: 200, body: `User-agent: *\nDisallow:\nSitemap: ${O}/sitemap.xml` },
      [O + "/sitemap.xml"]: { status: 200, body: urlset(locs) },
      [O + "/fr/services"]: { status: 200, body: page("Services", `<h1>Services</h1><p>Nos services à Québec</p>`) },
      [O + "/en/services"]: { status: 200, body: page("Services", `<h1>Services</h1><p>Our services in Quebec City</p>`) },
      [O + "/fr/contact"]: { status: 200, body: page("Contact", `<h1>Contact</h1><p>Nous joindre</p>`) },
      [O + "/en/contact"]: { status: 200, body: page("Contact", `<h1>Contact</h1><p>Reach us</p>`) },
    },
  };
};

test("CT-06 coverage guarantee — assessable ⇒ every fetched core page has content", async () => {
  const cases: { name: string; input: string; scenario: Scenario }[] = [];

  // real goldens (most are non-assessable ≥7/30+ → predicate must SKIP them)
  const goldenInputs: Record<string, string> = {
    toituresmarcelpouliot: "http://toituresmarcelpouliot.com/", // assessable (4 core)
    lasouche: "https://lasouche.ca/", // 12 core → skipped
    protectoit: "https://www.protectoit.com/", // 27 core → skipped
  };
  for (const [slug, input] of Object.entries(goldenInputs)) {
    const p = join("fixtures/golden", slug, "scenario.json");
    if (existsSync(p)) cases.push({ name: `golden:${slug}`, input, scenario: JSON.parse(readFileSync(p, "utf8")) });
  }
  // synthetics
  cases.push({ name: "syn:bilingual", ...bilingualScenario() });
  cases.push({
    name: "syn:link-crawl", input: "small.example",
    scenario: {
      ["https://small.example/"]: { status: 200, body: page("Accueil", `<h1>X</h1><p>Petit site</p><a href="/a">a</a>`, true) },
      ["https://www.small.example/"]: { status: 404 },
      ["https://small.example/robots.txt"]: { status: 404 },
    },
  });

  let assessedCount = 0, skippedCount = 0;
  for (const c of cases) {
    const r = await scan(new FakeTransport(c.scenario), new FakeClock(), c.input);
    if (!assessable(r)) { skippedCount++; continue; }
    assessedCount++;
    // every assessable scan retains content, and every retained page carries text
    assert.ok(r.page_content.length > 0, `${c.name}: content retained`);
    assert.ok(r.page_content.every((p) => p.text.length > 0), `${c.name}: every retained page has text`);
    // homepage is always covered (dedupContent prepends it, homepage-first)
    assert.ok(r.page_content[0].text.length > 0, `${c.name}: homepage covered (first entry)`);
    // the guarantee: sitemap path ⇒ 100 % core-page coverage; link-crawl ⇒ homepage-only (fetched-only)
    if (r.review_flags.includes("sitemap_absent")) {
      assert.equal(r.page_content.length, 1, `${c.name}: link-crawl retains the homepage only`);
    } else {
      assert.ok(r.page_content.length >= (r.core_pages as number), `${c.name}: full core coverage (${r.page_content.length} ≥ ${r.core_pages})`);
    }
  }
  assert.ok(assessedCount >= 3, `at least the assessable golden + 2 synthetics exercised (got ${assessedCount})`);
  assert.ok(skippedCount >= 2, `predicate skips non-assessable goldens (got ${skippedCount})`);
});
