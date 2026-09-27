import test from "node:test";
import assert from "node:assert/strict";
import { chat, chatBody, startBridge, tempHome } from "./board-bridge-harness.mjs";

/**
 * Deadlines per engine (PLAN.md point 39b), scaled through BOARD_ENGINE_TIME_SCALE.
 * Scale 0.01: first output 1.2 s, silence 0.9 s, total 6 s. The fake engine
 * scales its waiting times with the same factor, so "120 s" means 1.2 s here.
 */
async function withBridge(scale, fn) {
  const bridge = await startBridge({ home: tempHome(), env: { BOARD_ENGINE_TIME_SCALE: String(scale), BOARD_ENGINE_SLOTS: "4" } });
  try {
    await fn(bridge);
  } finally {
    await bridge.stop();
  }
}

test("scaled deadlines: Codex survives 120 s of silence, Claude without first output and a hanging Codex are stopped", { timeout: 60_000 }, async () => {
  await withBridge(0.01, async (bridge) => {
    const [silentCodex, mute, stalled, hanging] = await Promise.all([
      chat(bridge.base, chatBody({ engine: "codex", text: "[[fake:silence=120000]]" })),
      chat(bridge.base, chatBody({ engine: "claude", text: "[[fake:hang]]" })),
      (async () => {
        // Claude starts, then goes silent: the silence watchdog (90 s scaled) ends it.
        await new Promise((resolve) => setTimeout(resolve, 200));
        return chat(bridge.base, chatBody({ engine: "command-code", text: "[[fake:stall]]" }));
      })(),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const started = Date.now();
        const result = await chat(bridge.base, chatBody({ engine: "codex", text: "[[fake:hang]]" }));
        return { ...result, ms: Date.now() - started };
      })(),
    ]);
    assert.ok(silentCodex.finish, `Codex after silence: ${JSON.stringify(silentCodex.error)}`);
    assert.equal(silentCodex.error, undefined);
    assert.equal(mute.error?.code, "timeout");
    assert.match(mute.error.message, /nicht rechtzeitig angefangen/);
    assert.equal(stalled.text, "Teil eins und zwei");
    assert.equal(stalled.error?.code, "timeout");
    assert.match(stalled.error.message, /seit zu langer Zeit/);
    assert.equal(hanging.error?.code, "timeout");
    assert.match(hanging.error.message, /Höchstdauer/);
    assert.ok(hanging.ms >= 5_500, `Codex ended after ${hanging.ms} ms, before the total cap`);
  });
});

test("a long healthy run (30 s) is never stopped by the silence watchdog", { timeout: 90_000 }, async () => {
  // Scale 0.1: silence watchdog 9 s, total cap 60 s; the run streams for 30 s real time.
  await withBridge(0.1, async (bridge) => {
    const started = Date.now();
    const result = await chat(bridge.base, chatBody({ text: "[[fake:stream=300000]]" }));
    const ms = Date.now() - started;
    assert.ok(result.finish, JSON.stringify(result.error));
    assert.ok(ms >= 29_000, `ran ${ms} ms`);
  });
});
