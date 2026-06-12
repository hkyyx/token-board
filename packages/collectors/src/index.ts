import type { TokenBoardConfig } from "@token-board/core";
import { isPlatformEnabled } from "@token-board/core";
import { claudeCollector } from "./claude/index.js";
import { codexCollector } from "./codex/index.js";
import { cursorCollector } from "./cursor/index.js";
import { createOpenAICollector } from "./openai/index.js";
import { createAnthropicCollector } from "./anthropic/index.js";
import type { Collector, CollectorContext, CollectorResult } from "./types.js";

export function getCollectors(config?: TokenBoardConfig): Collector[] {
  const collectors: Collector[] = [
    claudeCollector,
    codexCollector,
    cursorCollector,
    createOpenAICollector(config?.api?.openaiApiKey),
    createAnthropicCollector(config?.api?.anthropicAdminKey),
  ];

  if (!config) {
    return collectors;
  }

  return collectors.filter((collector) =>
    isPlatformEnabled(config, collector.id),
  );
}

export async function runCollectors(
  collectors: Collector[],
  context: CollectorContext,
): Promise<CollectorResult[]> {
  const results: CollectorResult[] = [];

  for (const collector of collectors) {
    const detected = await collector.detect().catch(() => false);

    if (!detected) {
      results.push({ collector, detected: false, records: [] });
      continue;
    }

    try {
      const records = await collector.collect(context);
      results.push({ collector, detected: true, records });
    } catch (error) {
      results.push({
        collector,
        detected: true,
        records: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export * from "./types.js";
export * from "./csv.js";
export { claudeCollector } from "./claude/index.js";
export { codexCollector } from "./codex/index.js";
export { cursorCollector } from "./cursor/index.js";
export { createOpenAICollector } from "./openai/index.js";
export { createAnthropicCollector } from "./anthropic/index.js";
