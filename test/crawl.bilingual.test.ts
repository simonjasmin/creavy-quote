import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLang } from "../src/crawl/langDetect.ts";
import { inferRootLang } from "../src/crawl/langDetect.ts";
import { pairBilingual, resolveBilingual, extractHeadHreflang } from "../src/crawl/bilingual.ts";
import { normalize } from "../src/url/normalize.ts";

const TH = { tree_lang_purity: 0.8, min_tree_pages: 3, min_size_ratio: 0.5 };
const O = "https://x.example";
const FR = "Bonjour, nous sommes votre plombier à Montréal. Nos services de plomberie et chauffage pour votre maison. Réservez dès aujourd'hui, contactez-nous.";
const EN = "Hello, we are your plumber in Montreal. Our plumbing and heating services for your home. Book today and contact us for a free quote.";
const langMap = (pairs: [string, string][]) => Object.fromEntries(pairs.map(([u, l]) => [normalize(u).ok ? (normalize(u) as any).identity : u, l]));

// ---- langDetect ----
test("langDetect: fr / en / unknown", () => {
  assert.equal(detectLang(FR), "fr");
  assert.equal(detectLang(EN), "en");
  assert.equal(detectLang("123 456 789"), "unknown");
});
test("S-29 content detection overrides a wrong <html lang>", () => {
  const html = `<html lang="en-US"><body><p>${FR}</p></body></html>`; // WP theme lies; content is French
  assert.equal(inferRootLang(html), "fr");
});

// ---- path rung (S-25..S-28) ----
test("S-25 root-fr + /en/ path pairs → mirror", () => {
  const urls = [O + "/", O + "/services", O + "/about", O + "/en", O + "/en/services", O + "/en/about"];
  const r = pairBilingual(urls, "fr");
  assert.equal(r.bilingual_mirror, true); assert.deepEqual(r.languages, ["en", "fr"]);
});
test("S-26 root-en + /fr/ path pairs → mirror (nothing assumes French)", () => {
  const urls = [O + "/", O + "/services", O + "/about", O + "/fr", O + "/fr/services", O + "/fr/about"];
  const r = pairBilingual(urls, "en");
  assert.equal(r.bilingual_mirror, true); assert.deepEqual(r.languages, ["en", "fr"]);
});
test("S-27 same-language twin (root-en + /en/) refuses to pair", () => {
  const urls = [O + "/", O + "/services", O + "/en", O + "/en/services"];
  const r = pairBilingual(urls, "en"); // both trees English → no language difference
  assert.equal(r.bilingual_mirror, false);
});
test("S-28 partial translation → suspected", () => {
  // fr homepage + subpages, only 2 en subpages, NO en homepage → path homepage unpaired,
  // en tree below min → neither path nor tree mirror → suspected.
  const urls = [O + "/", O + "/services", O + "/about", O + "/en/services", O + "/en/about"];
  const r = resolveBilingual(urls, { rootLang: "fr", thresholds: TH });
  assert.equal(r.bilingual_mirror, false); assert.equal(r.suspected, true);
});

// ---- tree rung (S-30..S-33) ----
test("S-30 translated-slug tree-pair positive (no hreflang) → mirror via tree", () => {
  const fr = [O + "/", O + "/accueil", O + "/plomberie", O + "/contactez-nous"];
  const en = [O + "/en", O + "/en/home", O + "/en/plumbing", O + "/en/contact-us"];
  const r = resolveBilingual([...fr, ...en], { rootLang: "fr", thresholds: TH });
  assert.equal(r.bilingual_mirror, true); assert.equal(r.pairing_evidence, "tree");
});
test("S-31 /en/ stub of 2 vs 15 stays suspected", () => {
  const fr = Array.from({ length: 15 }, (_, i) => `${O}/p${i}`);
  const en = [O + "/en", O + "/en/x"];
  const r = resolveBilingual([...fr, ...en], { rootLang: "fr", thresholds: TH });
  assert.equal(r.bilingual_mirror, false); assert.equal(r.suspected, true);
});
test("S-32 same-language twin trees refuse (tree rung, content-guarded)", () => {
  const a = Array.from({ length: 4 }, (_, i) => `${O}/a${i}`);
  const b = Array.from({ length: 4 }, (_, i) => `${O}/en/b${i}`);
  // both trees detect EN → purity guard on the root(fr-claimed) tree fails
  const sampled = langMap([...a.map((u) => [u, "en"] as [string, string]), ...b.map((u) => [u, "en"] as [string, string])]);
  const r = resolveBilingual([...a, ...b], { rootLang: "fr", sampledLangByUrl: sampled, thresholds: TH });
  assert.equal(r.bilingual_mirror, false);
});
test("S-33 size mismatch (4 vs 15) refuses", () => {
  const fr = Array.from({ length: 15 }, (_, i) => `${O}/p${i}`);
  const en = Array.from({ length: 4 }, (_, i) => `${O}/en/q${i}`);
  const r = resolveBilingual([...fr, ...en], { rootLang: "fr", thresholds: TH });
  assert.equal(r.bilingual_mirror, false); assert.equal(r.suspected, true); // ratio 4/15 < 0.5
});

// ---- hreflang rung (S-34) ----
test("S-34 hreflang page-pairing positive → mirror via hreflang", () => {
  const groups = [[{ lang: "fr", url: O + "/services" }, { lang: "en", url: O + "/en/plumbing" }]];
  const r = resolveBilingual([O + "/services", O + "/en/plumbing"], { hreflangGroups: groups as any, thresholds: TH });
  assert.equal(r.bilingual_mirror, true); assert.equal(r.pairing_evidence, "hreflang");
});
test("extractHeadHreflang pulls fr/en, ignores x-default", () => {
  const html = `<link rel="alternate" hreflang="fr" href="${O}/"><link rel="alternate" hreflang="en" href="${O}/en"><link rel="alternate" hreflang="x-default" href="${O}/">`;
  const g = extractHeadHreflang(html);
  assert.equal(g.length, 2); assert.deepEqual(g.map((x) => x.lang).sort(), ["en", "fr"]);
});
