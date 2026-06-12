import type { DailyUsage, PlatformId } from "@token-board/core";

export interface CollectorContext {
  timezone: string;
  since: Date;
}

export interface Collector {
  id: PlatformId;
  name: string;
  detect(): Promise<boolean>;
  collect(context: CollectorContext): Promise<DailyUsage[]>;
}

export interface CollectorResult {
  collector: Collector;
  detected: boolean;
  records: DailyUsage[];
  error?: string;
}
