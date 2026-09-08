import type { App } from "electron";
import { appendFileSync, closeSync, constants, openSync } from "node:fs";
import { join } from "node:path";
import { runtimeRedactor } from "./runtime/redaction.js";
import { privateDirectory } from "./runtime/atomic-file.js";

type LogLevel = "info" | "error";

let logFilePath: string | undefined;

export function writeLog(level: LogLevel, message: string): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${runtimeRedactor.redact(message)}`;

  if (level === "error") {
    console.error(line);
  } else {
    console.info(line);
  }

  if (!logFilePath) return;

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
      appendFileSync(descriptor, `${line}\n`, "utf8");
    } finally {
      closeSync(descriptor);
    }
  } catch {
    console.error("Animama log write failed");
  }
}

export function initializeLogging(app: App): void {
  try {
    const logsDir = join(app.getPath("userData"), "runtime", "logs");
    privateDirectory(logsDir);
    app.setAppLogsPath(logsDir);
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
