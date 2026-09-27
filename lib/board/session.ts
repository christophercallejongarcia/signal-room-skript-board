/**
 * Local board session and CSRF token (PLAN.md point 11), Web Crypto only so it
 * runs in the proxy and in route handlers alike.
 *
 *   board_session = <nonce>.<HMAC(secret, "session:" + nonce)>   httpOnly, SameSite=Strict
 *   board_csrf    = HMAC(secret, "csrf:" + nonce)                readable by the page
 *
 * The CSRF value is derived from the session, so a header copied from another
 * session never matches.
 */
export const SESSION_COOKIE = "board_session";
export const CSRF_COOKIE = "board_csrf";
export const CSRF_HEADER = "x-board-csrf";

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Length-safe comparison without early exit on the first differing character. */
export function safeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export function requireSessionSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.BOARD_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("BOARD_SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen.");
  return secret;
}

export async function createSession(secret: string): Promise<{ session: string; csrf: string }> {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const nonce = toHex(bytes.buffer);
  return { session: `${nonce}.${await hmac(secret, `session:${nonce}`)}`, csrf: await hmac(secret, `csrf:${nonce}`) };
}

/** The nonce of a valid session cookie, or null. */
export async function verifySession(cookie: string | undefined, secret: string): Promise<string | null> {
  if (!cookie) return null;
  const [nonce, mac, extra] = cookie.split(".");
  if (!nonce || !mac || extra !== undefined || !/^[0-9a-f]{48}$/.test(nonce)) return null;
  return safeEqual(mac, await hmac(secret, `session:${nonce}`)) ? nonce : null;
}

export async function csrfForNonce(nonce: string, secret: string): Promise<string> {
  return hmac(secret, `csrf:${nonce}`);
}
