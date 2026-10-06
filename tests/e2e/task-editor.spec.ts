/** Spec 2.5 — the task card: fields, colored pickers, date shortcuts, move between spaces, links, save, Esc, unsaved prompt, delete, limits. */
import type { Locator, Page } from "@playwright/test";
import { test, expect, inDays, openSpace, today } from "./support/fixtures";

const editor = (page: Page, mode: "new" | "edit" = "new") => page.getByRole("dialog", { name: mode === "new" ? "משימה חדשה" : "עריכת משימה" });

/** The element actually on top at the center of `loc` belongs to it (not covered by a modal backdrop). */
async function expectOnTop(loc: Locator) {
  const onTop = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  });
  expect(onTop, "the element is on top and can be clicked").toBe(true);
}

test("create a task: title, colored priority & status buttons, date shortcuts, Ctrl+Enter", async ({ page, api, makeSpace, shot }) => {
  const { space } = await makeSpace({ label: "editor", view: "list", color: "violet" });
  await openSpace(page, space.id);
  await page.getByRole("button", { name: "משימה חדשה" }).click();
  const dialog = editor(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder("מה צריך לעשות?")).toBeFocused();

  // Priority and status are buttons (radios), not a dropdown; defaults are medium / new.
  const priority = dialog.getByRole("radiogroup", { name: "עדיפות" });
  const status = dialog.getByRole("radiogroup", { name: "סטטוס" });
  await expect(priority.getByRole("radio")).toHaveCount(4);
  await expect(status.getByRole("radio")).toHaveCount(4);
  await expect(dialog.locator("select")).toHaveCount(0);
  await expect(priority.getByRole("radio", { checked: true })).toHaveAccessibleName("בינונית");
  await expect(status.getByRole("radio", { checked: true })).toHaveAccessibleName("חדשה");
  await priority.getByRole("radio", { name: "גבוהה" }).click();
  await expect(priority.getByRole("radio", { name: "גבוהה" })).toHaveCSS("background-color", "rgb(234, 88, 12)");
  await expect(priority.getByRole("radio", { name: "דחוף" })).toHaveCSS("color", "rgb(220, 38, 38)");
  await status.getByRole("radio", { name: "בעבודה" }).click();
  await expect(status.getByRole("radio", { name: "בעבודה" })).toHaveAttribute("aria-checked", "true");

  // Date: picker + shortcuts.
  const date = dialog.locator('input[type="date"]');
  await dialog.getByRole("button", { name: "היום", exact: true }).click();
  await expect(date).toHaveValue(today());
  await dialog.getByRole("button", { name: "מחר", exact: true }).click();
  await expect(date).toHaveValue(inDays(1));
  await dialog.getByRole("button", { name: "בעוד שבוע", exact: true }).click();
  await expect(date).toHaveValue(inDays(7));
  await dialog.getByRole("button", { name: /^(נקה|ניקוי)$/ }).click();
  await expect(date).toHaveValue("");
  await expect(dialog).toContainText("ללא תאריך");
  await date.fill(inDays(3));

  await dialog.getByPlaceholder("מה צריך לעשות?").fill("E2E from the editor");
  await dialog.getByPlaceholder("פרטים, לינקים, מה סוכם…").fill("ראו https://example.com/e2e?x=1 ואז לסגור.");
  await shot("task-editor");
  await dialog.getByPlaceholder("פרטים, לינקים, מה סוכם…").press("Control+Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "המשימה נוספה" })).toBeVisible();

  const [task] = await api.tasks(space.id);
  expect(task).toMatchObject({ title: "E2E from the editor", priority: "high", status: "in_progress", dueDate: inDays(3) });

  // Notes show as text with a clickable link when the card is opened again.
  await page.getByRole("button", { name: /E2E from the editor/ }).click();
  const edit = editor(page, "edit");
  const link = edit.getByRole("link", { name: "https://example.com/e2e?x=1" });
  await expect(link).toHaveAttribute("href", "https://example.com/e2e?x=1");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(edit).toContainText("ואז לסגור.");
});

test("edit: save button, move to another space", async ({ page, api, makeSpace }) => {
  const { space: from, tasks } = await makeSpace({ label: "from", view: "list", tasks: [{ title: "E2E moving task", priority: "low" }] });
  const { space: to } = await makeSpace({ label: "to", view: "list" });
  await openSpace(page, from.id);
  await page.getByRole("button", { name: /E2E moving task/ }).click();
  const dialog = editor(page, "edit");
  await dialog.getByPlaceholder("מה צריך לעשות?").fill("E2E moved task");
  await dialog.getByRole("button", { name: to.name }).click();
  await dialog.getByRole("button", { name: "שמירת שינויים" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "השינויים נשמרו" })).toBeVisible();
  await expect(page.getByText("E2E moved task")).toHaveCount(0); // it left this space
  await expect.poll(async () => (await api.task(tasks[0].id))?.spaceId).toBe(to.id);
  expect((await api.task(tasks[0].id))?.title).toBe("E2E moved task");
  await openSpace(page, to.id);
  await expect(page.getByText("E2E moved task")).toBeVisible();
});

test("Esc closes; with unsaved changes it asks first", async ({ page, api, makeSpace }) => {
  const { space, tasks } = await makeSpace({ label: "esc", view: "list", tasks: [{ title: "E2E esc task" }] });
  await openSpace(page, space.id);
  const open = () => page.getByRole("button", { name: /E2E esc task/ }).click();

  await open();
  await expect(editor(page, "edit")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor(page, "edit")).toBeHidden();

  await open();
  await editor(page, "edit").getByPlaceholder("מה צריך לעשות?").fill("E2E changed but not saved");
  const prompts: string[] = [];
  page.once("dialog", (d) => {
    prompts.push(d.message());
    void d.dismiss(); // "no, keep editing"
  });
  await page.keyboard.press("Escape");
  await expect.poll(() => prompts).toEqual(["יש שינויים שלא נשמרו. לסגור בלי לשמור?"]);
  await expect(editor(page, "edit")).toBeVisible();
  await expect(editor(page, "edit").getByPlaceholder("מה צריך לעשות?")).toHaveValue("E2E changed but not saved");

  // A second Esc right away must ask again — the card must not vanish while still "open".
  page.once("dialog", (d) => {
    prompts.push(d.message());
    void d.accept(); // "yes, discard"
  });
  await page.keyboard.press("Escape");
  await expect.poll(() => prompts.length).toBe(2);
  await expect(editor(page, "edit")).toBeHidden();
  expect((await api.task(tasks[0].id))?.title).toBe("E2E esc task");

  // And the same card opens again normally.
  await open();
  await expect(editor(page, "edit")).toBeVisible();
  await expect(editor(page, "edit").getByPlaceholder("מה צריך לעשות?")).toHaveValue("E2E esc task");
});

test("delete asks for confirmation", async ({ page, api, makeSpace }) => {
  const { space, tasks } = await makeSpace({ label: "deltask", view: "list", tasks: [{ title: "E2E delete me" }] });
  await openSpace(page, space.id);
  await page.getByRole("button", { name: /E2E delete me/ }).click();
  const dialog = editor(page, "edit");
  await dialog.getByRole("button", { name: "מחיקה" }).click();
  await expect(dialog.getByText("למחוק לצמיתות?")).toBeVisible();
  await dialog.getByRole("button", { name: "לא", exact: true }).click();
  await expect(dialog.getByText("למחוק לצמיתות?")).toBeHidden();
  expect(await api.task(tasks[0].id)).not.toBeNull();

  await dialog.getByRole("button", { name: "מחיקה" }).click();
  await dialog.getByRole("button", { name: "כן, למחוק" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "המשימה נמחקה" })).toBeVisible();
  await expect.poll(() => api.task(tasks[0].id)).toBeNull();
});

test("a title is required and at most 200 characters", async ({ page, api, makeSpace }) => {
  const { space } = await makeSpace({ label: "limits", view: "list" });
  await openSpace(page, space.id);
  await page.getByRole("button", { name: "משימה חדשה" }).click();
  const dialog = editor(page);
  const title = dialog.getByPlaceholder("מה צריך לעשות?");

  // Empty → a message the user can actually see and read above the open card.
  await dialog.getByRole("button", { name: "הוספת משימה" }).click();
  const error = page.getByRole("alert").filter({ hasText: "חסרה כותרת למשימה" });
  await expect(error).toBeVisible();
  await expectOnTop(error);
  await expect(dialog).toBeVisible();

  await title.fill("א".repeat(250));
  await expect(title).toHaveValue("א".repeat(200));
  await dialog.getByRole("button", { name: "הוספת משימה" }).click();
  await expect(dialog).toBeHidden();
  expect((await api.tasks(space.id))[0].title).toHaveLength(200);

  // The server enforces the same limit for any client (the agent included).
  const res = await page.request.post("/api/tasks", { data: { spaceId: space.id, title: "ב".repeat(201) } });
  expect(res.status()).toBe(400);
  expect((await api.tasks(space.id)).length).toBe(1);
});

test("a double click on save creates the task once", async ({ page, api, makeSpace }) => {
  const { space } = await makeSpace({ label: "dbl", view: "list" });
  await openSpace(page, space.id);
  await page.getByRole("button", { name: "משימה חדשה" }).click();
  const dialog = editor(page);
  await dialog.getByPlaceholder("מה צריך לעשות?").fill("E2E only once");
  await dialog.getByRole("button", { name: "הוספת משימה" }).dblclick();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(500);
  expect((await api.tasks(space.id)).length).toBe(1);
});

test("a double click on “כן, למחוק” deletes once, without an error", async ({ page, api, makeSpace }) => {
  const { space, tasks } = await makeSpace({ label: "dbldel", view: "list", tasks: [{ title: "E2E delete twice" }] });
  await openSpace(page, space.id);
  await page.getByRole("button", { name: /E2E delete twice/ }).click();
  const dialog = editor(page, "edit");
  await dialog.getByRole("button", { name: "מחיקה" }).click();
  const deletes: number[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "DELETE") deletes.push(r.status());
  });
  await dialog.getByRole("button", { name: "כן, למחוק" }).dblclick();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(800);
  expect(deletes, "exactly one DELETE, and it succeeded").toEqual([200]);
  // (Next.js route announcer is role=alert too and reads the new page title — not an error.)
  expect(await page.locator("[role=alert]:not(#__next-route-announcer__)").count()).toBe(0);
  expect(await api.task(tasks[0].id)).toBeNull();
});
