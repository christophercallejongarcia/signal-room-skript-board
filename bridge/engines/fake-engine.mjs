#!/usr/bin/env node
/**
 * Fake engine for tests and the E2E fake mode (BOARD_ENGINE_FAKE=1, PLAN.md
 * points 79, 106). Started with the same argv as the real engine:
 *
 *   node fake-engine.mjs <claude|codex|command-code> [engine args…]
 *
 * It reads the whole prompt from stdin and answers in the recorded JSONL format
 * of that engine. Markers in the last user turn (or, without turns, anywhere
 * in the prompt) change the behaviour; markers in the history do not:
 *   [[fake:logged-out]]      the engine's "not logged in" answer
 *   [[fake:rate-limit]]      the engine's rate-limit answer
 *   [[fake:silence=<ms>]]    wait before the first output (scaled)
 *   [[fake:stream=<ms>]]     keep streaming small deltas for that long (scaled)
 *   [[fake:hang]]            never answer, never exit
 *   [[fake:die]]             two deltas, then exit 1 without a result
 *   [[fake:stall]]           two deltas, then silence forever
 *   [[fake:killself]]        two deltas, then SIGKILL on itself
 *   [[fake:child]]           start a grandchild in the same process group
 *   [[fake:ignore-term]]     ignore SIGTERM (only SIGKILL ends it)
 *   [[fake:tool]]            Command Code tries a tool and gets `tool_denied`
 *   [[fake:image]]           answer contains a Markdown image on a foreign host
 *   [[fake:clickable]]       answer contains two clickable titles
 * Waiting times are multiplied by BOARD_ENGINE_TIME_SCALE like the bridge's deadlines.
 * FAKE_ENGINE_LOG appends start and end lines (pid, pgid, engine, model, stdin
 * bytes and hash); FAKE_ENGINE_STDIN_DIR keeps the stdin of every run.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [engine, ...args] = process.argv.slice(2);
const scale = Number(process.env.BOARD_ENGINE_TIME_SCALE || 1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const valueOf = (...flags) => {
  for (const flag of flags) {
    const index = args.indexOf(flag);
    if (index >= 0) return args[index + 1];
  }
  return undefined;
};
const log = (entry) => {
  if (process.env.FAKE_ENGINE_LOG) fs.appendFileSync(process.env.FAKE_ENGINE_LOG, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
};
const emit = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** The last user turn, where the markers of this run live; the whole prompt if there are no turns. */
function controlText(prompt) {
  const turns = [...prompt.matchAll(/<turn role="user">\n?([\s\S]*?)<\/turn>/g)];
  return turns.at(-1)?.[1] ?? prompt;
}

let control = "";

function marker(_prompt, name) {
  const match = control.match(new RegExp(`\\[\\[fake:${name}(?:=(\\d+))?\\]\\]`));
  if (!match) return null;
  return match[1] === undefined ? true : Number(match[1]);
}

/** Deterministic answer text: engine, model, how many sources and turns arrived, the start of the last user turn. */
function answerText(prompt, model) {
  const sources = (prompt.match(/<quelle /g) ?? []).length;
  const turns = [...prompt.matchAll(/<turn role="user">\n?([\s\S]*?)<\/turn>/g)];
  const last = (turns.at(-1)?.[1] ?? prompt).replace(/\[\[fake:[^\]]*\]\]/g, "").trim().replace(/\s+/g, " ").slice(0, 80);
  const lines = [`Fake-Antwort von ${engine} (${model}).`, `Quellen im Kontext: ${sources}.`, `Letzte Frage: ${last}`];
  if (marker(prompt, "image")) lines.push("", "![Bild](https://evil.example/pixel.png)", "[Link](https://example.org/seite)");
  if (marker(prompt, "clickable")) {
    lines.push("", `<clickable-title titlePrompt="Schreib mir einen Hook zu '{{titleText}}'">Erster Titel</clickable-title>`);
    lines.push(`<clickable-title titlePrompt="Schreib mir einen Hook zu '{{titleText}}'">Zweiter Titel</clickable-title>`);
  }
  return lines.join("\n");
}

function chunks(text, size = 12) {
  const parts = [];
  const chars = [...text];
  for (let i = 0; i < chars.length; i += size) parts.push(chars.slice(i, i + size).join(""));
  return parts;
}

const usage = (prompt, text) => ({ input: Math.ceil(Buffer.byteLength(prompt) / 2) + 500, output: Math.ceil(Buffer.byteLength(text) / 3) });

async function streamDeltas(prompt, text, delta) {
  const streamMs = marker(prompt, "stream");
  if (typeof streamMs === "number") {
    const until = Date.now() + streamMs * scale;
    const tick = Math.max(20, Math.min(1_000, 200 * scale));
    while (Date.now() < until) {
      delta(".");
      await sleep(tick);
    }
  }
  for (const part of chunks(text)) {
    delta(part);
    await sleep(5);
  }
}

async function dieEarly(prompt, delta) {
  if (marker(prompt, "stall")) {
    delta("Teil eins ");
    delta("und zwei");
    await new Promise(() => setInterval(() => {}, 60_000));
  }
  if (marker(prompt, "die")) {
    delta("Teil eins ");
    delta("und zwei");
    await sleep(50);
    process.exit(1);
  }
  if (marker(prompt, "killself")) {
    delta("Teil eins ");
    delta("und zwei");
    await sleep(50);
    process.kill(process.pid, "SIGKILL");
  }
}

async function claude(prompt, model) {
  emit({ type: "system", subtype: "init", tools: [], mcp_servers: [], model, apiKeySource: "none" });
  if (marker(prompt, "logged-out")) {
    emit({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" });
    process.exit(1);
  }
  if (marker(prompt, "rate-limit")) {
    emit({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } });
    emit({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached" });
    process.exit(1);
  }
  const text = answerText(prompt, model);
  const delta = (value) => emit({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: value } } });
  emit({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Ich denke kurz nach." } } });
  await dieEarly(prompt, delta);
  await streamDeltas(prompt, text, delta);
  const used = usage(prompt, text);
  emit({ type: "assistant", message: { content: [{ type: "text", text }] } });
  emit({ type: "result", subtype: "success", is_error: false, result: text, usage: { input_tokens: used.input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: used.output } });
}

async function codex(prompt, model) {
  emit({ type: "thread.started", thread_id: "fake-thread" });
  emit({ type: "turn.started" });
  if (marker(prompt, "logged-out")) {
    emit({ type: "turn.failed", error: { message: "unexpected status 401 Unauthorized" } });
    process.exit(1);
  }
  if (marker(prompt, "rate-limit")) {
    emit({ type: "turn.failed", error: { message: "429 Too Many Requests: usage limit reached" } });
    process.exit(1);
  }
  if (marker(prompt, "die") || marker(prompt, "killself")) {
    await sleep(50);
    if (marker(prompt, "killself")) process.kill(process.pid, "SIGKILL");
    process.exit(1);
  }
  const text = answerText(prompt, model);
  const streamMs = marker(prompt, "stream");
  if (typeof streamMs === "number") await sleep(streamMs * scale);
  emit({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "Kurz überlegt." } });
  emit({ type: "item.completed", item: { id: "item_1", type: "agent_message", text } });
  const used = usage(prompt, text);
  emit({ type: "turn.completed", usage: { input_tokens: used.input, cached_input_tokens: 0, output_tokens: used.output } });
}

async function commandCode(prompt, model) {
  if (marker(prompt, "logged-out")) {
    process.stderr.write("Error: not logged in. Run command-code login.\n");
    process.exit(3);
  }
  if (marker(prompt, "rate-limit")) {
    process.stderr.write("Error: rate limit exceeded.\n");
    process.exit(5);
  }
  emit({ type: "event", event: { type: "run_start", sessionId: "fake" } });
  emit({ type: "event", event: { type: "model_request_start", model } });
  if (marker(prompt, "tool")) {
    emit({ type: "event", event: { type: "tool_call_start", toolName: "read_file" } });
    emit({ type: "event", event: { type: "tool_denied", toolName: "read_file" } });
  }
  const text = answerText(prompt, model);
  const delta = (value) => emit({ type: "event", event: { type: "text_delta", delta: value } });
  emit({ type: "event", event: { type: "thinking_delta", delta: "Kurz überlegt." } });
  await dieEarly(prompt, delta);
  await streamDeltas(prompt, text, delta);
  const used = usage(prompt, text);
  emit({ type: "result", subtype: "success", usage: { inputTokens: used.input, outputTokens: used.output, cacheReadTokens: 0 }, finalText: text });
}

async function main() {
  const prompt = await readStdin();
  control = controlText(prompt);
  const model = valueOf("--model", "-m") ?? (engine === "claude" ? "sonnet" : "fake-model");
  const hash = createHash("sha256").update(prompt).digest("hex");
  if (process.env.FAKE_ENGINE_STDIN_DIR) fs.writeFileSync(path.join(process.env.FAKE_ENGINE_STDIN_DIR, `${process.pid}.txt`), prompt);
  if (marker(prompt, "ignore-term")) process.on("SIGTERM", () => log({ ignored: "SIGTERM" }));
  else process.on("SIGTERM", () => process.exit(143));
  let child = null;
  if (marker(prompt, "child")) child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"], { stdio: "ignore" });
  // The start line comes after the signal handlers: a test that waits for it can rely on them.
  log({ engine, model, pgid: process.pid, cwd: process.cwd(), at: Date.now(), bytes: Buffer.byteLength(prompt), hash, args, ...(child ? { child: child.pid } : {}) });
  process.on("exit", () => log({ end: Date.now() }));
  const silence = marker(prompt, "silence");
  if (typeof silence === "number") await sleep(silence * scale);
  if (marker(prompt, "hang")) {
    setInterval(() => {}, 60_000);
    return;
  }
  if (engine === "claude") await claude(prompt, model);
  else if (engine === "codex") await codex(prompt, model);
  else if (engine === "command-code") await commandCode(prompt, model);
  else {
    process.stderr.write(`fake-engine: unbekannte Engine ${engine}\n`);
    process.exit(2);
  }
  // A grandchild from [[fake:child]] outlives this process; the supervisor has to end it.
}

main().catch((error) => {
  process.stderr.write(`fake-engine: ${error.message}\n`);
  process.exit(70);
});
