/**
 * The data layer. The REST API and the agent both go through these functions,
 * so a task the agent adds is indistinguishable from one added by hand.
 */
import "server-only";
import { and, asc, eq, gte, ilike, inArray, lt, lte, max, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { settings, spaces, tasks } from "@/db/schema";
import { instance } from "@/config/instance";
import { weekStart } from "./dates";
import {
  PRIORITY_META,
  type DashboardData,
  type Priority,
  type Space,
  type SpaceColor,
  type SpaceStats,
  type Status,
  type Task,
  type View,
} from "./domain";
import type { SpaceCreate, SpacePatch, TaskCreate, TaskPatch } from "./validation";

type SpaceRow = typeof spaces.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

function toSpace(r: SpaceRow): Space {
  return {
    id: r.id,
    name: r.name,
    color: r.color as SpaceColor,
    view: r.view as View,
    position: r.position,
    createdAt: r.createdAt.toISOString(),
  };
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    spaceId: r.spaceId,
    title: r.title,
    notes: r.notes,
    priority: r.priority as Priority,
    status: r.status as Status,
    dueDate: r.dueDate,
    position: r.position,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ── Spaces ────────────────────────────────────────────────────────────────

export async function listSpaces(): Promise<Space[]> {
  const rows = await db().select().from(spaces).orderBy(asc(spaces.position), asc(spaces.createdAt));
  return rows.map(toSpace);
}

export async function getSpace(id: string): Promise<Space | null> {
  const [row] = await db().select().from(spaces).where(eq(spaces.id, id));
  return row ? toSpace(row) : null;
}

export async function createSpace(input: SpaceCreate): Promise<Space> {
  const [{ top }] = await db().select({ top: max(spaces.position) }).from(spaces);
  const [row] = await db()
    .insert(spaces)
    .values({ ...input, position: (top ?? -1) + 1 })
    .returning();
  return toSpace(row);
}

export async function updateSpace(id: string, patch: SpacePatch): Promise<Space | null> {
  if (Object.keys(patch).length === 0) return getSpace(id);
  const [row] = await db().update(spaces).set(patch).where(eq(spaces.id, id)).returning();
  return row ? toSpace(row) : null;
}

/** Deletes the space and (by cascade) its tasks. Returns how many tasks went with it, or null if not found. */
export async function deleteSpace(id: string): Promise<{ deletedTasks: number } | null> {
  const count = await countTasks([id]);
  const rows = await db().delete(spaces).where(eq(spaces.id, id)).returning({ id: spaces.id });
  return rows.length ? { deletedTasks: count } : null;
}

/** Sets the sidebar order. Spaces missing from `ids` keep their relative order after the listed ones. */
export async function reorderSpaces(ids: string[]): Promise<void> {
  const listed = new Set(ids);
  const rest = (await listSpaces()).map((s) => s.id).filter((id) => !listed.has(id));
  await db().transaction(async (tx) => {
    for (const [i, id] of [...listed, ...rest].entries()) {
      await tx.update(spaces).set({ position: i }).where(eq(spaces.id, id));
    }
  });
}

export async function countTasks(spaceIds: string[]): Promise<number> {
  if (!spaceIds.length) return 0;
  const [{ n }] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(inArray(tasks.spaceId, spaceIds));
  return n;
}

// ── Tasks ─────────────────────────────────────────────────────────────────

export interface TaskFilter {
  /** Restrict to these spaces. An empty array matches nothing. */
  spaceIds?: string[];
  ids?: string[];
  statuses?: Status[];
  priorities?: Priority[];
  /** Inclusive range on due date. */
  dueFrom?: string;
  dueTo?: string;
  /** Only open tasks whose due date is before `today`. Requires `today`. */
  overdue?: boolean;
  today?: string;
  /** true = only dated tasks, false = only undated. */
  hasDueDate?: boolean;
  /** Case-insensitive match on title or notes. */
  query?: string;
  limit?: number;
}

export async function listTasks(filter: TaskFilter = {}): Promise<Task[]> {
  if (filter.spaceIds && filter.spaceIds.length === 0) return [];
  if (filter.ids && filter.ids.length === 0) return [];
  const where: SQL[] = [];
  if (filter.spaceIds) where.push(inArray(tasks.spaceId, filter.spaceIds));
  if (filter.ids) where.push(inArray(tasks.id, filter.ids));
  if (filter.statuses?.length) where.push(inArray(tasks.status, filter.statuses));
  if (filter.priorities?.length) where.push(inArray(tasks.priority, filter.priorities));
  if (filter.dueFrom) where.push(gte(tasks.dueDate, filter.dueFrom));
  if (filter.dueTo) where.push(lte(tasks.dueDate, filter.dueTo));
  if (filter.hasDueDate === true) where.push(sql`${tasks.dueDate} is not null`);
  if (filter.hasDueDate === false) where.push(sql`${tasks.dueDate} is null`);
  if (filter.overdue) {
    if (!filter.today) throw new Error("overdue filter requires today");
    where.push(ne(tasks.status, "done"), lt(tasks.dueDate, filter.today));
  }
  if (filter.query?.trim()) {
    const q = `%${filter.query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(tasks.title, q), ilike(tasks.notes, q))!);
  }
  const query = db()
    .select()
    .from(tasks)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(tasks.position), asc(tasks.createdAt));
  const rows = filter.limit ? await query.limit(filter.limit) : await query;
  return rows.map(toTask);
}

export async function getTask(id: string): Promise<Task | null> {
  const [row] = await db().select().from(tasks).where(eq(tasks.id, id));
  return row ? toTask(row) : null;
}

/** Inserts tasks in order; each goes to the end of its space. */
export async function createTasks(inputs: TaskCreate[]): Promise<Task[]> {
  if (!inputs.length) return [];
  return db().transaction(async (tx) => {
    const spaceIds = [...new Set(inputs.map((i) => i.spaceId))];
    const tops = await tx
      .select({ spaceId: tasks.spaceId, top: max(tasks.position) })
      .from(tasks)
      .where(inArray(tasks.spaceId, spaceIds))
      .groupBy(tasks.spaceId);
    const next = new Map(tops.map((t) => [t.spaceId, (t.top ?? 0) + 1]));
    const values = inputs.map((i) => {
      const position = next.get(i.spaceId) ?? 1;
      next.set(i.spaceId, position + 1);
      const status = i.status ?? "new";
      return {
        spaceId: i.spaceId,
        title: i.title.trim(),
        notes: i.notes?.trim() || null,
        priority: i.priority ?? "medium",
        status,
        dueDate: i.dueDate ?? null,
        position,
        completedAt: status === "done" ? new Date() : null,
      };
    });
    const rows = await tx.insert(tasks).values(values).returning();
    return rows.map(toTask);
  });
}

/**
 * Applies one patch to many tasks. Moving into "done" stamps completedAt (keeping
 * an earlier stamp); moving out of "done" clears it.
 */
export async function updateTasks(ids: string[], patch: TaskPatch): Promise<Task[]> {
  if (!ids.length) return [];
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title.trim();
  if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.spaceId !== undefined) {
    set.spaceId = patch.spaceId;
    // A task moved into another space goes to the end of its column there.
    if (patch.position === undefined) {
      set.position = sql`case when ${tasks.spaceId} = ${patch.spaceId} then ${tasks.position}
        else (select coalesce(max(t.position), 0) + 1 from ${tasks} t where t.space_id = ${patch.spaceId}) end`;
    }
  }
  if (patch.position !== undefined) set.position = patch.position;
  if (patch.status !== undefined) {
    set.status = patch.status;
    set.completedAt =
      patch.status === "done"
        ? sql`case when ${tasks.status} = 'done' and ${tasks.completedAt} is not null then ${tasks.completedAt} else now() end`
        : null;
  }
  const rows = await db().update(tasks).set(set).where(inArray(tasks.id, ids)).returning();
  return rows.map(toTask);
}

export async function deleteTasks(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db().delete(tasks).where(inArray(tasks.id, ids)).returning({ id: tasks.id });
  return rows.length;
}

// ── Dashboard & stats ────────────────────────────────────────────────────

const byUrgency = (a: Task, b: Task) =>
  (a.dueDate ?? "9999") < (b.dueDate ?? "9999")
    ? -1
    : (a.dueDate ?? "9999") > (b.dueDate ?? "9999")
      ? 1
      : PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;

export async function getSpaceStats(spaceIds: string[], today: string): Promise<SpaceStats[]> {
  if (!spaceIds.length) return [];
  const since = weekStart(today, instance.weekStartsOn);
  const rows = await db()
    .select({
      spaceId: tasks.spaceId,
      open: sql<number>`count(*) filter (where ${tasks.status} <> 'done')::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueDate} < ${today})::int`,
      closedThisWeek: sql<number>`count(*) filter (where ${tasks.status} = 'done' and ${tasks.completedAt} >= (${since}::date::timestamp at time zone ${instance.timeZone}))::int`,
    })
    .from(tasks)
    .where(inArray(tasks.spaceId, spaceIds))
    .groupBy(tasks.spaceId);
  const found = new Map(rows.map((r) => [r.spaceId, r]));
  return spaceIds.map((id) => found.get(id) ?? { spaceId: id, open: 0, overdue: 0, closedThisWeek: 0 });
}

/** Overdue → due today → urgent; each task appears once, in the first group it fits. */
export async function getDashboard(spaceIds: string[], today: string): Promise<DashboardData> {
  const open = await listTasks({ spaceIds, statuses: ["new", "in_progress", "on_hold"] });
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today).sort(byUrgency);
  const dueToday = open.filter((t) => t.dueDate === today).sort(byUrgency);
  const urgent = open
    .filter((t) => t.priority === "urgent" && !(t.dueDate && t.dueDate <= today))
    .sort(byUrgency);
  const stats = await getSpaceStats(spaceIds, today);
  return { today, overdue, dueToday, urgent, stats };
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db().select().from(settings).where(eq(settings.key, key));
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db()
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export const DASHBOARD_SPACES_KEY = "dashboard.spaceIds";
