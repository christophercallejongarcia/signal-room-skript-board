import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Shared board state outside every repo (plan point 9): locks, journals,
 * registers, slots, logs, gate results and backups. Several worktrees and
 * processes coordinate through this directory, so it never lives in a checkout.
 * `SIGNAL_ROOM_BOARD_HOME` exists for tests and the E2E harness only.
 */
export function boardHome(env = process.env) {
  const override = env.SIGNAL_ROOM_BOARD_HOME?.trim();
  return override ? path.resolve(override) : path.join(os.homedir(), ".signal-room", "board");
}

/** Create `boardHome()/...parts` with 0700 on every level we own and return it. */
export function ensureBoardDir(...parts) {
  const root = boardHome();
  const target = path.join(root, ...parts);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  let current = target;
  while (current.startsWith(root)) {
    fs.chmodSync(current, 0o700);
    if (current === root) break;
    current = path.dirname(current);
  }
  const parent = path.dirname(root);
  if (path.basename(parent) === ".signal-room") fs.chmodSync(parent, 0o700);
  return target;
}

export function boardFile(...parts) {
  return path.join(boardHome(), ...parts);
}
