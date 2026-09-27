import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertE2eTarget } from "../scripts/board/e2e.mjs";

function workspace(marker = "abc") {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sr-board-e2e-test-")));
  fs.writeFileSync(path.join(root, "SR-BOARD-E2E-MARKER"), marker);
  fs.mkdirSync(path.join(root, "project", ".convex", "local", "default"), { recursive: true });
  fs.writeFileSync(path.join(root, "project", ".convex", "local", "default", "config.json"), "{}");
  return root;
}

test("the E2E harness only seeds and cleans a loopback deployment inside its own marked temp folder", () => {
  const root = workspace();
  assert.doesNotThrow(() => assertE2eTarget({ convexUrl: "http://127.0.0.1:3212", root, marker: "abc" }));
  assert.throws(() => assertE2eTarget({ convexUrl: "https://happy-otter-123.convex.cloud", root, marker: "abc" }), /127\.0\.0\.1/);
  assert.throws(() => assertE2eTarget({ convexUrl: "http://192.168.2.1:3212", root, marker: "abc" }), /127\.0\.0\.1/);
  assert.throws(() => assertE2eTarget({ convexUrl: "http://127.0.0.1:3212", root, marker: "other" }), /Marker/);
  assert.throws(() => assertE2eTarget({ convexUrl: "http://127.0.0.1:3212", root: os.homedir(), marker: "abc" }), /Temp/);
  fs.rmSync(path.join(root, "project"), { recursive: true });
  assert.throws(() => assertE2eTarget({ convexUrl: "http://127.0.0.1:3212", root, marker: "abc" }), /Convex-Zustand/);
  fs.rmSync(root, { recursive: true });
});
