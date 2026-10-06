/** Spec 2.3 — dark mode that sticks, RTL, and the IBM Plex pair: Hebrew in Sans Hebrew, Arabic in Sans Arabic. */
import { test, expect, contrastRatio, openSpace, renderedFonts } from "./support/fixtures";

test("dark mode toggle persists across a reload", async ({ page, makeSpace, shot }) => {
  const { space } = await makeSpace({
    label: "dark",
    view: "kanban",
    color: "teal",
    tasks: [
      { title: "E2E dark urgent", priority: "urgent" },
      { title: "E2E dark late", priority: "high", dueDate: "2020-01-01" },
      { title: "E2E dark done", status: "done" },
    ],
  });
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
  await nav.getByRole("button", { name: "מצב כהה" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(bg);
  await expect(nav.getByRole("button", { name: "מצב בהיר" })).toBeVisible();
  await shot("dashboard-dark");
  await openSpace(page, space.id);
  // Text stays readable on the dark surfaces (WCAG AA: 4.5 for normal text).
  const readable = {
    title: page.getByRole("heading", { level: 1 }),
    subtitle: page.locator("main header p").first(),
    card: page.getByText("E2E dark urgent", { exact: true }),
    urgentBadge: page.getByTitle("עדיפות דחוף").first(),
    overdue: page.getByText(/^באיחור של/).first(),
    column: page.getByRole("heading", { name: "בעבודה" }),
  };
  const ratios: Record<string, number> = {};
  for (const [k, loc] of Object.entries(readable)) ratios[k] = Math.round((await contrastRatio(loc)) * 10) / 10;
  for (const [k, r] of Object.entries(ratios)) expect(r, `${k} contrast in dark mode (${JSON.stringify(ratios)})`).toBeGreaterThanOrEqual(4.5);
  await shot("kanban-dark");
  await page.getByRole("button", { name: /^E2E dark urgent\./ }).click();
  await shot("task-editor-dark");
  await page.keyboard.press("Escape");

  await nav.getByRole("button", { name: "מצב בהיר" }).click();
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
});

test("without a manual choice the theme follows the computer", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "dark", storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await ctx.close();
});

test("RTL page; Hebrew titles in IBM Plex Sans Hebrew, Arabic titles in IBM Plex Sans Arabic", async ({ page, makeSpace, shot }) => {
  const arabic = "مراجعة خطة الدرس مع المعلمين";
  const hebrew = "לבדוק את מערך השיעור";
  const { space } = await makeSpace({
    label: "langs",
    view: "list",
    color: "sky",
    tasks: [
      { title: arabic, priority: "high", notes: "ملاحظة: يجب إنهاء ذلك قبل يوم الخميس" },
      { title: hebrew, priority: "medium" },
      { title: "E2E mixed עברית والعربية", priority: "low" },
    ],
  });
  await openSpace(page, space.id);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  const arTitle = page.getByText(arabic, { exact: true });
  const heTitle = page.getByText(hebrew, { exact: true });
  // Arabic runs right-to-left on its own (dir=auto), aligned to the start like Hebrew.
  expect(await arTitle.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");

  const arFonts = await renderedFonts(page, arTitle);
  const heFonts = await renderedFonts(page, heTitle);
  expect(arFonts[0], `Arabic rendered with ${arFonts.join(", ")}`).toMatch(/IBM Plex Sans Arabic/);
  expect(heFonts[0], `Hebrew rendered with ${heFonts.join(", ")}`).toMatch(/IBM Plex Sans Hebrew/);
  await shot("list-hebrew-arabic");

  // Arabic glyphs must not be clipped: the title box is at least as tall as its text.
  const clipped = await arTitle.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(clipped).toBe(false);

  await arTitle.click();
  const dialog = page.getByRole("dialog", { name: "עריכת משימה" });
  await expect(dialog.getByPlaceholder("מה צריך לעשות?")).toHaveValue(arabic);
  expect(await dialog.getByPlaceholder("מה צריך לעשות?").evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  const notesFonts = await renderedFonts(page, dialog.getByText("ملاحظة", { exact: false }));
  expect(notesFonts[0]).toMatch(/IBM Plex Sans Arabic/);
  await shot("task-editor-arabic");
});

test("icon-only buttons show their icon at full size (not squashed by padding)", async ({ page, makeSpace }) => {
  const { space } = await makeSpace({ label: "icons", view: "calendar" });
  await openSpace(page, space.id);
  for (const name of ["הגדרות מרחב", "החודש הקודם", "החודש הבא"]) {
    const svg = page.getByRole("button", { name, exact: true }).locator("svg");
    const box = (await svg.boundingBox())!;
    expect(Math.round(box.width), `${name}: icon width`).toBe(Math.round(box.height));
    expect(box.width, `${name}: icon width`).toBeGreaterThanOrEqual(16);
  }
});
