#!/usr/bin/env node
/**
 * `npm run board:calibrate [engine…]`: Rauchtest je echter Engine und Modell
 * (PLAN.md Punkte 40, 41, 79). Zwei Läufe je Modell über denselben Weg wie der
 * Chat (Sandbox, System-Text, Prompt über stdin):
 *   mini        "Antworte nur mit: ok" ohne Quellen, misst den Engine-Overhead
 *   kalibrier   Quellen mit Code, Emoji, CJK, Umlauten und ein langer Verlauf
 * Bestanden, wenn die echten Input-Tokens aus der Usage unter der Schätzung
 * ohne Antwortreserve liegen (Bytes × Faktor + Overhead). Ergebnis als JSON in
 * ~/.signal-room/board/calibration.json, Befund von Hand nach research/07.
 */
import fs from "node:fs";
import { ENGINES, engineVersion, resolveBinary } from "../../bridge/engines/engines.mjs";
import { runEngineOnce } from "../../bridge/engines/oneshot.mjs";
import { boardFile, ensureBoardDir } from "../../lib/board/paths.mjs";
import { ANSWER_RESERVE_TOKENS, BOARD_MODELS, CODEX_CONFIG_MODEL, estimateTokens } from "../../lib/board/models.ts";
import { renderedBytes, renderPrompt } from "../../lib/board/prompt.ts";

const CODE = [
  "```ts",
  "export async function* runEngine(options: RunOptions): AsyncIterable<EngineEvent> {",
  "  const handle = await startEngineRun({ ...options, effort: options.effort ?? 'low' });",
  "  for await (const event of handle.events) if (event.type !== 'notice') yield event;",
  "  return { ok: true, bytes: Buffer.byteLength(JSON.stringify(options)) >>> 0 };",
  "}",
  "```",
].join("\n");
const EMOJI = "🚀🎬🧠✨🔥📈🤖💡🎯🧩🍕☕️🇩🇪👩🏽‍💻👨‍👩‍👧‍👦";
const CJK = "漢字仮名交じり文と한국어 문장과 中文句子。";
const UMLAUTE = "Äußerst übliche Größenänderungen für Öl, Süßes und Straßenbahn-Fahrpläne.";

export function calibrationRequest() {
  const block = Array.from({ length: 20 }, (_, i) => `${i + 1}. ${UMLAUTE} ${EMOJI} ${CJK}`).join("\n");
  const knowledgeBase = [
    { id: "youtubeNode-kalibrier", type: "youtube", title: "Kalibrier-Video 🎬", url: "https://www.youtube.com/watch?v=DR60qPkDM2o", notes: "Emoji und Umlaute", transcript: `${block}\n\n${block}` },
    { id: "textNode-code", type: "text", title: "Code-Notiz", transcript: `${CODE}\n\n${CODE}\n\n${CODE}` },
    { id: "textNode-cjk", type: "text", title: "CJK", groupTitle: "Gruppe 1", transcript: CJK.repeat(40) },
  ];
  const messages = [];
  for (let i = 0; i < 30; i += 1) {
    messages.push({ role: "user", parts: [{ type: "text", text: `Frage ${i + 1}: Was ist an ${UMLAUTE} besonders? ${EMOJI.slice(0, 8)}` }] });
    messages.push({ role: "assistant", parts: [{ type: "text", text: `Antwort ${i + 1}: Die Umlaute, das ß und die Emoji ${EMOJI.slice(0, 6)} kosten mehr Bytes. ${CJK}` }] });
  }
  messages.push({ role: "user", parts: [{ type: "text", text: "Antworte nur mit: ok" }] });
  return { brandVoice: "Locker und lehrend, du-Form, Alltagsbeispiele.", knowledgeBase, messages };
}

export function miniRequest() {
  return { brandVoice: null, knowledgeBase: [], messages: [{ role: "user", parts: [{ type: "text", text: "Antworte nur mit: ok" }] }] };
}

async function measure(model, label, request) {
  const rendered = renderPrompt(request);
  const bytes = renderedBytes(rendered);
  const bound = estimateTokens(model.engine, bytes) - ANSWER_RESERVE_TOKENS;
  const answer = await runEngineOnce({
    engine: model.engine,
    prompt: rendered.prompt,
    system: rendered.system,
    modelId: model.engine === "codex" || model.id === CODEX_CONFIG_MODEL ? undefined : model.id,
    effort: "low",
    timeoutMs: 180_000,
    instanceId: "calibrate",
  });
  const input = answer.usage?.inputTokens ?? null;
  const ok = answer.ok && input !== null && input <= bound;
  const line = { engine: model.engine, model: model.id, run: label, bytes, bound, inputTokens: input, outputTokens: answer.usage?.outputTokens ?? null, ratio: input ? Number((input / bytes).toFixed(3)) : null, ok, durationMs: answer.durationMs, error: answer.error?.message ?? null };
  console.log(`${ok ? "ok  " : "FAIL"} ${model.engine}/${model.id} ${label}: ${bytes} Bytes, Schranke ${bound}, echt ${input ?? "?"}${answer.error ? ` · ${answer.error.message}` : ""}`);
  return line;
}

async function main() {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const models = BOARD_MODELS.filter((model) => only.length === 0 || only.includes(model.engine));
  const results = [];
  const versions = {};
  for (const model of models) {
    versions[model.engine] ??= engineVersion(model.engine, { binary: resolveBinary(model.engine) });
    if (!versions[model.engine]) {
      console.log(`--   ${ENGINES[model.engine].label} nicht installiert`);
      continue;
    }
    results.push(await measure(model, "mini", miniRequest()));
    results.push(await measure(model, "kalibrier", calibrationRequest()));
  }
  ensureBoardDir();
  fs.writeFileSync(boardFile("calibration.json"), `${JSON.stringify({ at: new Date().toISOString(), versions, results }, null, 2)}\n`, { mode: 0o600 });
  console.log(`\nErgebnis: ${boardFile("calibration.json")}`);
  process.exit(results.every((line) => line.ok) ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
