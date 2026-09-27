import { csrfForNonce, safeEqual, verifySession } from "./session.ts";

/**
 * The access decision for `/board/*` and `/api/board/*` (PLAN.md points 10, 11),
 * pure so tests can drive it without a server. The proxy applies it to every request.
 */
export type GuardInput = {
  method: string;
  pathname: string;
  host: string | null;
  origin: string | null;
  sessionCookie: string | undefined;
  csrfHeader: string | null;
  webPort: string;
  secret: string;
};

export type GuardResult =
  | { ok: true; needsSession: boolean }
  | { ok: false; status: 403; reason: string };

export function allowedHosts(webPort: string): string[] {
  return [`127.0.0.1:${webPort}`, `localhost:${webPort}`];
}

export function isBoardApi(pathname: string): boolean {
  return pathname === "/api/board" || pathname.startsWith("/api/board/");
}

export function isBoardPage(pathname: string): boolean {
  return pathname === "/board" || pathname.startsWith("/board/");
}

export async function checkBoardRequest(input: GuardInput): Promise<GuardResult> {
  const hosts = allowedHosts(input.webPort);
  if (!input.host || !hosts.includes(input.host)) return { ok: false, status: 403, reason: "Host ist nicht erlaubt." };

  const nonce = await verifySession(input.sessionCookie, input.secret);
  const method = input.method.toUpperCase();

  if (isBoardPage(input.pathname)) {
    // Pages hand out the session; only safe methods reach them.
    if (method !== "GET" && method !== "HEAD") return { ok: false, status: 403, reason: "Methode ist nicht erlaubt." };
    return { ok: true, needsSession: nonce === null };
  }

  if (!isBoardApi(input.pathname)) return { ok: true, needsSession: false };
  if (nonce === null) return { ok: false, status: 403, reason: "Keine gültige Board-Sitzung. Bitte /board neu laden." };
  if (method === "GET" || method === "HEAD") return { ok: true, needsSession: false };

  const expectedOrigins = hosts.map((host) => `http://${host}`);
  if (!input.origin || !expectedOrigins.includes(input.origin)) return { ok: false, status: 403, reason: "Origin fehlt oder ist fremd." };
  if (`http://${input.host}` !== input.origin) return { ok: false, status: 403, reason: "Origin passt nicht zum Host." };
  if (!input.csrfHeader || !safeEqual(input.csrfHeader, await csrfForNonce(nonce, input.secret))) {
    return { ok: false, status: 403, reason: "CSRF-Token fehlt oder ist falsch." };
  }
  return { ok: true, needsSession: false };
}

/** CSP for board pages (point 14). Next dev needs 'unsafe-eval' for React refresh; production does not. */
export function boardCsp({ dev }: { dev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://i.ytimg.com",
    // 'self' also covers the same-origin dev WebSocket (CSP 3).
    "connect-src 'self'",
    "font-src 'self' data:",
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
