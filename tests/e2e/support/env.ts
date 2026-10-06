/**
 * Where the suite runs and with which password. Environment variables win over .env.local,
 * so the same suite can target the live deployment. Nothing here is ever printed.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

// quiet: dotenv must not log anything about the file it read. It never overrides variables already set.
loadEnv({ path: [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")], quiet: true });

export const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/+$/, "");

/** Local runs may use features that cost nothing here but money on the live site (a real agent call). */
export const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);

/** The signed-in browser state written by auth.setup.ts (git-ignored: it holds a session cookie). */
export const STORAGE_STATE = path.join(ROOT, "tests/e2e/.auth/state.json");

/** Verification screenshots go next to the code folder, in the project's screenshots folder. */
export const SHOTS_DIR = process.env.E2E_SHOTS_DIR ?? path.resolve(ROOT, "..", "03 - צילומי אימות", "e2e");

export const REPO_ROOT = ROOT;

export function appPassword(): string {
  const p = process.env.APP_PASSWORD;
  if (!p) throw new Error("APP_PASSWORD is not set (environment or .env.local)");
  return p;
}
