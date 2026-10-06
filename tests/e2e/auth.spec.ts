/**
 * Spec 2.8: one password, a signed cookie, every page and every API closed without it.
 * Uses exactly ONE wrong password per run — five failures lock the login for 15 minutes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { request as playwrightRequest } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { BASE_URL, REPO_ROOT, appPassword } from "./support/env";

test.use({ storageState: { cookies: [], origins: [] } });

test("signed out: pages redirect to /login and keep where you were going", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "כניסה" })).toBeVisible();

  await page.goto("/spaces/00000000-0000-4000-8000-000000000000");
  await expect(page).toHaveURL(/\/login\?next=%2Fspaces%2F00000000-0000-4000-8000-000000000000$/);
});

// Every login attempt counts against the rate limit, so one test covers wrong → right → ?next= → logout.
test("wrong password shows an error, the right one opens the requested page, logout closes it", async ({ page, shot }) => {
  await page.goto("/login?next=%2F%3Fe2e%3D1");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const password = page.getByLabel("סיסמה");
  const submit = page.getByRole("button", { name: "כניסה" });
  await expect(submit).toBeDisabled(); // nothing typed yet

  await password.fill(`e2e-wrong-${Date.now()}`);
  await submit.click();
  // (Next.js keeps an empty role=alert route announcer on every page — skip it.)
  const error = page.getByRole("alert").filter({ hasText: /\S/ });
  await expect(error).toHaveText("הסיסמה שגויה");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/login\?next=/);
  await shot("login-wrong-password");

  await password.fill(appPassword());
  await submit.click();
  // Back to the page that sent us to the login (?next=), and only inside this site.
  await page.waitForURL((u) => u.pathname === "/" && u.searchParams.get("e2e") === "1");
  await expect(page.getByRole("heading", { name: "מה בוער" })).toBeVisible();

  // The session cookie is not readable from page scripts.
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "mz_session");
  expect(session, "session cookie is set").toBeTruthy();
  expect(session!.httpOnly).toBe(true);
  expect(session!.sameSite).toBe("Lax");
  expect(session!.expires * 1000 - Date.now()).toBeGreaterThan(29 * 86_400_000);
  expect(await page.evaluate(() => document.cookie)).not.toContain("mz_session");

  await page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("button", { name: "יציאה" }).click();
  await page.waitForURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/spaces")).status()).toBe(401);
});

/** Every route.ts under src/app/api with the HTTP methods it exports. */
function apiRoutes(): { method: string; path: string }[] {
  const dir = path.join(REPO_ROOT, "src/app/api");
  const out: { method: string; path: string }[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") {
        const rel = path.relative(path.join(REPO_ROOT, "src/app"), path.dirname(full)).split(path.sep).join("/");
        const url = "/" + rel.replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000000");
        const src = readFileSync(full, "utf8");
        for (const m of src.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)) out.push({ method: m[1], path: url });
      }
    }
  };
  walk(dir);
  return out;
}

test("every API route answers 401 without a session (except health and login)", async () => {
  const routes = apiRoutes();
  expect(routes.length).toBeGreaterThan(15);
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const open = ["/api/health", "/api/auth/login"];
    const wrong: string[] = [];
    for (const r of routes) {
      if (open.includes(r.path)) continue;
      const res = await ctx.fetch(r.path, { method: r.method, data: r.method === "GET" ? undefined : {}, maxRedirects: 0 });
      if (res.status() !== 401) wrong.push(`${r.method} ${r.path} → ${res.status()}`);
      else expect((await res.json()).error).toBe("נדרשת כניסה למערכת");
    }
    // A route that does not exist is closed too — nothing under /api leaks without a session.
    const unknown = await ctx.get("/api/does-not-exist");
    if (unknown.status() !== 401) wrong.push(`GET /api/does-not-exist → ${unknown.status()}`);
    // A forged cookie is no better than none.
    const forged = await ctx.get("/api/spaces", { headers: { cookie: "mz_session=v1.9999999999999.forged" } });
    if (forged.status() !== 401) wrong.push(`forged cookie → ${forged.status()}`);
    expect(wrong, "routes that did not refuse an anonymous call").toEqual([]);

    const health = await ctx.get("/api/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
  } finally {
    await ctx.dispose();
  }
});
