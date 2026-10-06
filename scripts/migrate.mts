/** Applies pending migrations to DATABASE_URL. Touches only the "matzpen" schema. */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = postgres(url, { max: 1, prepare: false, ssl: local ? false : "require", onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: "drizzle", migrationsSchema: "matzpen" });
console.log("✓ migrations applied");
await client.end();
