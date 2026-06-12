import { homedir } from "node:os";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DailyUsage } from "@token-board/core";
import { formatDateInTimezone } from "@token-board/core";
import type { Collector, CollectorContext } from "../types.js";

const CLAUDE_DIR = path.join(homedir(), ".claude");

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
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

function extractUsageFromLine(line: string): {
  timestamp?: string;
  inputTokens: number;
  outputTokens: number;
  model?: string;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;

  const usage =
    (record.usage as Record<string, number> | undefined) ??
    ((record.message as Record<string, unknown> | undefined)?.usage as
      | Record<string, number>
      | undefined);

  if (!usage) return null;

  const inputTokens = Number(
    usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? 0,
  );
  const outputTokens = Number(
    usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? 0,
  );

  if (inputTokens <= 0 && outputTokens <= 0) return null;

  const timestamp =
    (typeof record.timestamp === "string" && record.timestamp) ||
    (typeof record.created_at === "string" && record.created_at) ||
    undefined;

  const model =
    (typeof record.model === "string" && record.model) ||
    ((record.message as Record<string, unknown> | undefined)?.model as
      | string
      | undefined);

  return { timestamp, inputTokens, outputTokens, model };
}

async function collectFromStatsCache(
  timezone: string,
  since: Date,
): Promise<DailyUsage[]> {
  const cachePath = path.join(CLAUDE_DIR, "stats-cache.json");
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const daily = parsed.dailyActivity as
      | Array<{
          date?: string;
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
        }>
      | undefined;

    if (!Array.isArray(daily)) return [];

    const sinceDate = formatDateInTimezone(since, timezone);
    const collectedAt = new Date().toISOString();

    return daily
      .filter((entry) => entry.date && entry.date >= sinceDate)
      .map((entry) => ({
        date: entry.date!,
        platform: "claude" as const,
        inputTokens: entry.inputTokens ?? 0,
        outputTokens: entry.outputTokens ?? 0,
        totalTokens:
          entry.totalTokens ??
          (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0),
        source: "local" as const,
        collectedAt,
      }));
  } catch {
    return [];
  }
}

export const claudeCollector: Collector = {
  id: "claude",
  name: "Claude Code",

  async detect(): Promise<boolean> {
    try {
      const stats = await stat(CLAUDE_DIR);
      return stats.isDirectory();
    } catch {
      return false;
    }
  },

  async collect(context: CollectorContext): Promise<DailyUsage[]> {
    const cacheRecords = await collectFromStatsCache(
      context.timezone,
      context.since,
    );
    if (cacheRecords.length > 0) {
      return cacheRecords;
    }

    const projectsDir = path.join(CLAUDE_DIR, "projects");
    const files = await walkJsonlFiles(projectsDir);
    const buckets = new Map<
      string,
      { input: number; output: number; models: Record<string, number> }
    >();
    const sinceMs = context.since.getTime();
    const collectedAt = new Date().toISOString();

    for (const file of files) {
      const content = await readFile(file, "utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        const usage = extractUsageFromLine(line);
        if (!usage) continue;

        const timestamp = usage.timestamp ? Date.parse(usage.timestamp) : NaN;
        if (!Number.isNaN(timestamp) && timestamp < sinceMs) continue;

        const date = usage.timestamp
          ? formatDateInTimezone(new Date(usage.timestamp), context.timezone)
          : formatDateInTimezone(new Date(), context.timezone);

        const bucket = buckets.get(date) ?? { input: 0, output: 0, models: {} };
        bucket.input += usage.inputTokens;
        bucket.output += usage.outputTokens;
        if (usage.model) {
          bucket.models[usage.model] =
            (bucket.models[usage.model] ?? 0) +
            usage.inputTokens +
            usage.outputTokens;
        }
        buckets.set(date, bucket);
      }
    }

    return [...buckets.entries()].map(([date, bucket]) => ({
      date,
      platform: "claude",
      inputTokens: bucket.input,
      outputTokens: bucket.output,
      totalTokens: bucket.input + bucket.output,
      models: Object.keys(bucket.models).length > 0 ? bucket.models : undefined,
      source: "local",
      collectedAt,
    }));
  },
};
