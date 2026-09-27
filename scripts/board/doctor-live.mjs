/**
 * `board:doctor` Teil 2 (PLAN.md Punkt 54): prüft die laufenden Schichten von
 * `npm run dev:board`. Lesend bis auf `--schreibproben`: dann wird kurz der
 * Modus `readonly` gesetzt und danach der vorherige Modus wiederhergestellt,
 * und eine Anlage mit alter opsVersion wird abgelehnt, bevor etwas geschrieben wird.
 */
import http from "node:http";
import os from "node:os";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { convexCli } from "./env.mjs";

function request({ port, path, method = "GET", headers = {}, body, host = "127.0.0.1" }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path, method, headers, timeout: 15_000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function cookiesFrom(response) {
  const jar = {};
  for (const line of response.headers["set-cookie"] ?? []) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    jar[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return jar;
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

export async function runLiveChecks(env, report) {
  const webPort = Number(env.BOARD_WEB_PORT || 3100);
  const bridgePort = Number(env.BOARD_BRIDGE_PORT || 3311);
  const host = `127.0.0.1:${webPort}`;
  const origin = `http://${host}`;
  const writeProbes = process.argv.includes("--schreibproben");

  let page;
  try {
    page = await request({ port: webPort, path: "/board", headers: { host } });
  } catch (error) {
    report(2, "Next erreichbar", false, `${error.message}. Läuft \`npm run dev:board\`?`);
    return;
  }
  const jar = cookiesFrom(page);
  const cookie = `board_session=${jar.board_session}; board_csrf=${jar.board_csrf}`;
  report(2, "Seite /board setzt Sitzung und CSRF", page.status === 200 && Boolean(jar.board_session && jar.board_csrf), `HTTP ${page.status}`);
  const csp = page.headers["content-security-policy"] ?? "";
  report(2, "CSP auf /board", /img-src 'self' data: https:\/\/i\.ytimg\.com/.test(csp) && /frame-src 'none'/.test(csp) && /connect-src 'self'/.test(csp), csp.slice(0, 60));

  const health = await request({ port: webPort, path: "/api/board/health", headers: { host, cookie } });
  const layers = health.json?.layers ?? {};
  report(2, "Health über alle drei Schichten", health.status === 200 && health.json?.ok === true, `web ${layers.web?.ok} · convex ${layers.convex?.ok} · bridge ${layers.bridge?.ok}${health.json?.ok ? "" : ` · ${layers.convex?.error ?? layers.bridge?.error ?? health.text.slice(0, 120)}`}`);
  report(
    2,
    "Health meldet Deployment, Build und Versionen je Schicht",
    Boolean(layers.web?.deployment && layers.web?.build && layers.web?.opsVersion && layers.convex?.deployment && layers.convex?.build && layers.convex?.schemaVersion && layers.bridge?.build && layers.bridge?.instanceId && layers.bridge?.protocolVersion),
    `convex ${layers.convex?.deployment} schema ${layers.convex?.schemaVersion} · bridge ${layers.bridge?.instanceId} · web ${layers.web?.instanceId}`,
  );

  const post = (headers, body = { opsVersion: 1, title: "Doctor-Probe" }) =>
    request({ port: webPort, path: "/api/board/boards", method: "POST", headers: { host, "content-type": "application/json", ...headers }, body });

  const foreignHost = await request({ port: webPort, path: "/api/board/health", headers: { host: `evil.example:${webPort}`, cookie } });
  report(2, "Negativ: fremder Host → 403", foreignHost.status === 403, `HTTP ${foreignHost.status}`);
  const rebinding = await request({ port: webPort, path: "/board", headers: { host: "attacker.test" } });
  report(2, "Negativ: DNS-Rebinding auf /board → 403", rebinding.status === 403, `HTTP ${rebinding.status}`);
  const noOrigin = await post({ cookie, "x-board-csrf": jar.board_csrf });
  report(2, "Negativ: POST ohne Origin → 403", noOrigin.status === 403, `HTTP ${noOrigin.status}`);
  const foreignOrigin = await post({ cookie, "x-board-csrf": jar.board_csrf, origin: "http://evil.example" });
  report(2, "Negativ: fremder Origin → 403", foreignOrigin.status === 403, `HTTP ${foreignOrigin.status}`);
  const noCsrf = await post({ cookie, origin });
  report(2, "Negativ: ohne CSRF-Header → 403", noCsrf.status === 403, `HTTP ${noCsrf.status}`);
  const wrongCsrf = await post({ cookie, origin, "x-board-csrf": "0".repeat(64) });
  report(2, "Negativ: falscher CSRF-Header → 403", wrongCsrf.status === 403, `HTTP ${wrongCsrf.status}`);
  const noSession = await request({ port: webPort, path: "/api/board/health", headers: { host } });
  report(2, "Negativ: ohne Sitzung → 403", noSession.status === 403, `HTTP ${noSession.status}`);
  const forgedSession = await request({ port: webPort, path: "/api/board/health", headers: { host, cookie: `board_session=${"a".repeat(48)}.${"b".repeat(64)}` } });
  report(2, "Negativ: gefälschte Sitzung → 403", forgedSession.status === 403, `HTTP ${forgedSession.status}`);

  const bridgeNoToken = await request({ port: bridgePort, path: "/v1/board/health" });
  report(2, "Negativ: Bridge ohne Token → 401", bridgeNoToken.status === 401, `HTTP ${bridgeNoToken.status}`);
  const bridgeForeignOrigin = await request({ port: bridgePort, path: "/v1/board/health", headers: { origin: "http://evil.example" } });
  report(2, "Negativ: Bridge mit fremdem Origin, ohne Token → 401", bridgeForeignOrigin.status === 401, `HTTP ${bridgeForeignOrigin.status}`);
  const bridgeWrongToken = await request({ port: bridgePort, path: "/v1/board/health", headers: { "x-board-bridge-token": "x".repeat(64) } });
  report(2, "Negativ: Bridge mit falschem Token → 401", bridgeWrongToken.status === 401, `HTTP ${bridgeWrongToken.status}`);

  try {
    await new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL).query(anyApi.board.boardHealth, { token: "f".repeat(64) });
    report(2, "Negativ: falscher Convex-Token abgelehnt", false, "wurde angenommen");
  } catch (error) {
    report(2, "Negativ: falscher Convex-Token abgelehnt", /verweigert|unauthorized/i.test(String(error?.data?.message ?? error?.message)), String(error?.data?.kind ?? "abgelehnt"));
  }

  for (const address of lanAddresses()) {
    try {
      const lan = await request({ host: address, port: webPort, path: "/board", headers: { host: `${address}:${webPort}` } });
      report(2, `Negativ: Next unter LAN-IP ${address} nicht erreichbar`, false, `HTTP ${lan.status}`);
    } catch (error) {
      report(2, `Negativ: Next unter LAN-IP ${address} nicht erreichbar`, true, error.code ?? error.message);
    }
    try {
      await request({ host: address, port: bridgePort, path: "/v1/board/health" });
      report(2, `Negativ: Bridge unter LAN-IP ${address} nicht erreichbar`, false, "erreichbar");
    } catch (error) {
      report(2, `Negativ: Bridge unter LAN-IP ${address} nicht erreichbar`, true, error.code ?? error.message);
    }
  }

  const oldOps = await post({ cookie, origin, "x-board-csrf": jar.board_csrf }, { opsVersion: 0, title: "Doctor-Probe alt" });
  report(2, "Versionen: Schreiben mit alter opsVersion → 409", oldOps.status === 409 && oldOps.json?.kind === "version", `HTTP ${oldOps.status} ${oldOps.json?.error ?? ""}`);

  if (!writeProbes) {
    report(2, "Modus readonly (Schreibprobe)", "skip", "nur mit --schreibproben");
    return;
  }
  const configOut = convexCli(["run", "boardAdmin:getConfig", "{}"], env).trim();
  const before = configOut.startsWith("{") ? JSON.parse(configOut) : null;
  const previousMode = before?.mode ?? "open";
  try {
    convexCli(["run", "boardAdmin:setMode", JSON.stringify({ mode: "readonly" })], env);
    const blocked = await post({ cookie, origin, "x-board-csrf": jar.board_csrf }, { opsVersion: 1, title: "Doctor-Probe readonly" });
    const read = await request({ port: webPort, path: "/api/board/boards", headers: { host, cookie } });
    report(2, "Modus readonly sperrt Schreiben (423)", blocked.status === 423 && blocked.json?.kind === "readonly", `HTTP ${blocked.status}`);
    report(2, "Modus readonly lässt Lesen zu", read.status === 200 && Array.isArray(read.json?.boards), `HTTP ${read.status}`);
  } finally {
    convexCli(["run", "boardAdmin:setMode", JSON.stringify({ mode: previousMode })], env);
  }
}
