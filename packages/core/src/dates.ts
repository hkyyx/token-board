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
