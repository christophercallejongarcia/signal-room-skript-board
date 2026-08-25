import http from "node:http";
import { Codex } from "@openai/codex-sdk";
import { codexAuthState } from "./auth.mjs";
import { buildStrategyPrompt, strategyOutputSchema, validateStrategyRequest } from "./request.mjs";

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.BRIDGE_PORT || "3211", 10);
const MAX_BODY_BYTES = 64 * 1024;
const allowedOrigins = new Set(
  (process.env.BRIDGE_ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function corsHeaders(origin) {
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

function sendJson(response, status, payload, origin) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...corsHeaders(origin),
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }

  if (chunks.length === 0) throw new Error("Request body is required.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createCodex() {
  return new Codex();
}

async function runStrategy(input) {
  const request = validateStrategyRequest(input);
  if (codexAuthState() === "logged-out") {
    throw Object.assign(new Error("Codex is not logged in. Run `codex login` in a terminal."), { status: 503 });
  }
  const codex = createCodex();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const thread = codex.startThread({
      model: process.env.CODEX_MODEL || undefined,
      modelReasoningEffort: process.env.CODEX_REASONING_EFFORT || "medium",
      workingDirectory: process.env.CODEX_WORKING_DIRECTORY || process.cwd(),
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      skipGitRepoCheck: false,
    });

    const turn = await thread.run(buildStrategyPrompt(request), {
      outputSchema: strategyOutputSchema,
      signal: controller.signal,
    });

    return JSON.parse(turn.finalResponse);
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);

  if (origin && !allowedOrigins.has(origin)) {
    return sendJson(response, 403, { error: "Origin is not allowed." }, origin);
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(origin));
    return response.end();
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(
      response,
      200,
      { ok: true, service: "signal-room-codex-bridge", codex: codexAuthState() },
      origin,
    );
  }

  if (request.method === "POST" && url.pathname === "/v1/strategy") {
    try {
      const input = await readJson(request);
      const result = await runStrategy(input);
      return sendJson(response, 200, result, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown bridge error.";
      const status = error?.status ?? (/required|must be|too large|Unexpected token|JSON/.test(message) ? 400 : 500);
      const exposed = status === 500 ? "The local Codex strategy run failed." : message;
      console.error("Strategy request failed:", message);
      return sendJson(response, status, { error: exposed, codex: codexAuthState() }, origin);
    }
  }

  return sendJson(response, 404, { error: "Not found." }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`Signal Room strategy bridge listening on http://${HOST}:${PORT}`);
});
