import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/db", async () => (await import("./helpers/test-db")).dbModule());
import { NextRequest } from "next/server";
import { resetDb } from "./helpers/test-db";
import { clearFailures, MAX_FAILURES, registerAttempt } from "@/lib/auth/rate-limit";
import { createSessionToken, SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { handle, ok, parseBody } from "@/lib/http";
import { proxy } from "@/proxy";
import { z } from "zod";

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("APP_PASSWORD", "correct horse battery");
  vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret");
});
afterEach(() => vi.unstubAllEnvs());

const T0 = new Date("2026-10-06T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describe("sign-in lockout", () => {
  it("allows 5 attempts in 15 minutes, then locks that address for 15 minutes", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect(await registerAttempt("1.1.1.1", at(i))).toBe(0);
    expect(await registerAttempt("1.1.1.1", at(5))).toBeGreaterThan(0);
    expect(await registerAttempt("2.2.2.2", at(5))).toBe(0);
    // The lock runs 15 minutes from the 5th attempt (minute 4).
    expect(await registerAttempt("1.1.1.1", at(18))).toBeGreaterThan(0);
    expect(await registerAttempt("1.1.1.1", at(20))).toBe(0);
  });

  it("counts a parallel burst atomically — only 5 of 20 simultaneous guesses get through", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => registerAttempt("3.3.3.3", T0)));
    expect(results.filter((w) => w === 0)).toHaveLength(MAX_FAILURES);
  });

  it("a successful sign-in clears the count", async () => {
    for (let i = 0; i < 4; i++) await registerAttempt("4.4.4.4", at(i));
    await clearFailures("4.4.4.4");
    for (let i = 0; i < MAX_FAILURES; i++) expect(await registerAttempt("4.4.4.4", at(5))).toBe(0);
  });

  it("caps attempts from all addresses together (IP rotation)", async () => {
    const waits = [];
    for (let i = 0; i < 51; i++) waits.push(await registerAttempt(`10.0.0.${i}`, at(i / 60)));
    expect(waits.slice(0, 50).every((w) => w === 0)).toBe(true);
    expect(waits[50]).toBeGreaterThan(0);
  });
});

describe("session cookie", () => {
  it("verifies its own tokens and rejects tampered or expired ones", async () => {
    const token = await createSessionToken(Date.now());
    expect(await verifySessionToken(token)).toBe(true);
    expect(await verifySessionToken(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBe(false);
    expect(await verifySessionToken(await createSessionToken(Date.now() - 31 * 86_400_000))).toBe(false);
  });

  it("changing the password or the secret signs everyone out", async () => {
    const token = await createSessionToken();
    vi.stubEnv("APP_PASSWORD", "a new password here");
    expect(await verifySessionToken(token)).toBe(false);
    vi.stubEnv("APP_PASSWORD", "correct horse battery");
    vi.stubEnv("SESSION_SECRET", "another-secret-another-secret-12");
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("is not a fast hash of the password (no offline guessing from a cookie)", async () => {
    const token = await createSessionToken();
    const [v, exp, sig] = token.split(".");
    const enc = new TextEncoder();
    const naive = await crypto.subtle.digest("SHA-256", enc.encode("matzpen-session-v1:correct horse battery"));
    const k = await crypto.subtle.importKey("raw", naive, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const guess = Buffer.from(await crypto.subtle.sign("HMAC", k, enc.encode(`${v}.${exp}`))).toString("base64url");
    expect(guess).not.toBe(sig);
  });
});

describe("route handlers", () => {
  const route = handle(async (req: Request) => ok(await parseBody(req, z.object({ a: z.number() }))));
  const post = (headers: Record<string, string>, body = '{"a":1}') =>
    new Request("http://localhost/api/x", { method: "POST", headers, body });

  it("check the session themselves, independent of the proxy", async () => {
    expect((await route(post({ "content-type": "application/json" }))).status).toBe(401);
    const cookie = `${SESSION_COOKIE}=${await createSessionToken()}`;
    expect((await route(post({ "content-type": "application/json", cookie }))).status).toBe(200);
  });

  it("accept JSON bodies only", async () => {
    const cookie = `${SESSION_COOKIE}=${await createSessionToken()}`;
    expect((await route(post({ "content-type": "text/plain", cookie }))).status).toBe(415);
  });
});

describe("proxy", () => {
  const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(new URL(path, "http://localhost:3100"), init);

  it("blocks state-changing requests started by another site", async () => {
    const cookie = `${SESSION_COOKIE}=${await createSessionToken()}`;
    const evil = await proxy(req("/api/tasks", { method: "POST", headers: { cookie, origin: "https://evil.example" } }));
    expect(evil.status).toBe(403);
    const fetchSite = await proxy(req("/api/tasks", { method: "POST", headers: { cookie, "sec-fetch-site": "same-site" } }));
    expect(fetchSite.status).toBe(403);
    const own = await proxy(req("/api/tasks", { method: "POST", headers: { cookie, origin: "http://localhost:3100" } }));
    expect(own.status).toBe(200);
  });

  it("answers 401 for APIs and redirects pages to /login without a session", async () => {
    expect((await proxy(req("/api/spaces"))).status).toBe(401);
    const page = await proxy(req("/spaces/abc"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost:3100/login?next=%2Fspaces%2Fabc");
  });
});
