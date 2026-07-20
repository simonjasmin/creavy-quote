// Service entry point. Boot order: load config (hard-fail on missing) → pick store →
// migrate (pg) → start the HTTP server. NOT imported by the test suite, so `pg` and the
// PgStore load only at boot — `node --test` stays Postgres-free.

import { loadServiceConfig } from "./config.ts";
import { MemoryStore } from "./store/memoryStore.ts";
import { RateLimiter } from "./rateLimiter.ts";
import { createServer } from "./server.ts";
import { readContractVersion } from "./contractVersion.ts";
import { realClock } from "./realClock.ts";
import { HttpTransport } from "../crawl/httpTransport.ts";
import { pricingConfig } from "../pricing/index.ts";
import type { Store } from "./store/types.ts";

async function boot(): Promise<void> {
  const config = loadServiceConfig(process.env); // #22 hard-fail
  const contractVersion = readContractVersion(); // fail fast at boot if the contract file is missing/unparseable

  let store: Store;
  if (config.databaseUrl) {
    const { PgStore } = await import("./store/pgStore.ts");
    const { runMigrations } = await import("./migrate.ts");
    await runMigrations(config.databaseUrl);
    store = new PgStore(config.databaseUrl);
    console.log("store: postgres");
  } else {
    store = new MemoryStore();
    console.warn("store: IN-MEMORY (non-persistent) — no DATABASE_URL; dev/staging-smoke only");
  }

  const server = createServer({
    config, pricing: pricingConfig, store, contractVersion,
    rateLimiter: new RateLimiter(config.rateLimit.windowMs, config.rateLimit.maxPerWindow),
    transport: new HttpTransport(),
    clock: realClock,
    log: (layer, detail) => console.log(JSON.stringify({ wall: layer, ...detail })),
  });

  server.listen(config.port, () => console.log(`creavy-quote listening on :${config.port} (${config.env}) — contract v${contractVersion}, origin ${config.allowedOrigin}, turnstile ${config.turnstile.enabled ? "on" : "off"}`));
}

boot().catch((e) => { console.error("boot failed:", (e as Error)?.message ?? e); process.exit(1); });
