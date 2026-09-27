import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * How each board engine is started: binary, sandbox profile, inner switches
 * (PLAN.md points 35 and 36) and a minimal environment. Everything here is
 * pure argv/env building plus a few read-only lookups, so tests can check the
 * exact command without spawning a model.
 */

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin";
export const ENGINE_IDS = /** @type {const} */ (["claude", "codex", "command-code"]);
export const EFFORTS = /** @type {const} */ (["instant", "low", "medium", "high"]);

export const ENGINES = {
  claude: {
    id: "claude",
    label: "Claude Code",
    binary: "claude",
    profile: "claude.sb",
    loginHint: "Im Terminal `claude` starten und `/login`.",
    streams: true,
  },
  codex: {
    id: "codex",
    label: "Codex",
    binary: "codex",
    profile: "codex.sb",
    loginHint: "Im Terminal `codex login` ausführen.",
    streams: false,
  },
  "command-code": {
    id: "command-code",
    label: "Command Code",
    binary: "command-code",
    profile: "command-code.sb",
    loginHint: "Im Terminal `command-code login` ausführen.",
    streams: true,
  },
};

/** Codex features that give the model tools or reach into Chris' accounts. All off (point 36). */
export const CODEX_DISABLED_FEATURES = [
  "apps",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "image_generation",
  "hooks",
  "plugins",
  "remote_plugin",
  "multi_agent",
  "goals",
  "in_app_browser",
  "in_app_local_automation",
  "shell_tool",
  "unified_exec",
  "view_image",
  "skill_search",
  "skill_mcp_dependency_install",
  "tool_suggest",
];

/** Deny-all settings Command Code reads from the project directory (point 36). */
export const COMMAND_CODE_SETTINGS = { permissions: { defaultMode: "dont-ask", deny: ["*"] } };

export function isEngineId(value) {
  return typeof value === "string" && Object.hasOwn(ENGINES, value);
}

export function profilePath(engine) {
  return path.join(ENGINE_DIR, ENGINES[engine].profile);
}

/** Hash of the sandbox profile. A gate result is only valid for exactly this profile (point 37). */
export function profileHash(engine) {
  return createHash("sha256").update(fs.readFileSync(profilePath(engine))).digest("hex");
}

/** Absolute, symlink-free path of an engine binary, searched outside the sandbox. */
export function resolveBinary(engine, env = process.env) {
  const name = ENGINES[engine].binary;
  // Installed engines only: repo-local `node_modules/.bin` (npm run puts it first) carries the Codex SDK's own, older CLI.
  const dirs = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".local", "bin"),
    ...(env.PATH || "").split(":").filter((dir) => !dir.includes("node_modules")),
  ].filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {
      // next directory
    }
  }
  return null;
}

/** `--version` of the engine, unsandboxed and without a model call. */
export function engineVersion(engine, { binary = resolveBinary(engine), timeoutMs = 15_000 } = {}) {
  if (!binary) return null;
  try {
    const out = execFileSync(binary, ["--version"], { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().split("\n")[0].trim() || null;
  } catch {
    return null;
  }
}

/** Codex runs with --ignore-user-config, so its model comes from the user's config file, read here. */
export function codexConfiguredModel(home = os.homedir()) {
  try {
    const text = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    for (const line of text.split("\n")) {
      if (/^\s*\[/.test(line)) break;
      const match = line.match(/^\s*model\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    }
  } catch {
    // no config
  }
  return null;
}

function mapEffort(engine, effort) {
  if (!effort || !EFFORTS.includes(effort)) return null;
  if (engine === "command-code") return effort === "high" ? "high" : null;
  return effort === "instant" ? "low" : effort;
}

/** The per-user cache directory of the Security framework (Claude's keychain lookup needs it). */
export function mdsDirectory() {
  try {
    const dir = execFileSync("/usr/bin/getconf", ["DARWIN_USER_CACHE_DIR"], { encoding: "utf8" }).trim();
    return path.join(fs.realpathSync(dir), "mds");
  } catch {
    return path.join(os.tmpdir(), "..", "C", "mds");
  }
}

/**
 * Create the run's temp directory `sr-board-<instanceId>-XXXX` (point 38) with
 * the per-engine layout. Returns real paths, because the sandbox matches the
 * resolved path.
 */
export function prepareRunDir(engine, { instanceId = "local", home = os.homedir(), tmpRoot = os.tmpdir() } = {}) {
  const safeInstance = String(instanceId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "local";
  const runDir = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, `sr-board-${safeInstance}-`)));
  const workDir = path.join(runDir, "work");
  const tmpDir = path.join(runDir, "tmp");
  fs.mkdirSync(workDir, { mode: 0o700 });
  fs.mkdirSync(tmpDir, { mode: 0o700 });
  let engineHome = null;
  if (engine === "codex") {
    engineHome = path.join(runDir, "codex-home");
    fs.mkdirSync(engineHome, { mode: 0o700 });
    fs.symlinkSync(path.join(home, ".codex", "auth.json"), path.join(engineHome, "auth.json"));
  }
  if (engine === "command-code") {
    engineHome = path.join(runDir, "home");
    fs.mkdirSync(path.join(engineHome, ".commandcode"), { recursive: true, mode: 0o700 });
    fs.symlinkSync(path.join(home, ".commandcode", "auth.json"), path.join(engineHome, ".commandcode", "auth.json"));
    fs.mkdirSync(path.join(workDir, ".commandcode"), { mode: 0o700 });
    fs.writeFileSync(path.join(workDir, ".commandcode", "settings.json"), JSON.stringify(COMMAND_CODE_SETTINGS));
  }
  return { runDir, workDir, tmpDir, engineHome };
}

export function removeRunDir(runDir) {
  if (!runDir || !path.basename(runDir).startsWith("sr-board-")) return;
  fs.rmSync(runDir, { recursive: true, force: true });
}

/** Parameters the engine's .sb profile expects. */
export function sandboxParams(engine, { run, binary, home = os.homedir() }) {
  const params = { HOME: home, RUN_DIR: run.runDir };
  if (engine === "claude") {
    params.CLAUDE_BIN = binary;
    params.MDS_DIR = mdsDirectory();
  }
  return params;
}

/** `sandbox-exec` arguments before the command: profile file plus `-D` parameters. */
export function profileArgs(engine, params) {
  const args = ["-f", profilePath(engine)];
  for (const [key, value] of Object.entries(params)) args.push("-D", `${key}=${value}`);
  return args;
}

/**
 * The complete sandboxed command for one engine run. The prompt always goes
 * over stdin; a system text, if any, goes to a file in the run directory
 * (Claude) or is expected as preamble in the prompt (Codex, Command Code).
 */
export function buildEngineCommand({ engine, modelId, effort, run, binary, home = os.homedir(), systemFile = null, maxTurns }) {
  if (!isEngineId(engine)) throw new Error(`Unbekannte Engine: ${engine}`);
  if (!binary) throw new Error(`${ENGINES[engine].label} ist nicht installiert.`);
  const mappedEffort = mapEffort(engine, effort);
  const baseEnv = {
    PATH: SYSTEM_PATH,
    HOME: home,
    TMPDIR: `${run.tmpDir}/`,
    USER: os.userInfo().username,
    LOGNAME: os.userInfo().username,
    LANG: "de_DE.UTF-8",
    NO_COLOR: "1",
  };
  const params = sandboxParams(engine, { run, binary, home });
  let engineArgs;
  let env;

  if (engine === "claude") {
    env = { ...baseEnv, CLAUDE_CODE_TMPDIR: run.tmpDir, DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" };
    engineArgs = [
      binary,
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--tools", "",
      "--setting-sources", "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--max-turns", String(maxTurns ?? 1),
      "--model", modelId || "sonnet",
      ...(mappedEffort ? ["--effort", mappedEffort] : []),
      ...(systemFile ? ["--system-prompt-file", systemFile] : []),
    ];
  } else if (engine === "codex") {
    env = { ...baseEnv, HOME: path.join(run.runDir, "home-empty"), CODEX_HOME: run.engineHome, SSL_CERT_FILE: "/etc/ssl/cert.pem" };
    fs.mkdirSync(env.HOME, { recursive: true, mode: 0o700 });
    engineArgs = [
      binary,
      "exec",
      "--json",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--disable", "plugins",
      ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["-c", `features.${feature}=false`]),
      "-c", 'web_search="disabled"',
      "-c", "mcp_servers={}",
      ...(mappedEffort ? ["-c", `model_reasoning_effort="${mappedEffort}"`] : []),
      ...(modelId ? ["-m", modelId] : []),
      "-C", run.workDir,
      "-",
    ];
  } else {
    env = { ...baseEnv, HOME: run.engineHome, SSL_CERT_FILE: "/etc/ssl/cert.pem" };
    engineArgs = [
      binary,
      "-p",
      "--output-format", "json",
      "--no-session",
      "--skip-onboarding",
      "--no-skills",
      "--permission-mode", "dont-ask",
      "--no-auto-update",
      "--max-turns", String(maxTurns ?? 3),
      ...(modelId ? ["-m", modelId] : []),
      ...(mappedEffort ? ["--effort", mappedEffort] : []),
    ];
  }

  return { command: SANDBOX_EXEC, args: [...profileArgs(engine, params), ...engineArgs], cwd: run.workDir, env };
}
