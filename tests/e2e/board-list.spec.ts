import { expect, test } from "@playwright/test";

test.beforeAll(() => {
  if (!process.env.BOARD_E2E_BASE_URL || !process.env.BOARD_E2E_MARKER) throw new Error("Nur über `npm run test:e2e:board` starten.");
});

test("board list: create with N, rename inline, reload keeps it, delete asks first", async ({ page }) => {
  await page.goto("/board");
  await expect(page.getByRole("heading", { name: "Skript-Boards" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Noch kein Board" })).toBeVisible();

  await page.getByRole("button", { name: /Neues Board/ }).click();
  const rename = page.getByRole("textbox", { name: "Board-Name" });
  await expect(rename).toBeFocused();
  const randomTitle = await rename.inputValue();
  expect(randomTitle).toMatch(/^\S+ \S+$/);
  await rename.fill("E2E Liste");
  await rename.press("Enter");
  await expect(page.getByRole("link", { name: "E2E Liste" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("link", { name: "E2E Liste" })).toBeVisible();

  await page.keyboard.press("n");
  const second = page.getByRole("textbox", { name: "Board-Name" });
  await expect(second).toBeFocused();
  await second.fill("Zweites Board");
  await second.press("Enter");
  await expect(page.getByRole("link", { name: "Zweites Board" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Boards suchen" }).fill("zweit");
  await expect(page.getByRole("link", { name: "E2E Liste" })).toBeHidden();
  await page.getByRole("searchbox", { name: "Boards suchen" }).fill("");

  await page.getByRole("button", { name: "Zweites Board löschen" }).click();
  await expect(page.getByRole("dialog")).toContainText("Zweites Board");
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(page.getByRole("link", { name: "Zweites Board" })).toBeHidden();
  await page.reload();
  await expect(page.getByRole("link", { name: "E2E Liste" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Zweites Board" })).toBeHidden();
  await page.screenshot({ path: ".scratch/skript-board/screens/board-list-hell.png" });

  await page.getByRole("button", { name: "Dunkles Theme" }).click();
  await expect(page.locator(".board-root")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator(".board-root")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: ".scratch/skript-board/screens/board-list-dunkel.png" });
});
