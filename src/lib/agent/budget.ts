/**
 * Hard monthly spending cap for the agent. Before every OpenAI call the engine
 * reserves a conservative estimate of that call's cost with one conditional
 * UPDATE — if the reservation would cross the budget, the call is never made.
 * After the response the reservation is replaced by the real cost. Because the
 * check-and-reserve is a single atomic statement, parallel requests cannot
 * slip past the cap together.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentUsage } from "@/db/schema";
import { instance } from "@/config/instance";
import { todayIn } from "@/lib/dates";

/** Output cap per call, reasoning included — no single call can blow the budget. */
export const MAX_OUTPUT_TOKENS = 1200;

/** "YYYY-MM" of `now` in the owner's time zone. */
export function monthKey(now: Date = new Date()): string {
  return todayIn(instance.timeZone, now).slice(0, 7);
}

export function budgetUsd(): number {
  const env = Number(process.env.AGENT_MONTHLY_BUDGET_USD);
  return Number.isFinite(env) && env > 0 ? env : instance.agentMonthlyBudgetUsd;
}

export function costOf(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * instance.pricing.inputPerMillion + outputTokens * instance.pricing.outputPerMillion) / 1_000_000
  );
}

/**
 * Upper-bound cost of the next call. Input: ~1 token per 1.5 characters (Hebrew,
 * JSON and ids tokenize densely; real ratios are higher, so this over-reserves).
 * Output: the full MAX_OUTPUT_TOKENS.
 */
export function estimateCallUsd(promptChars: number): number {
  return costOf(Math.ceil(promptChars / 1.5) + 200, MAX_OUTPUT_TOKENS);
}

function formatUsd(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

export class BudgetExceededError extends Error {
  constructor() {
    super(
      `הגעתי לתקרת התקציב החודשית של הסוכן (${formatUsd(budgetUsd())}). הוא יחזור לפעול ב-1 בחודש הבא. כל שאר המערכת ממשיכה לעבוד כרגיל.`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface Reservation {
  month: string;
  usd: number;
}

/**
 * Reserves `estimateUsd` for this month, or throws BudgetExceededError without
 * reserving anything. Call before EVERY OpenAI request.
 */
export async function checkBudget(estimateUsd: number, now: Date = new Date()): Promise<Reservation> {
  const month = monthKey(now);
  const cap = budgetUsd();
  await db().insert(agentUsage).values({ month }).onConflictDoNothing();
  const rows = await db()
    .update(agentUsage)
    .set({ costUsd: sql`${agentUsage.costUsd} + ${estimateUsd}`, updatedAt: new Date() })
    .where(and(eq(agentUsage.month, month), sql`${agentUsage.costUsd} + ${estimateUsd} <= ${cap}`))
    .returning({ month: agentUsage.month });
  if (!rows.length) throw new BudgetExceededError();
  return { month, usd: estimateUsd };
}

export interface CallUsage {
  /** Includes cached tokens — billed here at full input price, deliberately conservative. */
  prompt_tokens: number;
  /** Includes reasoning tokens. */
  completion_tokens: number;
}

/** Swaps the reservation for the real cost and counts the request. Pass usage=null when the call failed. */
export async function recordUsage(reservation: Reservation, usage: CallUsage | null | undefined): Promise<void> {
  const input = usage?.prompt_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;
  // A response without usage is charged the full reservation, never zero.
  const actual = usage ? costOf(input, output) : reservation.usd;
  await db()
    .update(agentUsage)
    .set({
      costUsd: sql`greatest(0, ${agentUsage.costUsd} - ${reservation.usd} + ${actual})`,
      inputTokens: sql`${agentUsage.inputTokens} + ${input}`,
      outputTokens: sql`${agentUsage.outputTokens} + ${output}`,
      requests: sql`${agentUsage.requests} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(agentUsage.month, reservation.month));
}

/** Returns a reservation untouched — for calls that never reached OpenAI's billing (connection errors). */
export async function releaseReservation(reservation: Reservation): Promise<void> {
  await db()
    .update(agentUsage)
    .set({ costUsd: sql`greatest(0, ${agentUsage.costUsd} - ${reservation.usd})`, updatedAt: new Date() })
    .where(eq(agentUsage.month, reservation.month));
}

export interface UsageView {
  month: string;
  costUsd: number;
  budgetUsd: number;
  requests: number;
}

export async function getUsage(now: Date = new Date()): Promise<UsageView> {
  const month = monthKey(now);
  const [row] = await db().select().from(agentUsage).where(eq(agentUsage.month, month));
  return {
    month,
    costUsd: Math.round((row?.costUsd ?? 0) * 1e6) / 1e6,
    budgetUsd: budgetUsd(),
    requests: row?.requests ?? 0,
  };
}
