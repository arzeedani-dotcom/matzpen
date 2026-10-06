/** Spec 2.4 — the month calendar: Sunday-first Hebrew grid, navigation, new task on a day, "+N", drag, the undated tray. */
import type { Page } from "@playwright/test";
import { test, expect, mouseDrag, openSpace, today } from "./support/fixtures";
import { HEBREW_MONTHS, formatLongHebrew } from "../../src/lib/dates";

const monthOf = (iso: string) => iso.slice(0, 7);
/** A day of the month on screen: "YYYY-MM-DD" for day `d` of the current month. */
const dayOfThisMonth = (d: number) => `${monthOf(today())}-${String(d).padStart(2, "0")}`;
const title = (month: string) => `${HEBREW_MONTHS[+month.slice(5) - 1]} ${month.slice(0, 4)}`;
const shift = (month: string, delta: number) => {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

const dayButton = (page: Page, iso: string) => page.getByRole("button", { name: new RegExp(`^${formatLongHebrew(iso)}`) });
const dayCell = (page: Page, iso: string) => page.getByRole("gridcell").filter({ has: dayButton(page, iso) });
const pill = (page: Page, t: string) => page.getByRole("button", { name: new RegExp(`^${t}\\. עדיפות`) });

test("a Sunday-first month in Hebrew with today circled", async ({ page, makeSpace, shot }) => {
  const { space } = await makeSpace({
    label: "cal",
    view: "calendar",
    color: "amber",
    tasks: [
      { title: "E2E today pill", priority: "high", dueDate: today() },
      { title: "E2E done pill", status: "done", dueDate: dayOfThisMonth(12) },
      { title: "E2E undated", priority: "urgent" },
    ],
  });
  await openSpace(page, space.id);
  const month = monthOf(today());
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(title(month));
  await expect(page.getByRole("grid")).toHaveAccessibleName(title(month));

  const weekdays = page.locator("main .grid-cols-7").first().locator("> div");
  await expect(weekdays).toHaveText(["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"], { useInnerText: true });
  // RTL: Sunday is the right-most column.
  const sun = (await weekdays.first().boundingBox())!;
  const sat = (await weekdays.last().boundingBox())!;
  expect(sun.x).toBeGreaterThan(sat.x);
  // Every week row starts on a Sunday.
  const firstCell = page.getByRole("gridcell").first().getByRole("button").first();
  await expect(firstCell).toHaveAccessibleName(/^יום ראשון, /);
  expect((await page.getByRole("gridcell").count()) % 7).toBe(0);

  const todayBtn = page.locator('[aria-current="date"]');
  await expect(todayBtn).toHaveCount(1);
  await expect(todayBtn).toHaveText(String(+today().slice(8)));
  await expect(todayBtn).toHaveCSS("border-radius", /^(9999px|50%|3\.\d+e\+\d+px|\d{2,}px)$/);
  expect(await todayBtn.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");

  // Pills in the priority color; a done task is struck through.
  await expect(dayCell(page, today()).getByText("E2E today pill")).toBeVisible();
  await expect(page.getByText("E2E done pill")).toHaveCSS("text-decoration-line", "line-through");
  await expect(page.getByRole("complementary", { name: "משימות ללא תאריך" })).toContainText("E2E undated");
  await shot("calendar");
});

test("navigate months with the buttons, “היום” and the arrow keys", async ({ page, makeSpace }) => {
  const { space } = await makeSpace({ label: "nav", view: "calendar" });
  await openSpace(page, space.id);
  const month = monthOf(today());
  const heading = page.getByRole("heading", { level: 2 }).first();
  const todayButton = page.getByRole("button", { name: "היום", exact: true });
  await expect(todayButton).toBeDisabled();

  await page.getByRole("button", { name: "החודש הבא" }).click();
  await expect(heading).toHaveText(title(shift(month, 1)));
  await expect(page).toHaveURL(new RegExp(`\\?m=${shift(month, 1)}$`));
  await page.getByRole("button", { name: "החודש הקודם" }).click();
  await page.getByRole("button", { name: "החודש הקודם" }).click();
  await expect(heading).toHaveText(title(shift(month, -1)));
  await expect(todayButton).toBeEnabled();
  await todayButton.click();
  await expect(heading).toHaveText(title(month));

  // The month survives a reload (it lives in ?m=).
  await page.getByRole("button", { name: "החודש הבא" }).click();
  await page.reload();
  await expect(heading).toHaveText(title(shift(month, 1)));
  await todayButton.click();

  // Keyboard: in RTL the future is to the left.
  await dayButton(page, dayOfThisMonth(15)).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(heading).toHaveText(title(shift(month, 1)));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(heading).toHaveText(title(shift(month, -1)));
});

test("click an empty day → a new task with that date already filled in", async ({ page, api, makeSpace }) => {
  const { space } = await makeSpace({ label: "newday", view: "calendar" });
  await openSpace(page, space.id);
  const day = dayOfThisMonth(17);
  const cell = dayCell(page, day);
  const box = (await cell.boundingBox())!;
  await cell.click({ position: { x: box.width / 2, y: box.height - 12 } });
  const dialog = page.getByRole("dialog", { name: "משימה חדשה" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[type="date"]')).toHaveValue(day);
  await expect(dialog).toContainText(formatLongHebrew(day));
  await dialog.getByPlaceholder("מה צריך לעשות?").fill("E2E on a day");
  await dialog.getByRole("button", { name: "הוספת משימה" }).click();
  await expect(dialog).toBeHidden();
  await expect(cell.getByText("E2E on a day")).toBeVisible();
  await expect.poll(async () => (await api.tasks(space.id)).map((t) => t.dueDate)).toEqual([day]);
});

test("more than 3 tasks on a day → “+N נוספות” opens the whole day", async ({ page, makeSpace, shot }) => {
  const day = dayOfThisMonth(9);
  const { space } = await makeSpace({
    label: "busy",
    view: "calendar",
    tasks: ["a", "b", "c", "d", "e"].map((x, i) => ({ title: `E2E busy ${x}`, dueDate: day, priority: i === 4 ? ("urgent" as const) : ("low" as const) })),
  });
  await openSpace(page, space.id, `?m=${monthOf(day)}`);
  const cell = dayCell(page, day);
  await expect(cell.locator("[aria-roledescription]")).toHaveCount(3);
  // The urgent one is among the three that show.
  await expect(cell.getByText("E2E busy e")).toBeVisible();
  await cell.getByRole("button", { name: "+2 נוספות" }).click();
  const sheet = page.getByRole("dialog", { name: formatLongHebrew(day) });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("listitem")).toHaveCount(5);
  await shot("calendar-day-more");

  // Checking a task inside the open day list: its undo must be on top of the sheet and pressable.
  await sheet.getByRole("checkbox", { name: "סמן כהושלמה: E2E busy a" }).click();
  const undo = page.getByRole("status").filter({ hasText: "המשימה הושלמה" }).getByRole("button", { name: /^(בטל|ביטול)$/ });
  await expect(undo).toBeVisible();
  const onTop = await undo.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
  expect(onTop, "the undo button is above the modal").toBe(true);
  await undo.click();
  await expect(sheet.getByRole("checkbox", { name: "סמן כהושלמה: E2E busy a" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("drag a pill to another day → its due date changes", async ({ page, api, makeSpace }) => {
  const from = dayOfThisMonth(10);
  const to = dayOfThisMonth(20);
  const { space, tasks } = await makeSpace({ label: "dragday", view: "calendar", tasks: [{ title: "E2E drag pill", dueDate: from }] });
  await openSpace(page, space.id, `?m=${monthOf(from)}`);
  await mouseDrag(page, pill(page, "E2E drag pill"), dayCell(page, to), { y: 20 });
  await expect(dayCell(page, to).getByText("E2E drag pill")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: `הועבר ל${formatLongHebrew(to)}` })).toBeVisible();
  await expect.poll(async () => (await api.task(tasks[0].id))?.dueDate).toBe(to);
  await page.reload();
  await expect(dayCell(page, to).getByText("E2E drag pill")).toBeVisible();
});

test("the “ללא תאריך” tray: drag a task onto a day to give it a date, and back to clear it", async ({ page, api, makeSpace }) => {
  const day = dayOfThisMonth(22);
  const { space, tasks } = await makeSpace({ label: "tray", view: "calendar", tasks: [{ title: "E2E from tray" }] });
  await openSpace(page, space.id, `?m=${monthOf(day)}`);
  const tray = page.getByRole("complementary", { name: "משימות ללא תאריך" });
  await expect(tray).toContainText("E2E from tray");

  await mouseDrag(page, tray.getByRole("button", { name: /^E2E from tray\./ }), dayCell(page, day), { y: 20 });
  await expect(dayCell(page, day).getByText("E2E from tray")).toBeVisible();
  await expect(tray).toContainText("לכל המשימות הפתוחות יש תאריך.");
  await expect.poll(async () => (await api.task(tasks[0].id))?.dueDate).toBe(day);

  await mouseDrag(page, pill(page, "E2E from tray"), tray);
  await expect(tray).toContainText("E2E from tray");
  await expect.poll(async () => (await api.task(tasks[0].id))?.dueDate ?? null).toBeNull();
});
