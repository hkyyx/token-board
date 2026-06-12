export interface StreakStats {
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
}

export function computeStreaks(datesWithActivity: string[]): StreakStats {
  const uniqueDates = [...new Set(datesWithActivity)].sort();
  if (uniqueDates.length === 0) {
    return { currentStreak: 0, longestStreak: 0, activeDays: 0 };
  }

  let longestStreak = 1;
  let streak = 1;

  for (let i = 1; i < uniqueDates.length; i += 1) {
    const prev = parseDate(uniqueDates[i - 1]!);
    const curr = parseDate(uniqueDates[i]!);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000);

    if (diffDays === 1) {
      streak += 1;
      longestStreak = Math.max(longestStreak, streak);
    } else if (diffDays > 1) {
      streak = 1;
    }
  }

  const today = formatDate(new Date());
  const yesterday = formatDate(addDays(new Date(), -1));
  const lastDate = uniqueDates[uniqueDates.length - 1]!;

  let currentStreak = 0;
  if (lastDate === today || lastDate === yesterday) {
    currentStreak = 1;
    for (let i = uniqueDates.length - 2; i >= 0; i -= 1) {
      const prev = parseDate(uniqueDates[i]!);
      const curr = parseDate(uniqueDates[i + 1]!);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000);
      if (diffDays === 1) {
        currentStreak += 1;
      } else {
        break;
      }
    }
  }

  return {
    currentStreak,
    longestStreak,
    activeDays: uniqueDates.length,
  };
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}
