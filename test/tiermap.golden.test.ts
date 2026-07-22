import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { mapTier, sizeBandRange } from "../src/tiermap/tiermap.ts";
import { pricingConfig as P } from "../src/pricing/index.ts";

// #27 golden extension, re-asserted for #35. Each expectation is verified from the
// scan-result's own core_pages / flags. Kinds: flat (≤6, priced) · band (7..12 clean →
// #35 estimation range) · review (>12 clean, no price) · oos (30+).
const EXPECT: Record<string, { kind: "flat" | "band" | "review" | "oos"; tier?: string; total?: number; why: string }> = {
  toituresmarcelpouliot: { kind: "flat", tier: "standard", total: P.tiers.standard.price_cents, why: "4 core, no component → Standard" },
  itemconstruction: { kind: "oos", why: "30+ core → out-of-scope" },
  labarberie: { kind: "oos", why: "30+ core (bilingual, but page count blocks first)" },
  mchenryplumbing: { kind: "oos", why: "30+ core" },
  // #35: clean 7..12 goldens now earn an instant estimation range instead of pure review.
  mtlplomberie: { kind: "band", why: "10 core (clean) → #35 size-estimation band" },
  lasouche: { kind: "band", why: "12 core (clean) → #35 size-estimation band" },
  // > size_band_max (12) → pure review, unchanged.
  paysagesgenest: { kind: "review", why: "16 core > band ceiling → review" },
  pierrehamelin: { kind: "review", why: "27 core > band ceiling → review" },
  protectoit: { kind: "review", why: "27 core > band ceiling → review" },
};

for (const [slug, exp] of Object.entries(EXPECT)) {
  const path = `fixtures/golden/${slug}/scan-result.json`;
  if (!existsSync(path)) continue;
  test(`tiermap golden ${slug} — ${exp.why}`, () => {
    const res = JSON.parse(readFileSync(path, "utf8"));
    const t = mapTier({ core_pages: res.core_pages, blog_posts: res.blog_posts, bilingual_mirror: res.bilingual_mirror, detected_platform: res.detected_platform, needs_browser: res.needs_browser, partial: res.partial, review_flags: res.review_flags }, P);
    // #27.9 decomposition shape re-asserted on every priced golden: sum reconciles, base is scanned-anchored.
    const sumOf = () => t.base!.amount + t.additions!.reduce((s, a) => s + a.amount, 0);
    if (exp.kind === "flat") {
      assert.equal(t.review_required, false, `${slug} review_required`);
      assert.equal(t.bundle?.tier, exp.tier);
      assert.equal(t.indicative_total, exp.total);
      assert.ok(t.reasons.includes("cheapest_bundle"));
      assert.equal(t.base!.from, "scan");
      assert.equal(sumOf(), t.indicative_total, `${slug}: base + additions === total`);
    } else if (exp.kind === "band") {
      assert.equal(t.bundle, null, `${slug}: no auto-bundle`);
      assert.equal(t.review_required, true);
      assert.ok(t.reasons.includes("size_estimation_band"), `${slug}: band code`);
      assert.deepEqual(t.range, sizeBandRange(res.core_pages, P), `${slug}: config-derived range`);
      assert.ok(t.range!.min < t.range!.max, `${slug}: sane range`);
      assert.equal(sumOf(), t.range!.min, `${slug}: decomposition reconciles to range.min`);
    } else { // review | oos → no price, no range
      assert.equal(t.bundle, null, `${slug}: no bundle`);
      assert.equal(t.review_required, true);
      assert.equal(t.range ?? null, null, `${slug}: no range`);
      assert.ok(t.reasons.includes(exp.kind === "oos" ? "out_of_scope_30_plus" : "review_unusual_size"));
    }
  });
}
