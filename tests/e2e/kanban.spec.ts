/** Spec 2.4 — kanban: four status columns with counters, drag (mouse + keyboard), saved order, done shows 20. */
import type { Locator, Page } from "@playwright/test";
import { test, expect, mouseDrag, openSpace } from "./support/fixtures";

const column = (page: Page, label: string) => page.getByRole("region", { name: new RegExp(`^${label}, \\d+ משימות$`) });
const card = (scope: Page | Locator, title: string) => scope.getByRole("button", { name: new RegExp(`^${title}\\.`) });
const titlesIn = (col: Locator) => col.locator("article p").allTextContents();

test("four status columns with task counters", async ({ page, makeSpace, shot }) => {
  const { space } = await makeSpace({
    label: "kanban",
    view: "kanban",
    color: "indigo",
    tasks: [
      { title: "E2E new A", priority: "urgent" },
      { title: "E2E new B", priority: "low" },
      { title: "E2E doing", status: "in_progress", priority: "high" },
      { title: "E2E finished", status: "done" },
    ],
  });
  await openSpace(page, space.id);
  const regions = page.getByRole("region");
  await expect(regions).toHaveCount(4);
  await expect(regions.nth(0)).toHaveAccessibleName("חדשה, 2 משימות");
  await expect(regions.nth(1)).toHaveAccessibleName("בעבודה, 1 משימות");
  await expect(regions.nth(2)).toHaveAccessibleName("בהשהייה, 0 משימות");
  await expect(regions.nth(3)).toHaveAccessibleName("הושלמה, 1 משימות");
  // The counter is visible, not only announced.
  await expect(column(page, "חדשה").locator("header")).toContainText("2");
  await expect(column(page, "בהשהייה")).toContainText("אין כאן משימות");
  // RTL: the first status sits on the right.
  const first = (await regions.nth(0).boundingBox())!;
  const second = (await regions.nth(1).boundingBox())!;
  expect(first.x).toBeGreaterThan(second.x);
  await shot("kanban");
});

test("drag a card to another column with the mouse — saved, and still there after reload", async ({ page, api, makeSpace }) => {
  const { space, tasks } = await makeSpace({ label: "drag", view: "kanban", tasks: [{ title: "E2E move me" }, { title: "E2E stay" }] });
  await openSpace(page, space.id);
  await mouseDrag(page, card(column(page, "חדשה"), "E2E move me"), column(page, "בעבודה"));

  await expect(column(page, "בעבודה")).toHaveAccessibleName("בעבודה, 1 משימות");
  await expect(card(column(page, "בעבודה"), "E2E move me")).toBeVisible();
  await expect.poll(async () => (await api.task(tasks[0].id))?.status).toBe("in_progress");

  await page.reload();
  await expect(card(column(page, "בעבודה"), "E2E move me")).toBeVisible();
  await expect(column(page, "חדשה")).toHaveAccessibleName("חדשה, 1 משימות");
});

test("drag a card with the keyboard (Space, arrows, Space)", async ({ page, api, makeSpace }) => {
  const { space, tasks } = await makeSpace({ label: "keys", view: "kanban", tasks: [{ title: "E2E by keyboard" }] });
  await openSpace(page, space.id);
  const c = card(column(page, "חדשה"), "E2E by keyboard");
  await c.focus();
  await page.keyboard.press("Space");
  // Screen readers hear where the card is (dnd-kit's live region, our Hebrew announcements).
  await expect(page.locator("[id^=DndLiveRegion]")).toHaveText(/^(הרמת את המשימה E2E by keyboard\.|מעל העמודה חדשה\.)$/);
  // In RTL the next columns ("בעבודה", then "בהשהייה") are to the left. dnd-kit may spend
  // one press on the card's own column edge, so walk left until the target is announced.
  const live = page.locator("[id^=DndLiveRegion]");
  for (let i = 0; i < 6 && (await live.textContent()) !== "מעל העמודה בהשהייה."; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
  }
  await expect(live).toHaveText("מעל העמודה בהשהייה.");
  await page.keyboard.press("Space");

  await expect(card(column(page, "בהשהייה"), "E2E by keyboard")).toBeVisible();
  await expect.poll(async () => (await api.task(tasks[0].id))?.status).toBe("on_hold");
  await page.reload();
  await expect(card(column(page, "בהשהייה"), "E2E by keyboard")).toBeVisible();

  // Esc cancels a lift: nothing moves.
  const again = card(column(page, "בהשהייה"), "E2E by keyboard");
  await again.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(card(column(page, "בהשהייה"), "E2E by keyboard")).toBeVisible();
  expect((await api.task(tasks[0].id))?.status).toBe("on_hold");

  // Enter opens the card instead of lifting it.
  await again.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "עריכת משימה" })).toBeVisible();
});

test("reorder inside a column — the order survives a reload", async ({ page, api, makeSpace }) => {
  const { space } = await makeSpace({
    label: "reorder",
    view: "kanban",
    tasks: [{ title: "E2E first" }, { title: "E2E second" }, { title: "E2E third" }],
  });
  await openSpace(page, space.id);
  const col = column(page, "חדשה");
  expect(await titlesIn(col)).toEqual(["E2E first", "E2E second", "E2E third"]);
  await mouseDrag(page, card(col, "E2E third"), card(col, "E2E first"), { y: -12 });
  await expect.poll(() => titlesIn(col)).toEqual(["E2E third", "E2E first", "E2E second"]);

  await expect
    .poll(async () => (await api.tasks(space.id)).sort((a, b) => a.position - b.position).map((t) => t.title))
    .toEqual(["E2E third", "E2E first", "E2E second"]);
  await page.reload();
  await expect.poll(() => titlesIn(column(page, "חדשה"))).toEqual(["E2E third", "E2E first", "E2E second"]);
});

test('"done" shows the 20 most recent and "show all" opens the rest', async ({ page, makeSpace }) => {
  // Completed in order 01 … 22, so 22 is the newest and 01, 02 are the oldest.
  const seeds = Array.from({ length: 22 }, (_, i) => ({ title: `E2E done ${String(i + 1).padStart(2, "0")}`, status: "done" as const }));
  const { space } = await makeSpace({ label: "done20", view: "kanban", tasks: seeds });
  await openSpace(page, space.id);
  const done = column(page, "הושלמה");
  await expect(done).toHaveAccessibleName("הושלמה, 22 משימות");
  await expect(done.locator("article")).toHaveCount(20);
  const shown = await titlesIn(done);
  expect(shown[0]).toBe("E2E done 22");
  expect(shown).not.toContain("E2E done 01");
  expect(shown).not.toContain("E2E done 02");

  await done.getByRole("button", { name: /הצג הכו?ל/ }).click();
  await expect(done.locator("article")).toHaveCount(22);
  await done.getByRole("button", { name: "הצג רק 20 אחרונות" }).click();
  await expect(done.locator("article")).toHaveCount(20);
});

test("a failed save puts the card back and says so", async ({ page, makeSpace }) => {
  const { space } = await makeSpace({ label: "fail", view: "kanban", tasks: [{ title: "E2E will bounce" }] });
  await openSpace(page, space.id);
  await page.route("**/api/tasks/*", (route) =>
    route.request().method() === "PATCH" ? route.fulfill({ status: 500, json: { error: "שגיאה בשרת. נסה שוב בעוד רגע." } }) : route.continue(),
  );
  await mouseDrag(page, card(column(page, "חדשה"), "E2E will bounce"), column(page, "בעבודה"));
  await expect(page.getByRole("alert").filter({ hasText: "שגיאה בשרת" })).toBeVisible();
  await expect(card(column(page, "חדשה"), "E2E will bounce")).toBeVisible();
  await expect(column(page, "בעבודה")).toHaveAccessibleName("בעבודה, 0 משימות");
});

test("offline: the dropped card returns to its column with a message", async ({ page, context, makeSpace }) => {
  const { space } = await makeSpace({ label: "offline", view: "kanban", tasks: [{ title: "E2E offline card" }] });
  await openSpace(page, space.id);
  await context.setOffline(true);
  try {
    await mouseDrag(page, card(column(page, "חדשה"), "E2E offline card"), column(page, "בעבודה"));
    await expect(page.getByRole("alert").filter({ hasText: "אין חיבור לשרת" })).toBeVisible();
    await expect(card(column(page, "חדשה"), "E2E offline card")).toBeVisible();
    await expect(column(page, "בעבודה")).toHaveAccessibleName("בעבודה, 0 משימות");
  } finally {
    await context.setOffline(false);
  }
});
