/** Small helpers so every route handler answers the same way. */
import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { instance } from "@/config/instance";
import { todayIn } from "./dates";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "גוף הבקשה אינו JSON תקין");
  }
  return schema.parse(raw);
}

/** Wraps a handler: validation errors → 400 in Hebrew, HttpError → its status, anything else → 500 (logged). */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      if (e instanceof ZodError) return fail(400, e.issues[0]?.message ?? "קלט לא תקין");
      console.error(e);
      return fail(500, "שגיאה בשרת. נסה שוב בעוד רגע.");
    }
  };
}

/** Today's date in the owner's time zone. */
export function today(): string {
  return todayIn(instance.timeZone);
}
