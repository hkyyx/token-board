import * as core from "@actions/core";
import { exec } from "@actions/exec";

async function run(): Promise<void> {
  const since = core.getInput("since") || "365d";
  const configPath = core.getInput("config") || "";

  const configFlag = configPath ? `--config ${configPath}` : "";

  await exec("npx", ["token-board", "collect", "--since", since, ...(configFlag ? configFlag.split(" ") : [])]);
  await exec("npx", ["token-board", "publish", ...(configFlag ? configFlag.split(" ") : [])]);
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
