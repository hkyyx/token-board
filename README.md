# Token Board

Track daily AI token usage across Cursor, Codex, Claude Code, OpenAI, Anthropic, and domestic agents — then publish a GitHub-style activity heatmap to your profile README.

## Features

- **Multi-platform collection**: local logs (Cursor, Codex, Claude Code) + API (OpenAI, Anthropic) + CSV import
- **GitHub-style heatmap**: configurable 7–365 day SVG with streaks and platform breakdown
- **Profile publishing**: render SVG + sanitized JSON for your `username/username` repo
- **GitHub Action**: daily automated updates

## Quick start (5 minutes)

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/token-board.git
cd token-board
npm install
npm run build

# Initialize config, data store, and workflow template
npx token-board init

# Detect available data sources
npx token-board detect

# Collect usage from local tools
npx token-board collect --days 30

# Optional: import domestic agent CSV
npx token-board import templates/domestic-agents.example.csv

# Generate heatmap SVG
npx token-board render

# Prepare publish artifacts
npx token-board publish
```

Embed in your GitHub profile README:

```markdown
## AI Token Activity

![Token Activity](https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/YOUR_GITHUB_USERNAME/main/assets/token-activity.svg)
```

## Supported platforms

| Platform | Source | Notes |
|---|---|---|
| Claude Code | Local | `~/.claude/projects/**/*.jsonl`, `stats-cache.json` |
| Codex CLI | Local | `~/.codex/sessions/**/*.jsonl` |
| Cursor IDE | Local | `state.vscdb` via `sqlite3` CLI (`cursorDiskKV` bubble rows) |
| OpenAI API | API | Organization usage API (`OPENAI_API_KEY`) |
| Anthropic | API | Admin usage report (`ANTHROPIC_ADMIN_KEY`) |
| Domestic agents | CSV | DeepSeek, Kimi, Qwen, etc. |

## Configuration

Config lives at `~/.config/token-board/config.yaml` (created by `token-board init`).

```yaml
timezone: Asia/Shanghai
dataPath: ./data/usage.json
outputPath: ./assets/token-activity.svg

github:
  owner: YOUR_GITHUB_USERNAME
  repo: YOUR_GITHUB_USERNAME
  branch: main
  svgPath: assets/token-activity.svg

platforms:
  cursor: { enabled: true }
  codex: { enabled: true }
  claude: { enabled: true }
  openai: { enabled: false }
  anthropic: { enabled: false }

publish:
  includeCost: false
  includeModels: false
```

## CSV import (domestic agents)

```csv
date,platform,input_tokens,output_tokens,cost_usd,model
2026-06-11,deepseek,12000,3400,0.05,deepseek-v3
```

```bash
token-board import usage.csv
```

See [`templates/domestic-agents.example.csv`](templates/domestic-agents.example.csv).

## GitHub Action

Copy the workflow from [`templates/github-action.yml`](templates/github-action.yml) to your profile repo:

```yaml
# .github/workflows/token-board.yml
on:
  schedule: [{ cron: "0 16 * * *" }]  # UTC 16:00
  workflow_dispatch:
```

### Secrets (optional)

| Secret | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI organization usage API |
| `ANTHROPIC_ADMIN_KEY` | Anthropic admin usage report (`sk-ant-admin-...`) |

For Cursor/Codex/Claude local data, run collection on a **self-hosted runner** or collect locally and push `data/usage.json`.

## CLI commands

| Command | Description |
|---|---|
| `token-board init` | Create config + workflow template |
| `token-board detect` | List detected platforms |
| `token-board collect [--days 30]` | Collect from enabled sources (7–365 days) |
| `token-board import <file.csv>` | Import CSV rows |
| `token-board render [--year 2026]` | Generate SVG heatmap |
| `token-board publish` | Render SVG + public JSON manifest |
| `token-board status` | Today / weekly summary |

## Privacy

By default, `publish` strips cost and model breakdown. Only aggregated daily token counts are written to `data/usage.public.json`.

## Development

Requires [sqlite3](https://sqlite.org/cli.html) on your PATH for Cursor local collection.

```bash
npm install
npm run build
node packages/cli/dist/index.js detect
```

## License

MIT
