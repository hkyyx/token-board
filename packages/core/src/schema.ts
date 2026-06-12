export const PLATFORM_IDS = [
  "cursor",
  "codex",
  "claude",
  "openai",
  "anthropic",
  "opencode",
  "custom",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export type UsageSource = "local" | "api" | "csv" | "manual";

export interface DailyUsage {
  date: string;
  platform: PlatformId;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd?: number;
  models?: Record<string, number>;
  source: UsageSource;
  collectedAt: string;
}

export interface UsageStore {
  version: 1;
  timezone: string;
  records: DailyUsage[];
}

export interface TokenBoardConfig {
  timezone: string;
  dataPath: string;
  outputPath: string;
  github?: {
    owner: string;
    repo: string;
    branch: string;
    svgPath: string;
  };
  platforms: Partial<Record<PlatformId, { enabled: boolean }>>;
  publish?: {
    includeCost: boolean;
    includeModels: boolean;
  };
  api?: {
    openaiApiKey?: string;
    anthropicAdminKey?: string;
    cursorAdminToken?: string;
  };
}

export function isPlatformId(value: string): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

export function createEmptyStore(timezone: string): UsageStore {
  return { version: 1, timezone, records: [] };
}

export function normalizeDailyUsage(record: DailyUsage): DailyUsage {
  const inputTokens = Math.max(0, Math.floor(record.inputTokens));
  const outputTokens = Math.max(0, Math.floor(record.outputTokens));
  const totalTokens =
    record.totalTokens > 0
      ? Math.floor(record.totalTokens)
      : inputTokens + outputTokens;

  return {
    ...record,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}
