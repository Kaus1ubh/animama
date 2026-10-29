import type { App } from "electron";
import {
  appendFileSync,
  closeSync,
  constants,
  lstatSync,
  openSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { runtimeRedactor } from "./runtime/redaction.js";
import { privateDirectory } from "./runtime/atomic-file.js";

type LogLevel = "info" | "error";

type LogLimits = {
  /** Rotate before main.log would grow past this many bytes. */
  maxBytes: number;
  /** Older files kept as main.log.1 (newest) to main.log.N. */
  backups: number;
};

const DEFAULT_LOG_LIMITS: LogLimits = {
  maxBytes: 10 * 1024 * 1024,
  backups: 3,
};

let logFilePath: string | undefined;
let logLimits = DEFAULT_LOG_LIMITS;

function currentSize(path: string): number {
  try {
    return lstatSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Shift main.log to main.log.1, main.log.1 to .2 and so on, dropping the
 * oldest. main.log moves aside first: when another process holds it (common on
 * Windows), rotation stops before any backup is touched.
 */
function rotate(path: string, backups: number): void {
  const rotating = `${path}.rotating`;
  renameSync(path, rotating);
  rmSync(`${path}.${backups}`, { force: true });
  for (let index = backups - 1; index >= 1; index -= 1) {
    try {
      renameSync(`${path}.${index}`, `${path}.${index + 1}`);
    } catch {
      // A missing backup leaves a gap that later rotations fill.
    }
  }
  renameSync(rotating, `${path}.1`);
}

export function writeLog(level: LogLevel, message: string): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${runtimeRedactor.redact(message)}`;

  if (level === "error") {
    console.error(line);
  } else {
    console.info(line);
  }

  if (!logFilePath) return;

  const entry = `${line}\n`;
  const size = currentSize(logFilePath);
  if (size > 0 && size + Buffer.byteLength(entry) > logLimits.maxBytes) {
    try {
      rotate(logFilePath, logLimits.backups);
    } catch {
      // Keep appending to the current file rather than losing the line.
      console.error("Animama log rotation failed");
    }
  }

  try {
    const descriptor = openSync(
      logFilePath,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      appendFileSync(descriptor, entry, "utf8");
    } finally {
      closeSync(descriptor);
    }
  } catch {
    console.error("Animama log write failed");
  }
}

/**
 * Write main and sidecar output to `<userData>/runtime/logs/main.log`, rotated
 * by size. `limits` exists for tests; the app uses the defaults.
 */
export function initializeLogging(
  app: App,
  limits: LogLimits = DEFAULT_LOG_LIMITS,
): void {
  try {
    const logsDir = join(app.getPath("userData"), "runtime", "logs");
    privateDirectory(logsDir);
    app.setAppLogsPath(logsDir);
    logLimits = limits;
    logFilePath = join(logsDir, "main.log");
    writeLog("info", `Animama Desktop starting; log=${logFilePath}`);
    writeLog(
      "info",
      `Runtime DISPLAY=${process.env.DISPLAY || ""} WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY || ""} XDG_SESSION_TYPE=${process.env.XDG_SESSION_TYPE || ""}`,
    );
  } catch {
    console.error("Animama logging unavailable");
  }
}

export function installProcessErrorLogging(): void {
  process.on("uncaughtException", (error) => {
    writeLog("error", `Uncaught exception: ${error.stack || error.message}`);
  });

  process.on("unhandledRejection", (reason) => {
    const message =
      reason instanceof Error ? reason.stack || reason.message : String(reason);
    writeLog("error", `Unhandled rejection: ${message}`);
  });
}
