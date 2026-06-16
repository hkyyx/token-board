import * as core from "@actions/core";
import { exec } from "@actions/exec";

async function run(): Promise<void> {
  const days = core.getInput("days") || "365";
  const configPath = core.getInput("config") || "";

  const configFlag = configPath ? `--config ${configPath}` : "";

  await exec("node", [
    "packages/cli/dist/index.js",
    "collect",
    "--days",
    days,
    ...(configFlag ? configFlag.split(" ") : []),
  ]);
  await exec("node", [
    "packages/cli/dist/index.js",
    "publish",
    "--days",
    days,
    ...(configFlag ? configFlag.split(" ") : []),
  ]);
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
