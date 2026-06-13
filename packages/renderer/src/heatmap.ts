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
  platforms: Array<{ platform: string; label: string; tokens: number; share: number }>;
}

const PLATFORM_LABELS: Record<string, string> = {
  cursor: "Cursor",
  codex: "Codex",
  claude: "Claude Code",
  openai: "OpenAI",
  anthropic: "Anthropic",
  opencode: "OpenCode",
  custom: "Custom",
};

const PLATFORM_COLORS: Record<string, string> = {
  cursor: "#a855f7",
  codex: "#10b981",
  claude: "#f97316",
  openai: "#22c55e",
  anthropic: "#eab308",
  opencode: "#3b82f6",
  custom: "#94a3b8",
};

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

function platformColor(platform: string): string {
  return PLATFORM_COLORS[platform] ?? "#58a6ff";
}

function aggregateDailyByPlatform(
  records: DailyUsage[],
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();

  for (const record of records) {
    let dayMap = result.get(record.date);
    if (!dayMap) {
      dayMap = new Map();
      result.set(record.date, dayMap);
    }
    dayMap.set(
      record.platform,
      (dayMap.get(record.platform) ?? 0) + record.totalTokens,
    );
  }

  return result;
}

function buildDayTooltip(
  date: string,
  total: number,
  dayPlatforms?: Map<string, number>,
): string {
  if (!dayPlatforms || dayPlatforms.size === 0) {
    return `${date}: ${formatNumber(total)} tokens`;
  }

  const lines = [`${date}: ${formatNumber(total)} tokens`];
  for (const [platform, tokens] of [...dayPlatforms.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`${platformLabel(platform)}: ${formatNumber(tokens)}`);
  }
  return lines.join("\n");
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

  const totalTokens = sumTokens(records);

  return {
    totalTokens,
    activeDays: streaks.activeDays,
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
    platforms: [...platformTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([platform, tokens]) => ({
        platform,
        label: platformLabel(platform),
        tokens,
        share: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
      })),
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
  const dailyByPlatform = aggregateDailyByPlatform(records);
  const platformCount = stats.platforms.length;

  const cell = 12;
  const gap = 3;
  const headerHeight = 50;
  const monthY = headerHeight - 2;
  const cellStartY = headerHeight + 8;
  const weeks = Math.ceil(dates.length / 7);
  const gridWidth = weeks * (cell + gap);
  const gridHeight = 7 * (cell + gap);
  const legendY = cellStartY + gridHeight + 12;
  const leftPanelBottom = legendY + 28;
  const statsPanelBottom = cellStartY + 206 + platformCount * 18 + 16;
  const width = gridWidth + 300;
  const height = Math.max(leftPanelBottom, statsPanelBottom);

  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let monthMarks = "";
  let lastMonth = -1;

  for (let week = 0; week < weeks; week += 1) {
    const weekStart = dates[week * 7];
    if (!weekStart) continue;
    const month = new Date(`${weekStart}T00:00:00Z`).getUTCMonth();
    if (month !== lastMonth) {
      const x = 20 + week * (cell + gap);
      monthMarks += `<text x="${x}" y="${monthY}" fill="${theme.muted}" font-size="10" font-family="system-ui, sans-serif">${monthLabels[month]}</text>`;
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
    const y = cellStartY + day * (cell + gap);
    const tooltip = buildDayTooltip(date, value, dailyByPlatform.get(date));

    cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${theme.levels[level]}"><title>${escapeXml(tooltip)}</title></rect>`;
  }

  const legend = theme.levels
    .map((color, index) => {
      const x = 20 + index * (cell + gap);
      const y = legendY;
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${color}"/>`;
    })
    .join("");

  const platformBadges = renderPlatformBadges(stats.platforms, theme, 20, 32);
  const platformRows = stats.platforms
    .map((entry, index) => {
      const y = 226 + index * 18;
      const color = platformColor(entry.platform);
      return `<circle cx="4" cy="${y - 4}" r="4" fill="${color}"/>
    <text x="14" y="${y}" fill="${theme.text}" font-size="12" font-family="system-ui, sans-serif">${escapeXml(entry.label)}: ${formatNumber(entry.tokens)} (${entry.share.toFixed(1)}%)</text>`;
    })
    .join("\n    ");

  const title = options.title ?? "AI Token Activity";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${theme.background}" rx="8"/>
  <text x="20" y="16" fill="${theme.text}" font-size="16" font-weight="600" font-family="system-ui, sans-serif">${escapeXml(title)}</text>
  ${platformBadges}
  ${monthMarks}
  ${cells}
  <text x="20" y="${legendY - 6}" fill="${theme.muted}" font-size="10" font-family="system-ui, sans-serif">Less</text>
  ${legend}
  <text x="${20 + 5 * (cell + gap) + 8}" y="${legendY + 3}" fill="${theme.muted}" font-size="10" font-family="system-ui, sans-serif">More</text>
  <g transform="translate(${gridWidth + 40}, ${cellStartY})">
    <text fill="${theme.text}" font-size="14" font-weight="600" font-family="system-ui, sans-serif">Stats</text>
    <text y="24" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Total tokens</text>
    <text y="42" fill="${theme.text}" font-size="20" font-weight="700" font-family="system-ui, sans-serif">${formatNumber(stats.totalTokens)}</text>
    <text y="68" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Active days</text>
    <text y="86" fill="${theme.text}" font-size="16" font-family="system-ui, sans-serif">${stats.activeDays}</text>
    <text y="112" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Current streak</text>
    <text y="130" fill="${theme.text}" font-size="16" font-family="system-ui, sans-serif">${stats.currentStreak} days</text>
    <text y="156" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Longest streak</text>
    <text y="174" fill="${theme.text}" font-size="16" font-family="system-ui, sans-serif">${stats.longestStreak} days</text>
    <text y="206" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Platforms</text>
    ${platformRows}
  </g>
</svg>`;
}

function renderPlatformBadges(
  platforms: HeatmapStats["platforms"],
  theme: HeatmapTheme,
  startX: number,
  y: number,
): string {
  if (platforms.length === 0) {
    return `<text x="${startX}" y="${y}" fill="${theme.muted}" font-size="11" font-family="system-ui, sans-serif">No platform data</text>`;
  }

  let x = startX;
  let badges = "";

  for (const entry of platforms) {
    const label = entry.label;
    const pillWidth = label.length * 6.5 + 28;
    const color = platformColor(entry.platform);

    badges += `<rect x="${x}" y="${y - 12}" width="${pillWidth}" height="18" rx="9" fill="${theme.border}"/>
    <circle cx="${x + 10}" cy="${y - 3}" r="4" fill="${color}"/>
    <text x="${x + 18}" y="${y + 1}" fill="${theme.text}" font-size="10" font-family="system-ui, sans-serif">${escapeXml(label)}</text>`;
    x += pillWidth + 8;
  }

  return badges;
}
