import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/db", async () => (await import("./helpers/test-db")).dbModule());
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers/test-db";
import { db } from "@/db";
import { pendingActions } from "@/db/schema";
import { createSpace, createTasks, listTasks, updateTasks } from "@/lib/repo";
import { confirmPending, resolveScope, resolveSpace, type ResolvedScope } from "@/lib/agent/guard";
import { executeTool, stepText, type ToolContext, type ToolOutcome } from "@/lib/agent/tools";
import type { AgentScope } from "@/lib/agent/types";

const TODAY = "2026-10-06"; // Tuesday

beforeEach(() => resetDb());

async function seed() {
  const home = await createSpace({ name: "בית", color: "emerald", view: "list" });
  const work = await createSpace({ name: "לקוחות והטמעות", color: "indigo", view: "kanban" });
  const arab = await createSpace({ name: "العمل", color: "amber", view: "calendar" });
  return { home, work, arab };
}

async function ctxFor(scope: AgentScope): Promise<ToolContext> {
  return { scope: await resolveScope(scope), today: TODAY };
}

const run = (name: string, args: unknown, ctx: ToolContext) => executeTool(name, JSON.stringify(args), ctx);
const out = (r: ToolOutcome) => JSON.parse(r.output) as Record<string, unknown> & { error?: string };

describe("scope", () => {
  it("resolves 'all' to every space and drops unknown ids", async () => {
    const { home, work } = await seed();
    expect((await resolveScope({ mode: "all" })).spaceIds).toHaveLength(3);
    const s = await resolveScope({ mode: "spaces", spaceIds: [home.id, "00000000-0000-4000-8000-000000000000"] });
    expect(s.spaceIds).toEqual([home.id]);
    expect(s.spaceIds).not.toContain(work.id);
  });

  it("resolves Hebrew and Arabic space names case/space/diacritic-insensitively, only in scope", async () => {
    const { home, work, arab } = await seed();
    const scope = await resolveScope({ mode: "all" });
    const id = (r: ReturnType<typeof resolveSpace>) => (r.ok ? r.value.id : r.error);
    expect(id(resolveSpace("  לקוחות   והטמעות ", scope))).toBe(work.id);
    expect(id(resolveSpace('"בית"', scope))).toBe(home.id);
    expect(id(resolveSpace("العَمَل", scope))).toBe(arab.id);
    expect(id(resolveSpace(home.id, scope))).toBe(home.id);
    const unknown = resolveSpace("גינה", scope);
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.error).toContain('"בית"');

    const narrow = await resolveScope({ mode: "spaces", spaceIds: [home.id] });
    const outside = resolveSpace("العمل", narrow);
    expect(outside.ok).toBe(false);
    expect(!outside.ok && outside.error).toContain("אינו בתחום");
  });

  it("reports ambiguous names", async () => {
    await seed();
    await createSpace({ name: "בית ", color: "rose", view: "list" });
    const r = resolveSpace("בית", await resolveScope({ mode: "all" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("כמה מרחבים");
  });

  it("rejects reads, updates, deletes and moves outside the scope", async () => {
    const { home, work } = await seed();
    const [inside] = await createTasks([{ spaceId: home.id, title: "בפנים" }]);
    const [outside] = await createTasks([{ spaceId: work.id, title: "בחוץ" }]);
    const ctx = await ctxFor({ mode: "spaces", spaceIds: [home.id] });

    const read = out(await run("read_tasks", {}, ctx));
    expect((read.rows as unknown[][]).map((r) => r[1])).toEqual(["בפנים"]);
    expect(out(await run("read_tasks", { ids: [outside.id] }, ctx)).error).toContain("אינן בתחום");
    expect(out(await run("read_tasks", { spaces: ["לקוחות והטמעות"] }, ctx)).error).toContain("אינו בתחום");
    expect(out(await run("summarize_tasks", { spaces: [work.id] }, ctx)).error).toBeDefined();

    const upd = await run("update_tasks", { ids: [inside.id, outside.id], changes: { priority: "urgent" } }, ctx);
    expect(out(upd).error).toContain("אינן בתחום");
    expect(upd.changed).toBe(false);

    const del = await run("delete_tasks", { ids: [outside.id] }, ctx);
    expect(out(del).error).toContain("אינן בתחום");
    expect(del.pending).toBeUndefined();

    const move = await run("update_tasks", { ids: [inside.id], changes: { space: work.id } }, ctx);
    expect(out(move).error).toContain("אינו בתחום");

    const add = await run("add_tasks", { tasks: [{ title: "x", space: "לקוחות והטמעות" }] }, ctx);
    expect(out(add).error).toBeDefined();

    const all = await listTasks();
    expect(all.find((t) => t.id === inside.id)!.priority).toBe("medium");
    expect(all.find((t) => t.id === outside.id)!.spaceId).toBe(work.id);
    expect(all).toHaveLength(2);
  });

  it("returns errors for invalid or unknown arguments instead of throwing", async () => {
    await seed();
    const ctx = await ctxFor({ mode: "all" });
    expect(out(await executeTool("read_tasks", "{not json", ctx)).error).toBeDefined();
    expect(out(await run("drop_database", {}, ctx)).error).toContain("כלי לא מוכר");
    expect(out(await run("update_tasks", { ids: ["nope"], changes: { priority: "urgent" } }, ctx)).error).toBeDefined();
    expect(out(await run("update_tasks", { ids: [crypto.randomUUID()], changes: {} }, ctx)).error).toContain("אין שינויים");
    expect(out(await run("update_tasks", { ids: [crypto.randomUUID()], changes: { due: "x" } }, ctx)).error).toBeDefined();
    expect(out(await run("add_tasks", { tasks: [{ title: "x", space: "בית", dueDate: "2026-02-30" }] }, ctx)).error).toBeDefined();
    expect(out(await run("add_tasks", { tasks: [{ title: "x" }] }, ctx)).error).toContain("חסר מרחב");
    expect(out(await run("delete_tasks", { ids: [crypto.randomUUID()] }, ctx)).error).toContain("אינם קיימים");
  });
});

describe("tools", () => {
  it("adds tasks by space name (≤3 runs immediately) and defaults the space when scope has one", async () => {
    const { home } = await seed();
    const ctx = await ctxFor({ mode: "all" });
    const r = await run(
      "add_tasks",
      {
        tasks: [
          { title: "לקנות חלב", space: "בית" },
          { title: "להתקשר לסבתא", space: "בית", dueDate: "2026-10-07", priority: null },
          { title: "ארנונה", space: "בית", dueDate: "2026-10-10", notes: "עד ה-10" },
        ],
      },
      ctx,
    );
    expect(r.changed).toBe(true);
    expect(r.pending).toBeUndefined();
    expect(out(r)).toMatchObject({ executed: true, added: 3 });
    const one = await ctxFor({ mode: "spaces", spaceIds: [home.id] });
    expect(out(await run("add_tasks", { tasks: [{ title: "בלי מרחב" }] }, one))).toMatchObject({ added: 1 });
    expect((await listTasks({ spaceIds: [home.id] })).map((t) => t.title)).toContain("בלי מרחב");
  });

  it("reads compact rows, defaults to open tasks, truncates notes and caps the list", async () => {
    const { home } = await seed();
    await createTasks([
      { spaceId: home.id, title: "פתוחה", notes: "א".repeat(500), dueDate: "2026-10-01" },
      { spaceId: home.id, title: "סגורה", status: "done" },
    ]);
    const ctx = await ctxFor({ mode: "all" });
    const r = out(await run("read_tasks", {}, ctx));
    expect(r.total).toBe(1);
    const [row] = r.rows as (string | null)[][];
    expect(row.slice(1, 6)).toEqual(["פתוחה", "בית", "medium", "new", "2026-10-01"]);
    expect(row[6]!.length).toBe(201);
    expect(out(await run("read_tasks", { statuses: ["done"] }, ctx)).total).toBe(1);
    expect(out(await run("read_tasks", { overdue: true }, ctx)).total).toBe(1);

    await createTasks(Array.from({ length: 160 }, (_, i) => ({ spaceId: home.id, title: `t${i}` })));
    const big = out(await run("read_tasks", {}, ctx));
    expect(big.total).toBe(161);
    expect((big.rows as unknown[]).length).toBe(150);
    expect(big.truncated).toBeDefined();
  });

  it("summarizes with the same numbers as the dashboard", async () => {
    const { home, work } = await seed();
    const tasks = await createTasks([
      { spaceId: home.id, title: "באיחור", dueDate: "2026-10-01", priority: "urgent" },
      { spaceId: home.id, title: "היום", dueDate: TODAY },
      { spaceId: home.id, title: "השבוע", dueDate: "2026-10-09", priority: "high" },
      { spaceId: home.id, title: "שבוע הבא", dueDate: "2026-10-12" },
      { spaceId: work.id, title: "בלי תאריך", status: "in_progress" },
      { spaceId: work.id, title: "נסגרה", status: "done" },
    ]);
    expect(tasks).toHaveLength(6);
    const s = out(await run("summarize_tasks", {}, await ctxFor({ mode: "all" })));
    expect(s).toMatchObject({
      open: 5,
      byStatus: { new: 4, in_progress: 1, on_hold: 0, done: 1 },
      byPriorityOpen: { urgent: 1, high: 1, medium: 3, low: 0 },
      overdue: 1,
      dueToday: 1,
      dueThisWeek: 2,
      noDueDate: 1,
      closedThisWeek: 1,
    });
    expect(s.perSpace).toEqual([
      { space: "בית", open: 4, overdue: 1, closedThisWeek: 0 },
      { space: "לקוחות והטמעות", open: 1, overdue: 0, closedThisWeek: 1 },
      { space: "العمل", open: 0, overdue: 0, closedThisWeek: 0 },
    ]);
  });

  it("gives Hebrew step lines", () => {
    expect(stepText("read_tasks", "{}")).toBe("קורא משימות…");
    expect(stepText("add_tasks", JSON.stringify({ tasks: [{}, {}, {}] }))).toBe("מוסיף 3 משימות…");
    expect(stepText("update_tasks", JSON.stringify({ ids: ["a", "b"] }))).toBe("מעדכן 2 משימות…");
    expect(stepText("summarize_tasks", "")).toBe("מכין סיכום…");
  });
});

describe("confirmation", () => {
  async function fiveOpen() {
    const { home, work } = await seed();
    const tasks = await createTasks(
      Array.from({ length: 5 }, (_, i) => ({ spaceId: home.id, title: `משימה ${i + 1}`, dueDate: "2026-10-06" })),
    );
    return { home, work, tasks, ctx: await ctxFor({ mode: "all" }) };
  }

  it("runs exactly 3 immediately, parks 4 and any delete", async () => {
    const { tasks, ctx } = await fiveOpen();
    const three = await run("update_tasks", { ids: tasks.slice(0, 3).map((t) => t.id), changes: { priority: "high" } }, ctx);
    expect(three.changed).toBe(true);
    expect(three.pending).toBeUndefined();

    const four = await run("update_tasks", { ids: tasks.slice(0, 4).map((t) => t.id), changes: { dueDate: "2026-10-07" } }, ctx);
    expect(four.changed).toBe(false);
    expect(four.pending).toMatchObject({ kind: "update", count: 4, summary: "להעביר 4 משימות לתאריך ד׳ 7 באוק׳" });
    expect(out(four)).toMatchObject({ executed: false, confirmationRequired: true });
    expect((await listTasks()).every((t) => t.dueDate === "2026-10-06")).toBe(true);

    const del = await run("delete_tasks", { ids: [tasks[0].id] }, ctx);
    expect(del.pending).toMatchObject({ kind: "delete", count: 1, summary: "למחוק משימה אחת" });
    expect(del.pending!.items).toEqual([{ id: tasks[0].id, title: "משימה 1", spaceName: "בית" }]);
    expect(await listTasks()).toHaveLength(5);

    const add = await run("add_tasks", { tasks: [1, 2, 3, 4].map((i) => ({ title: `n${i}`, space: "בית" })) }, ctx);
    expect(add.pending).toMatchObject({ kind: "add", count: 4 });
    expect(add.pending!.items[0]).toEqual({ id: null, title: "n1", spaceName: "בית" });
    expect(await listTasks()).toHaveLength(5);
  });

  it("confirm executes exactly the snapshot ids — a new matching task stays untouched", async () => {
    const { home, tasks, ctx } = await fiveOpen();
    const r = await run("update_tasks", { ids: tasks.map((t) => t.id), changes: { dueDate: "2026-10-07" } }, ctx);
    const pendingId = r.pending!.id;
    const [late] = await createTasks([{ spaceId: home.id, title: "חדשה", dueDate: "2026-10-06" }]);

    const c = await confirmPending(pendingId, "confirm", { mode: "all" });
    expect(c).toMatchObject({ ok: true, changed: true });
    expect(c.reply).toContain("בוצע: עודכנו 5 משימות");
    const after = await listTasks();
    expect(after.filter((t) => t.dueDate === "2026-10-07")).toHaveLength(5);
    expect(after.find((t) => t.id === late.id)!.dueDate).toBe("2026-10-06");
  });

  it("confirms an add and a delete, reporting vanished tasks", async () => {
    const { tasks, ctx } = await fiveOpen();
    const add = await run("add_tasks", { tasks: [1, 2, 3, 4].map((i) => ({ title: `n${i}`, space: "בית" })) }, ctx);
    expect(await confirmPending(add.pending!.id, "confirm", { mode: "all" })).toMatchObject({
      ok: true,
      changed: true,
      reply: "בוצע: נוספו 4 משימות.",
    });

    const del = await run("delete_tasks", { ids: tasks.slice(0, 2).map((t) => t.id) }, ctx);
    await updateTasks([tasks[0].id], { title: "עדיין קיימת" });
    const { deleteTasks } = await import("@/lib/repo");
    await deleteTasks([tasks[1].id]);
    const c = await confirmPending(del.pending!.id, "confirm", { mode: "all" });
    expect(c.reply).toBe("בוצע: נמחקה משימה אחת. משימה אחת כבר לא הייתה קיימת או בתחום, ולא נגעתי בה.");
    expect(await listTasks()).toHaveLength(7);
  });

  it("cancel changes nothing", async () => {
    const { tasks, ctx } = await fiveOpen();
    const r = await run("delete_tasks", { ids: tasks.map((t) => t.id) }, ctx);
    expect(await confirmPending(r.pending!.id, "cancel", { mode: "all" })).toEqual({
      ok: true,
      changed: false,
      reply: "בוטל. לא שיניתי דבר.",
    });
    expect(await listTasks()).toHaveLength(5);
    expect((await confirmPending(r.pending!.id, "confirm", { mode: "all" })).ok).toBe(false);
    expect(await listTasks()).toHaveLength(5);
  });

  it("refuses an expired action", async () => {
    const { tasks, ctx } = await fiveOpen();
    const r = await run("delete_tasks", { ids: [tasks[0].id] }, ctx);
    await db()
      .update(pendingActions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(pendingActions.id, r.pending!.id));
    const c = await confirmPending(r.pending!.id, "confirm", { mode: "all" });
    expect(c).toMatchObject({ ok: false, changed: false });
    expect(c.reply).toContain("פג תוקף");
    expect(await listTasks()).toHaveLength(5);
    const [row] = await db().select().from(pendingActions).where(eq(pendingActions.id, r.pending!.id));
    expect(row.status).toBe("expired");
  });

  it("executes once on a double confirm, even concurrently", async () => {
    const { tasks, ctx } = await fiveOpen();
    const r = await run("update_tasks", { ids: tasks.map((t) => t.id), changes: { status: "done" } }, ctx);
    const results = await Promise.all([
      confirmPending(r.pending!.id, "confirm", { mode: "all" }),
      confirmPending(r.pending!.id, "confirm", { mode: "all" }),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect((await confirmPending(r.pending!.id, "confirm", { mode: "all" })).reply).toBe("הפעולה הזו כבר בוצעה.");
  });

  it("refuses to run in a narrower scope than it was prepared in", async () => {
    const { home, tasks, ctx } = await fiveOpen();
    const r = await run("delete_tasks", { ids: [tasks[0].id] }, ctx);
    const other = (ctx.scope as ResolvedScope).spaceIds.find((id) => id !== home.id)!;
    const c = await confirmPending(r.pending!.id, "confirm", { mode: "spaces", spaceIds: [other] });
    expect(c.ok).toBe(false);
    expect(await listTasks()).toHaveLength(5);
  });

  it("keeps only one live pending action", async () => {
    const { tasks, ctx } = await fiveOpen();
    const first = await run("delete_tasks", { ids: [tasks[0].id] }, ctx);
    const second = await run("delete_tasks", { ids: [tasks[1].id] }, ctx);
    expect((await confirmPending(first.pending!.id, "confirm", { mode: "all" })).ok).toBe(false);
    expect((await confirmPending(second.pending!.id, "confirm", { mode: "all" })).ok).toBe(true);
    expect((await listTasks()).map((t) => t.id)).toContain(tasks[0].id);
  });

  it("rejects malformed and unknown ids", async () => {
    expect((await confirmPending("x", "confirm", { mode: "all" })).ok).toBe(false);
    expect((await confirmPending(crypto.randomUUID(), "confirm", { mode: "all" })).reply).toBe("הפעולה לא נמצאה.");
  });
});
