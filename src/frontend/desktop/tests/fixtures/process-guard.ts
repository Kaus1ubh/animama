import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The staged Windows runtime, when this checkout has one. */
export const stagedWindowsRuntime = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.desktop-runtime/win32-x64/runtime",
);

/** Every owned process on Windows runs through the staged process guard. */
export const stagedProcessGuard = path.join(
  stagedWindowsRuntime,
  "bin/animama-process-guard.exe",
);

/** Real child processes can launch on any other host, or with a staged guard. */
export const ownedProcessesLaunchable =
  process.platform !== "win32" || existsSync(stagedProcessGuard);
