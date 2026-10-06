import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __matzpenDb?: DB };

/** One small pool per server instance. `prepare: false` keeps it compatible with pooled (pgbouncer) URLs. */
export function db(): DB {
  if (globalForDb.__matzpenDb) return globalForDb.__matzpenDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15 });
  globalForDb.__matzpenDb = drizzle(client, { schema });
  return globalForDb.__matzpenDb;
}

export { schema };
