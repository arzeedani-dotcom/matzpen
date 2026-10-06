import { cookies } from "next/headers";
import { z } from "zod";
import { clearFailures, registerAttempt } from "@/lib/auth/rate-limit";
import { createSessionToken, safeEqual, SESSION_COOKIE, SESSION_DAYS } from "@/lib/auth/session";
import { fail, handle, ok, parseBody } from "@/lib/http";

const bodySchema = z.object({ password: z.string().min(1, "חסרה סיסמה").max(200) });

/** Vercel sets x-vercel-forwarded-for / x-real-ip itself; the first x-forwarded-for hop is the fallback elsewhere. */
function clientIp(req: Request): string {
  return (
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

export const POST = handle(
  async (req: Request) => {
    const expected = process.env.APP_PASSWORD;
    if (!expected) return fail(500, "המערכת לא הוגדרה: חסרה סיסמה בהגדרות השרת");
    const { password } = await parseBody(req, bodySchema);
    // Counted before the comparison, atomically — parallel guesses can't race past the limit.
    const ip = clientIp(req);
    const wait = await registerAttempt(ip);
    if (wait > 0) return fail(429, `יותר מדי ניסיונות. נסה שוב בעוד ${wait} דקות.`);
    if (!safeEqual(password, expected)) return fail(401, "הסיסמה שגויה");
    await clearFailures(ip);
    (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DAYS * 86_400,
    });
    return ok({ ok: true });
  },
  { public: true },
);
