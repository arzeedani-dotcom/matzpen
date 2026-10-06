/** Spec 2.9 — everything works on a phone (390×844, touch): drawer, kanban, calendar dots, full-screen card and agent. */
import type { Locator, Page } from "@playwright/test";
import { test, expect, expectNoPageHorizontalScroll, inDays, openSpace, today } from "./support/fixtures";
import { formatLongHebrew } from "../../src/lib/dates";

const column = (page: Page, label: string) => page.getByRole("region", { name: new RegExp(`^${label}, \\d+ משימות$`) });

/** A real finger: touchstart, hold (dnd-kit's touch delay), move in steps, lift — via the DevTools protocol. */
async function touchDrag(page: Page, source: Locator, to: { x: number; y: number }) {
  const b = (await source.boundingBox())!;
  const start = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", p?: { x: number; y: number }) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y) }] : [] });
  try {
    await touch("touchStart", start);
    await page.waitForTimeout(350);
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", { x: start.x + ((to.x - start.x) * i) / steps, y: start.y + ((to.y - start.y) * i) / steps });
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(200);
    await touch("touchEnd");
  } finally {
    await cdp.detach();
  }
}

test("the menu is a drawer that closes on navigation (and on Esc)", async ({ page, makeSpace, shot }) => {
  const { space } = await makeSpace({ label: "drawer", view: "list", color: "pink" });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toBeHidden(); // no sidebar on a phone
  await expectNoPageHorizontalScroll(page);
  await shot("dashboard");

  await page.getByRole("button", { name: "פתיחת התפריט" }).click();
  const drawer = page.getByRole("dialog", { name: "תפריט" });
  await expect(drawer).toBeVisible();
  const box = (await drawer.getByRole("navigation").boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(380); // slides in from the right (RTL start)
  await shot("drawer");
  await drawer.getByRole("link", { name: space.name }).click();
  await page.waitForURL(new RegExp(`/spaces/${space.id}$`));
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: "פתיחת התפריט" }).click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("kanban scrolls sideways one column at a time; a card can be dragged by touch", async ({ page, api, makeSpace, shot }) => {
  const { space, tasks } = await makeSpace({
    label: "mkanban",
    view: "kanban",
    tasks: [{ title: "E2E touch one", priority: "urgent" }, { title: "E2E touch two" }, { title: "E2E touch three", status: "in_progress" }],
  });
  await openSpace(page, space.id);
  await expectNoPageHorizontalScroll(page);
  const scroller = column(page, "חדשה").locator("..");
  const dims = await scroller.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, snap: getComputedStyle(el).scrollSnapType }));
  expect(dims.sw).toBeGreaterThan(dims.cw * 2);
  expect(dims.snap).toContain("x");
  const colBox = (await column(page, "חדשה").boundingBox())!;
  expect(colBox.width).toBeGreaterThan(390 * 0.75); // one column fills the screen
  await shot("kanban");

  // Scroll to the next column (to the left in RTL) and back.
  await scroller.evaluate((el) => el.scrollBy({ left: -400, behavior: "instant" }));
  await expect(column(page, "בעבודה")).toBeInViewport({ ratio: 0.9 });
  await scroller.evaluate((el) => el.scrollTo({ left: 0, behavior: "instant" }));
  await expect(column(page, "חדשה")).toBeInViewport({ ratio: 0.9 });

  // Touch: press and hold, then move the card to the top of its column.
  const cards = column(page, "חדשה").locator("article p");
  await expect(cards).toHaveText(["E2E touch one", "E2E touch two"]);
  const first = (await column(page, "חדשה").getByRole("button", { name: /^E2E touch one\./ }).boundingBox())!;
  await touchDrag(page, column(page, "חדשה").getByRole("button", { name: /^E2E touch two\./ }), { x: first.x + first.width / 2, y: first.y + 4 });
  await expect(cards).toHaveText(["E2E touch two", "E2E touch one"]);
  await expect
    .poll(async () => {
      const list = await api.tasks(space.id);
      const pos = (id: string) => list.find((t) => t.id === id)!.position;
      return pos(tasks[1].id) < pos(tasks[0].id);
    })
    .toBe(true);
});

test("calendar shows dots; tapping a day lists its tasks", async ({ page, makeSpace, shot }) => {
  const day = today();
  const { space } = await makeSpace({
    label: "mcal",
    view: "calendar",
    tasks: [
      { title: "E2E dot one", dueDate: day, priority: "urgent" },
      { title: "E2E dot two", dueDate: day },
      { title: "E2E undated phone" },
    ],
  });
  await openSpace(page, space.id);
  await expectNoPageHorizontalScroll(page);
  // Short weekday names on a phone.
  await expect(page.locator("main .grid-cols-7").first().locator("> div")).toHaveText(["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"], { useInnerText: true });
  const cell = page.getByRole("gridcell").filter({ has: page.getByRole("button", { name: new RegExp(`^${formatLongHebrew(day)}`) }) });
  await expect(cell.locator("span.rounded-full")).toHaveCount(2); // two dots, no pills
  await expect(cell.getByText("E2E dot one")).toHaveCount(0);
  await shot("calendar");

  await cell.tap();
  const sheet = page.getByRole("dialog", { name: formatLongHebrew(day) });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("listitem")).toHaveCount(2);
  await expect(sheet).toContainText("E2E dot one");
  await shot("calendar-day-sheet");
  await sheet.getByRole("button", { name: "משימה חדשה ביום הזה" }).tap();
  const editor = page.getByRole("dialog", { name: "משימה חדשה" });
  await expect(editor.locator('input[type="date"]')).toHaveValue(day);
  await editor.getByRole("button", { name: "ביטול" }).tap();

  // An empty day goes straight to a new task.
  const empty = inDays(1).slice(0, 7) === day.slice(0, 7) ? inDays(1) : inDays(-1);
  await page.getByRole("button", { name: new RegExp(`^${formatLongHebrew(empty)}$`) }).tap();
  await expect(page.getByRole("dialog", { name: "משימה חדשה" }).locator('input[type="date"]')).toHaveValue(empty);
});

test("the task card and the agent open full screen", async ({ page, makeSpace, shot }) => {
  const { space } = await makeSpace({ label: "mfull", view: "list", tasks: [{ title: "E2E full screen", notes: "https://example.com" }] });
  await openSpace(page, space.id);
  await expectNoPageHorizontalScroll(page);
  await shot("list");
  await page.getByRole("button", { name: /E2E full screen/ }).tap();
  const editor = page.getByRole("dialog", { name: "עריכת משימה" });
  await expect(editor).toBeVisible();
  await page.waitForTimeout(300);
  const e = (await editor.boundingBox())!;
  expect(Math.round(e.width)).toBe(390);
  expect(Math.round(e.height)).toBe(844);
  // Every field is reachable and nothing spills sideways.
  expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await shot("task-editor");
  await editor.getByRole("button", { name: "סגירה" }).first().tap();
  await expect(editor).toBeHidden();

  await page.getByRole("button", { name: "שאל את הסוכן" }).tap();
  const agent = page.getByRole("dialog", { name: "הסוכן" });
  await expect(agent).toBeVisible();
  await page.waitForTimeout(300);
  const a = (await agent.boundingBox())!;
  expect([Math.round(a.x), Math.round(a.y), Math.round(a.width), Math.round(a.height)]).toEqual([0, 0, 390, 844]);
  await expect(agent.getByRole("button", { name: "הרחבה ללוח צד" })).toBeHidden(); // no side panel on a phone
  await shot("agent");
  await agent.getByRole("button", { name: "סגירה" }).tap();
});

test("dark mode on a phone", async ({ page, makeSpace, shot }) => {
  const { space } = await makeSpace({ label: "mdark", view: "list", tasks: [{ title: "E2E late phone", priority: "urgent", dueDate: inDays(-1) }, { title: "مهمة بالعربية" }] });
  await page.addInitScript(() => localStorage.setItem("mz-theme", "dark"));
  await openSpace(page, space.id);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await shot("list-dark");
  await page.goto("/");
  await expectNoPageHorizontalScroll(page);
  await shot("dashboard-dark");
});
