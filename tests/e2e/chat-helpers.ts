import { expect, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { connect, node, nodeIds, waitSaved } from "./helpers";

/** Helpers for the chat E2E tests (PLAN.md point 87). */

export async function createTextNode(page: Page, title: string, body?: string, at = { x: 700, y: 120 }) {
  await page.locator(".bd-canvas").click({ position: at });
  await page.keyboard.press("t");
  await expect(page.locator("input[data-title-for]:focus")).toBeVisible();
  await page.keyboard.type(title);
  const id = await page.locator("input[data-title-for]:focus").getAttribute("data-title-for");
  await page.keyboard.press("Enter");
  if (body) {
    await page.locator(`.react-flow__node[data-id="${id}"] .bn-editor`).click();
    await page.keyboard.type(body);
  }
  return id!;
}

export async function createChatNode(page: Page, at = { x: 1200, y: 260 }) {
  const before = new Set(await nodeIds(page, "chatNode"));
  await page.locator(".bd-canvas").click({ position: at });
  await page.keyboard.press("c");
  await expect(node(page, "chatNode")).toHaveCount(before.size + 1);
  const id = (await nodeIds(page, "chatNode")).find((entry) => !before.has(entry))!;
  await expect(page.locator(`[data-chat-node="${id}"] .bd-chat-editor`)).toBeVisible();
  return id;
}

/** Fit the view so every node and handle is on screen, then connect. */
export async function connectTo(page: Page, sourceId: string, chatId: string) {
  await page.getByRole("button", { name: "Alles zeigen" }).click().catch(() => {});
  // Handles closer than a short drag cannot be connected reliably: move the chat away first.
  const from = await page.locator(`.react-flow__node[data-id="${sourceId}"] .react-flow__handle-right`).boundingBox();
  const to = await page.locator(`.react-flow__node[data-id="${chatId}"] .react-flow__handle-left`).boundingBox();
  if (from && to && Math.abs(to.x - from.x) < 150) {
    const head = await page.locator(`[data-node-id="${chatId}"] .bd-node-head`).boundingBox();
    if (head) {
      await page.mouse.move(head.x + 40, head.y + head.height / 2);
      await page.mouse.down();
      await page.mouse.move(head.x + 140, head.y + head.height / 2, { steps: 8 });
      await page.mouse.move(head.x + 240, head.y + head.height / 2, { steps: 8 });
      await page.mouse.up();
      await waitSaved(page);
    }
    await page.getByRole("button", { name: "Alles zeigen" }).click().catch(() => {});
  }
  await connect(page, sourceId, chatId);
  await expect(page.locator(`.react-flow__edge[data-id="xy-edge__${sourceId}connector-${chatId}chat-connector"]`)).toHaveCount(1);
  await waitSaved(page);
}

/** Node IDs of a type from the session model (test hooks), including nodes React Flow does not render off screen. */
export async function modelNodeIds(page: Page, type: string): Promise<string[]> {
  return page.evaluate((nodeType) => {
    const session = (window as unknown as { __boardSession: { model: { nodes: Map<string, { type: string }> } } }).__boardSession;
    return [...session.model.nodes.values()].filter((entry) => entry.type === nodeType).map((entry) => (entry as unknown as { id: string }).id);
  }, type);
}

/** Create an edge through the session (same op as a drag), for tests where the drag itself is not the subject. */
export async function connectViaSession(page: Page, sourceId: string, chatId: string) {
  await page.evaluate(
    async ([source, target]) => {
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
      const opId = `op-${Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")}`;
      const session = (window as unknown as { __boardSession: { run(command: unknown, options?: unknown): Promise<boolean> } }).__boardSession;
      await session.run({ ops: [{ opId, type: "edge.create", source, target }], undo: null }, { recordUndo: false });
    },
    [sourceId, chatId] as const,
  );
  await waitSaved(page);
}

export function chat(page: Page, chatId: string) {
  const root = page.locator(`[data-chat-node="${chatId}"]`);
  return {
    root,
    editor: root.locator(".bd-chat-editor"),
    send: root.getByRole("button", { name: "Senden" }),
    stop: root.getByRole("button", { name: "Stopp" }),
    assistant: root.locator(".bd-chat-msg--assistant"),
    lastAssistant: root.locator(".bd-chat-msg--assistant").last(),
    conversations: root.locator(".bd-chat-conversation"),
    async type(text: string) {
      await root.locator(".bd-chat-editor").click();
      await page.keyboard.type(text);
    },
  };
}

/** The newest prompt the fake engine received (FAKE_ENGINE_STDIN_DIR of the harness). */
export function lastPrompt(): string {
  const dir = path.join(process.env.BOARD_E2E_ROOT!, "fake-stdin");
  const files = fs.readdirSync(dir).map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  return files[0] ? fs.readFileSync(path.join(dir, files[0].name), "utf8") : "";
}

export function promptCount(): number {
  return fs.readdirSync(path.join(process.env.BOARD_E2E_ROOT!, "fake-stdin")).length;
}

export function boardIdOf(url: string) {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
}

// ---------------------------------------------------------------------------
// Process level: extra Next instances, the local Convex backend, the bridge

export async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor<T>(check: () => Promise<T | null | undefined | false> | T | null | undefined | false, { timeoutMs = 30_000, stepMs = 250, label = "Bedingung" } = {}): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error(`${label} nicht erfüllt nach ${timeoutMs} ms`);
    await sleep(stepMs);
  }
}

/** A client for the board API of one Next instance, with its own session and CSRF cookies. */
export class NextClient {
  base: string;
  cookie = "";
  csrf = "";
  constructor(base: string) {
    this.base = base;
  }

  async init() {
    const response = await fetch(`${this.base}/board`, { redirect: "manual" });
    const cookies = response.headers.getSetCookie();
    const jar = Object.fromEntries(cookies.map((line) => line.split(";")[0].split("=")).map(([key, ...rest]) => [key, rest.join("=")]));
    this.cookie = `board_session=${jar.board_session}; board_csrf=${jar.board_csrf}`;
    this.csrf = decodeURIComponent(jar.board_csrf ?? "");
    return this;
  }

  headers(json = true) {
    return { cookie: this.cookie, origin: this.base, "x-board-csrf": this.csrf, ...(json ? { "content-type": "application/json" } : {}) };
  }

  async get<T>(pathname: string): Promise<T> {
    const response = await fetch(`${this.base}/api/board${pathname}`, { headers: { cookie: this.cookie } });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error ?? `HTTP ${response.status}`), { status: response.status, data });
    return data as T;
  }

  /** POST /api/board/chat. Resolves with the status and, for a stream, once the run has started. */
  async startChat(body: Record<string, unknown>): Promise<{ status: number; json?: Record<string, unknown>; stream?: Promise<string> }> {
    const controller = new AbortController();
    const response = await fetch(`${this.base}/api/board/chat`, { method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: controller.signal });
    if (!response.headers.get("content-type")?.includes("event-stream")) return { status: response.status, json: await response.json() };
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    const stream = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          text += value;
        }
      } catch {
        // killed instance or aborted
      }
      return text;
    })();
    return { status: response.status, stream };
  }
}

export type NextInstance = { base: string; port: number; proc: ChildProcess; client: NextClient; kill(signal?: NodeJS.Signals): Promise<void> };

/** A second `next start` on its own port, same build and env as the harness instance. */
export async function startNext(extraEnv: Record<string, string> = {}): Promise<NextInstance> {
  const port = await freePort();
  const root = process.cwd();
  const proc = spawn(path.join(root, "node_modules", ".bin", "next"), ["start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", BOARD_WEB_PORT: String(port), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  const log = fs.createWriteStream(path.join(process.env.BOARD_E2E_ROOT!, "logs", `next-${port}.log`));
  proc.stdout?.on("data", (chunk) => {
    output += chunk;
    log.write(chunk);
  });
  proc.stderr?.on("data", (chunk) => {
    output += chunk;
    log.write(chunk);
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(
    async () => {
      if (proc.exitCode !== null) throw new Error(`Next beendet: ${output.slice(-500)}`);
      try {
        return (await fetch(`${base}/board`)).status === 200;
      } catch {
        return false;
      }
    },
    { timeoutMs: 60_000, label: "Next-Start" },
  );
  const client = await new NextClient(base).init();
  return {
    base,
    port,
    proc,
    client,
    async kill(signal: NodeJS.Signals = "SIGKILL") {
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      const exited = new Promise((resolve) => proc.once("exit", resolve));
      try {
        process.kill(-proc.pid!, signal);
      } catch {
        proc.kill(signal);
      }
      await exited;
    },
  };
}

/** PID of the harness's local Convex backend. */
export function convexPid(): number {
  const port = new URL(process.env.BOARD_E2E_CONVEX_URL!).port;
  const out = execFileSync("/usr/bin/pgrep", ["-f", `convex-local-backend --port ${port} `], { encoding: "utf8" }).trim().split("\n")[0];
  return Number(out);
}

/** Convex unreachable (SIGSTOP) for `fn`, then back (SIGCONT), even if `fn` throws. */
export async function withConvexStopped<T>(fn: () => Promise<T>): Promise<T> {
  const pid = convexPid();
  process.kill(pid, "SIGSTOP");
  try {
    return await fn();
  } finally {
    process.kill(pid, "SIGCONT");
  }
}

export async function bridgeRunState(runId: string): Promise<string> {
  const response = await fetch(`${process.env.BOARD_BRIDGE_URL}/v1/board/runs/${runId}`, { headers: { "x-board-bridge-token": process.env.BOARD_BRIDGE_TOKEN! } });
  return ((await response.json()) as { state: string }).state;
}

export type RunInfo = { conversationId: string; message: { text: string; status: string; terminal: boolean; seq: number }; activeRun: unknown };

export function journalDir(): string {
  const deployment = (process.env.CONVEX_DEPLOYMENT ?? "").replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(process.env.SIGNAL_ROOM_BOARD_HOME!, "run-journal", deployment);
}

export function journalFiles(): string[] {
  try {
    return fs.readdirSync(journalDir()).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
}
