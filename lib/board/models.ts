/**
 * Engines, models and token budgets of the chat node (PLAN.md points 40, 41, 77).
 *
 * Estimate = UTF-8 bytes × factor (bytes are a safe upper bound for byte-BPE
 * tokenizers) + measured engine overhead + a 16,000 token answer reserve. The
 * smoke test (`npm run board:calibrate`, research 07) checks for every model
 * that the real input tokens stay below this estimate; if one does not, the
 * engine's factor or overhead goes up here.
 */
export type EngineId = "claude" | "codex" | "command-code";
export type Effort = "instant" | "low" | "medium" | "high";

export const ENGINE_IDS: readonly EngineId[] = ["claude", "codex", "command-code"];
export const EFFORTS: readonly Effort[] = ["instant", "low", "medium", "high"];
export const EFFORT_LABELS: Record<Effort, string> = { instant: "Instant", low: "Niedrig", medium: "Mittel", high: "Hoch" };
export const ENGINE_LABELS: Record<EngineId, string> = { claude: "Claude", codex: "Codex", "command-code": "Command Code" };

export const ANSWER_RESERVE_TOKENS = 16_000;

/** Tokens the engine adds on its own (system prompt, tool schemas), measured in the smoke test and rounded up. */
export const ENGINE_OVERHEAD_TOKENS: Record<EngineId, number> = { claude: 1_000, codex: 20_000, "command-code": 20_000 };

/** Tokens per UTF-8 byte of our prompt, at most. */
export const ENGINE_BYTE_FACTOR: Record<EngineId, number> = { claude: 1, codex: 1, "command-code": 1 };

export type BoardModelInfo = {
  engine: EngineId;
  id: string;
  label: string;
  budgetTokens: number;
  isDefault?: boolean;
};

/** Codex takes its model from Chris' Codex configuration; the bridge reports the real ID. */
export const CODEX_CONFIG_MODEL = "codex-config";

export const BOARD_MODELS: readonly BoardModelInfo[] = [
  { engine: "claude", id: "sonnet", label: "Claude Sonnet", budgetTokens: 200_000, isDefault: true },
  { engine: "claude", id: "opus", label: "Claude Opus", budgetTokens: 200_000 },
  { engine: "claude", id: "fable", label: "Claude Fable", budgetTokens: 200_000 },
  { engine: "codex", id: CODEX_CONFIG_MODEL, label: "Codex (Modell aus der Codex-Konfiguration)", budgetTokens: 200_000 },
  { engine: "command-code", id: "moonshotai/kimi-k3", label: "Kimi K3", budgetTokens: 128_000 },
  { engine: "command-code", id: "zai-org/glm-5.3", label: "GLM 5.3", budgetTokens: 128_000 },
  { engine: "command-code", id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", budgetTokens: 128_000 },
  { engine: "command-code", id: "qwen/qwen3.8-max", label: "Qwen 3.8 Max", budgetTokens: 128_000 },
];

export const DEFAULT_CHAT_SETTINGS = { engine: "claude" as EngineId, modelId: "sonnet", effort: "medium" as Effort };

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === "string" && (ENGINE_IDS as readonly string[]).includes(value);
}

export function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && (EFFORTS as readonly string[]).includes(value);
}

export function findModel(engine: EngineId, modelId: string): BoardModelInfo | undefined {
  if (engine === "codex") return BOARD_MODELS.find((model) => model.engine === "codex");
  return BOARD_MODELS.find((model) => model.engine === engine && model.id === modelId);
}

export function modelsFor(engine: EngineId): BoardModelInfo[] {
  return BOARD_MODELS.filter((model) => model.engine === engine);
}

export function modelLabel(engine: EngineId, modelId: string | undefined): string {
  if (engine === "codex") return modelId && modelId !== CODEX_CONFIG_MODEL ? `Codex ${modelId}` : "Codex";
  return findModel(engine, modelId ?? "")?.label ?? `${ENGINE_LABELS[engine]} ${modelId ?? ""}`.trim();
}

export type BudgetCheck = {
  engine: EngineId;
  modelId: string;
  promptBytes: number;
  estimatedTokens: number;
  budgetTokens: number;
  ok: boolean;
};

/** Upper bound of the input tokens for `promptBytes` of prompt, plus overhead and reserve. */
export function estimateTokens(engine: EngineId, promptBytes: number): number {
  return Math.ceil(promptBytes * ENGINE_BYTE_FACTOR[engine]) + ENGINE_OVERHEAD_TOKENS[engine] + ANSWER_RESERVE_TOKENS;
}

export function checkBudget(engine: EngineId, modelId: string, promptBytes: number): BudgetCheck {
  const budgetTokens = findModel(engine, modelId)?.budgetTokens ?? Math.min(...modelsFor(engine).map((model) => model.budgetTokens));
  const estimatedTokens = estimateTokens(engine, promptBytes);
  return { engine, modelId, promptBytes, estimatedTokens, budgetTokens, ok: estimatedTokens <= budgetTokens };
}
