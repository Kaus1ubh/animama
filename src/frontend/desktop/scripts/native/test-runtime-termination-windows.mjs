import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { cacheRoot, desktopRoot } from "../runtime/common.mjs";

/**
 * Force-kill unpackaged Electron at every startup stage and require that no
 * process from the staged runtime survives it, then that the next launch on
 * the same data starts cleanly. Run `pnpm desktop:build` and stage the Windows
 * runtime first.
 */
if (process.platform !== "win32")
  throw new Error("The runtime termination harness runs on Windows only");
const runtimeRoot = path.join(cacheRoot, "win32-x64", "runtime");
if (!existsSync(path.join(runtimeRoot, "manifest.json")))
  throw new Error("Stage the Windows runtime first");
if (!existsSync(path.join(desktopRoot, "dist", "main.js")))
  throw new Error("Run pnpm desktop:build first");

const electron = createRequire(import.meta.url)("electron");
const STAGES = [
  "validating",
  "vault",
  "application",
  "database",
  "migrations",
  "backend",
  "ready",
];
const LAUNCH_TIMEOUT_MS = 240_000;
const CLEANUP_TIMEOUT_MS = 30_000;

/** Processes whose executable lies inside the staged runtime. */
function runtimeProcesses() {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:ANIMAMA_RUNTIME_ROOT, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.Name }",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ANIMAMA_RUNTIME_ROOT: runtimeRoot + path.sep },
    },
  );
  if (result.status !== 0)
    throw new Error(`Process listing failed: ${result.stderr}`);
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

async function waitForNoRuntimeProcesses() {
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
  let remaining = runtimeProcesses();
  while (remaining.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    remaining = runtimeProcesses();
  }
  return remaining;
}

/** Launch Electron and resolve with its status line once `stage` is reached. */
function launchUntil(stage, userData) {
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const child = spawn(electron, [desktopRoot], {
    env: {
      ...env,
      ANIMAMA_DESKTOP_DEV_RUNTIME_ROOT: runtimeRoot,
      ANIMAMA_DESKTOP_DEV_USER_DATA: userData,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out before the ${stage} stage`));
    }, LAUNCH_TIMEOUT_MS);
    let pending = "";
    const onData = (chunk) => {
      pending += chunk;
      for (let newline; (newline = pending.indexOf("\n")) >= 0; ) {
        const line = pending.slice(0, newline).trimEnd();
        pending = pending.slice(newline + 1);
        const status = /Runtime status: (\S+)(?: (\S+))?/u.exec(line);
        if (!status) continue;
        process.stdout.write(`  ${status[0]}\n`);
        const [, state, detail] = status;
        if (state === "error") {
          clearTimeout(timer);
          child.kill();
          reject(new Error(`Startup failed with ${detail}`));
        } else if (
          (state === "starting" && detail === stage) ||
          (state === "ready" && stage === "ready")
        ) {
          clearTimeout(timer);
          resolve({ child, origin: state === "ready" ? detail : undefined });
        }
      }
    };
    child.stdout.setEncoding("utf8").on("data", onData);
    child.stderr.setEncoding("utf8").on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Electron exited with ${code} before ${stage}`));
    });
  });
}

async function killAt(stage, userData) {
  process.stdout.write(`Force-killing Electron at ${stage}\n`);
  const { child, origin } = await launchUntil(stage, userData);
  child.removeAllListeners("exit");
  let answered = true;
  try {
    // Ready already means the supervisor verified the backend's private health.
    // Outside the app, requests lack the renderer capability, so any non-5xx
    // answer shows that the listener serves.
    if (origin) answered = (await fetch(new URL("/", origin))).status < 500;
  } finally {
    // TerminateProcess on the main process alone: no tree kill, no cleanup code.
    child.kill("SIGKILL");
  }
  if (!answered) throw new Error(`The app at ${origin} failed to answer`);
  const remaining = await waitForNoRuntimeProcesses();
  if (remaining.length)
    throw new Error(
      `Runtime processes survived a kill at ${stage}: ${remaining.join(", ")}`,
    );
  return origin;
}

const leftovers = runtimeProcesses();
if (leftovers.length)
  throw new Error(`Runtime processes are already running: ${leftovers}`);
const userData = mkdtempSync(path.join(tmpdir(), "animama-term-"));
try {
  for (const stage of STAGES) await killAt(stage, userData);
  // The next launch on the same data must reach ready again, with the same
  // origin, after PostgreSQL recovers from the previous kill.
  const first = await killAt("ready", userData);
  const second = await killAt("ready", userData);
  if (!first || first !== second)
    throw new Error(`The origin changed across launches: ${first} ${second}`);
  process.stdout.write("runtime termination: OK\n");
} finally {
  // Electron's helper processes can hold profile files briefly after it dies.
  try {
    rmSync(userData, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 500,
    });
  } catch (error) {
    process.stderr.write(`Could not remove ${userData}: ${error.message}\n`);
  }
}
