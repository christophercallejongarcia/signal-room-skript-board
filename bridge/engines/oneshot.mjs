import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { buildEngineCommand, codexConfiguredModel, prepareRunDir, removeRunDir, resolveBinary } from "./engines.mjs";
import { commandCodeExitError, createLineParser, errorMessage } from "./parse.mjs";

/**
 * One sandboxed engine call collected to the end. Used by `board:doctor` and
 * `board:gate`, which need a whole answer, not a stream. The chat path in the
 * bridge uses the streaming runner with supervisor and slots instead.
 */
export async function runEngineOnce({ engine, prompt, modelId, effort = "low", system = null, timeoutMs = 120_000, instanceId = "doctor", onSpawn }) {
  const binary = resolveBinary(engine);
  if (!binary) return { ok: false, error: { code: "not-installed", message: `${engine} ist nicht installiert.` } };
  const run = prepareRunDir(engine, { instanceId });
  const started = Date.now();
  try {
    let systemFile = null;
    let input = prompt;
    if (system && engine === "claude") {
      systemFile = path.join(run.runDir, "system.txt");
      fs.writeFileSync(systemFile, system);
    } else if (system) {
      input = `${system}\n\n${prompt}`;
    }
    const resolvedModel = modelId ?? (engine === "codex" ? codexConfiguredModel() : undefined);
    const command = buildEngineCommand({ engine, modelId: resolvedModel, effort, run, binary, systemFile });
    const child = spawn(command.command, command.args, { cwd: command.cwd, env: command.env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    onSpawn?.(child, run);
    const parse = createLineParser(engine);
    const result = { ok: false, text: "", reasoning: "", usage: null, error: null, notices: [], stderr: "", exitCode: null, runDir: run.runDir };
    const timer = setTimeout(() => {
      result.error = { code: "timeout", message: "Die Engine hat nicht rechtzeitig geantwortet." };
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 2_000).unref();
    }, timeoutMs);
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      result.stderr = (result.stderr + chunk).slice(-8_192);
    });
    const lines = readline.createInterface({ input: child.stdout });
    for await (const line of lines) {
      for (const event of parse(line)) {
        if (event.type === "text-delta") result.text += event.text;
        else if (event.type === "reasoning-delta") result.reasoning += event.text;
        else if (event.type === "finish") result.usage = event.usage;
        else if (event.type === "error") result.error ??= event;
        else if (event.type === "notice") result.notices.push(event);
      }
    }
    result.exitCode = await new Promise((resolve) => (child.exitCode !== null ? resolve(child.exitCode) : child.on("close", (code) => resolve(code))));
    clearTimeout(timer);
    if (!result.error && result.exitCode !== 0) {
      result.error = (engine === "command-code" && commandCodeExitError(result.exitCode)) || {
        code: /not logged in|login/i.test(result.stderr) ? "not-logged-in" : "engine-error",
        message: /not logged in|login/i.test(result.stderr) ? errorMessage("not-logged-in", engine) : errorMessage("engine-error", engine),
        detail: result.stderr.slice(-500),
      };
    }
    if (!result.error && !result.usage) result.error = { code: "no-finish", message: "Die Engine hat ohne Abschluss geendet." };
    result.ok = !result.error;
    result.durationMs = Date.now() - started;
    return result;
  } finally {
    removeRunDir(run.runDir);
  }
}
