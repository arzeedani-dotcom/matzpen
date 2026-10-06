/** Spec 2.4 — the TODO list: priority groups, due-date order, check with undo, folded "done", quick add. */
import type { Page } from "@playwright/test";
import { test, expect, inDays, openSpace } from "./support/fixtures";

const groupTitles = (page: Page, label: string) =>
  page.getByRole("region", { name: new RegExp(`^${label}`) }).locator("li button[data-list-row] > span:first-child").allTextContents();

test("grouped urgent → low, each group by due date with undated last", async ({ page, makeSpace, shot }) => {
  const { space } = await makeSpace({
    label: "list",
    view: "list",
    color: "emerald",
    tasks: [
      { title: "E2E low undated", priority: "low" },
      { title: "E2E urgent undated", priority: "urgent" },
      { title: "E2E urgent in 5 days", priority: "urgent", dueDate: inDays(5) },
      { title: "E2E medium yesterday", priority: "medium", dueDate: inDays(-1) },
      { title: "E2E urgent tomorrow", priority: "urgent", dueDate: inDays(1) },
      { title: "E2E high today", priority: "high", dueDate: inDays(0) },
      { title: "E2E medium undated", priority: "medium" },
      { title: "E2E medium in 3 days", priority: "medium", dueDate: inDays(3) },
      { title: "E2E closed", status: "done" },
    ],
  });
  await openSpace(page, space.id);

  const headings = page.getByRole("heading", { level: 2 });
  await expect(headings.first()).toBeVisible();
  const labels = (await page.locator("section[aria-labelledby] h2").allTextContents()).map((t) => t.replace(/[\d\s⚑▲●▽]|משימות/g, ""));
  expect(labels).toEqual(["דחוף", "גבוהה", "בינונית", "נמוכה"]);

  expect(await groupTitles(page, "דחוף")).toEqual(["E2E urgent tomorrow", "E2E urgent in 5 days", "E2E urgent undated"]);
  expect(await groupTitles(page, "בינונית")).toEqual(["E2E medium yesterday", "E2E medium in 3 days", "E2E medium undated"]);

  // Due dates read the same everywhere: late in red with "באיחור", today, tomorrow.
  const row = (t: string) => page.locator("li").filter({ hasText: t });
  await expect(row("E2E medium yesterday")).toContainText("באיחור של יום");
  await expect(row("E2E high today")).toContainText("היום");
  await expect(row("E2E urgent tomorrow")).toContainText("מחר");
  await expect(row("E2E medium yesterday").getByText("באיחור של יום")).toHaveCSS("color", "rgb(220, 38, 38)");

  // Done tasks wait folded at the bottom.
  const fold = page.getByRole("button", { name: /^הושלמו \(1\)/ });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("E2E closed")).toBeHidden();
  await shot("list");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("E2E closed")).toBeVisible();
});

test("check → done, with an undo that shows for about 5 seconds", async ({ page, api, makeSpace }) => {
  const { space, tasks } = await makeSpace({
    label: "check",
    view: "list",
    tasks: [{ title: "E2E check me", status: "in_progress" }, { title: "E2E keep" }],
  });
  await openSpace(page, space.id);
  await page.getByRole("checkbox", { name: "סמן כהושלמה: E2E check me" }).click();
  const toast = page.getByRole("status").filter({ hasText: "סומנה כהושלמה" });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: /^(בטל|ביטול)$/ })).toBeVisible();
  await expect.poll(async () => (await api.task(tasks[0].id))?.status).toBe("done");
  await expect(page.getByRole("button", { name: /^הושלמו \(1\)/ })).toBeVisible();

  // Undo restores the status it had before (in progress), not just "new".
  await toast.getByRole("button", { name: /^(בטל|ביטול)$/ }).click();
  await expect.poll(async () => (await api.task(tasks[0].id))?.status).toBe("in_progress");
  await expect(page.getByRole("checkbox", { name: "סמן כהושלמה: E2E check me" })).toBeVisible();
  expect((await api.task(tasks[0].id))?.completedAt).toBeNull();

  // Without undo the toast goes away by itself after ~5 seconds.
  await page.getByRole("checkbox", { name: "סמן כהושלמה: E2E keep" }).click();
  const second = page.getByRole("status").filter({ hasText: "סומנה כהושלמה" });
  await expect(second).toBeVisible();
  const shownAt = Date.now();
  await expect(second).toBeHidden({ timeout: 8_000 });
  const visibleFor = Date.now() - shownAt;
  expect(visibleFor).toBeGreaterThan(3_500);
  expect(visibleFor).toBeLessThan(6_500);
  expect((await api.task(tasks[1].id))?.status).toBe("done");
  // Everything is done → a calm empty state, not a blank page.
  await page.getByRole("checkbox", { name: "סמן כהושלמה: E2E check me" }).click();
  await expect(page.getByText("הכול סגור כאן.")).toBeVisible();
});

test("quick add: type, Enter → a new task with medium priority", async ({ page, api, makeSpace }) => {
  const { space } = await makeSpace({ label: "quick", view: "list" });
  await openSpace(page, space.id);
  const input = page.getByRole("textbox", { name: "הוספת משימה מהירה" });
  await input.fill("E2E quick one");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused(); // ready for the next one
  await input.fill("E2E quick two");
  await input.press("Enter");

  await expect(page.getByRole("region", { name: /^בינונית/ })).toContainText("E2E quick one");
  await expect(page.getByRole("region", { name: /^בינונית/ })).toContainText("E2E quick two");
  await expect.poll(async () => (await api.tasks(space.id)).map((t) => [t.title, t.priority, t.status]).sort()).toEqual([
    ["E2E quick one", "medium", "new"],
    ["E2E quick two", "medium", "new"],
  ]);

  // Whitespace only adds nothing.
  await input.fill("   ");
  await input.press("Enter");
  await page.waitForTimeout(400);
  expect((await api.tasks(space.id)).length).toBe(2);
});
