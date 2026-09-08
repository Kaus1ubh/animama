import { isIP } from "node:net";

/** Return whether a native listener address is explicitly loopback-only. */
export function isLoopbackBindHost(host: string): boolean {
  let normalized = host.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }
  const family = isIP(normalized);
  if (family === 4) return normalized.startsWith("127.");
  return family === 6 && normalized === "::1";
}

/** Resolve the supported native Hono binding and reject direct publication. */
export function resolveNativeGatewayBindHost(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const host = environment.ANIMAMA_LOCAL_BIND_HOST?.trim() || "127.0.0.1";
  if (!isLoopbackBindHost(host)) {
    throw new Error(
      "ANIMAMA_LOCAL_BIND_HOST must stay on loopback; use the private Compose gateway behind an operator-owned boundary for remote access",
    );
  }
  return host;
}
