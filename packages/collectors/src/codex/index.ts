import { homedir } from "node:os";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DailyUsage } from "@token-board/core";
import { formatDateInTimezone } from "@token-board/core";
import type { Collector, CollectorContext } from "../types.js";

const CODEX_SESSIONS_DIR = path.join(homedir(), ".codex", "sessions");

async function walkJsonlFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

function addUsage(
  buckets: Map<string, { input: number; output: number }>,
  timestamp: string,
  usage: TokenUsage,
  timezone: string,
): void {
  const inputTokens =
    (usage.input_tokens ?? 0) + (usage.cached_input_tokens ?? 0);
  const outputTokens =
    (usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0);
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;

  if (totalTokens <= 0) return;

  const date = formatDateInTimezone(new Date(timestamp), timezone);
  const bucket = buckets.get(date) ?? { input: 0, output: 0 };
  bucket.input += inputTokens;
  bucket.output += outputTokens;
  buckets.set(date, bucket);
}

export const codexCollector: Collector = {
  id: "codex",
  name: "Codex CLI",

  async detect(): Promise<boolean> {
    try {
      const info = await stat(CODEX_SESSIONS_DIR);
      return info.isDirectory();
    } catch {
      return false;
    }
  },

  async collect(context: CollectorContext): Promise<DailyUsage[]> {
    const files = await walkJsonlFiles(CODEX_SESSIONS_DIR);
    const buckets = new Map<string, { input: number; output: number }>();
    const sinceMs = context.since.getTime();
    const collectedAt = new Date().toISOString();

    for (const file of files) {
      const content = await readFile(file, "utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;

        let parsed: {
          timestamp?: string;
          type?: string;
          payload?: {
            type?: string;
            info?: {
              last_token_usage?: TokenUsage;
              total_token_usage?: TokenUsage;
            };
          };
        };

        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const timestamp = parsed.timestamp;
        if (!timestamp || Date.parse(timestamp) < sinceMs) continue;

        if (
          parsed.type === "event_msg" &&
          parsed.payload?.type === "token_count" &&
          parsed.payload.info?.last_token_usage
        ) {
          addUsage(
            buckets,
            timestamp,
            parsed.payload.info.last_token_usage,
            context.timezone,
          );
        }
      }
    }

    return [...buckets.entries()].map(([date, bucket]) => ({
      date,
      platform: "codex",
      inputTokens: bucket.input,
      outputTokens: bucket.output,
      totalTokens: bucket.input + bucket.output,
      source: "local",
      collectedAt,
    }));
  },
};
