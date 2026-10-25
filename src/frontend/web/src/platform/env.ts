type EnvValue = string | boolean | undefined;
type EnvRecord = Record<string, EnvValue>;

const metaEnv = ((import.meta as unknown as { env?: EnvRecord }).env ??
  {}) as EnvRecord;

function readString(key: string): string | null {
  const value = metaEnv[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBooleanFlag(key: string): boolean {
  const value = metaEnv[key];
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return value === "1" || value.toLowerCase() === "true";
}

/** Vite removes development-only imports behind this constant from builds. */
export const DEBUG_ENABLED =
  __ANIMAMA_DEV_BUILD__ &&
  import.meta.env.DEV &&
  (import.meta.env.VITE_ENABLE_DEBUG_PANEL === "true" ||
    import.meta.env.VITE_ENABLE_DEBUG_PANEL === "1");

export const env = {
  mode: readString("MODE") ?? "production",
  isDev: import.meta.env.DEV,
  baseUrl: readString("BASE_URL") ?? "/",
  appEnv: readString("VITE_APP_ENV") ?? "development",
  appVersion: __ANIMAMA_APP_VERSION__,
  disableWebuiTelemetry: readBooleanFlag("VITE_DISABLE_WEBUI_TELEMETRY"),
  disableWebuiTraces: readBooleanFlag("VITE_DISABLE_WEBUI_TRACES"),
  enableDebugPanel: DEBUG_ENABLED,
  /** Offers the Local model servers (Ollama, LM Studio, llama.cpp, vLLM). */
  enableLocalModels: readBooleanFlag("VITE_ENABLE_LOCAL_MODELS"),
} as const;
