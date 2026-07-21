// #35/#30.3 + treaty T2 — content_readiness → suggested_addons, DETERMINISTIC in code (never
// by asking the model to price). Amounts are config cents. content_readiness is NEVER a
// pricing input (the #32 firewall) — it only *adds unpriced upsell suggestions*.

import type { PricingConfig } from "../../pricing/loadPricingConfig.ts";
import type { ContentReadiness } from "../store/types.ts";

const flat = (config: PricingConfig, key: string): number => {
  const p = config.addons[key]?.price;
  return p && p.kind === "flat" ? p.cents : 0;
};

// ready → nothing; partial → copywriting; none → copywriting + photo. From config.
export function contentSuggestions(readiness: ContentReadiness, config: PricingConfig): { id: string; amount: number }[] {
  if (readiness === "ready") return [];
  const out = [{ id: "copywriting_per_page", amount: flat(config, "copywriting_per_page") }];
  if (readiness === "none") out.push({ id: "photo_sourcing", amount: flat(config, "photo_sourcing") });
  return out;
}

// Merge the stage-1 suggestions with the content ones, dedup by id (first wins).
export function mergeSuggestions(base: { id: string; amount: number }[], extra: { id: string; amount: number }[]): { id: string; amount: number }[] {
  const seen = new Set<string>();
  const out: { id: string; amount: number }[] = [];
  for (const s of [...(base ?? []), ...extra]) { if (seen.has(s.id)) continue; seen.add(s.id); out.push(s); }
  return out;
}
