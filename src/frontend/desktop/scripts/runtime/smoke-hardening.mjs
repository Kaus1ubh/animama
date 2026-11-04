import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./common.mjs";

/**
 * The longest Windows profile root the packaged app accepts
 * (`MAX_WINDOWS_DATA_ROOT` in `src/main-process/runtime/paths.ts`); a test keeps
 * the two in step.
 */
export const MAX_WINDOWS_DATA_ROOT = 70;

/**
 * One launch per debugging switch the packaged guard refuses
 * (`src/main-process/security/debugging-switches.ts`), with and without a
 * value. A test keeps the two lists in step.
 */
export const debuggingLaunches = [
  "--remote-debugging-port=0",
  "--remote-debugging-port",
  "--remote-debugging-pipe",
  "--remote-debugging-pipe=cbor",
  "--inspect",
  "--inspect=0",
  "--inspect-brk",
  "--inspect-brk=0",
  "--inspect-wait",
  "--inspect-wait=0",
  "--inspect-port=0",
  "--inspect-port",
];

/** Poll `condition` until it holds or `timeoutMs` passes. */
export function eventually(condition, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) return true;
    if (Date.now() >= deadline) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
}

/**
 * A new private directory under `base` for the journey copy and its throwaway
 * profile. It must lie outside the checkout, which holds every directory the
 * publish step reads.
 */
export function smokeCopyDirectory(base, prefix) {
  const inside = path.relative(repoRoot, base);
  if (!inside.startsWith("..") && !path.isAbsolute(inside))
    throw new Error("The smoke copy must be made outside the checkout");
  return mkdtempSync(path.join(base, prefix));
}

/**
 * Chromium writes this file into the default profile when it opens a remote
 * debugging port, before any of the app's own start-up code runs.
 */
const CHROMIUM_DEBUGGING_FILES = new Set(["DevToolsActivePort"]);

/**
 * Whether a profile directory is absent or holds nothing the app wrote: no
 * session, log or runtime state.
 */
export function profileUnused(directory) {
  return (
    !existsSync(directory) ||
    readdirSync(directory).every((name) => CHROMIUM_DEBUGGING_FILES.has(name))
  );
}

/**
 * Launch the exact installed app with each debugging switch, with and without
 * a value. Each launch must exit with a nonzero code within `timeoutMs`, leave
 * the canonical profile absent or empty and, shortly after, no process from the
 * installed app.
 */
export function debuggingLaunchesRefused({
  executable,
  env,
  userData,
  noInstalledProcesses,
  spawn = spawnSync,
  timeoutMs = 30_000,
  settleMs = 10_000,
}) {
  return debuggingLaunches.every((flag) => {
    const result = spawn(executable, [flag], {
      env,
      stdio: "ignore",
      timeout: timeoutMs,
      windowsHide: true,
    });
    return (
      !result.error &&
      typeof result.status === "number" &&
      result.status !== 0 &&
      profileUnused(userData) &&
      eventually(noInstalledProcesses, settleMs)
    );
  });
}
