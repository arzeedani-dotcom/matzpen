/**
 * Loads sample data. Uses seed/private/owner.ts when it exists (not in git), else seed/example.ts.
 *   npm run db:seed            — only if the database has no spaces yet
 *   npm run db:seed -- --reset — wipes this app's spaces and tasks first
 * Touches only the "matzpen" schema.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { addDays, todayIn } from "../src/lib/dates";
import { instance } from "../src/config/instance";
import type { SeedSpace } from "../seed/types";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = postgres(url, { max: 1, prepare: false, ssl: local ? false : "require", onnotice: () => {} });
const db = drizzle(client, { schema });

const file = existsSync("seed/private/owner.ts") ? "seed/private/owner.ts" : "seed/example.ts";
const data: SeedSpace[] = (await import(pathToFileURL(file).href)).default;
const reset = process.argv.includes("--reset");

const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.spaces);
if (n > 0 && !reset) {
  console.log(`Database already has ${n} spaces — nothing done. Use --reset to replace them.`);
  await client.end();
  process.exit(0);
}

const today = todayIn(instance.timeZone);
await db.transaction(async (tx) => {
  if (reset) {
    await tx.delete(schema.tasks);
    await tx.delete(schema.spaces);
  }
  for (const [i, s] of data.entries()) {
    const [space] = await tx
      .insert(schema.spaces)
      .values({ name: s.name, color: s.color, view: s.view, position: i })
      .returning();
    if (!s.tasks.length) continue;
    await tx.insert(schema.tasks).values(
      s.tasks.map((t, j) => ({
        spaceId: space.id,
        title: t.title,
        notes: t.notes ?? null,
        priority: t.priority,
        status: t.status,
        dueDate: t.due === null ? null : addDays(today, t.due),
        position: j + 1,
        completedAt: t.status === "done" ? new Date(Date.now() - (t.completedDaysAgo ?? 0) * 86_400_000) : null,
      })),
    );
  }
});
const total = data.reduce((sum, s) => sum + s.tasks.length, 0);
console.log(`✓ seeded ${data.length} spaces, ${total} tasks from ${file}`);
await client.end();
