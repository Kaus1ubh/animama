import type { AccountlessGatewayConfig } from "./app.js";
import { PostgresInstallationPrincipalProvider } from "./local-principal/postgres-provider.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`missing required local gateway setting: ${name}`);
  return value;
}

/** Resolve the Docker/self-host gateway composition without a hosted mode flag. */
export function loadDockerGatewayConfig(): AccountlessGatewayConfig {
  const publicOrigin = new URL(required("ANIMAMA_PUBLIC_ORIGIN"));
  const fastApiOrigin = new URL(
    process.env.ANIMAMA_PRIVATE_API_ORIGIN?.trim() ||
      "http://animama-server:8000",
  );
  const viteOriginValue = process.env.ANIMAMA_PRIVATE_VITE_ORIGIN?.trim();
  const staticRoot = process.env.ANIMAMA_SPA_DIST_ROOT?.trim();
  const injectedToken = process.env.ANIMAMA_INTERNAL_TOKEN?.trim();
  const tokenFile = process.env.ANIMAMA_INTERNAL_TOKEN_FILE?.trim();
  if (Boolean(injectedToken) === Boolean(tokenFile)) {
    throw new Error(
      "configure exactly one ANIMAMA_INTERNAL_TOKEN or ANIMAMA_INTERNAL_TOKEN_FILE",
    );
  }

  return {
    publicOrigin,
    fastApiOrigin,
    viteOrigin: viteOriginValue ? new URL(viteOriginValue) : undefined,
    staticRoot,
    internalTokenSource: injectedToken
      ? { kind: "value", value: injectedToken }
      : { kind: "file", path: tokenFile! },
    principalProvider: new PostgresInstallationPrincipalProvider({
      connectionString: required("WEB_DATABASE_URL"),
    }),
  };
}
