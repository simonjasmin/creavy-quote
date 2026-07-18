import { rawPricingConfig } from "./pricing.config.ts";
import { loadPricingConfig } from "./loadPricingConfig.ts";

// Boot-time load — hard-fails immediately if the config is invalid or still
// carries a TODO(...) placeholder (#22). Import this, never the raw object.
export const pricingConfig = loadPricingConfig(rawPricingConfig);

export * from "./loadPricingConfig.ts";
export { rawPricingConfig } from "./pricing.config.ts";
