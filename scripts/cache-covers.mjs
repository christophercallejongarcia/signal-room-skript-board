// One-off: fill the cover cache for the corpus the running app serves, without an Apify run.
// Usage: node scripts/cache-covers.mjs [http://localhost:3000]
import { cacheCovers } from "../lib/adapters/storage/cover-cache.ts";

const base = process.argv[2] ?? "http://localhost:3000";
const response = await fetch(`${base}/api/signals`);
if (!response.ok) throw new Error(`${base}/api/signals answered ${response.status}`);
const { signals } = await response.json();
const result = await cacheCovers(signals);
console.log(JSON.stringify({ signals: signals.length, ...result }));
