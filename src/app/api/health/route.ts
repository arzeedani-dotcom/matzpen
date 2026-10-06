import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fail, ok } from "@/lib/http";

/** Public liveness check: is the app up and can it reach the database? Reveals nothing else. */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return ok({ ok: true });
  } catch {
    return fail(503, "database unreachable");
  }
}
