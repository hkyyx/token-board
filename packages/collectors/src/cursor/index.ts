import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DailyUsage } from "@token-board/core";
import { formatDateInTimezone } from "@token-board/core";
import type { Collector, CollectorContext } from "../types.js";
import { getCursorCacheDir, getCursorDbPath } from "./paths.js";

const execFileAsync = promisify(execFile);

interface BubbleRow {
  input_tokens: number | null;
  output_tokens: number | null;
  model: string | null;
  created_at: string | null;
}

const BUBBLE_QUERY = `
  SELECT
    json_extract(value, '$.tokenCount.inputTokens') as input_tokens,
    json_extract(value, '$.tokenCount.outputTokens') as output_tokens,
    json_extract(value, '$.modelInfo.modelName') as model,
    json_extract(value, '$.createdAt') as created_at
  FROM cursorDiskKV
  WHERE key LIKE 'bubbleId:%'
    AND json_extract(value, '$.createdAt') IS NOT NULL
    AND json_extract(value, '$.createdAt') > ?
  ORDER BY ROWID ASC;
`;

function aggregateRows(
  rows: BubbleRow[],
  timezone: string,
): Map<string, { input: number; output: number; models: Record<string, number> }> {
  const buckets = new Map<
    string,
    { input: number; output: number; models: Record<string, number> }
  >();

  for (const row of rows) {
    const inputTokens = Number(row.input_tokens ?? 0);
    const outputTokens = Number(row.output_tokens ?? 0);
    if (inputTokens <= 0 && outputTokens <= 0) continue;
    if (!row.created_at) continue;

    const date = formatDateInTimezone(new Date(row.created_at), timezone);
    const bucket = buckets.get(date) ?? { input: 0, output: 0, models: {} };
    bucket.input += inputTokens;
    bucket.output += outputTokens;

    if (row.model) {
      const modelTokens = inputTokens + outputTokens;
      bucket.models[row.model] = (bucket.models[row.model] ?? 0) + modelTokens;
    }

    buckets.set(date, bucket);
  }

  return buckets;
}

function parseSqliteJsonOutput(stdout: string): BubbleRow[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as BubbleRow | BubbleRow[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as BubbleRow);
  }
}

async function queryCursorDatabase(
  dbPath: string,
  timeFloor: string,
): Promise<BubbleRow[]> {
  const sql = BUBBLE_QUERY.replace("?", `'${timeFloor.replace(/'/g, "''")}'`);
  const { stdout } = await execFileAsync(
    "sqlite3",
    ["-json", dbPath, sql],
    { maxBuffer: 64 * 1024 * 1024 },
  );

  return parseSqliteJsonOutput(stdout);
}

async function collectFromDatabase(
  context: CollectorContext,
): Promise<DailyUsage[]> {
  const dbPath = getCursorDbPath();
  const timeFloor = context.since.toISOString();
  const rows = await queryCursorDatabase(dbPath, timeFloor);
  const buckets = aggregateRows(rows, context.timezone);
  const collectedAt = new Date().toISOString();

  return [...buckets.entries()].map(([date, bucket]) => ({
    date,
    platform: "cursor",
    inputTokens: bucket.input,
    outputTokens: bucket.output,
    totalTokens: bucket.input + bucket.output,
    models: Object.keys(bucket.models).length > 0 ? bucket.models : undefined,
    source: "local",
    collectedAt,
  }));
}

async function collectFromCacheCsv(
  context: CollectorContext,
): Promise<DailyUsage[]> {
  const cacheDir = getCursorCacheDir();
  let files: string[];

  try {
    files = (await readdir(cacheDir)).filter((name) => name.endsWith(".csv"));
  } catch {
    return [];
  }

  const sinceDate = formatDateInTimezone(context.since, context.timezone);
  const buckets = new Map<string, { input: number; output: number }>();
  const collectedAt = new Date().toISOString();

  for (const file of files) {
    const content = await readFile(path.join(cacheDir, file), "utf8");
    const lines = content.trim().split("\n");
    if (lines.length <= 1) continue;

    const header = lines[0]!.split(",").map((value) => value.trim().toLowerCase());
    const dateIdx = header.findIndex((value) => value.includes("date"));
    const inputIdx = header.findIndex((value) => value.includes("input"));
    const outputIdx = header.findIndex((value) => value.includes("output"));
    const totalIdx = header.findIndex((value) => value.includes("total"));

    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      const date = cols[dateIdx]?.slice(0, 10);
      if (!date || date < sinceDate) continue;

      const inputTokens = Number(cols[inputIdx] ?? 0);
      const outputTokens = Number(cols[outputIdx] ?? 0);
      const totalTokens = Number(cols[totalIdx] ?? inputTokens + outputTokens);
      if (totalTokens <= 0) continue;

      const bucket = buckets.get(date) ?? { input: 0, output: 0 };
      bucket.input += inputTokens;
      bucket.output += outputTokens;
      buckets.set(date, bucket);
    }
  }

  return [...buckets.entries()].map(([date, bucket]) => ({
    date,
    platform: "cursor",
    inputTokens: bucket.input,
    outputTokens: bucket.output,
    totalTokens: bucket.input + bucket.output,
    source: "api",
    collectedAt,
  }));
}

export const cursorCollector: Collector = {
  id: "cursor",
  name: "Cursor IDE",

  async detect(): Promise<boolean> {
    try {
      await access(getCursorDbPath());
      return true;
    } catch {
      try {
        const cacheDir = getCursorCacheDir();
        const files = await readdir(cacheDir);
        return files.some((name) => name.endsWith(".csv"));
      } catch {
        return false;
      }
    }
  },

  async collect(context: CollectorContext): Promise<DailyUsage[]> {
    const dbRecords = await collectFromDatabase(context).catch(() => []);
    if (dbRecords.length > 0) {
      return dbRecords;
    }

    return collectFromCacheCsv(context);
  },
};
