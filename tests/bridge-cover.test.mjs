import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoverImagePrompt,
  buildCoverPrompt,
  coverOutputSchema,
  normalizeCoverPackages,
  validateCoverRequest,
} from "../bridge/request.mjs";

const idea = {
  title: "Warum dieser Hook trägt",
  goal: "Der Zuschauer erkennt einen prüfbaren Fehler.",
  storyboard: { hook: "Alle schauen auf die falsche Zahl.", caption: "Der Beweis liegt daneben.", takeaway: "Eine Zahl selbst prüfen." },
};

function request(format) {
  return validateCoverRequest({ format, treatment: "faceless", idea });
}

function responsePackage(number) {
  return {
    label: `Package ${number}`,
    textOverlay: number === 1 ? "Ein klarer Beweis" : `Fokus ${number}`,
    imageIdea: "Ein einzelnes Prüfobjekt",
    colorWorld: "Schwarz und Koralle",
    imagePrompt: "Eine klare Editorial-Komposition",
  };
}

test("cover requests carry the selected format and derive the run count", () => {
  assert.equal(request("reel").format, "reel");
  assert.equal(request("reel").count, 3);
  assert.equal(validateCoverRequest({ format: "youtube", treatment: "face", idea, package: { id: "package-2", label: "alt", textOverlay: "Fokus", imageIdea: "Objekt", colorWorld: "Koralle", imagePrompt: "Prompt" } }).count, 1);
  assert.throws(() => validateCoverRequest({ format: "square", treatment: "face", idea }), /format must be reel or youtube/);
});

test("the package schema requires the three reviewable package fields", () => {
  const schema = coverOutputSchema(3);
  assert.deepEqual(schema.required, ["packages"]);
  assert.equal(schema.properties.packages.minItems, 3);
  assert.equal(schema.properties.packages.maxItems, 3);
  assert.deepEqual(schema.properties.packages.items.required, ["label", "textOverlay", "imageIdea", "colorWorld", "imagePrompt"]);
  assert.equal(schema.additionalProperties, false);
});

test("format changes the planning prompt and its safe zone", () => {
  const reelPrompt = buildCoverPrompt(request("reel"));
  const youtubePrompt = buildCoverPrompt(request("youtube"));
  assert.match(reelPrompt, /4:5/);
  assert.match(reelPrompt, /upper third/i);
  assert.match(reelPrompt, /bottom 30%/i);
  assert.match(youtubePrompt, /16:9/);
  assert.match(youtubePrompt, /side column/i);
  assert.match(youtubePrompt, /lower-right/i);
  assert.notEqual(reelPrompt, youtubePrompt);
});

test("the image prompt carries the selected treatment and exact format", () => {
  const reelRequest = request("reel");
  const prompt = buildCoverImagePrompt(reelRequest, { id: "package-1", ...responsePackage(1) });
  assert.match(prompt, /built-in GPT Image capability/);
  assert.match(prompt, /exact 4:5 aspect ratio/);
  assert.match(prompt, /No people, faces or hands/);
});

test("the bridge normalizer makes returned package ids stable", () => {
  const normalized = normalizeCoverPackages({ packages: [responsePackage(1), responsePackage(2), responsePackage(3)] }, request("youtube"));
  assert.deepEqual(normalized.map((item) => item.id), ["package-1", "package-2", "package-3"]);
});
