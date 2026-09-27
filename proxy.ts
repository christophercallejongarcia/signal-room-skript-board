import { NextResponse, type NextRequest } from "next/server";
import { boardCsp, checkBoardRequest, isBoardPage } from "./lib/board/guard.ts";
import { createSession, CSRF_COOKIE, CSRF_HEADER, requireSessionSecret, SESSION_COOKIE } from "./lib/board/session.ts";

/**
 * Access guard for the Skript-Board only (PLAN.md points 10, 11, 14, ADR-0007).
 * Every other route of Signal Room passes untouched because of the matcher.
 */
export async function proxy(request: NextRequest) {
  let secret: string;
  try {
    secret = requireSessionSecret();
  } catch {
    return NextResponse.json({ error: "Board ist nicht konfiguriert (BOARD_SESSION_SECRET)." }, { status: 503 });
  }

  const pathname = request.nextUrl.pathname;
  const result = await checkBoardRequest({
    method: request.method,
    pathname,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    sessionCookie: request.cookies.get(SESSION_COOKIE)?.value,
    csrfHeader: request.headers.get(CSRF_HEADER),
    webPort: process.env.BOARD_WEB_PORT || "3100",
    secret,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status, headers: { "cache-control": "no-store" } });

  const response = NextResponse.next();
  if (isBoardPage(pathname)) {
    response.headers.set("content-security-policy", boardCsp({ dev: process.env.NODE_ENV !== "production" }));
    response.headers.set("referrer-policy", "no-referrer");
    response.headers.set("x-content-type-options", "nosniff");
  }
  if (result.needsSession) {
    const { session, csrf } = await createSession(secret);
    response.cookies.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: "strict", path: "/", secure: false });
    response.cookies.set(CSRF_COOKIE, csrf, { httpOnly: false, sameSite: "strict", path: "/", secure: false });
  }
  return response;
}

export const config = {
  matcher: ["/board", "/board/:path*", "/api/board", "/api/board/:path*"],
};
