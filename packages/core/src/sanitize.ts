import type { DailyUsage } from "./schema.js";

export function sanitizeForPublish(
  records: DailyUsage[],
  options: { includeCost?: boolean; includeModels?: boolean } = {},
): DailyUsage[] {
  return records.map((record) => {
    const sanitized: DailyUsage = {
      date: record.date,
      platform: record.platform,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      totalTokens: record.totalTokens,
      source: record.source,
      collectedAt: record.collectedAt,
    };

    if (options.includeCost && record.costUsd !== undefined) {
      sanitized.costUsd = record.costUsd;
    }

    if (options.includeModels && record.models) {
      sanitized.models = record.models;
    }

    return sanitized;
  });
}
