/** Spec 2.1: create, edit, reorder and delete spaces. */
import { test, expect, contrastRatio, openSpace, PREFIX } from "./support/fixtures";
import { SPACE_COLORS, VIEW_META, type View } from "../../src/lib/domain";

const hex = (key: string) => SPACE_COLORS.find((c) => c.key === key)!.hex;
const rgb = (h: string) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;

const sidebar = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "ניווט ראשי" });

for (const [view, colorKey] of [
  ["kanban", "rose"],
  ["list", "emerald"],
  ["calendar", "violet"],
] as [View, string][]) {
  test(`create a space with the ${view} view`, async ({ page, api, track, shot }) => {
    await page.goto("/");
    await sidebar(page).getByRole("button", { name: "מרחב חדש" }).click();
    const dialog = page.getByRole("dialog", { name: "מרחב חדש" });
    await expect(dialog).toBeVisible();

    // The palette: 10 colors, chosen by click (each one named, never a color code to type).
    const swatches = dialog.getByRole("group", { name: "צבע" }).getByRole("button");
    await expect(swatches).toHaveCount(10);
    const name = `${PREFIX}${VIEW_META[view].label} ${Date.now() % 100000}`;
    await dialog.getByPlaceholder("למשל: לקוחות, בית, לימודים").fill(name);
    const label = SPACE_COLORS.find((c) => c.key === colorKey)!.label;
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await expect(dialog.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: new RegExp(`^${VIEW_META[view].label}`) }).click();
    await expect(dialog.getByRole("button", { name: new RegExp(`^${VIEW_META[view].label}`) })).toHaveAttribute("aria-pressed", "true");
    if (view === "calendar") await shot("space-form-new");
    await dialog.getByRole("button", { name: "יצירת המרחב" }).click();

    await page.waitForURL(/\/spaces\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    track(id);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByRole("radiogroup", { name: "תצוגה" }).getByRole("radio", { checked: true })).toHaveAccessibleName(VIEW_META[view].label);

    // The space color marks the header and its line in the menu.
    const headerBar = page.locator("main header span[aria-hidden]").first();
    await expect(headerBar).toHaveCSS("background-color", rgb(hex(colorKey)));
    const link = sidebar(page).getByRole("link", { name });
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(link.locator("span").first()).toHaveCSS("background-color", rgb(hex(colorKey)));

    const saved = (await api.spaces()).find((s) => s.id === id)!;
    expect(saved).toMatchObject({ name, color: colorKey, view });
  });
}

test("a space needs a name", async ({ page, api }) => {
  const before = (await api.spaces()).length;
  await page.goto("/");
  await sidebar(page).getByRole("button", { name: "מרחב חדש" }).click();
  const dialog = page.getByRole("dialog", { name: "מרחב חדש" });
  await dialog.getByRole("button", { name: "יצירת המרחב" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "חסר שם למרחב" })).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "ביטול" }).click();
  await expect(dialog).toBeHidden();
  expect((await api.spaces()).length).toBe(before);
});

test("edit a space: name, color and view", async ({ page, api, makeSpace }) => {
  const { space } = await makeSpace({ label: "edit", color: "indigo", view: "kanban" });
  await openSpace(page, space.id);
  await page.getByRole("button", { name: "הגדרות מרחב" }).click();
  const dialog = page.getByRole("dialog", { name: "הגדרות מרחב" });
  const input = dialog.getByPlaceholder("למשל: לקוחות, בית, לימודים");
  await expect(input).toHaveValue(space.name);
  const newName = `${PREFIX}renamed ${Date.now() % 10000}`;
  await input.fill(newName);
  await dialog.getByRole("button", { name: "תכלת", exact: true }).click();
  await dialog.getByRole("button", { name: /^לוח שנה/ }).click();
  await dialog.getByRole("button", { name: "שמירת שינויים" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "המרחב עודכן" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(newName);
  await expect(sidebar(page).getByRole("link", { name: newName })).toBeVisible();
  await expect(page.getByRole("grid")).toBeVisible(); // the calendar is on screen now
  await expect.poll(async () => (await api.spaces()).find((s) => s.id === space.id)).toMatchObject({ name: newName, color: "sky", view: "calendar" });

  // The view switch in the header saves too (spec 2.4: the choice is kept per space).
  await page.getByRole("radiogroup", { name: "תצוגה" }).getByRole("radio", { name: "רשימה" }).click();
  await expect(page.getByPlaceholder("הוספת משימה מהירה…")).toBeVisible();
  await expect.poll(async () => (await api.spaces()).find((s) => s.id === space.id)?.view).toBe("list");
  await page.reload();
  await expect(page.getByPlaceholder("הוספת משימה מהירה…")).toBeVisible();
});

test("reorder spaces in the sidebar; the order is saved", async ({ page, api, makeSpace }) => {
  const { space: a } = await makeSpace({ label: "order A" });
  const { space: b } = await makeSpace({ label: "order B" });
  await page.goto("/");
  const nav = sidebar(page);
  await expect(nav.getByRole("link", { name: b.name })).toBeVisible();
  const names = async () => (await nav.locator("ul li").allTextContents()).map((t) => t.trim()).filter((t) => t.startsWith(PREFIX + "order"));
  expect(await names()).toEqual([a.name, b.name]);

  await nav.getByRole("button", { name: "שינוי סדר המרחבים" }).click();
  await nav.getByRole("button", { name: `העלאת ${b.name}` }).click();
  await expect.poll(names).toEqual([b.name, a.name]);
  await nav.getByRole("button", { name: "סיום סידור המרחבים" }).click();

  // Saved on the server…
  await expect
    .poll(async () => {
      const order = (await api.spaces()).map((s) => s.id);
      return order.indexOf(b.id) < order.indexOf(a.id);
    })
    .toBe(true);
  // …and shown that way after a reload.
  await page.reload();
  await expect(nav.getByRole("link", { name: b.name })).toBeVisible();
  expect(await names()).toEqual([b.name, a.name]);
});

test("delete a space: double confirmation that names the task count", async ({ page, api, makeSpace, shot }) => {
  const { space, tasks } = await makeSpace({
    label: "delete",
    view: "list",
    tasks: [{ title: "E2E one" }, { title: "E2E two", status: "done" }, { title: "E2E three" }],
  });
  await openSpace(page, space.id);
  await page.getByRole("button", { name: "הגדרות מרחב" }).click();
  const dialog = page.getByRole("dialog", { name: "הגדרות מרחב" });

  // Step back out once: nothing is deleted.
  await dialog.getByRole("button", { name: "מחיקת המרחב" }).click();
  await expect(dialog.getByText("מחיקת המרחב תמחק גם 3 משימות. אי אפשר לבטל את זה.")).toBeVisible();
  await dialog.getByRole("button", { name: "לא למחוק" }).click();
  await expect(dialog.getByText(/תמחק גם/)).toBeHidden();

  await dialog.getByRole("button", { name: "מחיקת המרחב" }).click();
  await dialog.getByRole("button", { name: "הבנתי, להמשיך" }).click();
  await shot("space-delete-confirm");
  const final = dialog.getByRole("button", { name: "מחיקה סופית" });
  expect(await contrastRatio(final), "the final delete button is readable").toBeGreaterThanOrEqual(4);
  await final.click();

  await page.waitForURL((u) => u.pathname === "/");
  await expect(page.getByRole("status").filter({ hasText: "המרחב נמחק יחד עם 3 משימות" })).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: space.name })).toHaveCount(0);
  expect((await api.spaces()).some((s) => s.id === space.id)).toBe(false);
  expect(await api.task(tasks[0].id)).toBeNull();
});

test("deleting an empty space says it is empty", async ({ page, api, makeSpace }) => {
  const { space } = await makeSpace({ label: "empty", view: "kanban" });
  await openSpace(page, space.id);
  await page.getByRole("button", { name: "הגדרות מרחב" }).click();
  const dialog = page.getByRole("dialog", { name: "הגדרות מרחב" });
  await dialog.getByRole("button", { name: "מחיקת המרחב" }).click();
  await expect(dialog.getByText("המרחב ריק. מחיקה לצמיתות?")).toBeVisible();
  await dialog.getByRole("button", { name: "הבנתי, להמשיך" }).click();
  await dialog.getByRole("button", { name: "מחיקה סופית" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  expect((await api.spaces()).some((s) => s.id === space.id)).toBe(false);
});

test("a double click on “מחיקה סופית” deletes once, without an error", async ({ page, makeSpace }) => {
  const { space } = await makeSpace({ label: "dbl", view: "list", tasks: [{ title: "E2E x" }] });
  await openSpace(page, space.id);
  await page.getByRole("button", { name: "הגדרות מרחב" }).click();
  const dialog = page.getByRole("dialog", { name: "הגדרות מרחב" });
  await dialog.getByRole("button", { name: "מחיקת המרחב" }).click();
  await dialog.getByRole("button", { name: "הבנתי, להמשיך" }).click();
  const deletes: number[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "DELETE") deletes.push(r.status());
  });
  await dialog.getByRole("button", { name: "מחיקה סופית" }).dblclick();
  await page.waitForURL((u) => u.pathname === "/");
  await page.waitForTimeout(800);
  expect(deletes, "exactly one DELETE, and it succeeded").toEqual([200]);
  // (Next.js route announcer is role=alert too and reads the new page title — not an error.)
  expect(await page.locator("[role=alert]:not(#__next-route-announcer__)").count()).toBe(0);
});

test("the delete warning waits for the real task count (never says “empty” while counting)", async ({ page, makeSpace }) => {
  const { space } = await makeSpace({ label: "slow", view: "list", tasks: [{ title: "E2E a" }, { title: "E2E b" }] });
  // Open the settings from the dashboard, where this space's tasks are not loaded yet, on a slow network.
  await page.goto("/");
  await page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: space.name }).waitFor();
  await page.route(`**/api/tasks?spaceId=${space.id}`, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto(`/spaces/${space.id}`);
  await page.getByRole("button", { name: "הגדרות מרחב" }).click();
  const dialog = page.getByRole("dialog", { name: "הגדרות מרחב" });
  await dialog.getByRole("button", { name: "מחיקת המרחב" }).click();
  // Checked at once (no retrying): while the count is unknown the dialog must not call the space empty.
  expect(await dialog.getByText("המרחב ריק. מחיקה לצמיתות?").count()).toBe(0);
  await expect(dialog.getByText("מחיקת המרחב תמחק גם 2 משימות. אי אפשר לבטל את זה.")).toBeVisible();
  await dialog.getByRole("button", { name: "לא למחוק" }).click();
});

test("offline: a reorder that could not be saved snaps back", async ({ page, context, makeSpace }) => {
  const { space: a } = await makeSpace({ label: "offA" });
  const { space: b } = await makeSpace({ label: "offB" });
  await page.goto("/");
  const nav = sidebar(page);
  await expect(nav.getByRole("link", { name: b.name })).toBeVisible();
  const names = async () => (await nav.locator("ul li").allTextContents()).map((t) => t.trim()).filter((t) => t.startsWith(PREFIX + "off"));
  await nav.getByRole("button", { name: "שינוי סדר המרחבים" }).click();
  await context.setOffline(true);
  try {
    await nav.getByRole("button", { name: `העלאת ${b.name}` }).click();
    await expect(page.getByRole("alert").filter({ hasText: "אין חיבור לשרת" })).toBeVisible();
    await expect.poll(names).toEqual([a.name, b.name]);
  } finally {
    await context.setOffline(false);
  }
});
