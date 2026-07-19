import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scan } from "../src/crawl/scan.ts";
import { FakeTransport, FakeClock, type Scenario } from "./helpers/replay.ts";

// Golden = real full-crawl fixtures captured by spikes/harvest-golden.mjs. scan()
// is replayed through the fake transport (zero network) and asserted against
// independently-verified invariants + the captured deterministic result.
// Verified by inspecting each site's captured sitemap/homepage (rider-c rule:
// assert only what the fixture evidence supports).
const GOLDEN: Record<string, { input: string; platform: string; needs_browser: boolean; bilingual?: string; check?: (r: any) => void }> = {
  lasouche: { input: "https://lasouche.ca/", platform: "wordpress", needs_browser: false, check: (r) => assert.ok(r.blog_posts >= 20, "blog-heavy: >=20 posts") },
  paysagesgenest: { input: "https://paysagesgenest.com/", platform: "custom", needs_browser: false, check: (r) => assert.ok(r.review_flags.includes("sitemap_absent"), "sitemap-less → link-crawl fallback") },
  itemconstruction: { input: "https://itemconstruction.com/", platform: "wordpress", needs_browser: false },
  protectoit: { input: "https://www.protectoit.com/", platform: "wix", needs_browser: false },
  toituresmarcelpouliot: { input: "http://toituresmarcelpouliot.com/", platform: "custom", needs_browser: false },
  pierrehamelin: { input: "https://pierrehamelin.ca/", platform: "wordpress", needs_browser: false },
  // #28 evidence-based relabels — three REAL bilingual goldens now earn mirror.
  // Evidence: each carries fr+en hreflang alternates (head + sitemap xhtml:link) →
  // ladder rung 1 (hreflang). labarberie = WP/Yoast, mchenry+mtl = Duda translated-slug.
  labarberie: { input: "https://labarberie.com/", platform: "wordpress", needs_browser: false, bilingual: "hreflang" },
  mchenryplumbing: { input: "https://www.mchenryplumbing.ca/", platform: "duda", needs_browser: false, bilingual: "hreflang" },
  mtlplomberie: { input: "https://www.mtlplomberie.ca/", platform: "duda", needs_browser: false, bilingual: "hreflang" },
};

for (const [slug, g] of Object.entries(GOLDEN)) {
  const dir = join("fixtures/golden", slug);
  if (!existsSync(join(dir, "scenario.json"))) continue;
  test(`golden ${slug} (${g.platform})`, async () => {
    const scenario = JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8")) as Scenario;
    const expected = JSON.parse(readFileSync(join(dir, "scan-result.json"), "utf8"));
    const r = await scan(new FakeTransport(scenario), new FakeClock(), g.input);

    // independently-verified invariants
    assert.equal(r.detected_platform, g.platform, `platform`);
    assert.equal(r.needs_browser, g.needs_browser, `needs_browser`);
    assert.equal(r.canonical_origin, expected.canonical_origin);
    g.check?.(r);

    // #28 bilingual relabel with evidence
    if (g.bilingual) {
      assert.equal(r.bilingual_mirror, true, `${slug}: bilingual_mirror`);
      assert.ok(r.languages.includes("fr") && r.languages.includes("en"), `${slug}: languages fr+en`);
      assert.ok(r.review_flags.includes("pairing_evidence:" + g.bilingual), `${slug}: evidence grade ${g.bilingual}`);
    }

    // deterministic replay of the full #8 object
    assert.equal(r.core_pages, expected.core_pages, "core_pages");
    assert.equal(r.blog_posts, expected.blog_posts, "blog_posts");
    assert.equal(r.bilingual_mirror, expected.bilingual_mirror);
    assert.deepEqual(r.languages.sort(), (expected.languages || []).sort());
    assert.deepEqual([...r.review_flags].sort(), [...expected.review_flags].sort());
  });
}

test("golden set covers required categories", () => {
  // blog-heavy (lasouche), sitemap-less (paysagesgenest), and THREE real bilingual
  // goldens (labarberie, mchenryplumbing, mtlplomberie) all → mirror via #28 hreflang,
  // with the moat event proven on real sites (see crawl.events golden moat test).
  // One-pager remains synthetic-only (trades sites are multi-page) — D-09 unit test.
  assert.ok(existsSync("fixtures/golden/lasouche/scenario.json"));
  assert.ok(existsSync("fixtures/golden/paysagesgenest/scenario.json"));
  for (const s of ["labarberie", "mchenryplumbing", "mtlplomberie"]) assert.ok(existsSync(`fixtures/golden/${s}/scenario.json`), s);
});
