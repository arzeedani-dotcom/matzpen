/**
 * Spec 2.7 — the agent's window (UI only; the engine is unit-tested). No model is ever
 * called on a live deployment: replies are stubbed, and a real request is sent only
 * against a local server, which has no OpenAI key and must answer with a Hebrew error.
 */
import type { Page } from "@playwright/test";
import { test, expect, openSpace } from "./support/fixtures";
import { IS_LOCAL } from "./support/env";

const panel = (page: Page) => page.getByRole("dialog", { name: "הסוכן" });
const launcher = (page: Page) => page.getByRole("button", { name: "שאל את הסוכן" });
const scopeButton = (page: Page) => panel(page).getByRole("button", { name: /^עובד על:/ });
const HEBREW = /[֐-׿]/;

const SUGGESTIONS = ["מה הכי חשוב לי היום?", "מה באיחור?", "תסכם לי את השבוע", "תוסיף משימה: להתקשר לרואה החשבון מחר"];

test("round launcher bottom-right with a hover label; window 400px with scope, 4 suggestions, side panel", async ({ page, shot }) => {
  await page.goto("/");
  const btn = launcher(page);
  const box = (await btn.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(vp.width - (box.x + box.width)).toBeLessThan(40); // right edge
  expect(vp.height - (box.y + box.height)).toBeLessThan(40); // bottom edge
  expect(Math.round(box.width)).toBe(Math.round(box.height));
  await expect(btn).toHaveCSS("border-radius", /^(9999px|50%|3\.\d+e\+\d+px|\d{2,}px)$/);
  const tip = page.getByText("שאל את הסוכן", { exact: true }).last();
  await expect(tip).toHaveCSS("opacity", "0");
  await btn.hover();
  await expect(tip).toHaveCSS("opacity", "1");

  await btn.click();
  const p = panel(page);
  await expect(p).toBeVisible();
  await expect(launcher(page)).toHaveCount(0);
  const width = async () => Math.round((await p.boundingBox())!.width);
  await expect.poll(width).toBe(400); // after the pop-in animation
  await expect(scopeButton(page)).toContainText("כל המרחבים");
  for (const s of SUGGESTIONS) await expect(p.getByRole("button", { name: s })).toBeVisible();
  await expect(p.getByRole("textbox", { name: "הודעה לסוכן" })).toBeFocused();
  await shot("agent-open");

  await p.getByRole("button", { name: "הרחבה ללוח צד" }).click();
  const wide = (await p.boundingBox())!;
  expect(Math.round(wide.height)).toBe(vp.height);
  expect(vp.width - (wide.x + wide.width)).toBeLessThan(2);
  await p.getByRole("button", { name: "חלון צף" }).click();
  await expect.poll(width).toBe(400);

  await page.keyboard.press("Escape");
  await expect(p).toBeHidden();
  await expect(launcher(page)).toBeVisible();
});

test("“עובד על” follows the page, and a manual choice holds until the page changes", async ({ page, makeSpace }) => {
  const { space: a } = await makeSpace({ label: "scopeA", view: "list" });
  const { space: b } = await makeSpace({ label: "scopeB", view: "list" });
  await openSpace(page, a.id);
  await launcher(page).click();
  await expect(scopeButton(page)).toContainText(a.name);

  await scopeButton(page).click();
  const picker = panel(page).getByRole("group", { name: "על מה הסוכן עובד" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("menuitemcheckbox", { name: a.name })).toHaveAttribute("aria-checked", "true");
  // Several spaces at once…
  await picker.getByRole("menuitemcheckbox", { name: b.name }).click();
  await expect(scopeButton(page)).toContainText("2 מרחבים");
  // …or all of them.
  await picker.getByRole("menuitemcheckbox", { name: "כל המרחבים" }).click();
  await expect(picker).toBeHidden();
  await expect(scopeButton(page)).toContainText("כל המרחבים");

  // Closing and reopening keeps the manual choice… (the close button: after the picker
  // closes, focus has left the window, so Esc would not reach it — reported, agent-widget.tsx)
  await panel(page).getByRole("button", { name: "סגירה" }).click();
  await launcher(page).click();
  await expect(scopeButton(page)).toContainText("כל המרחבים");
  // …moving to another page resets it to that page's default. (The open window covers the
  // sidebar's corner, so it is closed for the click.)
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: b.name }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(b.name);
  await launcher(page).click();
  await expect(scopeButton(page)).toContainText(b.name);
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "דשבורד" }).click();
  await launcher(page).click();
  await expect(scopeButton(page)).toContainText("כל המרחבים");
});

test("Enter sends, Shift+Enter adds a line; a server failure shows a Hebrew error, not a crash", async ({ page }) => {
  let body: { messages: { role: string; content: string }[]; scope: unknown } | null = null;
  await page.route("**/api/agent/chat", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ status: 500, json: { error: "שגיאה בשרת. נסה שוב בעוד רגע." } });
  });
  await page.goto("/");
  await launcher(page).click();
  const input = panel(page).getByRole("textbox", { name: "הודעה לסוכן" });
  await input.fill("שורה ראשונה");
  await input.press("Shift+Enter");
  await input.pressSequentially("שורה שנייה");
  await expect(input).toHaveValue("שורה ראשונה\nשורה שנייה");
  await input.press("Enter");

  const error = panel(page).getByRole("alert");
  await expect(error).toHaveText("שגיאה בשרת. נסה שוב בעוד רגע.");
  expect(body!.messages.at(-1)).toEqual({ role: "user", content: "שורה ראשונה\nשורה שנייה" });
  expect(body!.scope).toEqual({ mode: "all" });
  await expect(panel(page).getByText("שורה ראשונה")).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(input).toBeEnabled();
});

test("no connection → a Hebrew error; the conversation stays after a reload; “שיחה חדשה” clears it", async ({ page }) => {
  await page.route("**/api/agent/chat", (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await launcher(page).click();
  await panel(page).getByRole("button", { name: "מה באיחור?" }).click();
  await expect(panel(page).getByRole("alert")).toHaveText(/^אין חיבור לשרת/);

  await page.reload();
  await launcher(page).click();
  await expect(panel(page).getByText("מה באיחור?")).toBeVisible(); // kept in this browser
  await expect(panel(page).getByRole("button", { name: "מה הכי חשוב לי היום?" })).toHaveCount(0);

  await panel(page).getByRole("button", { name: "שיחה חדשה" }).click();
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  for (const s of SUGGESTIONS) await expect(panel(page).getByRole("button", { name: s })).toBeVisible();
});

test("a real request to a local server without an OpenAI key answers with a Hebrew error", async ({ page, shot }) => {
  test.skip(!IS_LOCAL, "never call the real model on a deployed site from tests");
  await page.goto("/");
  await launcher(page).click();
  await panel(page).getByRole("button", { name: "מה באיחור?" }).click();
  const error = panel(page).getByRole("alert");
  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(error).toHaveText(HEBREW);
  await expect(panel(page).getByRole("textbox", { name: "הודעה לסוכן" })).toBeEnabled();
  await shot("agent-error");
  await panel(page).getByRole("button", { name: "שיחה חדשה" }).click();
});
