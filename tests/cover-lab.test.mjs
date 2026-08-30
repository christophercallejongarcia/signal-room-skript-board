import test from "node:test";
import assert from "node:assert/strict";
import {
  COVER_FORMATS,
  COVER_PACKAGE_COUNT,
  coverBoard,
  coverBoardFor,
  parseCoverRequest,
  parseCoverResponse,
  replaceCoverPackage,
  upsertCoverBoard,
} from "../lib/cover-lab.ts";
import { newIdea } from "../lib/ideas.ts";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readGeneratedCover, writeGeneratedCover } from "../lib/adapters/storage/cover-lab-cache.ts";

const NOW = "2026-08-30T09:00:00.000Z";
const IMAGE = { mimeType: "image/png", data: "iVBORw0KGgo=" };

function packageValue(number) {
  return {
    label: `Package ${number}`,
    textOverlay: number === 1 ? "Ein klarer Beweis" : `Fokus ${number}`,
    imageIdea: `Ein einzelnes Beweisobjekt ${number}`,
    colorWorld: "Schwarz, Koralle und hoher Kontrast",
    imagePrompt: `Editorial cover image ${number}`,
    image: IMAGE,
  };
}

function idea() {
  return newIdea({ title: "Warum dieser Hook trägt" }, { id: "idea-1", now: NOW });
}

test("the request keeps format and treatment in one bounded shape", () => {
  assert.deepEqual(parseCoverRequest({ ideaId: " idea-1 ", format: "reel", treatment: "face" }), {
    ideaId: "idea-1",
    format: "reel",
    treatment: "face",
  });
  assert.deepEqual(parseCoverRequest({ ideaId: "idea-1", format: "youtube", treatment: "faceless", packageId: "package-2" }), {
    ideaId: "idea-1",
    format: "youtube",
    treatment: "faceless",
    packageId: "package-2",
  });
  assert.throws(() => parseCoverRequest({ ideaId: "idea-1", format: "post", treatment: "face" }), /format must be reel or youtube/);
  assert.throws(() => parseCoverRequest({ ideaId: "idea-1", format: "reel", treatment: "portrait" }), /treatment must be faceless or face/);
});

test("the format table defines distinct overlay safe zones", () => {
  assert.equal(COVER_FORMATS.reel.aspectRatio, "4:5");
  assert.match(COVER_FORMATS.reel.safeZone, /upper third/i);
  assert.equal(COVER_FORMATS.youtube.aspectRatio, "16:9");
  assert.match(COVER_FORMATS.youtube.safeZone, /side column/i);
  assert.match(COVER_FORMATS.youtube.safeZone, /lower-right/i);
});

test("the Bridge answer needs exactly three complete packages with one short overlay", () => {
  const response = parseCoverResponse(
    { format: "reel", packages: [packageValue(1), packageValue(2), packageValue(3)] },
    { format: "reel" },
  );
  assert.equal(response.length, COVER_PACKAGE_COUNT);
  assert.deepEqual(response.map((item) => item.id), ["package-1", "package-2", "package-3"]);
  assert.throws(
    () => parseCoverResponse({ format: "reel", packages: [packageValue(1), packageValue(2)] }, { format: "reel" }),
    /exactly three packages/,
  );
  assert.throws(
    () => parseCoverResponse({ format: "reel", packages: [{ ...packageValue(1), textOverlay: "This has five overlay words" }, packageValue(2), packageValue(3)] }, { format: "reel" }),
    /at most four overlay words/,
  );
});

test("a single replacement response keeps its requested package id", () => {
  const response = parseCoverResponse(
    { format: "youtube", packages: [packageValue(1)] },
    { format: "youtube", packageId: "package-2" },
  );
  assert.equal(response[0].id, "package-2");
});

test("a second format board stays on the Idea beside the first one", () => {
  const reel = coverBoard("reel", "faceless", [
    { id: "package-1", label: "Reel", textOverlay: "Ein Beweis", imageIdea: "Objekt", colorWorld: "Koralle", imagePrompt: "Prompt" },
    { id: "package-2", label: "Reel", textOverlay: "Zwei Schritte", imageIdea: "Objekt", colorWorld: "Koralle", imagePrompt: "Prompt" },
    { id: "package-3", label: "Reel", textOverlay: "Ein Fokus", imageIdea: "Objekt", colorWorld: "Koralle", imagePrompt: "Prompt" },
  ], NOW);
  const youtube = { ...reel, format: "youtube", aspectRatio: "16:9" };
  const withReel = upsertCoverBoard(idea(), reel);
  const withBoth = upsertCoverBoard(withReel, youtube);
  assert.deepEqual(withBoth.coverBoards?.map((board) => board.format).sort(), ["reel", "youtube"]);
  assert.equal(coverBoardFor(withBoth, "reel")?.aspectRatio, "4:5");
  assert.equal(coverBoardFor(withBoth, "youtube")?.aspectRatio, "16:9");
  const newerYoutube = { ...youtube, generatedAt: "2026-08-30T09:10:00.000Z" };
  const replacedYoutube = upsertCoverBoard(withBoth, newerYoutube);
  assert.equal(replacedYoutube.coverBoards?.length, 2);
  assert.equal(coverBoardFor(replacedYoutube, "reel")?.generatedAt, NOW);
  assert.equal(coverBoardFor(replacedYoutube, "youtube")?.generatedAt, newerYoutube.generatedAt);
});

test("regenerating one package preserves the other packages and format board", () => {
  const packages = [1, 2, 3].map((number) => ({
    id: `package-${number}`,
    label: `Package ${number}`,
    textOverlay: `Fokus ${number}`,
    imageIdea: "Objekt",
    colorWorld: "Koralle",
    imagePrompt: "Prompt",
  }));
  const original = upsertCoverBoard(idea(), coverBoard("youtube", "face", packages, NOW));
  const replacement = { ...packages[1], textOverlay: "Neu gerendert", renderedAt: "2026-08-30T09:05:00.000Z" };
  const updated = replaceCoverPackage(original, "youtube", replacement, replacement.renderedAt);
  assert.equal(updated.coverBoards?.length, 1);
  assert.equal(updated.coverBoards?.[0].aspectRatio, "16:9");
  assert.equal(updated.coverBoards?.[0].packages[0].textOverlay, "Fokus 1");
  assert.equal(updated.coverBoards?.[0].packages[1].textOverlay, "Neu gerendert");
  assert.equal(updated.coverBoards?.[0].packages[2].textOverlay, "Fokus 3");
});

test("generated images are stored below the ignored cover cache with format-separated paths", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cover-lab-"));
  try {
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const reel = await writeGeneratedCover("idea-1", "reel", "package-1", png, { dir });
    const youtube = await writeGeneratedCover("idea-1", "youtube", "package-1", png, { dir });
    assert.match(reel.imagePath, /^ideas\/idea-1\/reel\/package-1\.png$/);
    assert.match(youtube.imagePath, /^ideas\/idea-1\/youtube\/package-1\.png$/);
    assert.deepEqual((await readdir(path.join(dir, "ideas", "idea-1"))).sort(), ["reel", "youtube"]);
    assert.deepEqual((await readGeneratedCover("idea-1", "reel", "package-1", { dir }))?.bytes, png);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
