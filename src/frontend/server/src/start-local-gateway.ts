import { serve } from "@hono/node-server";

import { createAccountlessGatewayApp } from "./app.js";
import { loadDockerGatewayConfig } from "./local-config.js";
import { createLogger } from "./logger.js";

const logger = createLogger("LocalGateway");

/** Start the fixed accountless gateway composition on an already-vetted bind. */
export async function startLocalGateway(hostname: string): Promise<void> {
  try {
    const port = Number(process.env.PORT ?? 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("PORT must be an integer from 1 to 65535");
    }
    const runtime = await createAccountlessGatewayApp(
      loadDockerGatewayConfig(),
    );
    const server = serve(
      {
        fetch: runtime.app.fetch,
        port,
        hostname,
      },
      (info) => {
        logger.info("Start", "Animama local gateway listening", {
          address: info.address,
          port: info.port,
        });
      },
    );
    server.on("upgrade", runtime.handleUpgrade);
  } catch (error: unknown) {
    // Startup errors may contain database or filesystem details, so log only a
    // stable category and error type before exiting.
    logger.error(
      "Start",
      "Animama local gateway failed readiness",
      error instanceof Error ? { name: error.name } : undefined,
    );
    process.exitCode = 1;
  }
}
