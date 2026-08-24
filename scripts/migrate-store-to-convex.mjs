// One-off: push data/store.json into the Convex deployment from .env.local.
import fs from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const url = env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL missing in .env.local");
const store = JSON.parse(fs.readFileSync("data/store.json", "utf8"));
const client = new ConvexHttpClient(url);
for (const creator of store.creators) await client.mutation(anyApi.creators.upsert, { creator });
for (let i = 0; i < store.signals.length; i += 100) await client.mutation(anyApi.signals.bulkUpsert, { records: store.signals.slice(i, i + 100) });
const creators = await client.query(anyApi.creators.list, {});
const signals = await client.query(anyApi.signals.list, {});
console.log(`convex now holds ${creators.length} creators, ${signals.length} signals`);
