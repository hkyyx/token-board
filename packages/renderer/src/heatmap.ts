import type { DailyUsage } from "@token-board/core";
import {
  aggregateByDate,
  aggregateByPlatform,
  computeStreaks,
  dateRange,
  sumTokens,
} from "@token-board/core";

export interface HeatmapTheme {
  background: string;
  text: string;
  muted: string;
  border: string;
  levels: [string, string, string, string, string];
}

export const DEFAULT_THEME: HeatmapTheme = {
  background: "#0d1117",
  text: "#e6edf3",
  muted: "#8b949e",
  border: "#30363d",
  levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
};

export interface RenderOptions {
  year?: number;
  timezone?: string;
  theme?: HeatmapTheme;
  title?: string;
}

export interface HeatmapStats {
  totalTokens: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  topPlatforms: Array<{ platform: string; tokens: number }>;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function computeLevels(values: number[]): [number, number, number, number] {
  const nonZero = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) {
    return [1, 2, 3, 4];
  }

  const pick = (percentile: number) =>
    nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * percentile))] ??
    1;

  return [pick(0.25), pick(0.5), pick(0.75), pick(1)];
}

function levelForValue(
  value: number,
  thresholds: [number, number, number, number],
): number {
  if (value <= 0) return 0;
  if (value <= thresholds[0]) return 1;
  if (value <= thresholds[1]) return 2;
  if (value <= thresholds[2]) return 3;
  return 4;
}

export function computeHeatmapStats(records: DailyUsage[]): HeatmapStats {
  const dailyTotals = aggregateByDate(records);
  const platformTotals = aggregateByPlatform(records);
  const streaks = computeStreaks([...dailyTotals.keys()]);

  return {
    totalTokens: sumTokens(records),
    activeDays: streaks.activeDays,
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
    topPlatforms: [...platformTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([platform, tokens]) => ({ platform, tokens })),
  };
}

export function renderHeatmapSvg(
  records: DailyUsage[],
  options: RenderOptions = {},
): string {
  const theme = options.theme ?? DEFAULT_THEME;
  const timezone = options.timezone ?? "UTC";
  const dates = dateRange(365, timezone);
  const dailyTotals = aggregateByDate(records);
  const values = dates.map((date) => dailyTotals.get(date) ?? 0);
  const thresholds = computeLevels(values);
  const stats = computeHeatmapStats(records);

  const cell = 12;
  const gap = 3;
  const weeks = Math.ceil(dates.length / 7);
  const gridWidth = weeks * (cell + gap);
  const gridHeight = 7 * (cell + gap);
  const width = gridWidth + 280;
  const height = gridHeight + 132;

  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let monthMarks = "";
  let lastMonth = -1;

  for (let week = 0; week < weeks; week += 1) {
    const weekStart = dates[week * 7];
    if (!weekStart) continue;
    const month = new Date(`${weekStart}T00:00:00Z`).getUTCMonth();
    if (month !== lastMonth) {
      const x = 20 + week * (cell + gap);
      monthMarks += `<text x="${x}" y="28" fill="${theme.muted}" font-size="10" font-family="system-ui, sans-serif">${monthLabels[month]}</text>`;
      lastMonth = month;
    }
  }

  let cells = "";
  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index]!;
    const value = dailyTotals.get(date) ?? 0;
    const level = levelForValue(value, thresholds);
    const week = Math.floor(index / 7);
    const day = index % 7;
    const x = 20 + week * (cell + gap);
    const y = 38 + day * (cell + gap);
    const tooltip = `${date}: ${formatNumber(value)} tokens`;

    cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${theme.levels[level]}"><title>${escapeXml(tooltip)}</title></rect>`;
  }

  const legend = theme.levels
    .map((color, index) => {
      const x = 20 + index * (cell + gap);
      const y = gridHeight + 56;
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${color}"/>`;
    })
    .join("");

  const topPlatforms = stats.topPlatforms
    .map(
      (entry) =>
        `<text x="0" dy="16" fill="${theme.text}" font-size="12" font-family="system-ui, sans-serif">${escapeXml(entry.platform)}: ${formatNumber(entry.tokens)}</text>`,
    )
    .join("");

  const title = options.title ?? "AI Token Activity";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${theme.background}" rx="8"/>
  <text x="20" y="16" fill="${theme.text}" font-size="16" font-weight="600" font-family="system-ui, sans-serif">${escapeXml(title)}</text>
  ${monthMarks}
  ${cells}
  <text x="20" y="${gridHeight + 50}" fill="${theme.muted}" font-size="10" font-family="system-ui, sans-serif">Less</text>
  ${legend}
  <text x="${20 + 5 * (cell + gap) + 8}" y="${gridHeight + 50 + 9}" fill="${theme.muted}" font-size="10" font-family="system-ui, sans-serif">More</text>
  <g transform="translate(${gridWidth + 40}, 38)">
    <text fill="${theme.text}" font-size="14" font-weight="600" font-family="system-ui, sans-serif">Stats</text>
    <text y="24" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Total tokens</text>
    <text y="42" fill="${theme.text}" font-size="20" font-weight="700" font-family="system-ui, sans-serif">${formatNumber(stats.totalTokens)}</text>
    <text y="68" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Active days</text>
    <text y="86" fill="${theme.text}" font-size="16" font-family="system-ui, sans-serif">${stats.activeDays}</text>
    <text y="112" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Current streak</text>
    <text y="130" fill="${theme.text}" font-size="16" font-family="system-ui, sans-serif">${stats.currentStreak} days</text>
    <text y="156" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Longest streak</text>
    <text y="174" fill="${theme.text}" font-size="16" font-family="system-ui, sans-serif">${stats.longestStreak} days</text>
    <text y="206" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Top platforms</text>
    <text y="226" fill="${theme.text}" font-size="12" font-family="system-ui, sans-serif">${topPlatforms}</text>
  </g>
</svg>`;
}
