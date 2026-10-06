/**
 * Signs in once through the real login form and saves the browser state for every other
 * test. A saved session that the server still accepts is reused, because every login
 * attempt counts against the rate limit. Also sweeps "E2E …" spaces a crashed earlier
 * run may have left behind.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { test as setup, expect } from "@playwright/test";
import { AppApi, PREFIX } from "./support/fixtures";
import { STORAGE_STATE, appPassword } from "./support/env";

setup("sign in and save the session", async ({ browser }) => {
  let ctx = existsSync(STORAGE_STATE) ? await browser.newContext({ storageState: STORAGE_STATE }) : null;
  if (ctx && (await ctx.request.get("/api/spaces")).status() !== 200) {
    await ctx.close();
    ctx = null;
  }
  if (!ctx) {
    ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel("סיסמה").fill(appPassword());
    await page.getByRole("button", { name: "כניסה" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByRole("heading", { name: "מה בוער" })).toBeVisible();
  }

  const api = new AppApi(ctx.request);
  for (const s of await api.spaces()) if (s.name.startsWith(PREFIX)) await api.deleteSpace(s.id);

  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await ctx.storageState({ path: STORAGE_STATE });
  await ctx.close();
});
