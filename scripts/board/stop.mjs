#!/usr/bin/env node
/**
 * `npm run board:stop` (PLAN.md Punkt 9c): lokaler Stopppfad ohne Convex.
 * Legt `~/.signal-room/board/drain` an, damit keine Bridge neue Läufe annimmt,
 * und meldet es der laufenden Bridge über `POST /v1/board/drain`.
 *
 *   --abbrechen   laufende Läufe dieser Bridge zusätzlich abbrechen
 *   --weiter      Drain aufheben (Datei löschen, Bridge informieren)
 */
import fs from "node:fs";
import { boardFile, ensureBoardDir } from "../../lib/board/paths.mjs";
import { loadBoardEnv } from "./env.mjs";

const env = loadBoardEnv();
const resume = process.argv.includes("--weiter");
const abortRunning = process.argv.includes("--abbrechen");
const file = boardFile("drain");

if (resume) fs.rmSync(file, { force: true });
else {
  ensureBoardDir();
  fs.writeFileSync(file, JSON.stringify({ since: new Date().toISOString(), by: "board:stop" }), { mode: 0o600 });
}
console.log(resume ? `Drain aufgehoben (${file} gelöscht).` : `Drain gesetzt: ${file}. Keine Bridge nimmt neue Läufe an.`);

const port = Number(env.BOARD_BRIDGE_PORT || 3311);
try {
  const response = await fetch(`http://127.0.0.1:${port}/v1/board/drain`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-board-bridge-token": env.BOARD_BRIDGE_TOKEN ?? "" },
    body: JSON.stringify(resume ? { resume: true } : { abortRunning }),
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) console.log(`Bridge auf ${port} antwortet mit ${response.status}: ${body.error ?? ""}`);
  else if (!resume) console.log(`Bridge auf ${port}: ${body.running ?? 0} Läufe aktiv, ${body.aborted ?? 0} abgebrochen.`);
  else console.log(`Bridge auf ${port} nimmt wieder Läufe an.`);
} catch (error) {
  console.log(`Bridge auf ${port} nicht erreichbar (${error.message}). Die Drain-Datei wirkt trotzdem für jede Bridge.`);
}
