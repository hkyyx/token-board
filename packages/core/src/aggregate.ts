import type { DailyUsage } from "./schema.js";
import { normalizeDailyUsage } from "./schema.js";

function mergeModels(
  a?: Record<string, number>,
  b?: Record<string, number>,
): Record<string, number> | undefined {
  if (!a && !b) return undefined;
  const merged: Record<string, number> = { ...a };
  if (b) {
    for (const [model, tokens] of Object.entries(b)) {
      merged[model] = (merged[model] ?? 0) + tokens;
    }
  }
  return merged;
}

export function usageKey(date: string, platform: string): string {
  return `${date}::${platform}`;
}

export function mergeDailyRecords(records: DailyUsage[]): DailyUsage[] {
  const map = new Map<string, DailyUsage>();

  for (const raw of records.map(normalizeDailyUsage)) {
    const key = usageKey(raw.date, raw.platform);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, raw);
      continue;
    }

    map.set(key, normalizeDailyUsage({
      date: raw.date,
      platform: raw.platform,
      inputTokens: existing.inputTokens + raw.inputTokens,
      outputTokens: existing.outputTokens + raw.outputTokens,
      totalTokens: existing.totalTokens + raw.totalTokens,
      costUsd:
        existing.costUsd !== undefined || raw.costUsd !== undefined
          ? (existing.costUsd ?? 0) + (raw.costUsd ?? 0)
          : undefined,
      models: mergeModels(existing.models, raw.models),
      source: raw.collectedAt > existing.collectedAt ? raw.source : existing.source,
      collectedAt:
        raw.collectedAt > existing.collectedAt
          ? raw.collectedAt
          : existing.collectedAt,
    }));
  }

  return [...map.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.platform.localeCompare(b.platform);
  });
}

export function aggregateByDate(records: DailyUsage[]): Map<string, number> {
  const totals = new Map<string, number>();

  for (const record of records) {
    totals.set(record.date, (totals.get(record.date) ?? 0) + record.totalTokens);
  }

  return totals;
}

export function aggregateByPlatform(records: DailyUsage[]): Map<string, number> {
  const totals = new Map<string, number>();

  for (const record of records) {
    totals.set(
      record.platform,
      (totals.get(record.platform) ?? 0) + record.totalTokens,
    );
  }

  return totals;
}

export function sumTokens(records: DailyUsage[]): number {
  return records.reduce((sum, record) => sum + record.totalTokens, 0);
}
