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
const GOLDEN: Record<string, { input: string; platform: string; needs_browser: boolean; check?: (r: any) => void }> = {
  lasouche: { input: "https://lasouche.ca/", platform: "wordpress", needs_browser: false, check: (r) => assert.ok(r.blog_posts >= 20, "blog-heavy: >=20 posts") },
  paysagesgenest: { input: "https://paysagesgenest.com/", platform: "custom", needs_browser: false, check: (r) => assert.ok(r.review_flags.includes("sitemap_absent"), "sitemap-less → link-crawl fallback") },
  itemconstruction: { input: "https://itemconstruction.com/", platform: "wordpress", needs_browser: false },
  protectoit: { input: "https://www.protectoit.com/", platform: "wix", needs_browser: false },
  toituresmarcelpouliot: { input: "http://toituresmarcelpouliot.com/", platform: "custom", needs_browser: false },
  pierrehamelin: { input: "https://pierrehamelin.ca/", platform: "wordpress", needs_browser: false },
  // labarberie IS bilingual (fr-root + /en/) — scan reports langs=[en] (see §14 thread: implicit-FR-root gap, money-touching, NOT auto-fixed)
  labarberie: { input: "https://labarberie.com/", platform: "wordpress", needs_browser: false },
  mchenryplumbing: { input: "https://www.mchenryplumbing.ca/", platform: "duda", needs_browser: false },
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

    // deterministic replay of the full #8 object
    assert.equal(r.core_pages, expected.core_pages, "core_pages");
    assert.equal(r.blog_posts, expected.blog_posts, "blog_posts");
    assert.equal(r.bilingual_mirror, expected.bilingual_mirror);
    assert.deepEqual(r.languages.sort(), (expected.languages || []).sort());
    assert.deepEqual([...r.review_flags].sort(), [...expected.review_flags].sort());
  });
}

test("golden set covers required categories", () => {
  // blog-heavy (lasouche) + sitemap-less (paysagesgenest) present and verified above.
  // NOTE (reported): no real ICP site yielded a clean explicit /fr//en/ bilingual
  // (all use fr-root + /en/ → §14 implicit-FR-root thread) or a true one-pager
  // (trades sites are multi-page). Those two behaviours are proven by the synthetic
  // scan tests (bilingual) and D-09 unit test (one-pager) instead.
  assert.ok(existsSync("fixtures/golden/lasouche/scenario.json"));
  assert.ok(existsSync("fixtures/golden/paysagesgenest/scenario.json"));
});
