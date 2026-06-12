import { homedir } from "node:os";
import path from "node:path";

export function getCursorDbPath(): string {
  if (process.platform === "darwin") {
    return path.join(
      homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }

  if (process.platform === "win32") {
    return path.join(
      homedir(),
      "AppData",
      "Roaming",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }

  return path.join(
    homedir(),
    ".config",
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  );
}

export function getCursorCacheDir(): string {
  return path.join(homedir(), ".config", "token-board", "cursor-cache");
}
