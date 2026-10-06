import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/db", async () => (await import("./helpers/test-db")).dbModule());
import { resetDb } from "./helpers/test-db";
import {
  createSpace,
  createTasks,
  deleteSpace,
  getDashboard,
  getSetting,
  getSpaceStats,
  listSpaces,
  listTasks,
  setSetting,
  updateTasks,
} from "@/lib/repo";

beforeEach(() => resetDb());

async function seedSpace(name = "בית") {
  return createSpace({ name, color: "emerald", view: "list" });
}

describe("moving tasks", () => {
  it("a task moved into another space lands at the end of its column there", async () => {
    const a = await seedSpace("א");
    const b = await seedSpace("ב");
    await createTasks([{ spaceId: b.id, title: "b1" }, { spaceId: b.id, title: "b2" }]);
    const [moved] = await createTasks([{ spaceId: a.id, title: "a1" }]);
    const [after] = await updateTasks([moved.id], { spaceId: b.id });
    const others = (await listTasks({ spaceIds: [b.id] })).filter((t) => t.id !== moved.id);
    expect(after.position).toBeGreaterThan(Math.max(...others.map((t) => t.position)));
    expect((await listTasks({ spaceIds: [b.id] })).at(-1)?.id).toBe(moved.id);
  });
});

describe("spaces", () => {
  it("creates spaces in order and deletes with their tasks", async () => {
    const a = await seedSpace("א");
    const b = await seedSpace("ב");
    expect((await listSpaces()).map((s) => s.id)).toEqual([a.id, b.id]);
    await createTasks([{ spaceId: a.id, title: "x" }, { spaceId: a.id, title: "y" }]);
    expect(await deleteSpace(a.id)).toEqual({ deletedTasks: 2 });
    expect(await listTasks()).toHaveLength(0);
  });
});

describe("tasks", () => {
  it("appends positions per space and applies defaults", async () => {
    const s = await seedSpace();
    const [t1, t2] = await createTasks([{ spaceId: s.id, title: " לקנות חלב " }, { spaceId: s.id, title: "ארנונה" }]);
    expect(t1.title).toBe("לקנות חלב");
    expect(t1.priority).toBe("medium");
    expect(t1.status).toBe("new");
    expect(t2.position).toBeGreaterThan(t1.position);
  });

  it("stamps completedAt on done and clears it when reopened", async () => {
    const s = await seedSpace();
    const [t] = await createTasks([{ spaceId: s.id, title: "x" }]);
    const [done] = await updateTasks([t.id], { status: "done" });
    expect(done.completedAt).not.toBeNull();
    const [again] = await updateTasks([t.id], { status: "done", title: "y" });
    expect(again.completedAt).toBe(done.completedAt);
    const [reopened] = await updateTasks([t.id], { status: "in_progress" });
    expect(reopened.completedAt).toBeNull();
  });

  it("filters by scope, overdue and text", async () => {
    const a = await seedSpace("א");
    const b = await seedSpace("ב");
    await createTasks([
      { spaceId: a.id, title: "ישן", dueDate: "2026-10-01" },
      { spaceId: a.id, title: "סגור ישן", dueDate: "2026-10-01", status: "done" },
      { spaceId: a.id, title: "היום", dueDate: "2026-10-06", notes: "קישור ל-50% הנחה" },
      { spaceId: b.id, title: "אחר", dueDate: "2026-10-01" },
    ]);
    const overdue = await listTasks({ spaceIds: [a.id], overdue: true, today: "2026-10-06" });
    expect(overdue.map((t) => t.title)).toEqual(["ישן"]);
    expect(await listTasks({ spaceIds: [] })).toEqual([]);
    expect((await listTasks({ query: "50%" })).map((t) => t.title)).toEqual(["היום"]);
  });
});

describe("dashboard", () => {
  it("groups overdue, today and urgent without duplicates, and counts per space", async () => {
    const s = await seedSpace();
    await createTasks([
      { spaceId: s.id, title: "באיחור ודחוף", dueDate: "2026-10-01", priority: "urgent" },
      { spaceId: s.id, title: "להיום", dueDate: "2026-10-06" },
      { spaceId: s.id, title: "דחוף לשבוע הבא", dueDate: "2026-10-12", priority: "urgent" },
      { spaceId: s.id, title: "נסגר", status: "done" },
    ]);
    const d = await getDashboard([s.id], "2026-10-06");
    expect(d.overdue.map((t) => t.title)).toEqual(["באיחור ודחוף"]);
    expect(d.dueToday.map((t) => t.title)).toEqual(["להיום"]);
    expect(d.urgent.map((t) => t.title)).toEqual(["דחוף לשבוע הבא"]);
    const [stats] = await getSpaceStats([s.id], "2026-10-06");
    expect(stats).toMatchObject({ open: 3, overdue: 1 });
  });
});

describe("settings", () => {
  it("round-trips JSON values", async () => {
    expect(await getSetting("k", [])).toEqual([]);
    await setSetting("k", ["a"]);
    await setSetting("k", ["a", "b"]);
    expect(await getSetting("k", [])).toEqual(["a", "b"]);
  });
});
