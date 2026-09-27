import fs from "node:fs";
import { boardFile, ensureBoardDir } from "./paths.mjs";

/**
 * Gate results per engine in `~/.signal-room/board/gates.json` (PLAN.md point 37).
 * A result only counts for the exact engine version and sandbox profile hash it
 * was measured with; anything else is "ungeprüft" and the engine stays off.
 */
export function gatesFile() {
  return boardFile("gates.json");
}

export function readGates() {
  try {
    const parsed = JSON.parse(fs.readFileSync(gatesFile(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeGateResult(engine, result) {
  ensureBoardDir();
  const gates = readGates();
  gates[engine] = result;
  const file = gatesFile();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(gates, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return gates;
}

/** "passed" | "failed" | "unchecked" (with reason) for the engine as installed now. */
export function gateStatus(engine, { version, profileHash }, gates = readGates()) {
  const entry = gates[engine];
  if (!entry) return { state: "unchecked", reason: "Noch kein Gate gelaufen." };
  if (entry.version !== version) return { state: "unchecked", reason: `Engine-Version hat sich geändert (${entry.version} → ${version}).` };
  if (entry.profileHash !== profileHash) return { state: "unchecked", reason: "Sandbox-Profil hat sich geändert." };
  if (!entry.passed) return { state: "failed", reason: entry.reason || "Gate nicht bestanden." };
  return { state: "passed", checkedAt: entry.checkedAt };
}

/** Engines Chris enabled in `BOARD_ENGINES_ENABLED` (comma list). Empty means none. */
export function enabledEngines(env = process.env) {
  return new Set(
    (env.BOARD_ENGINES_ENABLED || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}
