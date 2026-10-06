// Renders the app icon SVG to the PNG sizes iOS and the web manifest need.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const svg = readFileSync("src/app/icon.svg", "utf8").replace('rx="14"', 'rx="0"'); // iOS rounds corners itself
const browser = await chromium.launch();
for (const [size, out] of [[180, "src/app/apple-icon.png"], [192, "public/icon-192.png"], [512, "public/icon-512.png"]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: out, omitBackground: false });
  await page.close();
  console.log("wrote", out);
}
await browser.close();
