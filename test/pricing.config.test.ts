import { test } from "node:test";
import assert from "node:assert/strict";
import { rawPricingConfig } from "../src/pricing/pricing.config.ts";
import { loadPricingConfig, PricingConfigError } from "../src/pricing/loadPricingConfig.ts";

test("the real config loads and is frozen", () => {
  const cfg = loadPricingConfig(rawPricingConfig);
  assert.equal(cfg.currency, "CAD");
  assert.equal(Object.isFrozen(cfg), true);
});

test("tier + care-plan values are integer cents", () => {
  const cfg = loadPricingConfig(rawPricingConfig);
  assert.equal(cfg.tiers.presence.price_cents, 149000);
  assert.equal(cfg.tiers.standard.price_cents, 279000);
  assert.equal(cfg.tiers.pro.price_cents, 429000);
  assert.equal(cfg.tiers.pro_custom.price_min_cents, 429000);
  assert.equal(cfg.tiers.pro_custom.price_max_cents, null);
  assert.equal(cfg.care_plan.monthly_cents, 5900);
});

test("CHECKLIST add-on values encode across all three price kinds (#20/#21)", () => {
  const cfg = loadPricingConfig(rawPricingConfig);
  assert.deepEqual(cfg.addons.extra_page.price, { kind: "flat", cents: 39000 });
  assert.deepEqual(cfg.addons.bilingual.price, { kind: "flat", cents: 69000 });
  assert.deepEqual(cfg.addons.booking.price, { kind: "flat", cents: 59000 });
  assert.deepEqual(cfg.addons.copywriting_per_page.price, { kind: "flat", cents: 19000 });
  assert.equal(cfg.addons.ecommerce.price.kind, "human_quote"); // #21 — no auto price
  assert.deepEqual(cfg.addons.rush_delivery.price, {
    kind: "percent_modifier",
    percent: 20,
    applies_to: "build_subtotal",
  });
});

test("loader HARD-FAILS on a TODO(...) placeholder value (#22)", () => {
  const withPlaceholder = structuredClone(rawPricingConfig) as any;
  withPlaceholder.addons.booking.price = "TODO(unset-price)"; // any TODO(...) marker
  assert.throws(() => loadPricingConfig(withPlaceholder), PricingConfigError);
});

test("loader HARD-FAILS on a placeholder buried deep in the tree (#22)", () => {
  const deep = structuredClone(rawPricingConfig) as any;
  deep.addons.extra_page.label_fr = "TODO(unset-label): confirm FR"; // spaced variant too
  assert.throws(() => loadPricingConfig(deep), PricingConfigError);
});

test("loader rejects a fourth price kind — only three exist (#20)", () => {
  const bad = structuredClone(rawPricingConfig) as any;
  bad.addons.booking.price = { kind: "from_price", cents: 89000 }; // "from $890" is unrepresentable
  assert.throws(() => loadPricingConfig(bad), PricingConfigError);
});

test("loader rejects a non-integer flat price (cents must be whole)", () => {
  const bad = structuredClone(rawPricingConfig) as any;
  bad.addons.booking.price = { kind: "flat", cents: 590.5 };
  assert.throws(() => loadPricingConfig(bad), PricingConfigError);
});

test("percent_modifier must apply to the build subtotal only, never recurring (#20)", () => {
  const bad = structuredClone(rawPricingConfig) as any;
  bad.addons.rush_delivery.price = { kind: "percent_modifier", percent: 20, applies_to: "care_plan" };
  assert.throws(() => loadPricingConfig(bad), PricingConfigError);
});

test("boot-time load via the index module does not throw", async () => {
  const mod = await import("../src/pricing/index.ts");
  assert.equal(mod.pricingConfig.currency, "CAD");
});
