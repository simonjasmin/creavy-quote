import { test } from "node:test";
import assert from "node:assert/strict";
import { assessable, BLOCKING_FLAGS, type AssessableScan } from "../src/assess/assessable.ts";
import { pricingConfig as P } from "../src/pricing/index.ts";

// #32 step 3 — the ONE assessability predicate. Both sides of every condition, so the
// gate that fronts the model (and CT-06 + A6) can never drift silently. Ceiling read
// from config (#27.2) — a drifted hardcode fails.
const CEILING = P.tiermap.review_pages - 1; // 6

const clean = (o: Partial<AssessableScan> = {}): AssessableScan => ({
  core_pages: 3, detected_platform: "wordpress", needs_browser: false, partial: false, review_flags: [], ...o,
});

test("AS-01 clean small WordPress site → assessable", () => assert.equal(assessable(clean()), true));

// greenfield / no-site
test("AS-02 detected_platform none (greenfield) → not assessable", () => assert.equal(assessable(clean({ detected_platform: "none" })), false));
test("AS-03 each greenfield/blocking flag → not assessable, and its absence → assessable", () => {
  for (const f of BLOCKING_FLAGS) {
    assert.equal(assessable(clean({ review_flags: [f] })), false, `${f} blocks`);
  }
  assert.equal(assessable(clean({ review_flags: [] })), true, "no blocking flag → assessable");
});

// e-commerce → human quote
test("AS-04 shopify → not assessable; wordpress → assessable", () => {
  assert.equal(assessable(clean({ detected_platform: "shopify" })), false);
  assert.equal(assessable(clean({ detected_platform: "wordpress" })), true);
});

// needs_browser (A3)
test("AS-05 needs_browser true → not assessable; false → assessable", () => {
  assert.equal(assessable(clean({ needs_browser: true })), false);
  assert.equal(assessable(clean({ needs_browser: false })), true);
});

// partial (A3)
test("AS-06 partial true → not assessable; false → assessable", () => {
  assert.equal(assessable(clean({ partial: true })), false);
  assert.equal(assessable(clean({ partial: false })), true);
});

// core-page ceiling (#27.2)
test("AS-07 core-page ceiling — both sides of the boundary", () => {
  assert.equal(assessable(clean({ core_pages: CEILING })), true, `core ${CEILING} (== ceiling) assessable`);
  assert.equal(assessable(clean({ core_pages: CEILING + 1 })), false, `core ${CEILING + 1} (review) not assessable`);
  assert.equal(assessable(clean({ core_pages: 1 })), true, "core 1 assessable");
  assert.equal(assessable(clean({ core_pages: 0 })), false, "core 0 (nothing to assess) not assessable");
  assert.equal(assessable(clean({ core_pages: "30+" })), false, "30+ out-of-scope not assessable");
});

// soft flags DON'T block — the model runs and caveats (A3)
test("AS-08 soft flags (bilingual_suspected, anti_bot) remain assessable", () => {
  assert.equal(assessable(clean({ review_flags: ["bilingual_suspected"] })), true);
  assert.equal(assessable(clean({ review_flags: ["anti_bot"] })), true);
  assert.ok(!BLOCKING_FLAGS.has("bilingual_suspected") && !BLOCKING_FLAGS.has("anti_bot"), "soft flags stay out of the blocking set");
});
