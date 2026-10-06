/**
 * A real Postgres (PGlite, in-process WASM) with the app's migrations applied.
 * Usage in a test file — the mock must be hoisted before importing repo code:
 *
 *   vi.mock("@/db", async () => (await import("./helpers/test-db")).dbModule());
 *   beforeEach(() => resetDb());
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

const pg = new PGlite();
const testDb = drizzle(pg, { schema });
let migrated: Promise<void> | null = null;

function migrate(): Promise<void> {
  migrated ??= (async () => {
    const dir = join(process.cwd(), "drizzle");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      for (const stmt of readFileSync(join(dir, f), "utf8").split("--> statement-breakpoint")) {
        if (stmt.trim()) await pg.exec(stmt);
      }
    }
  })();
  return migrated;
}

export async function resetDb(): Promise<void> {
  await migrate();
  await pg.exec(
    'truncate "matzpen"."tasks", "matzpen"."spaces", "matzpen"."settings", "matzpen"."pending_actions", "matzpen"."login_attempts" cascade',
  );
}

export function dbModule() {
  return { db: () => testDb, schema };
}
