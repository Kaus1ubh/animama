type LogData = Record<string, unknown>;

type ErrorShape = {
  name?: string;
  message?: string;
  stack?: string;
  [key: string]: unknown;
};

function serializeError(error: unknown): ErrorShape | undefined {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "string") return { message: error };
  if (typeof error === "object") return { ...(error as ErrorShape) };
  return { message: String(error) };
}

function write(
  level: "debug" | "info" | "warn" | "error",
  logger: string,
  category: string,
  message: string,
  data?: LogData,
  error?: unknown,
) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    logger,
    category,
    message,
    ...(data ? { data } : {}),
    ...(error ? { error: serializeError(error) } : {}),
  };
  console[level](JSON.stringify(payload));
}

export function createLogger(logger: string) {
  return {
    debug(category: string, message: string, data?: LogData) {
      write("debug", logger, category, message, data);
    },
    info(category: string, message: string, data?: LogData) {
      write("info", logger, category, message, data);
    },
    warn(category: string, message: string, data?: LogData) {
      write("warn", logger, category, message, data);
    },
    error(category: string, message: string, error?: unknown) {
      write("error", logger, category, message, undefined, error);
    },
  };
}
