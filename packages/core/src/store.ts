import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { DailyUsage, UsageStore } from "./schema.js";
import { createEmptyStore } from "./schema.js";
import { mergeDailyRecords } from "./aggregate.js";
import { dateRange } from "./dates.js";

export async function loadStore(filePath: string): Promise<UsageStore> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as UsageStore;

    if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
      throw new Error("Invalid usage store format");
    }

    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyStore(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
    throw error;
  }
}

export async function saveStore(filePath: string, store: UsageStore): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function upsertRecords(
  store: UsageStore,
  incoming: DailyUsage[],
): UsageStore {
  return {
    ...store,
    records: mergeDailyRecords([...store.records, ...incoming]),
  };
}

export function filterRecordsSince(
  records: DailyUsage[],
  since: string,
): DailyUsage[] {
  return records.filter((record) => record.date >= since);
}

export function filterRecordsByYear(
  records: DailyUsage[],
  year: number,
): DailyUsage[] {
  const prefix = `${year}-`;
  return records.filter((record) => record.date.startsWith(prefix));
}

export function filterRecordsByDays(
  records: DailyUsage[],
  days: number,
  timezone: string,
): DailyUsage[] {
  const dates = dateRange(days, timezone);
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) {
    return records;
  }

  return records.filter(
    (record) => record.date >= first && record.date <= last,
  );
}
