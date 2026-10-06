import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { handle, ok } from "@/lib/http";

export const POST = handle(async () => {
  (await cookies()).delete(SESSION_COOKIE);
  return ok({ ok: true });
});
