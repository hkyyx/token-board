import { homedir } from "node:os";
import path from "node:path";
import { DEFAULT_LOOKBACK_DAYS, parseDaysArg } from "./dates.js";
import type { TokenBoardConfig } from "./schema.js";

export const DEFAULT_CONFIG_DIR = path.join(
  homedir(),
  ".config",
  "token-board",
);

export const DEFAULT_CONFIG_PATH = path.join(DEFAULT_CONFIG_DIR, "config.yaml");

export function defaultConfig(cwd = process.cwd()): TokenBoardConfig {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    days: DEFAULT_LOOKBACK_DAYS,
    dataPath: path.join(cwd, "data", "usage.json"),
    outputPath: path.join(cwd, "assets", "token-activity.svg"),
    platforms: {
      cursor: { enabled: true },
      codex: { enabled: true },
      claude: { enabled: true },
      openai: { enabled: false },
      anthropic: { enabled: false },
    },
    publish: {
      includeCost: false,
      includeModels: false,
    },
  };
}

export function resolveConfigPath(configPath?: string): string {
  return configPath ?? process.env.TOKEN_BOARD_CONFIG ?? DEFAULT_CONFIG_PATH;
}

export async function loadConfig(configPath?: string): Promise<TokenBoardConfig> {
  const resolved = resolveConfigPath(configPath);
  const { readFile } = await import("node:fs/promises");
  const { parse } = await import("yaml");

  try {
    const raw = await readFile(resolved, "utf8");
    const parsed = parse(raw) as Partial<TokenBoardConfig>;
    const base = defaultConfig(path.dirname(path.dirname(resolved)));
    return {
      ...base,
      ...parsed,
      days: parseDaysArg(parsed.days, base.days),
      platforms: {
        ...defaultConfig().platforms,
        ...parsed.platforms,
      },
      publish: {
        includeCost: parsed.publish?.includeCost ?? defaultConfig().publish!.includeCost,
        includeModels: parsed.publish?.includeModels ?? defaultConfig().publish!.includeModels,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultConfig();
    }
    throw error;
  }
}

export function isPlatformEnabled(
  config: TokenBoardConfig,
  platform: keyof NonNullable<TokenBoardConfig["platforms"]>,
): boolean {
  return config.platforms?.[platform]?.enabled !== false;
}
