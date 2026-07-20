// Migration runner (~40 lines, no library). Applies numbered .sql files in order, each in
// a transaction, tracking applied versions in schema_migrations. Idempotent — re-running
// applies only new files. Invoked at deploy (index.ts) and locally via `npm run migrate`.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function runMigrations(databaseUrl: string, log: (m: string) => void = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version as string));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      const version = f.replace(/\.sql$/, "");
      if (done.has(version)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        applied.push(version);
        log(`migrated ${version}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${version} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

// CLI: `node --env-file=.env src/service/migrate.ts`
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("service/migrate.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL required"); process.exit(1); }
  runMigrations(url)
    .then((a) => { console.log(`applied ${a.length} migration(s)`); process.exit(0); })
    .catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
