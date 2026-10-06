/**
 * The agent's five tools: JSON schemas for OpenAI function calling, and the
 * executors behind them. Every argument is validated with zod and every write
 * goes through the guard — a bad call becomes an error message for the model,
 * never a crash and never an out-of-scope change. Outputs are compact JSON to
 * keep tokens (and cost) low.
 */
import "server-only";
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { instance } from "@/config/instance";
import { addDays, weekStart } from "@/lib/dates";
import { PRIORITIES, PRIORITY_META, STATUSES, type Status, type Task } from "@/lib/domain";
import { getSpaceStats, listTasks, type TaskFilter } from "@/lib/repo";
import { isoDate, taskCreateSchema, taskPatchSchema, type TaskPatch } from "@/lib/validation";
import {
  loadTasksInScope,
  needsConfirmation,
  resolveSpace,
  submitWrite,
  type NewTask,
  type ResolvedScope,
  type WritePlan,
} from "./guard";
import type { PendingActionView } from "./types";

export const READ_CAP = 150;
const NOTES_PREVIEW = 200;
const MAX_IDS = 500;
const MAX_ADD = 50;
const OPEN: Status[] = ["new", "in_progress", "on_hold"];

// ── Schemas the model sees ───────────────────────────────────────────────

const PRI = { type: "string", enum: [...PRIORITIES] };
const STA = { type: "string", enum: [...STATUSES] };
const DATE = { type: "string", description: "YYYY-MM-DD" };
const IDS = { type: "array", items: { type: "string" }, description: "Task ids from read_tasks" };
const SPACES = { type: "array", items: { type: "string" }, description: "Space names or ids; omit = whole scope" };

const fn = (name: string, description: string, parameters: Record<string, unknown>): ChatCompletionFunctionTool => ({
  type: "function",
  function: { name, description, parameters: { type: "object", additionalProperties: false, ...parameters } },
});

export const TOOL_DEFINITIONS: ChatCompletionFunctionTool[] = [
  fn(
    "read_tasks",
    "Find tasks in scope. Default: open tasks only (pass statuses incl. 'done' for closed). Returns rows [id,title,space,priority,status,due,notes], sorted by due date then priority, max 150.",
    {
      properties: {
        spaces: SPACES,
        ids: IDS,
        statuses: { type: "array", items: STA },
        priorities: { type: "array", items: PRI },
        dueFrom: DATE,
        dueTo: DATE,
        overdue: { type: "boolean", description: "Open tasks due before today" },
        hasDueDate: { type: "boolean" },
        query: { type: "string", description: "Text in title or notes" },
      },
    },
  ),
  fn("add_tasks", "Add one or more tasks in one call. Defaults: priority medium, status new.", {
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            space: { type: "string", description: "Space name or id (may be omitted if scope has one space)" },
            priority: PRI,
            status: STA,
            dueDate: DATE,
            notes: { type: "string" },
          },
          required: ["title"],
        },
      },
    },
    required: ["tasks"],
  }),
  fn("update_tasks", "Apply the same changes to tasks by id. dueDate/notes null = clear. space = move.", {
    properties: {
      ids: IDS,
      changes: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          notes: { type: ["string", "null"] },
          priority: PRI,
          status: STA,
          dueDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
          space: { type: "string" },
        },
      },
    },
    required: ["ids", "changes"],
  }),
  fn("delete_tasks", "Delete tasks by id. Always needs the user's confirmation.", {
    properties: { ids: IDS },
    required: ["ids"],
  }),
  fn(
    "summarize_tasks",
    "Computed counts: by status, by priority (open), overdue, due today, due this week, closed this week, per space.",
    { properties: { spaces: SPACES } },
  ),
];

// ── Argument validation ──────────────────────────────────────────────────

const opt = <T extends z.ZodType>(t: T) => t.nullish().transform((v) => v ?? undefined);
const ids = z.array(z.uuid("מזהה משימה לא תקין")).min(1, "חסרים מזהים").max(MAX_IDS);
const spacesArg = opt(z.array(z.string().min(1)).max(50));

const readArgs = z.strictObject({
  spaces: spacesArg,
  ids: opt(z.array(z.uuid("מזהה משימה לא תקין")).max(MAX_IDS)),
  statuses: opt(z.array(z.enum(STATUSES))),
  priorities: opt(z.array(z.enum(PRIORITIES))),
  dueFrom: opt(isoDate),
  dueTo: opt(isoDate),
  overdue: opt(z.boolean()),
  hasDueDate: opt(z.boolean()),
  query: opt(z.string().max(200)),
});

const addArgs = z.strictObject({
  tasks: z
    .array(
      z.strictObject({
        title: z.string(),
        space: opt(z.string()),
        priority: opt(z.enum(PRIORITIES)),
        status: opt(z.enum(STATUSES)),
        dueDate: opt(isoDate),
        notes: opt(z.string()),
      }),
    )
    .min(1, "אין משימות להוספה")
    .max(MAX_ADD),
});

const updateArgs = z.strictObject({
  ids,
  changes: z.strictObject({
    title: opt(z.string()),
    notes: z.string().nullable().optional(),
    priority: opt(z.enum(PRIORITIES)),
    status: opt(z.enum(STATUSES)),
    dueDate: isoDate.nullable().optional(),
    space: opt(z.string()),
  }),
});

const deleteArgs = z.strictObject({ ids });
const summarizeArgs = z.strictObject({ spaces: spacesArg });

function issues(e: z.ZodError): string {
  return e.issues
    .slice(0, 5)
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

// ── Execution ────────────────────────────────────────────────────────────

export type ToolName = "read_tasks" | "add_tasks" | "update_tasks" | "delete_tasks" | "summarize_tasks";

export interface ToolContext {
  scope: ResolvedScope;
  /** Today in the owner's time zone, YYYY-MM-DD. */
  today: string;
  /** Tasks written without confirmation so far in this user message (see submitWrite). */
  touched?: Set<string>;
}

export interface ToolOutcome {
  /** JSON string handed back to the model. */
  output: string;
  /** True when tasks were written. */
  changed: boolean;
  /** Set when the write was parked for confirmation — the loop must stop. */
  pending?: PendingActionView;
}

const json = (v: unknown) => JSON.stringify(v);
const fail = (error: string): ToolOutcome => ({ output: json({ error }), changed: false });

function parseArgs(raw: string): unknown {
  return raw.trim() ? JSON.parse(raw) : {};
}

/** Resolves a list of space refs inside scope; omitted → the whole scope. */
function resolveSpaces(refs: string[] | undefined, scope: ResolvedScope): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!scope.spaceIds.length) return { ok: false, error: "אין מרחבים בתחום שנבחר." };
  if (!refs?.length) return { ok: true, ids: scope.spaceIds };
  const out: string[] = [];
  for (const ref of refs) {
    const r = resolveSpace(ref, scope);
    if (!r.ok) return r;
    out.push(r.value.id);
  }
  return { ok: true, ids: [...new Set(out)] };
}

const byDueThenPriority = (a: Task, b: Task) =>
  (a.dueDate ?? "9999") < (b.dueDate ?? "9999")
    ? -1
    : (a.dueDate ?? "9999") > (b.dueDate ?? "9999")
      ? 1
      : PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;

async function readTasks(raw: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const p = readArgs.safeParse(raw);
  if (!p.success) return fail(issues(p.error));
  const a = p.data;
  const spaces = resolveSpaces(a.spaces, ctx.scope);
  if (!spaces.ok) return fail(spaces.error);
  if (a.ids?.length) {
    const check = await loadTasksInScope(a.ids, ctx.scope);
    if (!check.ok) return fail(check.error);
  }
  const filter: TaskFilter = {
    spaceIds: spaces.ids,
    ids: a.ids?.length ? a.ids : undefined,
    statuses: a.statuses?.length ? a.statuses : a.ids?.length ? undefined : OPEN,
    priorities: a.priorities,
    dueFrom: a.dueFrom,
    dueTo: a.dueTo,
    overdue: a.overdue || undefined,
    today: ctx.today,
    hasDueDate: a.hasDueDate,
    query: a.query,
  };
  const found = (await listTasks(filter)).sort(byDueThenPriority);
  const names = new Map(ctx.scope.spaces.map((s) => [s.id, s.name]));
  const rows = found.slice(0, READ_CAP).map((t) => [
    t.id,
    t.title,
    names.get(t.spaceId) ?? "?",
    t.priority,
    t.status,
    t.dueDate,
    t.notes ? (t.notes.length > NOTES_PREVIEW ? `${t.notes.slice(0, NOTES_PREVIEW)}…` : t.notes) : null,
  ]);
  const out: Record<string, unknown> = { total: found.length, rows };
  if (found.length > READ_CAP) out.truncated = `showing first ${READ_CAP}; narrow the filter`;
  return { output: json(out), changed: false };
}

function writeResult(r: Awaited<ReturnType<typeof submitWrite>>, scope: ResolvedScope, verb: string): ToolOutcome {
  if (!r.executed) {
    return {
      output: json({
        executed: false,
        confirmationRequired: true,
        summary: r.pending.summary,
        count: r.pending.count,
        note: "NOT done yet. Tell the user what will change; they approve with the buttons or by writing \"כן\". Call no more tools.",
      }),
      changed: false,
      pending: r.pending,
    };
  }
  const names = new Map(scope.allSpaces.map((s) => [s.id, s.name]));
  const out: Record<string, unknown> = { executed: true, [verb]: r.count };
  if (r.tasks.length) out.tasks = r.tasks.map((t) => ({ id: t.id, title: t.title, space: names.get(t.spaceId) }));
  return { output: json(out), changed: r.count > 0 };
}

async function addTasks(raw: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const p = addArgs.safeParse(raw);
  if (!p.success) return fail(issues(p.error));
  const tasks: NewTask[] = [];
  for (const [i, item] of p.data.tasks.entries()) {
    let spaceId: string;
    if (item.space) {
      const r = resolveSpace(item.space, ctx.scope);
      if (!r.ok) return fail(`tasks.${i}: ${r.error}. לא בוצע דבר.`);
      spaceId = r.value.id;
    } else if (ctx.scope.spaces.length === 1) {
      spaceId = ctx.scope.spaceIds[0];
    } else {
      return fail(`tasks.${i}: חסר מרחב. מרחבים זמינים: ${ctx.scope.spaces.map((s) => `"${s.name}"`).join(", ")}`);
    }
    const t = taskCreateSchema.safeParse({ ...item, spaceId, space: undefined });
    if (!t.success) return fail(`tasks.${i}: ${issues(t.error)}. לא בוצע דבר.`);
    tasks.push(t.data);
  }
  return writeResult(await submitWrite({ kind: "add", tasks }, ctx.scope, [], ctx.touched), ctx.scope, "added");
}

async function updateTasksTool(raw: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const p = updateArgs.safeParse(raw);
  if (!p.success) return fail(issues(p.error));
  const { space, ...rest } = p.data.changes;
  const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (space) {
    const r = resolveSpace(space, ctx.scope);
    if (!r.ok) return fail(`${r.error}. לא בוצע דבר.`);
    patch.spaceId = r.value.id;
  }
  if (!Object.keys(patch).length) return fail("אין שינויים לביצוע (changes ריק).");
  const changes = taskPatchSchema.safeParse(patch);
  if (!changes.success) return fail(issues(changes.error));
  const tasks = await loadTasksInScope(p.data.ids, ctx.scope);
  if (!tasks.ok) return fail(tasks.error);
  const plan: WritePlan = { kind: "update", ids: tasks.value.map((t) => t.id), changes: changes.data as TaskPatch };
  return writeResult(await submitWrite(plan, ctx.scope, tasks.value, ctx.touched), ctx.scope, "updated");
}

async function deleteTasksTool(raw: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const p = deleteArgs.safeParse(raw);
  if (!p.success) return fail(issues(p.error));
  const tasks = await loadTasksInScope(p.data.ids, ctx.scope);
  if (!tasks.ok) return fail(tasks.error);
  const plan: WritePlan = { kind: "delete", ids: tasks.value.map((t) => t.id) };
  return writeResult(await submitWrite(plan, ctx.scope, tasks.value, ctx.touched), ctx.scope, "deleted");
}

/** Same numbers as the dashboard: overdue and closed-this-week come from getSpaceStats. */
async function summarizeTasks(raw: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const p = summarizeArgs.safeParse(raw);
  if (!p.success) return fail(issues(p.error));
  const spaces = resolveSpaces(p.data.spaces, ctx.scope);
  if (!spaces.ok) return fail(spaces.error);
  const [all, stats] = await Promise.all([listTasks({ spaceIds: spaces.ids }), getSpaceStats(spaces.ids, ctx.today)]);
  const weekEnd = addDays(weekStart(ctx.today, instance.weekStartsOn), 6);
  const open = all.filter((t) => t.status !== "done");
  const count = <K extends string>(keys: readonly K[], pick: (t: Task) => K, list: Task[]) =>
    Object.fromEntries(keys.map((k) => [k, list.filter((t) => pick(t) === k).length]));
  const names = new Map(ctx.scope.spaces.map((s) => [s.id, s.name]));
  const sum = (k: "open" | "overdue" | "closedThisWeek") => stats.reduce((n, s) => n + s[k], 0);
  return {
    output: json({
      today: ctx.today,
      open: sum("open"),
      byStatus: count(STATUSES, (t) => t.status, all),
      byPriorityOpen: count(PRIORITIES, (t) => t.priority, open),
      overdue: sum("overdue"),
      dueToday: open.filter((t) => t.dueDate === ctx.today).length,
      dueThisWeek: open.filter((t) => t.dueDate && t.dueDate >= ctx.today && t.dueDate <= weekEnd).length,
      noDueDate: open.filter((t) => !t.dueDate).length,
      closedThisWeek: sum("closedThisWeek"),
      perSpace: stats.map((s) => ({
        space: names.get(s.spaceId),
        open: s.open,
        overdue: s.overdue,
        closedThisWeek: s.closedThisWeek,
      })),
    }),
    changed: false,
  };
}

const EXECUTORS: Record<ToolName, (args: unknown, ctx: ToolContext) => Promise<ToolOutcome>> = {
  read_tasks: readTasks,
  add_tasks: addTasks,
  update_tasks: updateTasksTool,
  delete_tasks: deleteTasksTool,
  summarize_tasks: summarizeTasks,
};

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(EXECUTORS, name);
}

/** Runs one tool call. Never throws for bad input — the error goes back to the model. */
export async function executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolOutcome> {
  if (!isToolName(name)) return fail(`כלי לא מוכר: ${name}`);
  let args: unknown;
  try {
    args = parseArgs(rawArgs);
  } catch {
    return fail("הארגומנטים אינם JSON תקין.");
  }
  return EXECUTORS[name](args, ctx);
}

function countOf(rawArgs: string, key: "tasks" | "ids"): number {
  try {
    const v = (parseArgs(rawArgs) as Record<string, unknown>)?.[key];
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

const many = (n: number) => (n === 1 ? "משימה אחת" : `${n} משימות`);

/** The Hebrew progress line shown while a tool runs, e.g. "מעדכן 2 משימות…". */
export function stepText(name: string, rawArgs: string): string {
  switch (name) {
    case "read_tasks":
      return "קורא משימות…";
    case "summarize_tasks":
      return "מכין סיכום…";
    case "add_tasks": {
      const n = countOf(rawArgs, "tasks");
      return needsConfirmation("add", n) ? `מכין הוספה של ${many(n)} לאישור…` : `מוסיף ${many(n)}…`;
    }
    case "update_tasks": {
      const n = countOf(rawArgs, "ids");
      return needsConfirmation("update", n) ? `מכין עדכון של ${many(n)} לאישור…` : `מעדכן ${many(n)}…`;
    }
    case "delete_tasks":
      return `מכין מחיקה של ${many(countOf(rawArgs, "ids"))} לאישור…`;
    default:
      return "עובד…";
  }
}
