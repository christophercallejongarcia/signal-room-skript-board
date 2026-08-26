import http from "node:http";
import { Codex } from "@openai/codex-sdk";
import { codexAuthState } from "./auth.mjs";
import {
  buildHooksPrompt,
  buildStoryboardPrompt,
  buildStrategyPrompt,
  hooksOutputSchema,
  storyboardOutputSchema,
  strategyOutputSchema,
  validateHooksRequest,
  validateStoryboardRequest,
  validateStrategyRequest,
} from "./request.mjs";

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.BRIDGE_PORT || "3211", 10);
/** Room for a 20 000 character transcript in UTF-8 plus its evidence packet. */
const MAX_BODY_BYTES = 128 * 1024;
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

/** One Codex turn under the read-only sandbox. The routes differ only in prompt and schema. */
async function runCodex(prompt, outputSchema) {
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

    const turn = await thread.run(prompt, { outputSchema, signal: controller.signal });
    return JSON.parse(turn.finalResponse);
  } finally {
    clearTimeout(timeout);
  }
}

/** Every POST route: validate, run, and report the same way. A Map so no path resolves through Object.prototype. */
const routes = new Map([
  [
    "/v1/strategy",
    {
      label: "Strategy",
      failure: "The local Codex strategy run failed.",
      run: (input) => runCodex(buildStrategyPrompt(validateStrategyRequest(input)), strategyOutputSchema),
    },
  ],
  [
    "/v1/storyboard",
    {
      label: "Storyboard",
      failure: "The local Codex storyboard run failed.",
      run: (input) => runCodex(buildStoryboardPrompt(validateStoryboardRequest(input)), storyboardOutputSchema),
    },
  ],
  [
    "/v1/hooks",
    {
      label: "Hooks",
      failure: "The local Codex hooks run failed.",
      run: (input) => {
        // The answer schema is built from the validated count, so a run comes back with exactly that many.
        const request = validateHooksRequest(input);
        return runCodex(buildHooksPrompt(request), hooksOutputSchema(request.count));
      },
    },
  ],
]);

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

  const route = request.method === "POST" ? routes.get(url.pathname) : undefined;
  if (route) {
    try {
      const input = await readJson(request);
      return sendJson(response, 200, await route.run(input), origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown bridge error.";
      const status = error?.status ?? (/required|must be|too large|Unexpected token|JSON/.test(message) ? 400 : 500);
      const exposed = status === 500 ? route.failure : message;
      console.error(`${route.label} request failed:`, message);
      return sendJson(response, status, { error: exposed, codex: codexAuthState() }, origin);
    }
  }

  return sendJson(response, 404, { error: "Not found." }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`Signal Room strategy bridge listening on http://${HOST}:${PORT}`);
});
