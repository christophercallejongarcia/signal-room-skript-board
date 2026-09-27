import test from "node:test";
import assert from "node:assert/strict";
import { boardCsp, checkBoardRequest } from "../lib/board/guard.ts";
import { createSession, csrfForNonce, verifySession } from "../lib/board/session.ts";

const secret = "s".repeat(40);
const base = { webPort: "3100", secret, host: "127.0.0.1:3100", origin: null, csrfHeader: null };

async function session() {
  const { session, csrf } = await createSession(secret);
  return { session, csrf };
}

test("a session cookie verifies only with the same secret and without tampering", async () => {
  const { session: cookie, csrf } = await session();
  const nonce = await verifySession(cookie, secret);
  assert.ok(nonce);
  assert.equal(await csrfForNonce(nonce, secret), csrf);
  assert.equal(await verifySession(cookie, "t".repeat(40)), null);
  assert.equal(await verifySession(`${cookie}0`, secret), null);
  assert.equal(await verifySession(`${"a".repeat(48)}.${"b".repeat(64)}`, secret), null);
  assert.equal(await verifySession(undefined, secret), null);
  assert.equal(await verifySession(`${cookie}.x`, secret), null);
});

test("board pages need an allowed host and hand out a session when none is valid", async () => {
  assert.deepEqual(await checkBoardRequest({ ...base, method: "GET", pathname: "/board", sessionCookie: undefined }), { ok: true, needsSession: true });
  assert.equal((await checkBoardRequest({ ...base, host: "localhost:3100", method: "GET", pathname: "/board/x", sessionCookie: undefined })).ok, true);
  for (const host of ["evil.example", "127.0.0.1:3000", "192.168.2.130:3100", null]) {
    const result = await checkBoardRequest({ ...base, host, method: "GET", pathname: "/board", sessionCookie: undefined });
    assert.equal(result.ok, false, String(host));
  }
  const { session: cookie } = await session();
  assert.deepEqual(await checkBoardRequest({ ...base, method: "GET", pathname: "/board", sessionCookie: cookie }), { ok: true, needsSession: false });
  assert.equal((await checkBoardRequest({ ...base, method: "POST", pathname: "/board", sessionCookie: cookie })).ok, false);
});

test("board API reads need a session, writes need session, own origin and matching CSRF", async () => {
  const { session: cookie, csrf } = await session();
  const other = await session();
  const api = { ...base, pathname: "/api/board/boards" };
  assert.equal((await checkBoardRequest({ ...api, method: "GET", sessionCookie: undefined })).ok, false);
  assert.equal((await checkBoardRequest({ ...api, method: "GET", sessionCookie: cookie })).ok, true);
  const write = { ...api, method: "POST", sessionCookie: cookie };
  assert.equal((await checkBoardRequest({ ...write, origin: "http://127.0.0.1:3100", csrfHeader: csrf })).ok, true);
  assert.equal((await checkBoardRequest({ ...write, origin: null, csrfHeader: csrf })).ok, false, "no origin");
  assert.equal((await checkBoardRequest({ ...write, origin: "http://evil.example", csrfHeader: csrf })).ok, false, "foreign origin");
  assert.equal((await checkBoardRequest({ ...write, origin: "http://localhost:3100", csrfHeader: csrf })).ok, false, "origin must match the host");
  assert.equal((await checkBoardRequest({ ...write, origin: "http://127.0.0.1:3100", csrfHeader: null })).ok, false, "no csrf");
  assert.equal((await checkBoardRequest({ ...write, origin: "http://127.0.0.1:3100", csrfHeader: other.csrf })).ok, false, "csrf of another session");
  for (const method of ["PUT", "PATCH", "DELETE"]) assert.equal((await checkBoardRequest({ ...write, method, origin: null, csrfHeader: csrf })).ok, false, method);
});

test("the CSP blocks foreign images, frames, media and connections", () => {
  const csp = boardCsp({ dev: false });
  assert.match(csp, /img-src 'self' data: https:\/\/i\.ytimg\.com;/);
  assert.match(csp, /connect-src 'self';/);
  assert.match(csp, /media-src 'none'/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(boardCsp({ dev: true }), /unsafe-eval/);
});
