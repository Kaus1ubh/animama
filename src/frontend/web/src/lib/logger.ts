type LogData = Record<string, unknown>;

type LogOptions = {
  threadId?: string;
};

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

export function createLogger(prefix: string): Logger {
  const formattedPrefix = normalizePrefix(prefix);

  return {
    info(category, message, data) {
      console.info(format(formattedPrefix, category, message), data);
    },
    debug(category, message, data) {
      console.debug(format(formattedPrefix, category, message), data);
    },
    warn(category, message, data) {
      console.warn(format(formattedPrefix, category, message), data);
    },
    error(category, message, error) {
      console.error(format(formattedPrefix, category, message), error);
    },
  };
}
