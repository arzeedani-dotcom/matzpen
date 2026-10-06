/**
 * Everything except the login page, the login API, the health check and the home-screen
 * app files (manifest, icons) requires a valid session. Route handlers check it again.
 * State-changing requests must come from this site itself (CSRF defence beyond SameSite).
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

const PUBLIC = ["/login", "/api/auth/login", "/api/health"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** True when a browser says the request was started by another site. */
function crossSite(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.get("origin");
  return !!origin && origin !== req.nextUrl.origin;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!SAFE_METHODS.has(req.method) && crossSite(req)) {
    return NextResponse.json({ error: "בקשה ממקור חיצוני נחסמה" }, { status: 403 });
  }
  if (PUBLIC.some((p) => pathname === p)) return NextResponse.next();
  if (await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "נדרשת כניסה למערכת" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Browsers fetch the manifest and the home-screen icons without cookies — they hold nothing private.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|manifest.webmanifest|icon-192.png|icon-512.png|apple-icon.png).*)",
  ],
};
