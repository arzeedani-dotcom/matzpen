/**
 * Signed session cookie. Runs in both the proxy and route handlers, so it uses
 * Web Crypto only. The signing key is derived from APP_PASSWORD: changing the
 * password signs everyone out.
 *
 * A cookie must not let anyone test password guesses offline, so the key is never
 * a fast hash of the password: with SESSION_SECRET (recommended, 32+ random bytes)
 * it is an HMAC under that secret; without it, a deliberately slow PBKDF2.
 */
export const SESSION_COOKIE = "mz_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 600_000;

/** Derived once per server instance (and again only if the password or secret changes). */
let cached: { id: string; key: Promise<CryptoKey> } | null = null;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function deriveKey(password: string, secret: string | undefined): Promise<CryptoKey> {
  let material: ArrayBuffer;
  if (secret) {
    const outer = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    material = await crypto.subtle.sign("HMAC", outer, enc.encode(`matzpen-session-v1:${password}`));
  } else {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    material = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: enc.encode("matzpen-session-v1"), iterations: PBKDF2_ITERATIONS },
      base,
      256,
    );
  }
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function key(): Promise<CryptoKey> {
  const password = process.env.APP_PASSWORD;
  if (!password) return Promise.reject(new Error("APP_PASSWORD is not set"));
  const secret = process.env.SESSION_SECRET || undefined;
  const id = `${password}\u0000${secret ?? ""}`;
  if (cached?.id !== id) {
    const pending = deriveKey(password, secret);
    cached = { id, key: pending };
    // A failed derivation must not stay cached.
    pending.catch(() => {
      if (cached?.key === pending) cached = null;
    });
  }
  return cached.key;
}

async function sign(payload: string): Promise<string> {
  return b64url(await crypto.subtle.sign("HMAC", await key(), enc.encode(payload)));
}

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function createSessionToken(now = Date.now()): Promise<string> {
  const exp = now + SESSION_DAYS * 86_400_000;
  const payload = `v1.${exp}`;
  return `${payload}.${await sign(payload)}`;
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < now) return false;
  try {
    return safeEqual(parts[2], await sign(`${parts[0]}.${parts[1]}`));
  } catch {
    return false;
  }
}
