import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Whether Codex can run at all. The SDK spawns the Codex CLI, which reads the
 * subscription login from `$CODEX_HOME/auth.json` (default `~/.codex`); an
 * explicit CODEX_API_KEY bypasses that file.
 */
export function codexAuthState({ home, env = process.env } = {}) {
  if (env.CODEX_API_KEY) return "logged-in";
  const codexHome = home ?? env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  return fs.existsSync(path.join(codexHome, "auth.json")) ? "logged-in" : "logged-out";
}
