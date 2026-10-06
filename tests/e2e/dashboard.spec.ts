/** Spec 2.6 — dashboard: space chips saved in the database, "what's burning", quick complete, per-space cards, calm empty state. */
import type { Locator, Page } from "@playwright/test";
import { test, expect, inDays } from "./support/fixtures";

const chips = (page: Page) => page.getByRole("group", { name: "המרחבים שמוצגים בדשבורד" });
const group = (page: Page, label: "באיחור" | "להיום" | "דחוף") => page.getByRole("list", { name: new RegExp(`^${label} \\d+$`) });
const rowTitles = (list: Locator) => list.locator("li button span[dir=auto]").allTextContents();

test("the space selection is saved in the database and survives a reload", async ({ page, api, makeSpace, keepDashboardSelection }) => {
  void keepDashboardSelection;
  const { space: a } = await makeSpace({ label: "chipA", tasks: [{ title: "E2E chip A late", dueDate: inDays(-2) }] });
  const { space: b } = await makeSpace({ label: "chipB", tasks: [{ title: "E2E chip B late", dueDate: inDays(-2) }] });
  await api.setDashboardSelection(null);
  await page.goto("/");
  const all = chips(page).getByRole("button", { name: "כל המרחבים" });
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("E2E chip A late")).toBeVisible();

  // Turning A off: the choice is written to the database…
  await chips(page).getByRole("button", { name: a.name }).click();
  await expect(chips(page).getByRole("button", { name: a.name })).toHaveAttribute("aria-pressed", "false");
  await expect(all).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => api.dashboardSelection()).not.toBeNull();
  const saved = (await api.dashboardSelection())!;
  expect(saved).not.toContain(a.id);
  expect(saved).toContain(b.id);
  await expect(page.getByText("E2E chip A late")).toHaveCount(0);
  await expect(page.getByText("E2E chip B late")).toBeVisible();

  // …so a fresh load (any device) shows the same choice.
  await page.reload();
  await expect(chips(page).getByRole("button", { name: a.name })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("E2E chip A late")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "מרחבים" }).getByRole("link", { name: new RegExp(a.name) })).toHaveCount(0);

  await all.click();
  await expect.poll(() => api.dashboardSelection()).toBeNull();
  await expect(page.getByText("E2E chip A late")).toBeVisible();
});

test("what's burning: overdue → today → urgent, each task once; quick complete; space card", async ({ page, api, makeSpace, keepDashboardSelection, shot }) => {
  void keepDashboardSelection;
  const { space, tasks } = await makeSpace({
    label: "burn",
    color: "rose",
    tasks: [
      { title: "E2E late urgent", priority: "urgent", dueDate: inDays(-3) },
      { title: "E2E late medium", priority: "medium", dueDate: inDays(-1) },
      { title: "E2E today urgent", priority: "urgent", dueDate: inDays(0) },
      { title: "E2E today high", priority: "high", dueDate: inDays(0) },
      { title: "E2E urgent undated", priority: "urgent" },
      { title: "E2E urgent next week", priority: "urgent", dueDate: inDays(7) },
      { title: "E2E calm low", priority: "low", dueDate: inDays(4) },
      { title: "E2E late but done", priority: "urgent", dueDate: inDays(-2), status: "done" },
    ],
  });
  await api.setDashboardSelection([space.id]);
  await page.goto("/");

  const sections = page.locator("#burning-title ~ div h3");
  await expect(sections).toHaveCount(3);
  await expect(sections.nth(0)).toContainText("באיחור");
  await expect(sections.nth(1)).toContainText("להיום");
  await expect(sections.nth(2)).toContainText("דחוף");

  expect(await rowTitles(group(page, "באיחור"))).toEqual(["E2E late urgent", "E2E late medium"]);
  expect((await rowTitles(group(page, "להיום"))).sort()).toEqual(["E2E today high", "E2E today urgent"]);
  expect(await rowTitles(group(page, "דחוף"))).toEqual(["E2E urgent next week", "E2E urgent undated"]);
  for (const t of ["E2E late urgent", "E2E today urgent"]) await expect(page.locator("main").getByText(t, { exact: true })).toHaveCount(1);
  await expect(page.getByText("E2E calm low")).toHaveCount(0);
  await expect(page.getByText("E2E late but done")).toHaveCount(0);
  await expect(page.locator("main header p")).toHaveText("2 משימות באיחור, 2 להיום ו־2 דחופות.");

  // Each row: the space's color dot and name, and a click opens the card.
  const row = group(page, "באיחור").locator("li").first();
  await expect(row).toContainText(space.name);
  await expect(row.locator("span.rounded-full").first()).toHaveCSS("background-color", "rgb(225, 29, 72)");

  // The space card: open, overdue, closed this week — and it leads into the space.
  const card = page.getByRole("region", { name: "מרחבים" }).getByRole("link", { name: new RegExp(space.name) });
  await expect(card).toContainText(/7\s*פתוחות/);
  await expect(card).toContainText(/2\s*באיחור/);
  await expect(card).toContainText(/1\s*נסגרה השבוע/);
  await shot("dashboard");

  // Quick complete from the dashboard.
  await page.getByRole("checkbox", { name: "סמן כהושלמה: E2E late medium" }).click();
  await expect(page.getByRole("status").filter({ hasText: "המשימה הושלמה" })).toBeVisible();
  await expect(group(page, "באיחור").getByText("E2E late medium")).toHaveCount(0);
  await expect.poll(async () => (await api.task(tasks[1].id))?.status).toBe("done");
  await expect(card).toContainText(/6\s*פתוחות/);
  await expect(card).toContainText(/1\s*באיחור/);
  await expect(card).toContainText(/2\s*נסגרו השבוע/);

  // Clicking a task opens its card.
  await page.getByRole("button", { name: "E2E urgent undated" }).click();
  await expect(page.getByRole("dialog", { name: "עריכת משימה" })).toBeVisible();
  await page.keyboard.press("Escape");

  await card.click();
  await page.waitForURL(new RegExp(`/spaces/${space.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(space.name);
});

test("nothing burning → a positive message, not an empty screen", async ({ page, api, makeSpace, keepDashboardSelection, shot }) => {
  void keepDashboardSelection;
  const { space } = await makeSpace({ label: "calm", tasks: [{ title: "E2E someday", priority: "low" }] });
  await api.setDashboardSelection([space.id]);
  await page.goto("/");
  await expect(page.getByText("אין שום דבר באיחור, להיום או דחוף.")).toBeVisible();
  await expect(page.locator("main header p")).toHaveText("אין שום דבר באיחור או להיום.");
  await shot("dashboard-calm");
});

test("offline: a quick-completed task comes back with a message", async ({ page, context, api, makeSpace, keepDashboardSelection }) => {
  void keepDashboardSelection;
  const { space } = await makeSpace({ label: "offdash", tasks: [{ title: "E2E offline late", dueDate: inDays(-1) }] });
  await api.setDashboardSelection([space.id]);
  await page.goto("/");
  await expect(group(page, "באיחור").getByText("E2E offline late")).toBeVisible();
  await context.setOffline(true);
  try {
    await page.getByRole("checkbox", { name: "סמן כהושלמה: E2E offline late" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "אין חיבור לשרת" })).toBeVisible();
    await expect(group(page, "באיחור").getByText("E2E offline late")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("offline: the chip selection snaps back when it could not be saved", async ({ page, context, api, makeSpace, keepDashboardSelection }) => {
  void keepDashboardSelection;
  const { space } = await makeSpace({ label: "offchip" });
  await api.setDashboardSelection(null);
  await page.goto("/");
  const chip = chips(page).getByRole("button", { name: space.name });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await context.setOffline(true);
  try {
    await chip.click();
    await expect(page.getByRole("alert").filter({ hasText: "אין חיבור לשרת" })).toBeVisible();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(chips(page).getByRole("button", { name: "כל המרחבים" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await context.setOffline(false);
  }
});
