import { expect, test, type Page, type Request } from "@playwright/test";
import { boardIdOf, chat, connectTo, connectViaSession, createChatNode, createTextNode, lastPrompt, modelNodeIds, promptCount } from "./chat-helpers";
import { node, nodeIds, openNewBoard, paste, requireHarness, waitSaved } from "./helpers";

test.beforeAll(requireHarness);

/**
 * Chat node in fake mode (PLAN.md points 80 to 87), against the Poppy
 * scenarios s02, s05, s05b, s08 and s09. The bridge runs BOARD_ENGINE_FAKE=1.
 */
const SHOTS = ".scratch/skript-board/screens";

async function zoomOut(page: Page, steps = 2) {
  for (let i = 0; i < steps; i += 1) await page.getByRole("button", { name: "Verkleinern" }).click();
}

function foreignRequests(page: Page) {
  const seen: string[] = [];
  const own = new URL(process.env.BOARD_E2E_BASE_URL!).host;
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.host !== own && url.hostname !== "i.ytimg.com") seen.push(request.url());
  });
  return seen;
}

test("s02 + s05: group with video and text, @ lists group and children, mention goes out as tag, answer streams, conversation gets a title, reload keeps it", async ({ page }) => {
  await openNewBoard(page, `Chat ${Date.now() % 100000}`);
  const hook = await createTextNode(page, "Hook-Formel (Kallaway)", "Context Lean, Scroll Stop, Contrarian Snapback.");
  // Leave the text editor first: a paste there stays in the editor (point 64).
  await page.locator(".bd-canvas").click({ position: { x: 250, y: 780 } });
  await page.locator(".bd-canvas").hover({ position: { x: 300, y: 600 } });
  await paste(page, "https://www.youtube.com/watch?v=DR60qPkDM2o");
  await expect(node(page, "youtubeNode")).toHaveCount(1);
  await expect(page.locator('[data-node-type="youtubeNode"]').first()).toHaveAttribute("data-transcript-status", "ready", { timeout: 30_000 });
  const video = (await nodeIds(page, "youtubeNode"))[0];
  await page.locator(`[data-node-id="${hook}"] .bd-node-head`).click({ position: { x: 5, y: 20 } });
  await page.locator(`[data-node-id="${video}"] .bd-node-head`).click({ position: { x: 5, y: 15 }, modifiers: ["Shift"] });
  await page.keyboard.press("ControlOrMeta+g");
  await expect(node(page, "groupNode")).toHaveCount(1);
  const group = (await nodeIds(page, "groupNode"))[0];
  await waitSaved(page);

  await zoomOut(page);
  const chatId = await createChatNode(page);
  await connectTo(page, group, chatId);
  const c = chat(page, chatId);
  await expect(c.root.getByTestId("chat-context")).toContainText("2 Quellen");

  // s05-at-picker: @ shows the group and its children, never unconnected nodes.
  await c.type("Nutze @");
  const list = c.root.getByRole("listbox", { name: "Quellen" });
  await expect(list.getByRole("option")).toHaveCount(3);
  await expect(list.getByRole("option").first()).toHaveText("Gruppe 1");
  await expect(list.getByRole("option").filter({ hasText: "Hook-Formel (Kallaway)" })).toHaveCount(1);
  await expect(list.getByRole("option").filter({ hasText: /Fake-Video DR60qPkDM2o/ })).toHaveCount(1);
  await page.keyboard.type("Hook");
  await expect(list.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(c.root.locator(".bd-mention")).toHaveText("@Hook-Formel (Kallaway)");
  await page.keyboard.type(" und das Video. Schreib 3 Hooks für Opus 5.5.");
  const before = promptCount();
  await page.keyboard.press("Enter");

  await expect(c.lastAssistant).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await expect(c.lastAssistant).toContainText("Fake-Antwort von claude (sonnet)");
  await expect(c.lastAssistant).toContainText("Quellen im Kontext: 2");
  await expect(c.lastAssistant.locator(".bd-chat-meta")).toContainText("Claude Sonnet · gerade eben");
  await expect(c.root.locator(".bd-chat-msg--user").last()).toContainText("@Hook-Formel (Kallaway) und das Video");
  await expect(c.conversations).toHaveCount(1);
  await expect(c.conversations.first()).toContainText("Nutze Hook-Formel (Kallaway) und das");

  // What reached the engine: the mention as tag, both sources with group title, the transcript in full.
  expect(promptCount()).toBe(before + 1);
  const prompt = lastPrompt();
  expect(prompt).toContain(`<poppy_reference_node nodeId="${hook}" title="Hook-Formel (Kallaway)" type="textNode" />`);
  expect(prompt).toContain("Gruppe: Gruppe 1");
  expect(prompt).toContain("Context Lean, Scroll Stop, Contrarian Snapback.");
  expect(prompt).toMatch(/typ="youtube">\nTitel: .*\n(?:Gruppe: Gruppe 1\n)?URL: https:\/\/www\.youtube\.com\/watch\?v=DR60qPkDM2o/);
  await page.getByRole("button", { name: "Alles zeigen" }).click();
  await page.screenshot({ path: `${SHOTS}/s05-antwort-hell.png` });

  await page.reload();
  const again = chat(page, chatId);
  await expect(again.lastAssistant).toContainText("Fake-Antwort von claude (sonnet)");
  await expect(again.conversations.first()).toContainText("Nutze Hook-Formel");
});

test("s05b: an answer with a Markdown image on a foreign host never loads it, not while streaming, not after reload, not as text node", async ({ page }) => {
  const foreign = foreignRequests(page);
  await openNewBoard(page, `Bild ${Date.now() % 100000}`);
  const text = await createTextNode(page, "Notiz", "Eine Notiz.");
  await zoomOut(page);
  const chatId = await createChatNode(page);
  await connectTo(page, text, chatId);
  const c = chat(page, chatId);
  await c.type("[[fake:image]] Zeig mir ein Bild");
  await page.keyboard.press("Enter");
  await expect(c.lastAssistant).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await expect(c.lastAssistant.getByRole("link", { name: "Bild" })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(c.lastAssistant.locator("img")).toHaveCount(0);
  await page.reload();
  await expect(chat(page, chatId).lastAssistant.locator("img")).toHaveCount(0);

  await chat(page, chatId).lastAssistant.getByRole("button", { name: "Als Text-Node" }).click();
  await expect.poll(async () => (await modelNodeIds(page, "textNode")).length).toBe(2);
  await waitSaved(page);
  const answerNode = (await modelNodeIds(page, "textNode")).find((id) => id !== text)!;
  await page.getByRole("button", { name: "Alles zeigen" }).click();
  // 500 × 300, 60 px right of the chat node, no edge.
  // Flow units from React Flow's node elements: 500 × 300, at least 60 px right of the chat.
  const flow = (id: string) =>
    page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => {
      const style = (el as HTMLElement).style;
      const match = style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
      return { x: Number(match?.[1]), y: Number(match?.[2]), width: parseFloat(style.width), height: parseFloat(style.height) };
    });
  const chatBox = await flow(chatId);
  const textBox = await flow(answerNode);
  expect(textBox.width).toBe(500);
  expect(textBox.height).toBe(300);
  expect(textBox.x).toBeGreaterThanOrEqual(chatBox.x + chatBox.width + 60);
  await expect(page.locator(`.react-flow__edge[data-id*="${answerNode}"]`)).toHaveCount(0);
  await page.locator(`[data-node-id="${answerNode}"] .bd-node-head`).click({ position: { x: 5, y: 20 } });
  await expect(page.locator(`[data-node-id="${answerNode}"] .bn-editor`)).toContainText("Fake-Antwort");
  await page.reload();
  await expect.poll(async () => (await modelNodeIds(page, "textNode")).length).toBe(2);
  expect(foreign, `foreign requests: ${foreign.join(", ")}`).toEqual([]);
});

test("s08: a new conversation appears with its first message; switch, rename, delete with confirmation", async ({ page }) => {
  await openNewBoard(page, `Unterhaltungen ${Date.now() % 100000}`);
  const text = await createTextNode(page, "Quelle", "Kurzer Text.");
  await zoomOut(page);
  const chatId = await createChatNode(page);
  await connectTo(page, text, chatId);
  const c = chat(page, chatId);
  await c.type("Erste Unterhaltung über Kaffee am Morgen");
  await page.keyboard.press("Enter");
  await expect(c.lastAssistant).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await expect(c.conversations).toHaveCount(1);

  await c.root.getByRole("button", { name: "Neue Unterhaltung" }).click();
  await expect(c.conversations).toHaveCount(1, { timeout: 2_000 });
  await expect(c.assistant).toHaveCount(0);
  await c.type("Zweite Unterhaltung über Tee");
  await page.keyboard.press("Enter");
  await expect(c.lastAssistant).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await expect(c.conversations).toHaveCount(2);
  await expect(c.conversations.first()).toContainText("Zweite Unterhaltung über Tee");
  await page.screenshot({ path: `${SHOTS}/s08-neue-unterhaltung-hell.png` });

  await c.conversations.nth(1).locator(".bd-chat-conversation-title").click();
  await expect(c.lastAssistant).toContainText("Erste Unterhaltung über Kaffee");
  await c.conversations.nth(1).getByRole("button", { name: /Optionen für/ }).click();
  await c.root.getByRole("menuitem", { name: "Umbenennen" }).click();
  const rename = c.root.getByRole("textbox", { name: "Unterhaltung umbenennen" });
  await rename.fill("Kaffee-Hooks");
  await rename.press("Enter");
  await expect(c.conversations.filter({ hasText: "Kaffee-Hooks" })).toHaveCount(1);

  await c.conversations.filter({ hasText: "Kaffee-Hooks" }).getByRole("button", { name: /Optionen für/ }).click();
  await c.root.getByRole("menuitem", { name: "Löschen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Löschen" }).click();
  await expect(c.conversations).toHaveCount(1);
  await page.reload();
  await expect(chat(page, chatId).conversations).toHaveCount(1);
  await expect(chat(page, chatId).conversations.first()).toContainText("Zweite Unterhaltung");
});

test("s09: model switch to Codex shows 'denkt …' until the whole answer; effort and model stay on the node", async ({ page }) => {
  await openNewBoard(page, `Modell ${Date.now() % 100000}`);
  const text = await createTextNode(page, "Quelle", "Text.");
  await zoomOut(page);
  const chatId = await createChatNode(page);
  await connectTo(page, text, chatId);
  const c = chat(page, chatId);
  await c.root.getByTestId("model-menu").click();
  const menu = c.root.getByRole("menu");
  await expect(menu.getByRole("menuitemradio")).toHaveCount(8);
  await menu.getByRole("button", { name: "Hoch" }).click();
  await menu.getByRole("menuitemradio", { name: /Codex/ }).click();
  await expect(c.root.getByTestId("model-menu")).toContainText("Codex");
  await expect(c.root.getByTestId("model-menu")).toContainText("Hoch");
  await waitSaved(page);
  await page.screenshot({ path: `${SHOTS}/s09-modell-hell.png` });

  await c.type("[[fake:silence=2500]] Hallo Codex");
  await page.keyboard.press("Enter");
  await expect(c.root.locator(".bd-chat-thinking")).toContainText("Codex denkt");
  await expect(c.lastAssistant).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await expect(c.lastAssistant).toContainText("Fake-Antwort von codex");
  expect(lastPrompt().startsWith("Du bist die Schreibhilfe")).toBe(true);

  await page.reload();
  await expect(chat(page, chatId).root.getByTestId("model-menu")).toContainText("Codex");
  await expect(chat(page, chatId).root.getByTestId("model-menu")).toContainText("Hoch");
  await expect(chat(page, chatId).lastAssistant.locator(".bd-chat-meta")).toContainText("Codex");
});

test("stop: a long answer is stopped, the saved part stays, status aborted; 'Erneut senden' starts a new run", async ({ page }) => {
  await openNewBoard(page, `Stopp ${Date.now() % 100000}`);
  const text = await createTextNode(page, "Quelle", "Text.");
  await zoomOut(page);
  const chatId = await createChatNode(page);
  await connectTo(page, text, chatId);
  const c = chat(page, chatId);
  await c.type("[[fake:stream=60000]] Erzähl lange");
  await page.keyboard.press("Enter");
  await expect(c.root.locator(".bd-chat-msg--live.bd-chat-msg--assistant")).toContainText("...", { timeout: 20_000 });
  await page.waitForTimeout(2_500);
  await c.stop.click();
  await expect(c.lastAssistant).toHaveAttribute("data-status", "aborted", { timeout: 20_000 });
  await expect(c.lastAssistant).toContainText("...");
  await expect(c.lastAssistant).toContainText("Abgebrochen.");
  await c.lastAssistant.getByRole("button", { name: "Erneut senden" }).click();
  await expect(c.assistant).toHaveCount(2);
  await c.stop.click();
  await expect(c.lastAssistant).toHaveAttribute("data-status", "aborted", { timeout: 20_000 });
});

test("sources not ready: the header warns, sending is refused until released 'nur mit Titel'", async ({ page }) => {
  await openNewBoard(page, `Sperre ${Date.now() % 100000}`);
  await page.locator(".bd-canvas").hover({ position: { x: 300, y: 300 } });
  await paste(page, "https://youtu.be/NOCAPS12345");
  await expect(page.locator('[data-node-type="youtubeNode"][data-transcript-status="no-captions"]')).toHaveCount(1, { timeout: 30_000 });
  const video = (await nodeIds(page, "youtubeNode"))[0];
  await zoomOut(page);
  const chatId = await createChatNode(page);
  await connectTo(page, video, chatId);
  const c = chat(page, chatId);
  await expect(page.locator(`[data-node-id="${chatId}"]`).getByTestId("chat-head-warning")).toContainText("1 Quelle nicht bereit");
  await expect(c.root.getByTestId("chat-sources-warning")).toContainText("keine Untertitel");
  const before = promptCount();
  await c.type("Worum geht es?");
  await page.keyboard.press("Enter");
  const banner = c.root.locator(".bd-chat-send-error");
  await expect(banner).toHaveAttribute("data-kind", "sources-not-ready");
  expect(promptCount()).toBe(before);
  await banner.getByRole("button", { name: "Nur mit Titel senden" }).click();
  await expect(c.lastAssistant).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  expect(lastPrompt()).toContain("Transkript: (nicht verfügbar, nur der Titel ist freigegeben)");
});

test("budget: a source over the model's budget blocks sending with both offers; cutting the source lifts it", async ({ page }) => {
  await openNewBoard(page, `Budget ${Date.now() % 100000}`);
  await page.locator(".bd-canvas").hover({ position: { x: 300, y: 300 } });
  // 140,000 bytes of text: fine for Claude (200,000), over Command Code's 128,000.
  await paste(page, "ü".repeat(70_000));
  await expect(node(page, "textNode")).toHaveCount(1);
  const big = (await nodeIds(page, "textNode"))[0];
  await waitSaved(page);
  await zoomOut(page);
  const chatId = await createChatNode(page);
  await connectViaSession(page, big, chatId);
  const c = chat(page, chatId);
  await expect(c.root.getByTestId("chat-context")).toContainText("1 Quelle");
  await expect(c.root.getByTestId("chat-context")).not.toHaveClass(/is-over/);
  await c.root.getByTestId("model-menu").click();
  await c.root.getByRole("menu").getByRole("menuitemradio", { name: "GLM 5.3" }).click();
  await expect(c.root.getByTestId("chat-context")).toHaveClass(/is-over/, { timeout: 10_000 });
  const banner = c.root.locator(".bd-chat-send-error[data-kind='budget']");
  await expect(banner).toContainText("Kontext zu groß");
  await expect(banner.getByRole("button", { name: /Verlauf kürzen/ })).toBeVisible();
  await c.type("Fasse zusammen");
  await expect(c.send).toBeDisabled();
  await banner.getByRole("button", { name: "Trennen" }).click();
  await expect(c.root.getByTestId("chat-context")).toContainText("0 Quellen");
  await expect(c.root.getByTestId("chat-context")).not.toHaveClass(/is-over/, { timeout: 10_000 });
  await expect(c.send).toBeEnabled();
});

test("consistency: sending right after typing uses the new text; a stale revision is retried once; a failed local save blocks sending", async ({ page }) => {
  const url = await openNewBoard(page, `Konsistenz ${Date.now() % 100000}`);
  const text = await createTextNode(page, "Notiz", "Alter Stand.");
  await zoomOut(page);
  const chatId = await createChatNode(page);
  await connectTo(page, text, chatId);
  const c = chat(page, chatId);

  // Type into the source and send at once: the send waits for the save and carries the new revision.
  await page.locator(`[data-node-id="${text}"] .bd-node-head`).click({ position: { x: 5, y: 20 } });
  await page.locator(`.react-flow__node[data-id="${text}"] .bn-editor`).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" NEUER STAND 4711");
  await c.editor.click();
  await page.keyboard.type("Was steht in der Notiz?");
  await page.keyboard.press("Enter");
  await expect(c.lastAssistant).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  expect(lastPrompt()).toContain("NEUER STAND 4711");

  // A revision that changed in between: the route answers 409, the client flushes and sends once more.
  let posts = 0;
  await page.route("**/api/board/chat", async (route) => {
    posts += 1;
    if (posts === 1) {
      const body = JSON.parse(route.request().postData() ?? "{}");
      await route.continue({ postData: JSON.stringify({ ...body, boardRevision: Math.max(0, body.boardRevision - 1) }) });
    } else await route.continue();
  });
  await c.type("Noch einmal");
  await page.keyboard.press("Enter");
  await expect(c.assistant).toHaveCount(2, { timeout: 30_000 });
  await expect(c.lastAssistant).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  expect(posts).toBe(2);
  await page.unroute("**/api/board/chat");

  // Local journal fails: the board turns read-only, sending is locked.
  await page.evaluate(() => {
    (window as unknown as { __boardTestHooks: { failJournalWrites: boolean } }).__boardTestHooks = { failJournalWrites: true };
  });
  await page.locator(`[data-node-id="${text}"] .bd-node-head`).click({ position: { x: 5, y: 20 } });
  await page.locator(`.react-flow__node[data-id="${text}"] .bn-editor`).click();
  await page.keyboard.type("x");
  await expect(page.getByTestId("save-state")).toHaveText("Lokale Sicherung fehlgeschlagen");
  await expect(c.send).toBeDisabled();
  expect(boardIdOf(url)).toBeTruthy();
});
