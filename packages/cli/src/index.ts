#!/usr/bin/env node

import { Command } from "commander";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as stringifyYaml } from "yaml";
import {
  DEFAULT_CONFIG_DIR,
  DEFAULT_CONFIG_PATH,
  aggregateByPlatform,
  defaultConfig,
  filterRecordsByDays,
  filterRecordsByYear,
  formatDateInTimezone,
  loadConfig,
  loadStore,
  parseDaysArg,
  parseSinceArg,
  sanitizeForPublish,
  saveStore,
  sinceDateFromDays,
  sumTokens,
  upsertRecords,
} from "@token-board/core";
import {
  getCollectors,
  parseUsageCsv,
  runCollectors,
} from "@token-board/collectors";
import { renderHeatmapSvg } from "@token-board/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

async function writeTemplate(relativePath: string, destination: string): Promise<void> {
  const source = path.join(repoRoot, "templates", relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

const program = new Command();

function getGlobalConfigPath(command: Command): string | undefined {
  return (command.parent?.opts() as { config?: string } | undefined)?.config;
}

function getGlobalDays(command: Command, config: Awaited<ReturnType<typeof loadConfig>>): number {
  const opts = command.parent?.opts() as { days?: string } | undefined;
  return parseDaysArg(opts?.days, config.days);
}

program
  .name("token-board")
  .description("Track AI token usage and publish GitHub-style activity heatmaps")
  .option("-c, --config <path>", "Path to config file")
  .option(
    "-d, --days <number>",
    "Number of days to collect and display (7-365)",
    "30",
  );

program
  .command("init")
  .description("Create config template and example workflow")
  .option("--cwd <path>", "Project directory", process.cwd())
  .action(async (options: { cwd: string }, command: Command) => {
    const globalOpts = getGlobalConfigPath(command);
    await mkdir(DEFAULT_CONFIG_DIR, { recursive: true });
    await mkdir(path.join(options.cwd, "data"), { recursive: true });
    await mkdir(path.join(options.cwd, "assets"), { recursive: true });

    const config = {
      ...defaultConfig(options.cwd),
      github: {
        owner: "YOUR_GITHUB_USERNAME",
        repo: "YOUR_GITHUB_USERNAME",
        branch: "main",
        svgPath: "assets/token-activity.svg",
      },
    };

    if (!globalOpts) {
      await writeFile(
        DEFAULT_CONFIG_PATH,
        stringifyYaml(config),
        "utf8",
      );
    }

    await writeFile(
      path.join(options.cwd, "data", "usage.json"),
      `${JSON.stringify({ version: 1, timezone: config.timezone, records: [] }, null, 2)}\n`,
      "utf8",
    );

    await writeTemplate(
      "github-action.yml",
      path.join(options.cwd, ".github", "workflows", "token-board.yml"),
    );
    await writeTemplate(
      "config.example.yaml",
      path.join(options.cwd, "config.example.yaml"),
    );

    console.log(`Created config at ${globalOpts ?? DEFAULT_CONFIG_PATH}`);
    console.log(`Created data store at ${path.join(options.cwd, "data", "usage.json")}`);
    console.log("Next: run `token-board collect` then `token-board render`");
  });

program
  .command("detect")
  .description("List detected platform data sources")
  .action(async (_options, command: Command) => {
    const config = await loadConfig(getGlobalConfigPath(command));
    const collectors = getCollectors(config);

    for (const collector of collectors) {
      const detected = await collector.detect().catch(() => false);
      console.log(`${detected ? "✓" : "✗"} ${collector.name} (${collector.id})`);
    }
  });

program
  .command("collect")
  .description("Collect usage from enabled platforms")
  .option("--since <duration>", "Deprecated: use --days instead (e.g. 30d)")
  .action(async (options: { since?: string }, command: Command) => {
    const config = await loadConfig(getGlobalConfigPath(command));
    let days = getGlobalDays(command, config);
    if (options.since) {
      const since = parseSinceArg(options.since);
      days = parseDaysArg(
        Math.ceil((Date.now() - since.getTime()) / 86_400_000),
      );
    }
    const since = sinceDateFromDays(days, config.timezone);
    const collectors = getCollectors(config);
    const results = await runCollectors(collectors, {
      timezone: config.timezone,
      since,
    });

    const incoming = results.flatMap((result) => result.records);
    const store = await loadStore(config.dataPath);
    store.timezone = config.timezone;
    const updated = upsertRecords(store, incoming);
    await saveStore(config.dataPath, updated);

    for (const result of results) {
      const status = result.error
        ? `error: ${result.error}`
        : `${result.records.length} records`;
      console.log(
        `${result.detected ? "✓" : "✗"} ${result.collector.name}: ${status}`,
      );
    }

    console.log(`Saved ${updated.records.length} total records to ${config.dataPath}`);
  });

program
  .command("import")
  .description("Import usage rows from CSV")
  .argument("<file>", "CSV file path")
  .action(async (file: string, _options, command: Command) => {
    const config = await loadConfig(getGlobalConfigPath(command));
    const content = await readFile(path.resolve(file), "utf8");
    const records = parseUsageCsv(content);
    const store = await loadStore(config.dataPath);
    const updated = upsertRecords(store, records);
    await saveStore(config.dataPath, updated);
    console.log(`Imported ${records.length} records from ${file}`);
  });

program
  .command("render")
  .description("Generate SVG heatmap")
  .option("--year <year>", "Filter to a specific year")
  .option("-o, --output <path>", "Output SVG path")
  .action(async (options: { year?: string; output?: string }, command: Command) => {
    const config = await loadConfig(getGlobalConfigPath(command));
    const days = getGlobalDays(command, config);
    const store = await loadStore(config.dataPath);
    const baseRecords = options.year
      ? filterRecordsByYear(store.records, Number(options.year))
      : filterRecordsByDays(store.records, days, store.timezone);
    const svg = renderHeatmapSvg(baseRecords, {
      timezone: store.timezone,
      year: options.year ? Number(options.year) : undefined,
      days: options.year ? 365 : days,
    });

    const outputPath = options.output ?? config.outputPath;
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, svg, "utf8");
    console.log(`Wrote ${outputPath}`);
  });

program
  .command("status")
  .description("Show today and weekly usage summary")
  .action(async (_options, command: Command) => {
    const config = await loadConfig(getGlobalConfigPath(command));
    const store = await loadStore(config.dataPath);
    const today = formatDateInTimezone(new Date(), store.timezone);
    const weekStart = formatDateInTimezone(
      new Date(Date.now() - 6 * 86_400_000),
      store.timezone,
    );

    const todayRecords = store.records.filter((record) => record.date === today);
    const weekRecords = store.records.filter((record) => record.date >= weekStart);
    const platformTotals = aggregateByPlatform(weekRecords);

    console.log(`Today (${today}): ${formatNumber(sumTokens(todayRecords))} tokens`);
    console.log(`Last 7 days: ${formatNumber(sumTokens(weekRecords))} tokens`);
    console.log("Platforms this week:");
    for (const [platform, tokens] of [...platformTotals.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${platform}: ${formatNumber(tokens)}`);
    }
  });

program
  .command("publish")
  .description("Render and prepare files for GitHub profile repo")
  .option("--dry-run", "Only render files without writing publish manifest")
  .action(async (options: { dryRun?: boolean }, command: Command) => {
    const config = await loadConfig(getGlobalConfigPath(command));
    const days = getGlobalDays(command, config);
    const store = await loadStore(config.dataPath);
    const windowRecords = filterRecordsByDays(
      store.records,
      days,
      store.timezone,
    );
    const publicRecords = sanitizeForPublish(windowRecords, config.publish);
    const svg = renderHeatmapSvg(publicRecords, {
      timezone: store.timezone,
      days,
    });

    const svgPath = config.github?.svgPath ?? config.outputPath;
    const publishDir = path.dirname(config.dataPath);

    await mkdir(path.dirname(svgPath), { recursive: true });
    await writeFile(svgPath, svg, "utf8");
    await saveStore(path.join(publishDir, "usage.public.json"), {
      version: 1,
      timezone: store.timezone,
      records: publicRecords,
    });

    const manifest = {
      generatedAt: new Date().toISOString(),
      svgPath,
      dataPath: config.dataPath,
      github: config.github,
    };

    const manifestPath = path.join(publishDir, "publish-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    if (options.dryRun) {
      console.log("Dry run complete.");
    }

    console.log(`Rendered ${svgPath}`);
    console.log(`Wrote ${manifestPath}`);
    if (config.github) {
      console.log(
        `Embed in README:\n![Token Activity](https://raw.githubusercontent.com/${config.github.owner}/${config.github.repo}/${config.github.branch}/${svgPath})`,
      );
    }
  });

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
