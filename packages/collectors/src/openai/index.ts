import type { DailyUsage } from "@token-board/core";
import { formatDateInTimezone } from "@token-board/core";
import type { Collector, CollectorContext } from "../types.js";

interface OpenAIUsageBucket {
  start_time: number;
  end_time: number;
  results?: Array<{
    input_tokens?: number;
    output_tokens?: number;
    input_cached_tokens?: number;
    num_model_requests?: number;
  }>;
}

export function createOpenAICollector(apiKey?: string): Collector {
  return {
    id: "openai",
    name: "OpenAI API",

    async detect(): Promise<boolean> {
      return Boolean(apiKey ?? process.env.OPENAI_API_KEY);
    },

    async collect(context: CollectorContext): Promise<DailyUsage[]> {
      const key = apiKey ?? process.env.OPENAI_API_KEY;
      if (!key) return [];

      const startTime = Math.floor(context.since.getTime() / 1000);
      const endTime = Math.floor(Date.now() / 1000);
      const url = new URL("https://api.openai.com/v1/organization/usage/completions");
      url.searchParams.set("start_time", String(startTime));
      url.searchParams.set("end_time", String(endTime));
      url.searchParams.set("bucket_width", "1d");
      url.searchParams.set("group_by", "model");

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (!response.ok) {
        throw new Error(`OpenAI usage API failed: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as { data?: OpenAIUsageBucket[] };
      const collectedAt = new Date().toISOString();
      const buckets = new Map<string, { input: number; output: number }>();

      for (const bucket of payload.data ?? []) {
        const date = formatDateInTimezone(
          new Date(bucket.start_time * 1000),
          context.timezone,
        );

        let input = 0;
        let output = 0;

        for (const result of bucket.results ?? []) {
          input += (result.input_tokens ?? 0) + (result.input_cached_tokens ?? 0);
          output += result.output_tokens ?? 0;
        }

        const existing = buckets.get(date) ?? { input: 0, output: 0 };
        existing.input += input;
        existing.output += output;
        buckets.set(date, existing);
      }

      return [...buckets.entries()].map(([date, usage]) => ({
        date,
        platform: "openai",
        inputTokens: usage.input,
        outputTokens: usage.output,
        totalTokens: usage.input + usage.output,
        source: "api",
        collectedAt,
      }));
    },
  };
}
