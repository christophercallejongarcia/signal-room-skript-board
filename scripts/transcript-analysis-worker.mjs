import { getStorage } from "../lib/adapters/storage/index.ts";
import { processTranscriptAnalyses } from "../lib/transcript-analysis-run.ts";

const requested = Number.parseInt(process.argv[2] || "3", 10);
const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 20) : 3;
const result = await processTranscriptAnalyses({ storage: getStorage(), limit });
console.log(JSON.stringify(result));
