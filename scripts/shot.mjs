// Screenshot a page of the running dev app, signed in.
//   node scripts/shot.mjs <path-without-leading-slash, "" for dashboard> <name> [--mobile] [--dark] [--base=http://localhost:3100]
// Saves PNG to "../03 - צילומי אימות/dev/<name>.png". Each call uses its own headless browser.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [rawPath = "", name = "shot", ...flags] = process.argv.slice(2);
// Path without the leading slash ("spaces/<id>") — Git Bash rewrites "/x" into a Windows path.
const path = "/" + rawPath.replace(/^\/+/, "");
const base = flags.find((f) => f.startsWith("--base="))?.slice(7) ?? "http://localhost:3100";
const mobile = flags.includes("--mobile");
const dark = flags.includes("--dark");
const out = "../03 - צילומי אימות/dev";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: mobile ? 2 : 1,
  colorScheme: dark ? "dark" : "light",
  locale: "he-IL",
  timezoneId: "Asia/Jerusalem",
});
const page = await ctx.newPage();
await page.request.post(`${base}/api/auth/login`, { data: { password: process.env.APP_PASSWORD ?? "dev-password" } });
await page.goto(base + path, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
console.log(`saved ${out}/${name}.png`);
await browser.close();
