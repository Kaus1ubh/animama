import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { Hono } from "hono/tiny";

import type { TrustedGatewayAssertion } from "./gateway/headers.js";
import { proxyHttpRequest } from "./gateway/http-proxy.js";
import { createStaticSpaHandler } from "./gateway/static-spa.js";
import {
  createModelPackHandler,
  PARAKEET_MOUNT,
  type ModelPackMount,
} from "./gateway/model-pack.js";
import { createGatewayUpgradeHandler } from "./gateway/websocket-proxy.js";
import type { InstallationPrincipalProvider } from "./local-principal/provider.js";
import {
  loadInternalToken,
  type InternalTokenSource,
} from "./security/internal-token.js";
import {
  rejectByPolicy,
  validateHttpRequest,
  type LocalRequestPolicy,
} from "./security/request-policy.js";
import type { RendererCapabilityPolicy } from "./security/renderer-capability.js";
import { proxyTelemetry } from "./telemetry.js";

export type AccountlessGatewayConfig = {
  publicOrigin: URL;
  fastApiOrigin: URL;
  viteOrigin?: URL;
  staticRoot?: string;
  internalTokenSource: InternalTokenSource;
  principalProvider: InstallationPrincipalProvider;
  allowSameSiteFetches?: boolean;
  rendererCapability?: RendererCapabilityPolicy;
  /** Desktop has no collector; disable telemetry without mutating process env. */
  telemetryEnabled?: boolean;
  maxBodyBytes?: number;
  parakeetMount?: ModelPackMount;
};

export type AccountlessGatewayRuntime = {
  app: Hono;
  handleUpgrade: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;
  publicOrigin: URL;
};

function requireLocalHttpOrigin(value: URL, label: string): URL {
  if (
    (value.protocol !== "http:" && value.protocol !== "https:") ||
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash
  ) {
    throw new Error(
      `${label} must be an http(s) origin without credentials or a path`,
    );
  }
  return value;
}

function blockInternalSurface(app: Hono): void {
  for (const path of [
    "/docs",
    "/redoc",
    "/openapi.json",
    "/_desktop",
    "/api/auth",
  ] as const) {
    app.all(path, (c) => c.json({ error: "not_found" }, 404));
    app.all(`${path}/*`, (c) => c.json({ error: "not_found" }, 404));
  }
}

/**
 * Create the local-only Hono application after loading both trusted values.
 * The principal provider and token source are invoked once and never consulted
 * from request data.
 */
export async function createFrontendApp(
  config: AccountlessGatewayConfig,
): Promise<AccountlessGatewayRuntime> {
  if (
    config.maxBodyBytes !== undefined &&
    (!Number.isSafeInteger(config.maxBodyBytes) || config.maxBodyBytes < 1)
  )
    throw new Error("invalid gateway body limit");
  const publicOrigin = requireLocalHttpOrigin(
    config.publicOrigin,
    "public origin",
  );
  const fastApiOrigin = requireLocalHttpOrigin(
    config.fastApiOrigin,
    "private FastAPI origin",
  );
  const viteOrigin = config.viteOrigin
    ? requireLocalHttpOrigin(config.viteOrigin, "private Vite origin")
    : undefined;
  if (Boolean(viteOrigin) === Boolean(config.staticRoot)) {
    throw new Error(
      "configure exactly one private Vite origin or built SPA root",
    );
  }

  // Load the bounded file/value first so a configuration failure cannot leave
  // the retrying PostgreSQL provider alive in the background.
  const internalToken = await loadInternalToken(config.internalTokenSource);
  const principalId =
    await config.principalProvider.getInstallationPrincipalId();
  const assertion: TrustedGatewayAssertion = {
    principalId: principalId.trim(),
    internalToken,
  };
  if (!assertion.principalId) {
    throw new Error("installation principal is required for gateway readiness");
  }

  const requestPolicy: LocalRequestPolicy = {
    publicOrigin,
    allowSameSiteFetches: config.allowSameSiteFetches,
    rendererCapability: config.rendererCapability,
  };
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, service: "animama-local-gateway" }),
  );

  app.use("*", async (c, next) => {
    const failure = validateHttpRequest(c.req.raw, requestPolicy, {
      requireCsrf: new URL(c.req.url).pathname.startsWith("/v1"),
    });
    if (failure) return rejectByPolicy(c, failure);
    await next();
  });

  blockInternalSurface(app);
  app.post("/api/telemetry/:signal", (c) =>
    config.telemetryEnabled === false
      ? c.newResponse(null, 204)
      : proxyTelemetry(c),
  );

  const proxyFastApi = (c: Parameters<typeof proxyHttpRequest>[0]) =>
    proxyHttpRequest(c, {
      upstreamOrigin: fastApiOrigin,
      assertion,
      maxBodyBytes: config.maxBodyBytes,
    });
  app.all("/v1", proxyFastApi);
  app.all("/v1/*", proxyFastApi);

  if (config.parakeetMount)
    app.on(
      ["GET", "HEAD"],
      `${PARAKEET_MOUNT}*`,
      createModelPackHandler(config.parakeetMount),
    );

  if (viteOrigin) {
    app.all("*", (c) => proxyHttpRequest(c, { upstreamOrigin: viteOrigin }));
  } else {
    app.all("*", createStaticSpaHandler(config.staticRoot!));
  }

  return {
    app,
    handleUpgrade: createGatewayUpgradeHandler({
      fastApiOrigin,
      viteOrigin,
      requestPolicy,
      assertion,
    }),
    publicOrigin,
  };
}

// The standalone Compose launcher consumes the same factory as Electron.
export { createFrontendApp as createAccountlessGatewayApp };
