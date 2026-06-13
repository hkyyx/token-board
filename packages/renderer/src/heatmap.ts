import type { DailyUsage } from "@token-board/core";
import {
  aggregateByDate,
  aggregateByPlatform,
  computeStreaks,
  dateRange,
  DEFAULT_LOOKBACK_DAYS,
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
  days?: number;
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

type LayoutMode = "strip" | "stacked" | "wide";

interface HeatmapGeometry {
  mode: LayoutMode;
  cell: number;
  gap: number;
  weeks: number;
  gridWidth: number;
  gridHeight: number;
  contentWidth: number;
  padding: number;
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

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

function platformColor(platform: string): string {
  return PLATFORM_COLORS[platform] ?? "#58a6ff";
}

function resolveLayoutMode(days: number): LayoutMode {
  if (days <= 45) return "strip";
  if (days <= 120) return "stacked";
  return "wide";
}

function computeGeometry(days: number): HeatmapGeometry {
  const padding = 20;
  const gap = 3;
  const weeks = Math.ceil(days / 7);
  const mode = resolveLayoutMode(days);

  if (mode === "strip") {
    const contentWidth = Math.max(520, Math.min(860, padding * 2 + days * 18));
    const cell = Math.min(
      22,
      Math.max(
        10,
        Math.floor((contentWidth - padding * 2 - (days - 1) * gap) / days),
      ),
    );
    const gridWidth = days * (cell + gap) - gap;
    return {
      mode,
      cell,
      gap,
      weeks,
      gridWidth,
      gridHeight: cell,
      contentWidth: Math.max(contentWidth, gridWidth + padding * 2),
      padding,
    };
  }

  if (mode === "stacked") {
    const contentWidth = 720;
    const cell = Math.min(
      18,
      Math.max(13, Math.floor((contentWidth - padding * 2) / weeks - gap)),
    );
    const gridWidth = weeks * (cell + gap);
    const gridHeight = 7 * (cell + gap);
    return {
      mode,
      cell,
      gap,
      weeks,
      gridWidth,
      gridHeight,
      contentWidth,
      padding,
    };
  }

  const cell = 12;
  const gridWidth = weeks * (cell + gap);
  const gridHeight = 7 * (cell + gap);
  return {
    mode,
    cell,
    gap,
    weeks,
    gridWidth,
    gridHeight,
    contentWidth: gridWidth + 300,
    padding,
  };
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

function renderMonthMarks(
  dates: string[],
  geometry: HeatmapGeometry,
  theme: HeatmapTheme,
  monthY: number,
): string {
  let monthMarks = "";
  let lastMonth = -1;

  if (geometry.mode === "strip") {
    for (let index = 0; index < dates.length; index += 1) {
      const date = dates[index];
      if (!date) continue;
      const month = new Date(`${date}T00:00:00Z`).getUTCMonth();
      if (month !== lastMonth) {
        const x = geometry.padding + index * (geometry.cell + geometry.gap);
        monthMarks += `<text x="${x}" y="${monthY}" fill="${theme.muted}" font-size="10" font-family="system-ui, sans-serif">${MONTH_LABELS[month]}</text>`;
        lastMonth = month;
      }
    }
    return monthMarks;
  }

  for (let week = 0; week < geometry.weeks; week += 1) {
    const weekStart = dates[week * 7];
    if (!weekStart) continue;
    const month = new Date(`${weekStart}T00:00:00Z`).getUTCMonth();
    if (month !== lastMonth) {
      const x = geometry.padding + week * (geometry.cell + geometry.gap);
      monthMarks += `<text x="${x}" y="${monthY}" fill="${theme.muted}" font-size="10" font-family="system-ui, sans-serif">${MONTH_LABELS[month]}</text>`;
      lastMonth = month;
    }
  }

  return monthMarks;
}

function renderCells(
  dates: string[],
  dailyTotals: Map<string, number>,
  dailyByPlatform: Map<string, Map<string, number>>,
  thresholds: [number, number, number, number],
  geometry: HeatmapGeometry,
  theme: HeatmapTheme,
  cellStartY: number,
): string {
  let cells = "";

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index]!;
    const value = dailyTotals.get(date) ?? 0;
    const level = levelForValue(value, thresholds);
    const tooltip = buildDayTooltip(date, value, dailyByPlatform.get(date));

    if (geometry.mode === "strip") {
      const x = geometry.padding + index * (geometry.cell + geometry.gap);
      cells += `<rect x="${x}" y="${cellStartY}" width="${geometry.cell}" height="${geometry.cell}" rx="2" fill="${theme.levels[level]}"><title>${escapeXml(tooltip)}</title></rect>`;
      continue;
    }

    const week = Math.floor(index / 7);
    const day = index % 7;
    const x = geometry.padding + week * (geometry.cell + geometry.gap);
    const y = cellStartY + day * (geometry.cell + geometry.gap);
    cells += `<rect x="${x}" y="${y}" width="${geometry.cell}" height="${geometry.cell}" rx="2" fill="${theme.levels[level]}"><title>${escapeXml(tooltip)}</title></rect>`;
  }

  return cells;
}

function renderLegend(
  theme: HeatmapTheme,
  geometry: HeatmapGeometry,
  legendY: number,
): string {
  const { cell, gap, padding } = geometry;
  const legend = theme.levels
    .map((color, index) => {
      const x = padding + index * (cell + gap);
      return `<rect x="${x}" y="${legendY}" width="${cell}" height="${cell}" rx="2" fill="${color}"/>`;
    })
    .join("");

  return `
  <text x="${padding}" y="${legendY - 6}" fill="${theme.muted}" font-size="10" font-family="system-ui, sans-serif">Less</text>
  ${legend}
  <text x="${padding + 5 * (cell + gap) + 8}" y="${legendY + 3}" fill="${theme.muted}" font-size="10" font-family="system-ui, sans-serif">More</text>`;
}

function renderStatsPanelSide(
  stats: HeatmapStats,
  theme: HeatmapTheme,
  x: number,
  y: number,
): string {
  return `<g transform="translate(${x}, ${y})">
    <text fill="${theme.text}" font-size="14" font-weight="600" font-family="system-ui, sans-serif">Stats</text>
    <text y="24" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Total tokens</text>
    <text y="42" fill="${theme.text}" font-size="20" font-weight="700" font-family="system-ui, sans-serif">${formatNumber(stats.totalTokens)}</text>
    <text y="68" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Active days</text>
    <text y="86" fill="${theme.text}" font-size="16" font-family="system-ui, sans-serif">${stats.activeDays}</text>
    <text y="112" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Current streak</text>
    <text y="130" fill="${theme.text}" font-size="16" font-family="system-ui, sans-serif">${stats.currentStreak} days</text>
    <text y="156" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Longest streak</text>
    <text y="174" fill="${theme.text}" font-size="16" font-family="system-ui, sans-serif">${stats.longestStreak} days</text>
    <text y="206" fill="${theme.muted}" font-size="12" font-family="system-ui, sans-serif">Platforms tracked</text>
    <text y="224" fill="${theme.text}" font-size="16" font-family="system-ui, sans-serif">${stats.platforms.length}</text>
  </g>`;
}

function renderStatsPanelBelow(
  stats: HeatmapStats,
  theme: HeatmapTheme,
  x: number,
  y: number,
  width: number,
): { svg: string; height: number } {
  const columns = [
    { label: "Total tokens", value: formatNumber(stats.totalTokens), large: true },
    { label: "Active days", value: String(stats.activeDays) },
    { label: "Current streak", value: `${stats.currentStreak} days` },
    { label: "Longest streak", value: `${stats.longestStreak} days` },
  ];
  const colWidth = width / columns.length;
  let svg = `<text x="${x}" y="${y + 14}" fill="${theme.text}" font-size="14" font-weight="600" font-family="system-ui, sans-serif">Stats</text>`;

  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index]!;
    const cx = x + index * colWidth;
    const valueSize = column.large ? 20 : 16;
    const valueWeight = column.large ? "700" : "400";

    svg += `
    <text x="${cx}" y="${y + 36}" fill="${theme.muted}" font-size="11" font-family="system-ui, sans-serif">${column.label}</text>
    <text x="${cx}" y="${y + 36 + (column.large ? 24 : 20)}" fill="${theme.text}" font-size="${valueSize}" font-weight="${valueWeight}" font-family="system-ui, sans-serif">${escapeXml(column.value)}</text>`;
  }

  svg += `
  <text x="${x}" y="${y + 88}" fill="${theme.muted}" font-size="11" font-family="system-ui, sans-serif">Platforms tracked</text>
  <text x="${x + 120}" y="${y + 88}" fill="${theme.text}" font-size="14" font-family="system-ui, sans-serif">${stats.platforms.length}</text>`;

  return { svg, height: 96 };
}

export function renderHeatmapSvg(
  records: DailyUsage[],
  options: RenderOptions = {},
): string {
  const theme = options.theme ?? DEFAULT_THEME;
  const timezone = options.timezone ?? "UTC";
  const days = options.days ?? DEFAULT_LOOKBACK_DAYS;
  const geometry = computeGeometry(days);
  const dates = dateRange(days, timezone);
  const dailyTotals = aggregateByDate(records);
  const values = dates.map((date) => dailyTotals.get(date) ?? 0);
  const thresholds = computeLevels(values);
  const stats = computeHeatmapStats(records);
  const dailyByPlatform = aggregateDailyByPlatform(records);

  const badgeBlock = renderPlatformBadges(
    stats.platforms,
    theme,
    geometry.padding,
    32,
    geometry.contentWidth - geometry.padding * 2,
  );
  const headerHeight = 50 + Math.max(0, badgeBlock.height - 18);
  const monthY = headerHeight - 2;
  const cellStartY = headerHeight + 8;
  const legendY =
    geometry.mode === "strip"
      ? cellStartY + geometry.cell + 12
      : cellStartY + geometry.gridHeight + 12;

  const monthMarks = renderMonthMarks(dates, geometry, theme, monthY);
  const cells = renderCells(
    dates,
    dailyTotals,
    dailyByPlatform,
    thresholds,
    geometry,
    theme,
    cellStartY,
  );
  const legend = renderLegend(theme, geometry, legendY);

  const chartWidth =
    geometry.mode === "wide"
      ? geometry.gridWidth
      : geometry.contentWidth - geometry.padding * 2;

  let statsSvg = "";
  let statsHeight = 0;
  let barChartStartY = legendY + 24;

  if (geometry.mode === "wide") {
    statsSvg = renderStatsPanelSide(
      stats,
      theme,
      geometry.gridWidth + geometry.padding + 20,
      cellStartY,
    );
    statsHeight = 230;
  } else {
    barChartStartY = legendY + 24;
    const statsPanel = renderStatsPanelBelow(
      stats,
      theme,
      geometry.padding,
      barChartStartY,
      geometry.contentWidth - geometry.padding * 2,
    );
    statsSvg = statsPanel.svg;
    statsHeight = statsPanel.height;
    barChartStartY += statsHeight + 16;
  }

  const barChart = renderPlatformBarChart(
    stats.platforms,
    theme,
    geometry.padding,
    barChartStartY,
    chartWidth,
  );

  const leftPanelBottom = barChartStartY + barChart.height;
  const rightPanelBottom =
    geometry.mode === "wide" ? cellStartY + statsHeight : 0;
  const height =
    Math.max(leftPanelBottom, rightPanelBottom) + geometry.padding;
  const title = options.title ?? "LLM Token Activity";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.contentWidth}" height="${height}" viewBox="0 0 ${geometry.contentWidth} ${height}">
  <rect width="100%" height="100%" fill="${theme.background}" rx="8"/>
  <text x="${geometry.padding}" y="16" fill="${theme.text}" font-size="16" font-weight="600" font-family="system-ui, sans-serif">${escapeXml(title)}</text>
  ${badgeBlock.svg}
  ${monthMarks}
  ${cells}
  ${legend}
  ${statsSvg}
  ${barChart.svg}
</svg>`;
}

function renderPlatformBarChart(
  platforms: HeatmapStats["platforms"],
  theme: HeatmapTheme,
  startX: number,
  startY: number,
  chartWidth: number,
): { svg: string; height: number } {
  const titleHeight = 22;
  const rowHeight = 30;
  const labelWidth = 92;
  const valueWidth = 96;
  const barHeight = 10;
  const barAreaWidth = Math.max(160, chartWidth - labelWidth - valueWidth - 8);
  const maxTokens = platforms[0]?.tokens ?? 0;

  if (platforms.length === 0) {
    return {
      svg: `<text x="${startX}" y="${startY + 12}" fill="${theme.muted}" font-size="11" font-family="system-ui, sans-serif">No platform data</text>`,
      height: 20,
    };
  }

  let svg = `<text x="${startX}" y="${startY + 12}" fill="${theme.text}" font-size="12" font-weight="600" font-family="system-ui, sans-serif">Platform Usage</text>`;

  for (let index = 0; index < platforms.length; index += 1) {
    const entry = platforms[index]!;
    const rowY = startY + titleHeight + index * rowHeight;
    const color = platformColor(entry.platform);
    const barWidth =
      maxTokens > 0 && entry.tokens > 0
        ? Math.max(3, (entry.tokens / maxTokens) * barAreaWidth)
        : 0;
    const barX = startX + labelWidth;
    const barY = rowY + 6;
    const tooltip = `${entry.label}: ${formatNumber(entry.tokens)} (${entry.share.toFixed(1)}%)`;

    svg += `
  <text x="${startX}" y="${rowY + 14}" fill="${theme.text}" font-size="11" font-family="system-ui, sans-serif">${escapeXml(entry.label)}</text>
  <rect x="${barX}" y="${barY}" width="${barAreaWidth}" height="${barHeight}" rx="3" fill="${theme.border}"/>
  <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="3" fill="${color}"><title>${escapeXml(tooltip)}</title></rect>
  <text x="${barX + barAreaWidth + 8}" y="${rowY + 14}" fill="${theme.muted}" font-size="10" font-family="system-ui, sans-serif">${formatNumber(entry.tokens)} (${entry.share.toFixed(1)}%)</text>`;
  }

  return {
    svg,
    height: titleHeight + platforms.length * rowHeight + 8,
  };
}

function renderPlatformBadges(
  platforms: HeatmapStats["platforms"],
  theme: HeatmapTheme,
  startX: number,
  y: number,
  maxWidth: number,
): { svg: string; height: number } {
  if (platforms.length === 0) {
    return {
      svg: `<text x="${startX}" y="${y}" fill="${theme.muted}" font-size="11" font-family="system-ui, sans-serif">No platform data</text>`,
      height: 18,
    };
  }

  let x = startX;
  let rowY = y;
  let badges = "";
  const rowHeight = 22;

  for (const entry of platforms) {
    const label = entry.label;
    const pillWidth = label.length * 6.5 + 28;
    const color = platformColor(entry.platform);

    if (x + pillWidth > startX + maxWidth && x > startX) {
      x = startX;
      rowY += rowHeight;
    }

    badges += `<rect x="${x}" y="${rowY - 12}" width="${pillWidth}" height="18" rx="9" fill="${theme.border}"/>
    <circle cx="${x + 10}" cy="${rowY - 3}" r="4" fill="${color}"/>
    <text x="${x + 18}" y="${rowY + 1}" fill="${theme.text}" font-size="10" font-family="system-ui, sans-serif">${escapeXml(label)}</text>`;
    x += pillWidth + 8;
  }

  return {
    svg: badges,
    height: rowY - y + 12,
  };
}
