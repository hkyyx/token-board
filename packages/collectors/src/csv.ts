import type { DailyUsage, PlatformId } from "@token-board/core";
import { isPlatformId, normalizeDailyUsage } from "@token-board/core";

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function headerIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) =>
    candidates.some((candidate) => header.includes(candidate)),
  );
}

export function parseUsageCsv(content: string): DailyUsage[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [];

  const headers = parseCsvLine(lines[0]!).map((value) => value.toLowerCase());
  const dateIdx = headerIndex(headers, ["date"]);
  const platformIdx = headerIndex(headers, ["platform", "client", "source"]);
  const inputIdx = headerIndex(headers, ["input"]);
  const outputIdx = headerIndex(headers, ["output"]);
  const totalIdx = headerIndex(headers, ["total"]);
  const costIdx = headerIndex(headers, ["cost"]);
  const modelIdx = headerIndex(headers, ["model"]);

  if (dateIdx < 0) {
    throw new Error("CSV must include a date column");
  }

  const collectedAt = new Date().toISOString();
  const records: DailyUsage[] = [];

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const date = cols[dateIdx]?.slice(0, 10);
    if (!date) continue;

    const platformRaw = (platformIdx >= 0 ? cols[platformIdx] : "custom") ?? "custom";
    const platform: PlatformId = isPlatformId(platformRaw.toLowerCase())
      ? (platformRaw.toLowerCase() as PlatformId)
      : "custom";

    const inputTokens = Number(cols[inputIdx] ?? 0);
    const outputTokens = Number(cols[outputIdx] ?? 0);
    const totalTokens = Number(
      cols[totalIdx] ?? inputTokens + outputTokens,
    );
    const costUsd = costIdx >= 0 ? Number(cols[costIdx]) : undefined;
    const model = modelIdx >= 0 ? cols[modelIdx] : undefined;

    records.push(
      normalizeDailyUsage({
        date,
        platform,
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd: Number.isFinite(costUsd) ? costUsd : undefined,
        models: model ? { [model]: totalTokens } : undefined,
        source: "csv",
        collectedAt,
      }),
    );
  }

  return records;
}
