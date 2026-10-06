/** Failed-login lockout: 5 failures within 15 minutes lock that IP for 15 minutes. */
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";

export const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

export async function lockedFor(ip: string, now = new Date()): Promise<number> {
  const [row] = await db().select().from(loginAttempts).where(eq(loginAttempts.ip, ip));
  if (!row?.lockedUntil || row.lockedUntil <= now) return 0;
  return Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 60_000);
}

export async function recordFailure(ip: string, now = new Date()): Promise<void> {
  const [row] = await db().select().from(loginAttempts).where(eq(loginAttempts.ip, ip));
  const fresh = !row || now.getTime() - row.firstAt.getTime() > WINDOW_MS;
  const count = fresh ? 1 : row.count + 1;
  const values = {
    ip,
    count,
    firstAt: fresh ? now : row.firstAt,
    lockedUntil: count >= MAX_FAILURES ? new Date(now.getTime() + WINDOW_MS) : null,
  };
  await db().insert(loginAttempts).values(values).onConflictDoUpdate({ target: loginAttempts.ip, set: values });
}

export async function clearFailures(ip: string): Promise<void> {
  await db().delete(loginAttempts).where(eq(loginAttempts.ip, ip));
}
