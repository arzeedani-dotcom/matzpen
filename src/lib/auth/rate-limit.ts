/**
 * Sign-in lockout: 5 attempts within 15 minutes lock that IP for 15 minutes, and
 * GLOBAL_MAX attempts from everywhere within an hour lock sign-in for everyone
 * (so rotating IPs does not buy unlimited guesses).
 *
 * Each attempt is counted by one atomic statement BEFORE the password is compared,
 * so a burst of parallel guesses cannot slip past the check. A successful sign-in
 * clears the counters again.
 */
import "server-only";
import { and, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";

export const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;

/** The pseudo-IP row that counts attempts from every address together. */
const GLOBAL_KEY = "*";
const GLOBAL_MAX = 50;
const GLOBAL_WINDOW_MS = 60 * 60_000;

/** Inside sql`` fragments timestamps go as ISO text: the postgres driver does not serialise Date objects there. */
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/** Counts one attempt for `key`; returns the minutes it stays locked, 0 when this attempt may go ahead. */
async function count(key: string, max: number, windowMs: number, now: Date): Promise<number> {
  const at = ts(now);
  const windowStart = ts(new Date(now.getTime() - windowMs));
  const lockUntil = ts(new Date(now.getTime() + LOCK_MS));
  // A row whose window ended (and is not locked) starts over at 1; reaching `max` locks it.
  const t = loginAttempts;
  const restart = sql`${t.firstAt} < ${windowStart} and (${t.lockedUntil} is null or ${t.lockedUntil} <= ${at})`;
  const rows = await db()
    .insert(t)
    .values({ ip: key, count: 1, firstAt: now, lockedUntil: max <= 1 ? new Date(now.getTime() + LOCK_MS) : null })
    .onConflictDoUpdate({
      target: t.ip,
      set: {
        count: sql`case when ${restart} then 1 else ${t.count} + 1 end`,
        firstAt: sql`case when ${restart} then ${at} else ${t.firstAt} end`,
        lockedUntil: sql`case
          when ${t.lockedUntil} > ${at} then ${t.lockedUntil}
          when ${t.firstAt} >= ${windowStart} and ${t.count} + 1 >= ${max} then ${lockUntil}
          else null end`,
      },
    })
    .returning({ count: t.count, lockedUntil: t.lockedUntil });
  const row = rows[0];
  if (!row || row.count <= max) return 0;
  const until = row.lockedUntil ? row.lockedUntil.getTime() : now.getTime() + LOCK_MS;
  return Math.max(1, Math.ceil((until - now.getTime()) / 60_000));
}

/**
 * Registers a sign-in attempt from `ip`. Returns 0 when the password may be checked,
 * otherwise the minutes until sign-in opens again.
 */
export async function registerAttempt(ip: string, now = new Date()): Promise<number> {
  // Old rows are never needed again — keep the table small.
  await db()
    .delete(loginAttempts)
    .where(
      and(
        lt(loginAttempts.firstAt, new Date(now.getTime() - 86_400_000)),
        or(isNull(loginAttempts.lockedUntil), lt(loginAttempts.lockedUntil, now)),
      ),
    );
  const [perIp, global] = await Promise.all([
    count(ip, MAX_FAILURES, WINDOW_MS, now),
    count(GLOBAL_KEY, GLOBAL_MAX, GLOBAL_WINDOW_MS, now),
  ]);
  return Math.max(perIp, global);
}

/** After a successful sign-in: this address, and the global counter, start clean. */
export async function clearFailures(ip: string): Promise<void> {
  await db().delete(loginAttempts).where(inArray(loginAttempts.ip, [ip, GLOBAL_KEY]));
}
