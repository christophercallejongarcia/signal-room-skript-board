import { expect, type Page } from "@playwright/test";

export function requireHarness() {
  if (!process.env.BOARD_E2E_BASE_URL || !process.env.BOARD_E2E_MARKER) throw new Error("Nur über `npm run test:e2e:board` starten.");
}

export const hooksEnabled = () => process.env.NEXT_PUBLIC_BOARD_TEST_HOOKS === "1";

/** Create a board through the list page and open it. Returns the board URL. */
export async function openNewBoard(page: Page, name: string): Promise<string> {
  await page.goto("/board");
  await page.getByRole("button", { name: /Neues Board/ }).first().click();
  const input = page.getByRole("textbox", { name: "Board-Name" });
  await input.fill(name);
  await input.press("Enter");
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.locator(".bd-editor")).toBeVisible();
  await expect(page.getByTestId("save-state")).toHaveText("Gespeichert");
  return page.url();
}

export function node(page: Page, type: string) {
  return page.locator(`.react-flow__node [data-node-type="${type}"]`);
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId("save-state")).toHaveText("Gespeichert", { timeout: 20_000 });
}

/** A synthetic clipboard paste on the canvas or on a given element. */
export async function paste(page: Page, text: string, selector?: string) {
  await page.evaluate(
    ([value, target]) => {
      const data = new DataTransfer();
      data.setData("text/plain", value);
      const element = target ? document.querySelector(target) : window;
      element?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    [text, selector ?? null] as const,
  );
}

/** Drag from the source handle of one node to the chat handle of another. */
export async function connect(page: Page, sourceNodeId: string, targetNodeId: string) {
  const from = page.locator(`.react-flow__node[data-id="${sourceNodeId}"] .react-flow__handle-right`);
  const to = page.locator(`.react-flow__node[data-id="${targetNodeId}"] .react-flow__handle-left`);
  await page.waitForTimeout(300);
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("Handle nicht gefunden.");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 5, { steps: 5 });
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

export async function nodeIds(page: Page, type: string): Promise<string[]> {
  return page.locator(`.react-flow__node[data-id^="${type.replace("Node", "")}-"]`).evaluateAll((els) => els.map((el) => el.getAttribute("data-id") ?? ""));
}

export async function color(page: Page, selector: string, property: string) {
  return page.locator(selector).first().evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}
