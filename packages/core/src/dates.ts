export const MIN_LOOKBACK_DAYS = 7;
export const MAX_LOOKBACK_DAYS = 365;
export const DEFAULT_LOOKBACK_DAYS = 365;

export function clampDays(days: number): number {
  const rounded = Math.floor(days);
  if (!Number.isFinite(rounded)) {
    throw new Error(
      `Days must be an integer between ${MIN_LOOKBACK_DAYS} and ${MAX_LOOKBACK_DAYS}.`,
    );
  }
  if (rounded < MIN_LOOKBACK_DAYS || rounded > MAX_LOOKBACK_DAYS) {
    throw new Error(
      `Days must be between ${MIN_LOOKBACK_DAYS} and ${MAX_LOOKBACK_DAYS}.`,
    );
  }
  return rounded;
}

export function parseDaysArg(
  value: string | number | undefined,
  fallback = DEFAULT_LOOKBACK_DAYS,
): number {
  if (value === undefined || value === "") {
    return clampDays(fallback);
  }

  const days = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(days)) {
    throw new Error(
      `Invalid --days value: ${value}. Use an integer between ${MIN_LOOKBACK_DAYS} and ${MAX_LOOKBACK_DAYS}.`,
    );
  }

  return clampDays(days);
}

export function sinceDateFromDays(days: number, timezone: string): Date {
  const firstDate = dateRange(days, timezone)[0];
  if (!firstDate) {
    return new Date(Date.now() - days * 86_400_000);
  }
  return new Date(`${firstDate}T00:00:00.000Z`);
}

export function formatDateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function parseSinceArg(value: string): Date {
  const match = /^(\d+)([dhm])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid --since value: ${value}. Use formats like 7d, 24h, 30m.`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const now = Date.now();
  const multipliers: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return new Date(now - amount * multipliers[unit]!);
}

export function dateRange(days: number, timezone: string): string[] {
  const dates: string[] = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - i);
    dates.push(formatDateInTimezone(date, timezone));
  }

  return dates;
}

export function startOfYear(year: number): string {
  return `${year}-01-01`;
}

export function endOfYear(year: number): string {
  return `${year}-12-31`;
}
