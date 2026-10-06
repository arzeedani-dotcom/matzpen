/**
 * Server-enforced safety for the agent. Nothing here trusts the model:
 *   1. Scope — every read and write is limited to the spaces the user selected.
 *   2. Confirmation — deletes, and writes touching more than CONFIRM_THRESHOLD tasks in one
 *      user message (counted across all tool calls), are parked in `pending_actions` and run
 *      only on an explicit "yes".
 *   3. Exact replay — a confirmed action touches exactly the stored task ids, once.
 */
import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pendingActions } from "@/db/schema";
import { formatShortHebrew } from "@/lib/dates";
import { PRIORITY_META, STATUS_META, type Space, type Task } from "@/lib/domain";
import { createTasks, deleteTasks, listSpaces, listTasks, updateTasks } from "@/lib/repo";
import { taskCreateSchema, taskPatchSchema, type TaskPatch } from "@/lib/validation";
import {
  CONFIRM_THRESHOLD,
  PENDING_TTL_MINUTES,
  type AgentScope,
  type PendingActionView,
} from "./types";

export const agentScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("spaces"), spaceIds: z.array(z.string()).max(200) }),
]);

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ── Scope ─────────────────────────────────────────────────────────────────

export interface ResolvedScope {
  /** Spaces the agent may see and touch, in sidebar order. */
  spaces: Space[];
  spaceIds: string[];
  /** Every existing space — used only to explain that a name is out of scope. */
  allSpaces: Space[];
}

/** "all" = every space right now; explicit ids that no longer exist are dropped. */
export async function resolveScope(scope: AgentScope): Promise<ResolvedScope> {
  const allSpaces = await listSpaces();
  const wanted = scope.mode === "all" ? null : new Set(scope.spaceIds);
  const spaces = wanted ? allSpaces.filter((s) => wanted.has(s.id)) : allSpaces;
  return { spaces, spaceIds: spaces.map((s) => s.id), allSpaces };
}

/** Case-, whitespace-, quote- and diacritic-insensitive key for space names (Hebrew niqqud, Arabic tashkeel). */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[֑-ׇֽֿׁׂًׅׄ-ٰٟـ]/g, "")
    .replace(/^["'`״׳]+|["'`״׳]+$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function scopeNames(scope: ResolvedScope): string {
  return scope.spaces.length ? scope.spaces.map((s) => `"${s.name}"`).join(", ") : "(אין מרחבים בתחום)";
}

/** Finds a space by id or name — only among the spaces in scope. */
export function resolveSpace(ref: string, scope: ResolvedScope): Result<Space> {
  const byId = scope.spaces.find((s) => s.id === ref.trim());
  if (byId) return { ok: true, value: byId };
  const key = normalizeName(ref);
  const matches = scope.spaces.filter((s) => normalizeName(s.name) === key);
  if (matches.length === 1) return { ok: true, value: matches[0] };
  if (matches.length > 1) {
    return {
      ok: false,
      error: `השם "${ref}" מתאים לכמה מרחבים; השתמש במזהה: ${matches.map((s) => `${s.name}=${s.id}`).join(", ")}`,
    };
  }
  const outside = scope.allSpaces.some((s) => s.id === ref.trim() || normalizeName(s.name) === key);
  return {
    ok: false,
    error: outside
      ? `המרחב "${ref}" אינו בתחום שנבחר ("עובד על"). מרחבים זמינים: ${scopeNames(scope)}`
      : `אין מרחב בשם "${ref}". מרחבים זמינים: ${scopeNames(scope)}`,
  };
}

/** Loads tasks by id and refuses if any is missing or outside the scope. Nothing partial. */
export async function loadTasksInScope(ids: string[], scope: ResolvedScope): Promise<Result<Task[]>> {
  const unique = [...new Set(ids)];
  const found = await listTasks({ ids: unique });
  const allowed = new Set(scope.spaceIds);
  const outside = found.filter((t) => !allowed.has(t.spaceId));
  if (outside.length) {
    return {
      ok: false,
      error: `${outside.length} מהמשימות אינן בתחום המרחבים שנבחרו (${outside.map((t) => t.id).join(", ")}). לא בוצע דבר.`,
    };
  }
  const have = new Set(found.map((t) => t.id));
  const missing = unique.filter((id) => !have.has(id));
  if (missing.length) {
    return {
      ok: false,
      error: `מזהים שאינם קיימים: ${missing.join(", ")}. קרא שוב עם read_tasks וקח מזהים משם. לא בוצע דבר.`,
    };
  }
  return { ok: true, value: unique.map((id) => found.find((t) => t.id === id)!) };
}

// ── Writes ────────────────────────────────────────────────────────────────

export type NewTask = z.output<typeof taskCreateSchema>;

export type WritePlan =
  | { kind: "add"; tasks: NewTask[] }
  | { kind: "update"; ids: string[]; changes: TaskPatch }
  | { kind: "delete"; ids: string[] };

/** Deletes always wait for a "yes"; adds and updates only above the threshold. */
export function needsConfirmation(kind: WritePlan["kind"], count: number): boolean {
  return kind === "delete" || count > CONFIRM_THRESHOLD;
}

function planCount(plan: WritePlan): number {
  return plan.kind === "add" ? plan.tasks.length : plan.ids.length;
}

function tasksWord(n: number): string {
  return n === 1 ? "משימה אחת" : `${n} משימות`;
}

function spaceName(scope: ResolvedScope, id: string): string {
  return scope.allSpaces.find((s) => s.id === id)?.name ?? "?";
}

function describeChanges(changes: TaskPatch, scope: ResolvedScope): string {
  const parts: string[] = [];
  if (changes.dueDate !== undefined) {
    parts.push(changes.dueDate ? `תאריך יעד ${formatShortHebrew(changes.dueDate)}` : "ללא תאריך יעד");
  }
  if (changes.status) parts.push(`סטטוס "${STATUS_META[changes.status].label}"`);
  if (changes.priority) parts.push(`עדיפות "${PRIORITY_META[changes.priority].label}"`);
  if (changes.spaceId) parts.push(`העברה למרחב "${spaceName(scope, changes.spaceId)}"`);
  if (changes.title) parts.push(`כותרת "${changes.title}"`);
  if (changes.notes !== undefined) parts.push(changes.notes ? "עדכון הערות" : "מחיקת הערות");
  return parts.join(", ");
}

/** Hebrew, future tense — shown on the confirmation card. */
export function describePlan(plan: WritePlan, scope: ResolvedScope): string {
  const n = planCount(plan);
  if (plan.kind === "delete") return `למחוק ${tasksWord(n)}`;
  if (plan.kind === "update") {
    const c = plan.changes;
    const keys = Object.keys(c).filter((k) => c[k as keyof TaskPatch] !== undefined);
    if (keys.length === 1 && c.dueDate) return `להעביר ${tasksWord(n)} לתאריך ${formatShortHebrew(c.dueDate)}`;
    if (keys.length === 1 && c.status === "done") return `לסמן ${tasksWord(n)} כהושלמו`;
    return `לעדכן ${tasksWord(n)}: ${describeChanges(c, scope)}`;
  }
  const spaceIds = [...new Set(plan.tasks.map((t) => t.spaceId))];
  const where = spaceIds.length === 1 ? ` למרחב "${spaceName(scope, spaceIds[0])}"` : "";
  return n === 1 ? `להוסיף את המשימה "${plan.tasks[0].title}"${where}` : `להוסיף ${n} משימות${where}`;
}

/** Hebrew, past tense — the line after a confirmed action. */
function describeDone(plan: WritePlan, count: number, scope: ResolvedScope): string {
  const one = count === 1;
  if (plan.kind === "add") return one ? "נוספה משימה אחת" : `נוספו ${count} משימות`;
  if (plan.kind === "delete") return one ? "נמחקה משימה אחת" : `נמחקו ${count} משימות`;
  return `${one ? "עודכנה משימה אחת" : `עודכנו ${count} משימות`} (${describeChanges(plan.changes, scope)})`;
}

async function executePlan(plan: WritePlan): Promise<{ count: number; tasks: Task[] }> {
  if (plan.kind === "add") {
    const tasks = await createTasks(plan.tasks);
    return { count: tasks.length, tasks };
  }
  if (plan.kind === "update") {
    const tasks = await updateTasks(plan.ids, plan.changes);
    return { count: tasks.length, tasks };
  }
  return { count: await deleteTasks(plan.ids), tasks: [] };
}

export type WriteOutcome =
  | { executed: true; count: number; tasks: Task[] }
  | { executed: false; pending: PendingActionView };

/**
 * Runs a validated, in-scope write — or parks it for confirmation.
 * `affected` are the current tasks for update/delete (for the confirmation card).
 * `touched` holds the tasks this user message already changed without a "yes". The threshold
 * applies to the whole message, so a bulk change split into several small calls still stops.
 */
export async function submitWrite(
  plan: WritePlan,
  scope: ResolvedScope,
  affected: Task[] = [],
  touched: Set<string> = new Set(),
): Promise<WriteOutcome> {
  const ids = plan.kind === "add" ? [] : plan.ids;
  const total = plan.kind === "add" ? touched.size + plan.tasks.length : new Set([...touched, ...ids]).size;
  if (!needsConfirmation(plan.kind, total)) {
    const result = await executePlan(plan);
    for (const id of plan.kind === "add" ? result.tasks.map((t) => t.id) : ids) touched.add(id);
    return { executed: true, ...result };
  }
  return { executed: false, pending: await createPending(plan, scope, affected) };
}

/** The card lists every title (it scrolls); the cap only guards against a runaway payload. */
const MAX_CARD_ITEMS = 500;

async function createPending(plan: WritePlan, scope: ResolvedScope, affected: Task[]): Promise<PendingActionView> {
  const summary = describePlan(plan, scope);
  const expiresAt = new Date(Date.now() + PENDING_TTL_MINUTES * 60_000);
  const payload = plan.kind === "add" ? { tasks: plan.tasks } : plan.kind === "update" ? { changes: plan.changes } : {};
  const taskIds = plan.kind === "add" ? [] : plan.ids;
  // One live pending action at a time: a new one replaces any older card.
  await supersedePending();
  const [row] = await db()
    .insert(pendingActions)
    .values({ kind: plan.kind, payload, taskIds, scope: scope.spaceIds, summary, expiresAt })
    .returning({ id: pendingActions.id });
  const items =
    plan.kind === "add"
      ? plan.tasks.map((t) => ({ id: null, title: t.title, spaceName: spaceName(scope, t.spaceId) }))
      : affected.map((t) => ({ id: t.id, title: t.title, spaceName: spaceName(scope, t.spaceId) }));
  return {
    id: row.id,
    kind: plan.kind,
    summary,
    count: planCount(plan),
    items: items.slice(0, MAX_CARD_ITEMS),
    expiresAt: expiresAt.toISOString(),
  };
}

/** Cancels every still-pending action (a newer request makes old cards stale). */
export async function supersedePending(): Promise<void> {
  await db().update(pendingActions).set({ status: "cancelled" }).where(eq(pendingActions.status, "pending"));
}

// ── Confirmation ──────────────────────────────────────────────────────────

export interface ConfirmOutcome {
  /** False when nothing could run (not found, expired, already handled, out of scope). */
  ok: boolean;
  /** Short Hebrew line for the chat. */
  reply: string;
  /** True when tasks were written. */
  changed: boolean;
}

const storedPayload = {
  add: z.object({ tasks: z.array(taskCreateSchema).min(1) }),
  update: z.object({ changes: taskPatchSchema }),
};

const ALREADY: Record<string, string> = {
  confirmed: "הפעולה הזו כבר בוצעה.",
  cancelled: "הפעולה הזו כבר בוטלה או הוחלפה בבקשה חדשה. בקש שוב אם צריך.",
  expired: `פג תוקף הבקשה (${PENDING_TTL_MINUTES} דקות). בקש שוב ואכין אותה מחדש.`,
};

const refuse = (reply: string): ConfirmOutcome => ({ ok: false, reply, changed: false });

/** Claims the row atomically: only one caller can move it out of "pending". */
async function claim(id: string, status: "confirmed" | "cancelled", now: Date): Promise<boolean> {
  const rows = await db()
    .update(pendingActions)
    .set({ status })
    .where(and(eq(pendingActions.id, id), eq(pendingActions.status, "pending"), gt(pendingActions.expiresAt, now)))
    .returning({ id: pendingActions.id });
  return rows.length === 1;
}

export async function confirmPending(
  id: string,
  decision: "confirm" | "cancel",
  scope: AgentScope,
  now: Date = new Date(),
): Promise<ConfirmOutcome> {
  if (!z.uuid().safeParse(id).success) return refuse("הפעולה לא נמצאה.");
  const [row] = await db().select().from(pendingActions).where(eq(pendingActions.id, id));
  if (!row) return refuse("הפעולה לא נמצאה.");
  if (row.status !== "pending") return refuse(ALREADY[row.status] ?? "הפעולה כבר טופלה.");
  if (row.expiresAt <= now) {
    await db()
      .update(pendingActions)
      .set({ status: "expired" })
      .where(and(eq(pendingActions.id, id), eq(pendingActions.status, "pending")));
    return refuse(ALREADY.expired);
  }

  if (decision === "cancel") {
    return (await claim(id, "cancelled", now))
      ? { ok: true, reply: "בוטל. לא שיניתי דבר.", changed: false }
      : refuse("הפעולה כבר טופלה.");
  }

  // The action may only run inside a scope at least as wide as the one it was prepared in.
  const current = await resolveScope(scope);
  const allowed = new Set(current.spaceIds);
  const existing = new Set(current.allSpaces.map((s) => s.id));
  const stored = row.scope.filter((sid) => existing.has(sid));
  if (stored.some((sid) => !allowed.has(sid))) {
    return refuse("הפעולה הוכנה עבור מרחבים שאינם בתחום הנוכחי. בחר אותם ב\"עובד על\" ונסה שוב, או בקש מחדש.");
  }

  let plan: WritePlan;
  let missing = 0;
  if (row.kind === "add") {
    const parsed = storedPayload.add.safeParse(row.payload);
    if (!parsed.success) return refuse("הפעולה השמורה פגומה ולא בוצעה.");
    const tasks = parsed.data.tasks.filter((t) => allowed.has(t.spaceId));
    missing = parsed.data.tasks.length - tasks.length;
    plan = { kind: "add", tasks };
  } else if (row.kind === "update" || row.kind === "delete") {
    // Exactly the snapshot — re-filtered to tasks that still exist and are still in scope.
    const still = await listTasks({ ids: row.taskIds, spaceIds: stored });
    const ids = row.taskIds.filter((tid) => still.some((t) => t.id === tid));
    missing = row.taskIds.length - ids.length;
    if (row.kind === "update") {
      const parsed = storedPayload.update.safeParse(row.payload);
      if (!parsed.success) return refuse("הפעולה השמורה פגומה ולא בוצעה.");
      if (parsed.data.changes.spaceId && !allowed.has(parsed.data.changes.spaceId)) {
        return refuse("מרחב היעד כבר לא קיים או אינו בתחום. לא בוצע דבר.");
      }
      plan = { kind: "update", ids, changes: parsed.data.changes };
    } else {
      plan = { kind: "delete", ids };
    }
  } else {
    return refuse("סוג פעולה לא מוכר.");
  }

  if (!(await claim(id, "confirmed", now))) return refuse("הפעולה כבר טופלה.");

  if (planCount(plan) === 0) {
    return { ok: true, reply: "לא בוצע דבר: המשימות כבר לא קיימות או אינן בתחום.", changed: false };
  }
  let result: { count: number };
  try {
    result = await executePlan(plan);
  } catch (e) {
    // Each repo write is a single statement/transaction, so nothing ran — release the claim.
    await db().update(pendingActions).set({ status: "pending" }).where(eq(pendingActions.id, id));
    throw e;
  }
  const note =
    missing === 1
      ? " משימה אחת כבר לא הייתה קיימת או בתחום, ולא נגעתי בה."
      : missing > 1
        ? ` ${missing} משימות כבר לא היו קיימות או בתחום, ולא נגעתי בהן.`
        : "";
  return { ok: true, reply: `בוצע: ${describeDone(plan, result.count, current)}.${note}`, changed: result.count > 0 };
}
