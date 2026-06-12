import type { DailyUsage } from "@token-board/core";
import { formatDateInTimezone } from "@token-board/core";
import type { Collector, CollectorContext } from "../types.js";

interface AnthropicUsageBucket {
  starting_at?: string;
  ending_at?: string;
  results?: Array<{
    uncached_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  }>;
}

export function createAnthropicCollector(adminKey?: string): Collector {
  return {
    id: "anthropic",
    name: "Anthropic Admin API",

    async detect(): Promise<boolean> {
      const key = adminKey ?? process.env.ANTHROPIC_ADMIN_KEY;
      return Boolean(key?.startsWith("sk-ant-admin"));
    },

    async collect(context: CollectorContext): Promise<DailyUsage[]> {
      const key = adminKey ?? process.env.ANTHROPIC_ADMIN_KEY;
      if (!key) return [];

      const startingAt = context.since.toISOString();
      const endingAt = new Date().toISOString();
      const url = new URL(
        "https://api.anthropic.com/v1/organizations/usage_report/messages",
      );
      url.searchParams.set("starting_at", startingAt);
      url.searchParams.set("ending_at", endingAt);
      url.searchParams.append("group_by[]", "model");
      url.searchParams.set("bucket_width", "1d");

      const response = await fetch(url, {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Anthropic usage API failed: ${response.status} ${response.statusText}`,
        );
      }

      const payload = (await response.json()) as { data?: AnthropicUsageBucket[] };
      const collectedAt = new Date().toISOString();
      const buckets = new Map<string, { input: number; output: number }>();

      for (const bucket of payload.data ?? []) {
        const dateSource = bucket.starting_at ?? bucket.ending_at;
        if (!dateSource) continue;

        const date = formatDateInTimezone(new Date(dateSource), context.timezone);
        let input = 0;
        let output = 0;

        for (const result of bucket.results ?? []) {
          input +=
            (result.uncached_input_tokens ?? 0) +
            (result.cache_creation_input_tokens ?? 0) +
            (result.cache_read_input_tokens ?? 0);
          output += result.output_tokens ?? 0;
        }

        const existing = buckets.get(date) ?? { input: 0, output: 0 };
        existing.input += input;
        existing.output += output;
        buckets.set(date, existing);
      }

      return [...buckets.entries()].map(([date, usage]) => ({
        date,
        platform: "anthropic",
        inputTokens: usage.input,
        outputTokens: usage.output,
        totalTokens: usage.input + usage.output,
        source: "api",
        collectedAt,
      }));
    },
  };
}
