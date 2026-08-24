const APIFY_BASE = "https://api.apify.com/v2";
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export function apifyConfigured() {
  return Boolean(process.env.APIFY_TOKEN);
}

/**
 * Runs an actor synchronously and returns its dataset items.
 * actorId uses "~" instead of "/" (e.g. "apify~instagram-scraper").
 */
export async function runActor<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<T[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${APIFY_BASE}/acts/${actorId.replace("/", "~")}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${Math.floor(timeoutMs / 1000)}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Apify ${actorId} failed (${response.status}): ${text.slice(0, 300)}`);
    }
    const items = (await response.json()) as T[];
    return Array.isArray(items) ? items : [];
  } finally {
    clearTimeout(timer);
  }
}
