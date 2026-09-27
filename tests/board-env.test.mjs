import test from "node:test";
import assert from "node:assert/strict";
import { assertLocalConvex, parseEnvFile } from "../scripts/board/env.mjs";

test("the Convex guard accepts only local and anonymous deployments on loopback", () => {
  assert.doesNotThrow(() => assertLocalConvex({ CONVEX_DEPLOYMENT: "anonymous:anonymous-agent", NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3410" }));
  assert.doesNotThrow(() => assertLocalConvex({ CONVEX_DEPLOYMENT: "local:local-chris-signal", NEXT_PUBLIC_CONVEX_URL: "http://localhost:3210/" }));
  assert.throws(() => assertLocalConvex({ CONVEX_DEPLOYMENT: "dev:happy-otter-123", NEXT_PUBLIC_CONVEX_URL: "https://happy-otter-123.convex.cloud" }), /lokale Deployment/);
  assert.throws(() => assertLocalConvex({ CONVEX_DEPLOYMENT: "", NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3410" }), /leer/);
  assert.throws(() => assertLocalConvex({ CONVEX_DEPLOYMENT: "anonymous:x", NEXT_PUBLIC_CONVEX_URL: "https://x.convex.cloud" }), /127\.0\.0\.1/);
  assert.throws(() => assertLocalConvex({ CONVEX_DEPLOYMENT: "anonymous:x", NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3410", CONVEX_DEPLOY_KEY: "k" }), /DEPLOY_KEY/);
});

test("the env parser reads KEY=VALUE, skips comments and strips quotes", () => {
  assert.deepEqual(parseEnvFile('# c\nA=1\nB="zwei = 2"\n\nC=\'drei\'\nkaputt\n'), { A: "1", B: "zwei = 2", C: "drei" });
});
