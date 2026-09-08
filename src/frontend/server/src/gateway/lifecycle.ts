import { getRequestListener } from "@hono/node-server";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import {
  createFrontendApp,
  type AccountlessGatewayConfig,
  type AccountlessGatewayRuntime,
} from "../app.js";
import { validateHttpRequest } from "../security/request-policy.js";
import type { RendererCapabilityPolicy } from "../security/renderer-capability.js";
import { isSpaNavigation } from "./static-spa.js";

export type GatewayBootstrapConfig = {
  port: number;
  rendererCapability: RendererCapabilityPolicy;
  bootstrapHtml: () => string;
};

export type FrontendGateway = {
  origin: URL;
  server: Server;
  promote(config: AccountlessGatewayConfig): Promise<void>;
  setBootstrapState(): void;
  drain(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
};

/** Bind one stable listener before starting any private service. */
export async function createFrontendGateway(
  config: GatewayBootstrapConfig,
): Promise<FrontendGateway> {
  let runtime: AccountlessGatewayRuntime | undefined;
  let origin = new URL("http://127.0.0.1");
  let closing = false;
  let promoting = false;
  let generation = 0;
  let closeTask: Promise<void> | undefined;
  const sockets = new Set<Socket>();
  const responses = new Set<ServerResponse>();
  const handler = getRequestListener(
    async (request) => {
      const pathname = new URL(request.url).pathname;
      const failure = validateHttpRequest(
        request,
        { publicOrigin: origin, rendererCapability: config.rendererCapability },
        { requireCsrf: pathname === "/v1" || pathname.startsWith("/v1/") },
      );
      if (failure)
        return Response.json(
          { error: "gateway_request_rejected" },
          { status: failure.status },
        );
      if (closing) return new Response(null, { status: 503 });
      if (runtime) return runtime.app.fetch(request);
      let documentPath: string;
      try {
        documentPath = decodeURIComponent(pathname);
      } catch {
        return Response.json({ error: "invalid_path" }, { status: 400 });
      }
      if (
        request.method === "GET" &&
        (pathname === "/" ||
          pathname === "/_bootstrap" ||
          isSpaNavigation(documentPath, request.headers))
      ) {
        // Pack transitions reload the current chat route to dispose workers.
        // Its bootstrap document must receive readiness and reload back to React.
        return new Response(config.bootstrapHtml(), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }
      return Response.json({ error: "runtime_starting" }, { status: 503 });
    },
    {
      overrideGlobalObjects: false,
      errorHandler: () => new Response(null, { status: 500 }),
    },
  );
  const server = createServer((request, response) => {
    responses.add(response);
    response.once("close", () => responses.delete(response));
    void handler(request, response);
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket, head) => {
    if (closing || !runtime) {
      socket.destroy();
      return;
    }
    runtime.handleUpgrade(request, socket, head);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("gateway_bind_failed"));
        return;
      }
      origin = new URL(`http://127.0.0.1:${address.port}`);
      resolve();
    });
  });
  const drain = async (timeoutMs = 5000) => {
    generation++;
    runtime = undefined;
    const drainingSockets = [...sockets];
    const deadline = Date.now() + timeoutMs;
    while (responses.size && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    // Retain the listener and origin; abort remaining HTTP streams/upgrades.
    await Promise.all(
      drainingSockets.map(
        (socket) =>
          new Promise<void>((resolve) => {
            if (socket.closed) {
              resolve();
              return;
            }
            socket.once("close", () => resolve());
            socket.destroy();
          }),
      ),
    );
  };
  return {
    origin,
    server,
    async promote(ready) {
      if (
        closing ||
        runtime ||
        promoting ||
        ready.publicOrigin.origin !== origin.origin ||
        ready.rendererCapability?.value !== config.rendererCapability.value ||
        ready.viteOrigin
      )
        throw new Error("gateway_promotion_rejected");
      promoting = true;
      const started = generation;
      try {
        const next = await createFrontendApp(ready);
        if (closing || started !== generation)
          throw new Error("gateway_promotion_cancelled");
        runtime = next;
      } finally {
        promoting = false;
      }
    },
    setBootstrapState() {
      generation++;
      runtime = undefined;
    },
    drain,
    async close() {
      if (closeTask) return closeTask;
      closing = true;
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      closeTask = (async () => {
        await drain();
        await closed;
      })();
      return closeTask;
    },
  };
}
