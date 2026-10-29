type LogData = Record<string, unknown>;

type LogOptions = {
  threadId?: string;
};

type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  info: (
    category: string,
    message: string,
    data?: LogData,
    options?: LogOptions,
  ) => void;
  debug: (
    category: string,
    message: string,
    data?: LogData,
    options?: LogOptions,
  ) => void;
  warn: (
    category: string,
    message: string,
    data?: LogData,
    options?: LogOptions,
  ) => void;
  error: (
    category: string,
    message: string,
    error?: unknown,
    options?: LogOptions,
  ) => void;
  /**
   * An info line that also marks a lifecycle event, such as a chat turn or
   * voice session starting, for the diagnostics summary's recent activity.
   */
  milestone: (category: string, message: string, data?: LogData) => void;
}

/**
 * A recent warning or error kept for the diagnostics summary. It holds the
 * authored message and the error's type, never the call's data.
 */
export type RecentLogEntry = {
  time: number;
  level: "warn" | "error";
  source: string;
  category: string;
  message: string;
  errorName?: string;
};

/** A recent milestone kept for the diagnostics summary, without its data. */
export type RecentMilestone = {
  time: number;
  source: string;
  category: string;
  message: string;
};

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Development builds print every level. Production builds print only warnings
 * and errors, so streamed text and per-event detail stay out of users'
 * consoles; Settings → About → Copy diagnostics summary reports recent ones.
 */
const CONSOLE_LEVEL: LogLevel = import.meta.env.DEV ? "debug" : "warn";

const RECENT_LOG_LIMIT = 30;
const recentLogs: RecentLogEntry[] = [];
// Milestones have their own buffer so routine activity never pushes out problems.
const RECENT_MILESTONE_LIMIT = 50;
const milestones: RecentMilestone[] = [];

/** Recent warnings and errors logged in this window, oldest first. */
export function recentLogEntries(): readonly RecentLogEntry[] {
  return [...recentLogs];
}

/** Recent milestones logged in this window, oldest first. */
export function recentMilestones(): readonly RecentMilestone[] {
  return [...milestones];
}

function errorName(value: unknown): string | undefined {
  if (value instanceof Error) return value.name;
  if (value && typeof value === "object" && "error" in value) {
    const nested = (value as { error?: unknown }).error;
    if (nested instanceof Error) return nested.name;
  }
  return undefined;
}

function remember(
  level: RecentLogEntry["level"],
  source: string,
  category: string,
  message: string,
  detail: unknown,
): void {
  recentLogs.push({
    time: Date.now(),
    level,
    source,
    category,
    message,
    errorName: errorName(detail),
  });
  if (recentLogs.length > RECENT_LOG_LIMIT) recentLogs.shift();
}

function formatTimestamp(date = new Date()): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const milliseconds = date.getMilliseconds().toString().padStart(3, "0");
  return `${hours}:${minutes}:${seconds}:${milliseconds}`;
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function format(prefix: string, category: string, message: string): string {
  return `[${formatTimestamp()} - ${prefix}] ${category}: ${message}`;
}

/** Create a console logger for one source; see `CONSOLE_LEVEL`. */
export function createLogger(prefix: string): Logger {
  const formattedPrefix = normalizePrefix(prefix);
  const prints = (candidate: LogLevel) =>
    LOG_LEVEL_RANK[candidate] >= LOG_LEVEL_RANK[CONSOLE_LEVEL];

  return {
    info(category, message, data) {
      if (!prints("info")) return;
      console.info(format(formattedPrefix, category, message), data);
    },
    debug(category, message, data) {
      if (!prints("debug")) return;
      console.debug(format(formattedPrefix, category, message), data);
    },
    warn(category, message, data) {
      remember("warn", formattedPrefix, category, message, data);
      if (!prints("warn")) return;
      console.warn(format(formattedPrefix, category, message), data);
    },
    error(category, message, error) {
      remember("error", formattedPrefix, category, message, error);
      if (!prints("error")) return;
      console.error(format(formattedPrefix, category, message), error);
    },
    milestone(category, message, data) {
      milestones.push({
        time: Date.now(),
        source: formattedPrefix,
        category,
        message,
      });
      if (milestones.length > RECENT_MILESTONE_LIMIT) milestones.shift();
      if (!prints("info")) return;
      console.info(format(formattedPrefix, category, message), data);
    },
  };
}
