import test from "node:test";
import assert from "node:assert/strict";
import { StoryboardDuplicateError } from "../lib/storyboard.ts";
import { StoryboardConflictError, StoryboardRequestError } from "../lib/storyboard-run.ts";
import {
  StoryboardIdError,
  parseStoryboardScriptId,
  storyboardErrorStatus,
  storeHasPersistentContent,
} from "../lib/storyboard-http.ts";

test("Storyboard route ids are decoded and bounded before storage access", () => {
  assert.equal(parseStoryboardScriptId("script%201"), "script 1");
  assert.throws(() => parseStoryboardScriptId(""), StoryboardIdError);
  assert.throws(() => parseStoryboardScriptId("%"), StoryboardIdError);
  assert.throws(() => parseStoryboardScriptId("x".repeat(201)), StoryboardIdError);
});

test("Storyboard route errors map domain conflicts separately from infrastructure failures", () => {
  assert.equal(storyboardErrorStatus(new StoryboardIdError()), 400);
  assert.equal(storyboardErrorStatus(new StoryboardConflictError()), 409);
  assert.equal(storyboardErrorStatus(new StoryboardRequestError("bad evidence")), 409);
  assert.equal(storyboardErrorStatus(new StoryboardDuplicateError("duplicate")), 409);
  assert.equal(storyboardErrorStatus(new Error("offline")), 502);
});

test("demo mode requires Scripts, Ideas, Signals, and Creators all to be empty", async () => {
  const empty = {
    async listScripts() { return []; },
    async listIdeas() { return []; },
    async listSignals() { return []; },
    async listCreators() { return []; },
  };
  assert.equal(await storeHasPersistentContent(empty), false);
  for (const populated of ["scripts", "ideas", "signals", "creators"]) {
    const storage = {
      ...empty,
      [`list${populated[0].toUpperCase()}${populated.slice(1)}`]: async () => [{}],
    };
    assert.equal(await storeHasPersistentContent(storage), true, populated);
  }
});
