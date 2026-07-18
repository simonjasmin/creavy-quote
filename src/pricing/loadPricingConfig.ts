// Runtime validator/loader for the pricing config.
// Decisions #20 (exactly three price kinds; flat = integer cents),
// #21 (e-commerce = human_quote), #22 (loader hard-fails on any TODO(...)).
//
// The loader takes `unknown` on purpose: it is the last line of defence at BOOT,
// independent of compile-time types (Node strips types, it does not check them).

export type FlatPrice = { kind: "flat"; cents: number };
export type PercentModifierPrice = { kind: "percent_modifier"; percent: number; applies_to: "build_subtotal" };
export type HumanQuotePrice = { kind: "human_quote" };
export type AddonPrice = FlatPrice | PercentModifierPrice | HumanQuotePrice;

export type Addon = { label_fr: string; price: AddonPrice };
export type Tier = { label_fr: string; price_cents: number };
export type ProCustomTier = { label_fr: string; price_min_cents: number; price_max_cents: number | null };

export type PricingConfig = {
  currency: string;
  care_plan: { key: string; label_fr: string; monthly_cents: number };
  tiers: { presence: Tier; standard: Tier; pro: Tier; pro_custom: ProCustomTier };
  addons: Record<string, Addon>;
};

export class PricingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingConfigError";
  }
}

// Matches TODO( / TODO ( — the un-runnable placeholder marker (#22).
export const TODO_PLACEHOLDER = /TODO\s*\(/;

function fail(msg: string): never {
  throw new PricingConfigError(msg);
}
function check(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}
function isPositiveInt(n: unknown): boolean {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

// #22 — deep scan: ANY string value matching TODO( anywhere in the tree hard-fails.
function assertNoPlaceholders(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (TODO_PLACEHOLDER.test(value)) fail(`unfilled placeholder at ${path}: ${JSON.stringify(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoPlaceholders(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoPlaceholders(v, `${path}.${k}`);
  }
}

function validatePrice(price: unknown, path: string): AddonPrice {
  check(price && typeof price === "object", `${path}: price must be an object`);
  const p = price as Record<string, unknown>;
  switch (p.kind) {
    case "flat":
      check(isPositiveInt(p.cents), `${path}: flat price needs a positive integer "cents" (#20)`);
      return { kind: "flat", cents: p.cents as number };
    case "percent_modifier":
      check(typeof p.percent === "number" && p.percent > 0, `${path}: percent_modifier needs a positive "percent"`);
      check(p.applies_to === "build_subtotal", `${path}: percent_modifier.applies_to must be "build_subtotal" — never recurring (#20)`);
      return { kind: "percent_modifier", percent: p.percent as number, applies_to: "build_subtotal" };
    case "human_quote":
      check(!("cents" in p) && !("percent" in p), `${path}: human_quote carries no auto price (#21)`);
      return { kind: "human_quote" };
    default:
      return fail(`${path}: unknown price kind ${JSON.stringify(p.kind)} — only flat | percent_modifier | human_quote (#20)`);
  }
}

export function loadPricingConfig(raw: unknown): PricingConfig {
  check(raw && typeof raw === "object", "pricing config must be an object");

  // #22 — placeholders are un-runnable: scan the WHOLE tree before anything else.
  assertNoPlaceholders(raw, "pricingConfig");

  const c = raw as Record<string, any>;
  check(typeof c.currency === "string" && c.currency.length > 0, "currency required");
  check(c.care_plan && isPositiveInt(c.care_plan.monthly_cents), "care_plan.monthly_cents required (positive integer cents)");
  check(typeof c.care_plan.label_fr === "string" && typeof c.care_plan.key === "string", "care_plan needs key + label_fr");

  const t = c.tiers ?? {};
  for (const key of ["presence", "standard", "pro"] as const) {
    check(t[key] && isPositiveInt(t[key].price_cents), `tier ${key} needs a positive integer price_cents`);
    check(typeof t[key].label_fr === "string", `tier ${key} needs label_fr`);
  }
  check(t.pro_custom && isPositiveInt(t.pro_custom.price_min_cents), "pro_custom needs price_min_cents");
  check(t.pro_custom.price_max_cents === null || Number.isInteger(t.pro_custom.price_max_cents), "pro_custom.price_max_cents must be an integer or null");
  check(typeof t.pro_custom.label_fr === "string", "pro_custom needs label_fr");

  check(c.addons && typeof c.addons === "object", "addons required");
  const addons: Record<string, Addon> = {};
  for (const [key, def] of Object.entries<any>(c.addons)) {
    check(def && typeof def.label_fr === "string", `addon ${key} needs label_fr`);
    addons[key] = { label_fr: def.label_fr, price: validatePrice(def.price, `addons.${key}.price`) };
  }

  return Object.freeze({
    currency: c.currency,
    care_plan: { key: c.care_plan.key, label_fr: c.care_plan.label_fr, monthly_cents: c.care_plan.monthly_cents },
    tiers: {
      presence: { label_fr: t.presence.label_fr, price_cents: t.presence.price_cents },
      standard: { label_fr: t.standard.label_fr, price_cents: t.standard.price_cents },
      pro: { label_fr: t.pro.label_fr, price_cents: t.pro.price_cents },
      pro_custom: { label_fr: t.pro_custom.label_fr, price_min_cents: t.pro_custom.price_min_cents, price_max_cents: t.pro_custom.price_max_cents },
    },
    addons,
  }) as PricingConfig;
}
