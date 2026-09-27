#!/usr/bin/env node
/**
 * `npm run board:doctor` (PLAN.md Punkte 48, 54, 42b). Standardmäßig schreibfrei
 * gegenüber Board-Daten und Journalen; Proben legen nur eigene Probe-Einträge an
 * und löschen sie sofort wieder.
 *
 *   --teil 1   Voraussetzungen: Engines (Mini-Prompt), yt-dlp, Convex-Schreibprobe,
 *              YT-OS-Schreibprobe, sandbox-exec, ~/.signal-room/board
 *   --teil 2   Laufende Schichten von `npm run dev:board`: Health und Negativtests
 *   --teil laeufe   Lauf-Journale je Besitzer (lebend oder tot), schreibfrei;
 *              mit `--repair` werden Journale toter Besitzer nachgereicht (Punkt 34b)
 *   ohne Angabe Teil 1, Teil 2 und Läufe
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ENGINE_IDS, ENGINES, engineVersion, profileHash, resolveBinary } from "../../bridge/engines/engines.mjs";
import { runEngineOnce } from "../../bridge/engines/oneshot.mjs";
import { enabledEngines, gateStatus } from "../../lib/board/gates.mjs";
import { journalStatus, repairDeadJournals } from "../../lib/board/run-journal.mjs";
import { boardHome, ensureBoardDir } from "../../lib/board/paths.mjs";
import { assertLocalConvex, convexCli, loadBoardEnv } from "./env.mjs";

const execFileAsync = promisify(execFile);
export const TEST_VIDEO_ID = "DR60qPkDM2o";

const results = [];
function report(part, name, ok, detail = "") {
  results.push({ part, name, ok, detail });
  const mark = ok === true ? "ok  " : ok === "skip" ? "--  " : "FAIL";
  console.log(`${mark} [${part}] ${name}${detail ? ` · ${detail}` : ""}`);
}

async function checkEngine(engine, env) {
  const binary = resolveBinary(engine);
  const version = engineVersion(engine, { binary });
  if (!binary || !version) return report(1, `${ENGINES[engine].label}: installiert`, false, "nicht gefunden");
  const answer = await runEngineOnce({ engine, prompt: "Antworte nur mit: ok", effort: "low", timeoutMs: 120_000, instanceId: "doctor" });
  const ok = answer.ok && /\bok\b/i.test(answer.text.trim());
  report(1, `${ENGINES[engine].label} ${version}: Mini-Prompt in der Sandbox`, ok, ok ? `${answer.durationMs} ms, ${answer.usage?.inputTokens ?? "?"} Input-Tokens` : `${answer.error?.message ?? answer.text.slice(0, 80)}`);
  const gate = gateStatus(engine, { version, profileHash: profileHash(engine) });
  const enabled = enabledEngines(env).has(engine);
  report(1, `${ENGINES[engine].label}: Gate`, gate.state === "passed", `${gate.state}${gate.reason ? `, ${gate.reason}` : ""}${enabled ? ", in BOARD_ENGINES_ENABLED" : ", nicht freigeschaltet"}`);
}

async function checkYtDlp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sr-board-ytdlp-"));
  try {
    const url = `https://www.youtube.com/watch?v=${TEST_VIDEO_ID}`;
    const meta = await execFileAsync("yt-dlp", ["--ignore-config", "--no-playlist", "--no-cache-dir", "--skip-download", "--dump-single-json", url], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
    const info = JSON.parse(meta.stdout);
    await execFileAsync("yt-dlp", ["--ignore-config", "--no-playlist", "--no-cache-dir", "--skip-download", "--write-auto-subs", "--write-subs", "--sub-langs", "de-orig", "--sub-format", "vtt", "-P", tmp, "-o", "%(id)s.%(ext)s", url], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
    const vtt = fs.readdirSync(tmp).find((name) => name.endsWith(".vtt"));
    const size = vtt ? fs.statSync(path.join(tmp, vtt)).size : 0;
    report(1, "yt-dlp: Metadaten und deutsche Untertitel", Boolean(info.title && info.view_count && size > 1000), `${info.title?.slice(0, 40)} · ${info.view_count} Views · ${vtt ?? "keine VTT"} ${Math.round(size / 1024)} KB`);
  } catch (error) {
    report(1, "yt-dlp: Metadaten und deutsche Untertitel", false, error.message.split("\n")[0]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function checkConvex(env) {
  try {
    assertLocalConvex(env);
    const out = convexCli(["run", "boardAdmin:writeProbe", JSON.stringify({ probeId: randomBytes(4).toString("hex") })], env);
    const parsed = JSON.parse(out.slice(out.indexOf("{")));
    report(1, "Convex lokal: Schreibprobe", parsed.wrote && parsed.deleted, `${env.CONVEX_DEPLOYMENT} · ${env.NEXT_PUBLIC_CONVEX_URL}`);
  } catch (error) {
    report(1, "Convex lokal: Schreibprobe", false, error.message.split("\n")[0]);
  }
}

function checkYtos(env) {
  const root = env.YTOS_ROOT || "~/dev/YT-OS";
  const videos = path.join(root, "videos");
  const probe = path.join(videos, `.sr-board-probe-${randomBytes(4).toString("hex")}`);
  try {
    fs.writeFileSync(probe, "probe\n", { flag: "wx" });
    fs.rmSync(probe);
    report(1, "YT-OS: videos/ schreibbar", !fs.existsSync(probe), videos);
  } catch (error) {
    report(1, "YT-OS: videos/ schreibbar", false, `${videos}: ${error.message}`);
  }
}

function checkSandboxAndHome() {
  report(1, "sandbox-exec vorhanden", fs.existsSync("/usr/bin/sandbox-exec"), "/usr/bin/sandbox-exec");
  try {
    const dir = ensureBoardDir();
    const mode = (fs.statSync(dir).mode & 0o777).toString(8);
    report(1, "~/.signal-room/board mit 0700", mode === "700", `${boardHome()} (${mode})`);
  } catch (error) {
    report(1, "~/.signal-room/board mit 0700", false, error.message);
  }
}

export async function partOne(env) {
  checkSandboxAndHome();
  checkYtos(env);
  checkConvex(env);
  await checkYtDlp();
  const only = process.argv.find((arg) => arg.startsWith("--engines="))?.slice(10).split(",");
  for (const engine of ENGINE_IDS) {
    if (only && !only.includes(engine)) continue;
    await checkEngine(engine, env);
  }
}

/** Run journals (points 34a to 34c, 42b). Read-only unless `--repair`. */
export async function partRuns(env) {
  const deploymentId = env.CONVEX_DEPLOYMENT ?? env.NEXT_PUBLIC_CONVEX_URL ?? "unbekannt";
  const journals = journalStatus(deploymentId);
  if (journals.length === 0) report("L", "Lauf-Journale", true, "keine offenen");
  for (const journal of journals) {
    const age = `${Math.round(journal.ageMs / 1000)} s`;
    if (!journal.supported) report("L", `Journal ${journal.runId}`, "skip", "fremde Deployment oder unbekanntes Format, bleibt unverändert");
    else if (journal.ownerAlive) report("L", `Journal ${journal.runId}`, true, `Besitzer ${journal.owner} lebt · ${journal.hasFinal ? "Abschluss wartet auf Zustellung" : "läuft"} · ${age}`);
    else report("L", `Journal ${journal.runId}`, journal.ageMs < 120_000, `Besitzer ${journal.owner} tot · ${journal.hasFinal ? "mit Abschluss" : "ohne Abschluss"} · ${age}. \`npm run board:doctor -- --teil laeufe --repair\``);
  }
  if (!process.argv.includes("--repair")) return;
  const { ConvexHttpClient } = await import("convex/browser");
  const { anyApi } = await import("convex/server");
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  const bridge = env.BOARD_BRIDGE_URL || `http://127.0.0.1:${env.BOARD_BRIDGE_PORT || 3311}`;
  const results = await repairDeadJournals({
    deploymentId,
    deliver: async (runId, final) => {
      const result = await client.mutation(anyApi.boardChat.finishRun, { token: env.BOARD_ACCESS_TOKEN, opsVersion: 1, runId, seq: final.seq, text: final.text, textHash: final.hash, status: final.status, ...(final.reasoning ? { reasoning: final.reasoning } : {}), ...(final.usage ? { usage: final.usage } : {}), ...(final.error ? { error: final.error } : {}) });
      return result.status === "applied" || result.status === "terminal";
    },
    bridgeState: async (runId) => {
      const response = await fetch(`${bridge}/v1/board/runs/${encodeURIComponent(runId)}`, { headers: { "x-board-bridge-token": env.BOARD_BRIDGE_TOKEN ?? "" }, signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`Bridge ${response.status}`);
      return (await response.json()).state;
    },
  });
  for (const result of results) report("L", `Reparatur ${result.runId ?? result.file}`, !["deliver-failed", "bridge-unreachable"].includes(result.action), result.action);
}

export async function partTwo(env) {
  const { runLiveChecks } = await import("./doctor-live.mjs");
  await runLiveChecks(env, report);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadBoardEnv();
  const partArg = process.argv.indexOf("--teil");
  const part = partArg > 0 ? process.argv[partArg + 1] : "alle";
  if (part === "1" || part === "alle") await partOne(env);
  if (part === "2" || part === "alle") {
    if (fs.existsSync(new URL("./doctor-live.mjs", import.meta.url))) await partTwo(env);
    else report(2, "Teil 2", "skip", "kommt mit Phase 0b");
  }
  if (part === "laeufe" || part === "alle") await partRuns(env);
  const failed = results.filter((r) => r.ok === false);
  console.log(failed.length ? `\n${failed.length} Prüfung(en) rot.` : "\nAlles grün.");
  process.exit(failed.length ? 1 : 0);
}
