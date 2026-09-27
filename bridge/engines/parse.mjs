/**
 * Map one stdout JSON line of an engine to board events (PLAN.md points 74, 75):
 *   { type: "text-delta", text }
 *   { type: "reasoning-delta", text }
 *   { type: "finish", usage: { inputTokens, outputTokens } }
 *   { type: "error", code, message }      message is German and actionable
 *   { type: "notice", code, detail }      diagnostics only, never shown as answer
 * A parser is a small state machine per run, because Claude repeats its text in
 * the final `assistant` line and Command Code reports tool denials separately.
 */

export const ERROR_MESSAGES = {
  "not-logged-in": {
    claude: "Claude Code ist nicht eingeloggt. Im Terminal `claude` starten und `/login`.",
    codex: "Codex ist nicht eingeloggt. Im Terminal `codex login` ausführen.",
    "command-code": "Command Code ist nicht eingeloggt. Im Terminal `command-code login` ausführen.",
  },
  "rate-limit": "Das Abo-Limit dieser Engine ist erreicht. Bitte eine andere Engine wählen.",
  "no-credits": "Command Code hat keine Credits mehr. Bitte eine andere Engine wählen.",
  "engine-error": "Die Engine hat mit einem Fehler geantwortet.",
  "format-changed": "Das Ausgabeformat der Engine hat sich geändert. Bitte `npm run board:gate` ausführen.",
};

export function errorMessage(code, engine) {
  const entry = ERROR_MESSAGES[code];
  if (!entry) return ERROR_MESSAGES["engine-error"];
  return typeof entry === "string" ? entry : entry[engine];
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function classify(engine, text) {
  const value = String(text || "");
  if (/not logged in|please run \/login|unauthori[sz]ed|\b401\b|login required|authentication/i.test(value)) return "not-logged-in";
  if (/rate.?limit|usage limit|\b429\b|quota|too many requests/i.test(value)) return "rate-limit";
  if (engine === "command-code" && /credit/i.test(value)) return "no-credits";
  return "engine-error";
}

function engineError(engine, code, detail) {
  return { type: "error", code, message: errorMessage(code, engine), detail: detail ? String(detail).slice(0, 500) : undefined };
}

function claudeParser() {
  return (line) => {
    const events = [];
    if (line.type === "stream_event") {
      const delta = line.event?.type === "content_block_delta" ? line.event.delta : null;
      if (delta?.type === "text_delta" && delta.text) events.push({ type: "text-delta", text: delta.text });
      else if (delta?.type === "thinking_delta" && delta.thinking) events.push({ type: "reasoning-delta", text: delta.thinking });
    } else if (line.type === "rate_limit_event") {
      const status = line.rate_limit_info?.status;
      if (status && status !== "allowed" && status !== "allowed_warning") events.push(engineError("claude", "rate-limit", status));
    } else if (line.type === "result") {
      if (line.is_error) events.push(engineError("claude", classify("claude", line.result ?? line.error), line.result));
      else {
        const usage = line.usage ?? {};
        events.push({
          type: "finish",
          usage: {
            inputTokens: num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens),
            outputTokens: num(usage.output_tokens),
          },
        });
      }
    }
    return events;
  };
}

function codexParser() {
  return (line) => {
    const events = [];
    if (line.type === "item.completed") {
      const item = line.item ?? {};
      if (item.type === "agent_message" && typeof item.text === "string") events.push({ type: "text-delta", text: item.text });
      else if (item.type === "reasoning" && typeof item.text === "string") events.push({ type: "reasoning-delta", text: item.text });
      else if (item.type === "error") events.push({ type: "notice", code: "codex-item-error", detail: String(item.message ?? "").slice(0, 300) });
      else if (item.type && item.type !== "agent_message") events.push({ type: "notice", code: "codex-item", detail: item.type });
    } else if (line.type === "turn.completed") {
      events.push({ type: "finish", usage: { inputTokens: num(line.usage?.input_tokens), outputTokens: num(line.usage?.output_tokens) } });
    } else if (line.type === "turn.failed") {
      const message = line.error?.message ?? JSON.stringify(line.error ?? {});
      events.push(engineError("codex", classify("codex", message), message));
    } else if (line.type === "error") {
      // "Reconnecting… n/5" and similar are transient; the turn result decides.
      events.push({ type: "notice", code: "codex-transient", detail: String(line.message ?? "").slice(0, 300) });
    }
    return events;
  };
}

const COMMAND_CODE_KNOWN = new Set([
  "run_start",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "model_request_start",
  "model_request_end",
  "model_trace",
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "text_delta",
  "text_start",
  "text_end",
  "tool_denied",
  "tool_call_start",
  "tool_call_end",
  "tool_result",
  "run_end",
]);

function commandCodeParser() {
  let reportedFormat = false;
  return (line) => {
    const events = [];
    if (line.type === "event") {
      const event = line.event ?? {};
      if (event.type === "text_delta" && typeof event.delta === "string") events.push({ type: "text-delta", text: event.delta });
      else if (event.type === "thinking_delta" && typeof event.delta === "string") events.push({ type: "reasoning-delta", text: event.delta });
      else if (event.type === "tool_denied") events.push({ type: "notice", code: "tool-denied", detail: String(event.toolName ?? event.name ?? "") });
      else if (!COMMAND_CODE_KNOWN.has(event.type) && !reportedFormat) {
        reportedFormat = true;
        events.push({ type: "notice", code: "format-changed", detail: String(event.type) });
      }
    } else if (line.type === "result") {
      if (line.subtype === "success") {
        events.push({ type: "finish", usage: { inputTokens: num(line.usage?.inputTokens) + num(line.usage?.cacheReadTokens), outputTokens: num(line.usage?.outputTokens) } });
      } else {
        const message = line.error?.message ?? line.message ?? line.subtype;
        events.push(engineError("command-code", classify("command-code", message), message));
      }
    } else if (line.type === "error") {
      events.push(engineError("command-code", classify("command-code", line.message), line.message));
    }
    return events;
  };
}

export function createLineParser(engine) {
  const parse = engine === "claude" ? claudeParser() : engine === "codex" ? codexParser() : commandCodeParser();
  return (rawLine) => {
    const text = rawLine.trim();
    if (!text) return [];
    let line;
    try {
      line = JSON.parse(text);
    } catch {
      return [{ type: "notice", code: "non-json", detail: text.slice(0, 200) }];
    }
    if (!line || typeof line !== "object") return [];
    return parse(line);
  };
}

/** Exit codes of Command Code documented in research 03. */
export function commandCodeExitError(code) {
  if (code === 3) return engineError("command-code", "not-logged-in");
  if (code === 5) return engineError("command-code", "rate-limit");
  if (code === 10) return engineError("command-code", "no-credits");
  return null;
}
