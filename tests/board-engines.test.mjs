import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEngineCommand, CODEX_DISABLED_FEATURES, codexConfiguredModel, ENGINE_IDS, prepareRunDir, profileHash, removeRunDir, SANDBOX_EXEC } from "../bridge/engines/engines.mjs";
import { commandCodeExitError, createLineParser } from "../bridge/engines/parse.mjs";
import { gateStatus } from "../lib/board/gates.mjs";

const fixtures = new URL("./fixtures/board-engines/", import.meta.url);

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sr-board-home-"));
  fs.mkdirSync(path.join(home, ".codex"));
  fs.writeFileSync(path.join(home, ".codex", "auth.json"), "{}");
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "gpt-test"\nmodel_reasoning_effort = "medium"\n[profiles.x]\nmodel = "other"\n');
  fs.mkdirSync(path.join(home, ".commandcode"));
  fs.writeFileSync(path.join(home, ".commandcode", "auth.json"), "{}");
  return home;
}

function collect(engine, file) {
  const parse = createLineParser(engine);
  const events = fs.readFileSync(new URL(file, fixtures), "utf8").split("\n").flatMap((line) => parse(line));
  return {
    text: events.filter((e) => e.type === "text-delta").map((e) => e.text).join(""),
    deltas: events.filter((e) => e.type === "text-delta").length,
    finish: events.find((e) => e.type === "finish"),
    error: events.find((e) => e.type === "error"),
  };
}

test("every engine starts through sandbox-exec with its own profile and the run directory as parameter", () => {
  const home = fakeHome();
  for (const engine of ENGINE_IDS) {
    const run = prepareRunDir(engine, { instanceId: "test", home });
    try {
      const cmd = buildEngineCommand({ engine, modelId: undefined, effort: "low", run, binary: "/usr/local/bin/fake", home });
      assert.equal(cmd.command, SANDBOX_EXEC);
      assert.equal(cmd.args[0], "-f");
      assert.ok(cmd.args[1].endsWith(`${engine}.sb`));
      assert.ok(cmd.args.includes(`RUN_DIR=${run.runDir}`));
      assert.equal(cmd.cwd, run.workDir);
      assert.ok(path.basename(run.runDir).startsWith("sr-board-test-"));
      assert.deepEqual(Object.keys(cmd.env).filter((key) => /KEY|TOKEN|SECRET/.test(key)), [], "no secrets in the engine env");
    } finally {
      removeRunDir(run.runDir);
    }
  }
});

test("Claude gets no tools, no settings, no MCP, no session and one turn", () => {
  const home = fakeHome();
  const run = prepareRunDir("claude", { home });
  const { args, env } = buildEngineCommand({ engine: "claude", modelId: "sonnet", effort: "high", run, binary: "/x/claude", home });
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(at("--tools"), "");
  assert.equal(at("--setting-sources"), "");
  assert.equal(at("--max-turns"), "1");
  assert.equal(at("--model"), "sonnet");
  assert.equal(at("--effort"), "high");
  for (const flag of ["--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands", "--include-partial-messages"]) assert.ok(args.includes(flag), flag);
  assert.ok(args.includes("CLAUDE_BIN=/x/claude"));
  assert.equal(env.CLAUDE_CODE_TMPDIR, run.tmpDir);
  removeRunDir(run.runDir);
});

test("Codex runs with its own CODEX_HOME holding only a symlink to auth.json, and every tool feature off", () => {
  const home = fakeHome();
  const run = prepareRunDir("codex", { home });
  const { args, env } = buildEngineCommand({ engine: "codex", modelId: codexConfiguredModel(home), effort: "instant", run, binary: "/x/codex", home });
  assert.equal(env.CODEX_HOME, run.engineHome);
  assert.deepEqual(fs.readdirSync(run.engineHome), ["auth.json"]);
  assert.equal(fs.readlinkSync(path.join(run.engineHome, "auth.json")), path.join(home, ".codex", "auth.json"));
  assert.notEqual(env.HOME, home, "Codex never sees the real HOME");
  assert.equal(env.SSL_CERT_FILE, "/etc/ssl/cert.pem");
  for (const flag of ["--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(args[args.indexOf("-m") + 1], "gpt-test", "model comes from the top-level config key");
  for (const feature of ["apps", "shell_tool", "computer_use", "browser_use", "plugins"]) assert.ok(CODEX_DISABLED_FEATURES.includes(feature));
  assert.ok(args.includes("features.apps=false"));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes("mcp_servers={}"));
  assert.ok(args.includes('model_reasoning_effort="low"'), "instant maps to low");
  assert.equal(args.at(-1), "-", "prompt over stdin");
  removeRunDir(run.runDir);
});

test("Command Code runs with a private HOME and deny-all project settings", () => {
  const home = fakeHome();
  const run = prepareRunDir("command-code", { home });
  const { args, env } = buildEngineCommand({ engine: "command-code", modelId: "zai-org/glm-5.3", effort: "medium", run, binary: "/x/cc", home });
  assert.equal(env.HOME, run.engineHome);
  assert.deepEqual(fs.readdirSync(path.join(run.engineHome, ".commandcode")), ["auth.json"]);
  const settings = JSON.parse(fs.readFileSync(path.join(run.workDir, ".commandcode", "settings.json"), "utf8"));
  assert.deepEqual(settings.permissions.deny, ["*"]);
  for (const flag of ["--no-session", "--skip-onboarding", "--no-skills", "--no-auto-update"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dont-ask");
  assert.equal(args[args.indexOf("--max-turns") + 1], "3");
  assert.ok(!args.includes("--effort"), "only Hoch passes --effort, other levels use the model default");
  removeRunDir(run.runDir);
});

test("run directories outside the sr-board prefix are never deleted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "not-board-"));
  removeRunDir(dir);
  assert.ok(fs.existsSync(dir));
  fs.rmSync(dir, { recursive: true });
});

test("recorded Claude stream maps to many text deltas and a finish with usage", () => {
  const result = collect("claude", "claude-success.jsonl");
  assert.ok(result.deltas > 5);
  assert.match(result.text, /Kaffee/);
  assert.ok(result.finish.usage.inputTokens > 0);
  assert.equal(result.error, undefined);
});

test("recorded Codex output maps to one whole-text delta", () => {
  const result = collect("codex", "codex-success.jsonl");
  assert.equal(result.deltas, 1);
  assert.equal(result.text.split("\n").length, 3);
  assert.ok(result.finish.usage.inputTokens > 0);
});

test("recorded Command Code stream maps text deltas and ignores message_update echoes", () => {
  const result = collect("command-code", "command-code-success.jsonl");
  assert.ok(result.deltas > 5);
  assert.match(result.text, /Kaffee/);
  const final = JSON.parse(fs.readFileSync(new URL("command-code-success.jsonl", fixtures), "utf8").trim().split("\n").at(-1)).finalText;
  assert.equal(result.text, final);
  assert.ok(result.finish);
});

test("logged-out, rate-limit and unknown formats become German errors or notices", () => {
  const claude = createLineParser("claude");
  const loggedOut = claude(JSON.stringify({ type: "result", is_error: true, result: "Not logged in · Please run /login" }));
  assert.equal(loggedOut[0].code, "not-logged-in");
  assert.match(loggedOut[0].message, /claude.*\/login/);
  assert.equal(claude(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } }))[0].code, "rate-limit");
  assert.deepEqual(claude(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } })), []);
  const codex = createLineParser("codex");
  assert.equal(codex(JSON.stringify({ type: "turn.failed", error: { message: "unexpected status 401 Unauthorized" } }))[0].code, "not-logged-in");
  assert.equal(codex(JSON.stringify({ type: "error", message: "Reconnecting... 1/5" }))[0].type, "notice");
  const cc = createLineParser("command-code");
  assert.equal(cc(JSON.stringify({ type: "event", event: { type: "tool_denied", toolName: "read_file" } }))[0].code, "tool-denied");
  assert.equal(cc(JSON.stringify({ type: "event", event: { type: "brand_new_event" } }))[0].code, "format-changed");
  assert.equal(cc("kein json")[0].code, "non-json");
  assert.equal(commandCodeExitError(3).code, "not-logged-in");
  assert.equal(commandCodeExitError(10).code, "no-credits");
});

test("a gate result counts only for the same engine version and profile hash", () => {
  const hash = profileHash("claude");
  const gates = { claude: { passed: true, version: "2.1.283", profileHash: hash, checkedAt: "x" } };
  assert.equal(gateStatus("claude", { version: "2.1.283", profileHash: hash }, gates).state, "passed");
  assert.equal(gateStatus("claude", { version: "2.1.284", profileHash: hash }, gates).state, "unchecked");
  assert.equal(gateStatus("claude", { version: "2.1.283", profileHash: "other" }, gates).state, "unchecked");
  assert.equal(gateStatus("codex", { version: "1", profileHash: hash }, gates).state, "unchecked");
  assert.equal(gateStatus("claude", { version: "2.1.283", profileHash: hash }, { claude: { ...gates.claude, passed: false, reason: "x" } }).state, "failed");
});
