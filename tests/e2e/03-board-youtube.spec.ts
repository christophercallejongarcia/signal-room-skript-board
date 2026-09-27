import { expect, test } from "@playwright/test";
import { node, openNewBoard, paste, requireHarness, waitSaved } from "./helpers";

test.beforeAll(requireHarness);

/** s01 in fake mode (PLAN.md point 73): the bridge runs with BOARD_YTDLP_FAKE=1, APIFY_TOKEN is removed. */
test("youtube: Cmd+V creates the node, the transcript arrives, title and numbers show; no captions and failures offer the right actions", async ({ page }) => {
  await openNewBoard(page, `YouTube ${Date.now() % 100000}`);
  await page.locator(".bd-canvas").hover({ position: { x: 500, y: 300 } });
  await paste(page, "https://www.youtube.com/watch?v=DR60qPkDM2o&list=PLbpi6ZahtOH6Ar_3GPy3workNOvnYTE2Z&index=2");
  await expect(node(page, "youtubeNode")).toHaveCount(1);
  const card = page.locator('[data-node-type="youtubeNode"]').first();
  await expect(card).toHaveAttribute("data-transcript-status", "ready", { timeout: 30_000 });
  await expect(card.getByTestId("transcript-status")).toContainText("Transkript ✓");
  await expect(card.locator(".bd-node-title")).toContainText("Fake-Video DR60qPkDM2o");
  await expect(card).toContainText("Aufrufe");
  await expect(card).toContainText("× Kanal");
  // Flow units, independent of the current zoom.
  expect(await page.locator('.react-flow__node[data-id^="youtube-"]').first().evaluate((el) => (el as HTMLElement).style.width)).toBe("290px");
  expect(await card.locator(".bd-node-head").evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/rgb\((254, 228, 227|241, 65, 65)\)/);
  await waitSaved(page);

  await card.locator(".bd-node-head").click({ position: { x: 10, y: 15 } });
  await expect(page.getByRole("button", { name: /Transkript kopieren/ })).toBeEnabled();
  await page.getByRole("textbox", { name: "Notizen für die KI" }).fill("Hook ab Minute 2 anschauen");
  await waitSaved(page);
  await page.screenshot({ path: ".scratch/skript-board/screens/s01-youtube-hell.png" });

  await page.reload();
  await expect(page.locator('[data-node-type="youtubeNode"]').first()).toHaveAttribute("data-transcript-status", "ready");
  await page.locator('[data-node-type="youtubeNode"] .bd-node-head').first().click({ position: { x: 10, y: 15 } });
  await expect(page.getByRole("textbox", { name: "Notizen für die KI" })).toHaveValue("Hook ab Minute 2 anschauen");

  // No captions: status says so, and without APIFY_TOKEN there is no paid button.
  await page.locator(".bd-canvas").click({ position: { x: 1150, y: 700 } });
  await page.locator(".bd-canvas").hover({ position: { x: 1000, y: 650 } });
  await paste(page, "https://youtu.be/NOCAPS12345");
  const noCaps = page.locator('[data-node-type="youtubeNode"][data-transcript-status="no-captions"]');
  await expect(noCaps).toHaveCount(1, { timeout: 30_000 });
  await expect(noCaps.getByTestId("transcript-status")).toHaveText("Keine Untertitel");
  await noCaps.locator(".bd-node-head").click({ position: { x: 10, y: 15 } });
  await expect(page.getByRole("button", { name: /Apify/ })).toHaveCount(0);

  // yt-dlp fails: "Erneut versuchen" appears.
  await page.locator(".bd-canvas").click({ position: { x: 1150, y: 120 } });
  await page.locator(".bd-canvas").hover({ position: { x: 300, y: 650 } });
  await paste(page, "https://www.youtube.com/shorts/FAILxxxxxxx");
  const failed = page.locator('[data-node-type="youtubeNode"][data-transcript-status="fetch-failed"]');
  await expect(failed).toHaveCount(1, { timeout: 30_000 });
  await expect(failed.getByTestId("transcript-status")).toContainText("Video unavailable");
  await failed.locator(".bd-node-head").click({ position: { x: 10, y: 15 } });
  await expect(page.getByRole("button", { name: "Erneut versuchen" })).toBeVisible();

  // Any other URL gets the MVP hint.
  await paste(page, "https://example.com/artikel");
  await expect(page.getByText("Im MVP nur YouTube-Links.")).toBeVisible();
});
