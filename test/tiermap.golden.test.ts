import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { mapTier } from "../src/tiermap/tiermap.ts";
import { pricingConfig as P } from "../src/pricing/index.ts";

// #27 golden extension: run the mapper on the 8 real golden scan-results, assert
// bundles against hand-verified expectations. Evidence rule: each expectation is
// verified from the scan-result's own core_pages / blog_posts / bilingual_mirror.
const EXPECT: Record<string, { review: boolean; tier?: string; total?: number; why: string }> = {
  // only clean shape (≤6 core, no heavy component): 4 pages → Standard.
  toituresmarcelpouliot: { review: false, tier: "standard", total: P.tiers.standard.price_cents, why: "4 core pages, no component" },
  // everything else exceeds the clean-shape page count (≥7 or 30+) → review, no bundle.
  itemconstruction: { review: true, why: "30+ core → out-of-scope" },
  labarberie: { review: true, why: "30+ core (bilingual, but page count blocks first)" },
  mchenryplumbing: { review: true, why: "30+ core" },
  lasouche: { review: true, why: "12 core ≥ 7" },
  mtlplomberie: { review: true, why: "18 core ≥ 7" },
  paysagesgenest: { review: true, why: "16 core ≥ 7" },
  pierrehamelin: { review: true, why: "27 core ≥ 7" },
  protectoit: { review: true, why: "27 core ≥ 7" },
};

for (const [slug, exp] of Object.entries(EXPECT)) {
  const path = `fixtures/golden/${slug}/scan-result.json`;
  if (!existsSync(path)) continue;
  test(`tiermap golden ${slug} — ${exp.why}`, () => {
    const res = JSON.parse(readFileSync(path, "utf8"));
    const t = mapTier({ core_pages: res.core_pages, blog_posts: res.blog_posts, bilingual_mirror: res.bilingual_mirror, detected_platform: res.detected_platform, needs_browser: res.needs_browser, partial: res.partial, review_flags: res.review_flags }, P);
    assert.equal(t.review_required, exp.review, `${slug} review_required`);
    if (exp.tier) { assert.equal(t.bundle?.tier, exp.tier); assert.equal(t.indicative_total, exp.total); assert.deepEqual(t.suggested_addons, [], `${slug}: no suggestions (blog 0, no brand-asset signal)`); assert.ok(t.reasons.includes("cheapest_bundle"), `${slug}: stable code`); }
    else assert.equal(t.bundle, null, `${slug} expected no bundle`);
  });
}
