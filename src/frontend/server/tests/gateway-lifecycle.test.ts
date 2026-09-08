import {
  createServer,
  request as httpRequest,
  type Server,
  type IncomingHttpHeaders,
} from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFrontendGateway,
  type FrontendGateway,
} from "../src/gateway/lifecycle.js";
import type { AccountlessGatewayConfig } from "../src/app.js";

describe("embedded gateway lifecycle", () => {
  let gateway: FrontendGateway;
  let upstream: Server;
  let root: string;
  let ready: AccountlessGatewayConfig;
  let captured: IncomingHttpHeaders[];
  let upstreamCancelled: boolean;
  const sockets = new Set<Socket>();
  const cookie = "animama_renderer_capability=renderer-fixture";

  beforeEach(async () => {
    captured = [];
    upstreamCancelled = false;
    root = await mkdtemp(path.join(tmpdir(), "animama-gateway-lifecycle-"));
    await writeFile(path.join(root, "index.html"), "<html>packaged app</html>");
    upstream = createServer((request, response) => {
      captured.push(request.headers);
      request.on("error", () => undefined);
      if (request.url === "/v1/stream") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("data: first\n\n");
        response.on("close", () => {
          upstreamCancelled = true;
        });
        return;
      }
      request.resume();
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        response.end('{"ok":true}');
      });
    });
    upstream.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    upstream.on("upgrade", (request, socket) => {
      captured.push(request.headers);
      const accept = createHash("sha1")
        .update(
          `${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
        )
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.once("end", () => socket.end());
      socket.resume();
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", resolve);
    });
    gateway = await createFrontendGateway({
      port: 0,
      rendererCapability: { value: "renderer-fixture" },
      bootstrapHtml: () => "<html>starting</html>",
    });
    ready = {
      publicOrigin: gateway.origin,
      fastApiOrigin: new URL(
        `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      ),
      staticRoot: root,
      internalTokenSource: { kind: "value", value: "a".repeat(64) },
      principalProvider: {
        async getInstallationPrincipalId() {
          return "durable-owner";
        },
      },
      rendererCapability: { value: "renderer-fixture" },
      telemetryEnabled: false,
      maxBodyBytes: 64,
    };
  });
  afterEach(async () => {
    await gateway?.drain(0);
    await gateway?.close();
    for (const socket of sockets) socket.destroy();
    if (upstream?.listening)
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    if (root) await rm(root, { recursive: true, force: true });
  });

  function request(
    route: string,
    extra: Record<string, string | undefined> = {},
    method = "GET",
    body?: string,
  ) {
    const headers: Record<string, string | undefined> = {
      host: gateway.origin.host,
      cookie,
      "sec-fetch-site": "same-origin",
      ...extra,
    };
    for (const name of Object.keys(headers))
      if (headers[name] === undefined) delete headers[name];
    return new Promise<{
      status: number;
      body: string;
      headers: IncomingHttpHeaders;
    }>((resolve, reject) => {
      const req = httpRequest(
        new URL(route, gateway.origin),
        { method, headers, agent: false },
        (response) => {
          let text = "";
          response.on("data", (chunk) => {
            text += chunk;
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              status: response.statusCode!,
              body: text,
              headers: response.headers,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  }

  it("promotes, drains, and reuses the same held listener and origin", async () => {
    expect((await request("/")).body).toContain("starting");
    expect((await request("/v1/runtime-context")).status).toBe(503);
    await expect(
      createFrontendGateway({
        port: Number(gateway.origin.port),
        rendererCapability: { value: "other" },
        bootstrapHtml: () => "",
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    const server = gateway.server;
    await gateway.promote(ready);
    expect(
      (await request("/a/example", { accept: "text/html" })).body,
    ).toContain("packaged app");
    await gateway.drain(0);
    expect((await request("/v1/echo")).status).toBe(503);
    for (const route of ["/a/example/c/chat", "/setup"]) {
      const response = await request(route, {
        accept: "text/html",
        "sec-fetch-mode": "navigate",
      });
      expect(response.status).toBe(200);
      expect(response.body).toContain("starting");
      expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect((await request("/a/example")).status).toBe(503);
    for (const route of [
      "/v1/echo",
      "/onnx/model",
      "/%6fnnx/model",
      "/content/private",
      "/assets/chunk.js",
    ]) {
      expect(
        (
          await request(route, {
            accept: "text/html",
            "sec-fetch-mode": "navigate",
          })
        ).status,
      ).toBe(503);
    }
    await gateway.promote(ready);
    expect(gateway.server).toBe(server);
    expect((await request("/v1/echo")).status).toBe(200);
    expect(
      (await request("/a/example/c/chat", { accept: "text/html" })).body,
    ).toContain("packaged app");
  });

  it("checks browser authority on health, bootstrap and API routes", async () => {
    for (const route of ["/", "/a/example/c/chat", "/health", "/v1/echo"]) {
      expect((await request(route, { host: "hostile.invalid" })).status).toBe(
        421,
      );
      expect(
        (await request(route, { origin: "https://hostile.invalid" })).status,
      ).toBe(403);
      expect(
        (await request(route, { origin: `${gateway.origin.origin}/path` }))
          .status,
      ).toBe(403);
      expect(
        (await request(route, { "sec-fetch-site": "cross-site" })).status,
      ).toBe(403);
      expect(
        (await request(route, { "sec-fetch-site": undefined })).status,
      ).toBe(403);
      expect((await request(route, { cookie: undefined })).status).toBe(401);
    }
    await gateway.promote(ready);
    expect(
      (
        await request(
          "/v1/write",
          { "sec-fetch-site": "none", "x-animama-csrf": "1" },
          "POST",
        )
      ).status,
    ).toBe(403);
    expect(
      (await request("/v1/write", { origin: gateway.origin.origin }, "POST"))
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          "/v1/write",
          { origin: gateway.origin.origin, "x-animama-csrf": "1" },
          "POST",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/api/telemetry/traces",
          { origin: gateway.origin.origin },
          "POST",
        )
      ).status,
    ).toBe(204);
  });

  it("never exposes internal readiness or masks missing model/content files", async () => {
    await gateway.promote(ready);
    for (const route of [
      "/_desktop/health",
      "/docs",
      "/api/missing",
      "/onnx/missing",
      "/tts/missing",
      "/content/private",
      "/effects/missing",
    ]) {
      expect(
        (await request(route, { accept: "text/html" })).status,
        route,
      ).toBe(404);
    }
    await request("/v1/echo", {
      authorization: "Bearer spoof",
      "x-animama-principal-id": "spoof",
      "x-animama-internal-token": "spoof",
    });
    expect(captured.at(-1)).toMatchObject({
      "x-animama-principal-id": "durable-owner",
      "x-animama-internal-token": "a".repeat(64),
    });
    expect(captured.at(-1)?.cookie).toBeUndefined();
    expect(captured.at(-1)?.authorization).toBeUndefined();
  });

  it.each(["GET", "HEAD"])(
    "serves packaged ONNX ES modules with browser-loadable MIME on %s",
    async (method) => {
      await mkdir(path.join(root, "onnx"));
      const source = "export const packaged = true;";
      await writeFile(path.join(root, "onnx/ort.min.mjs"), source);
      await gateway.promote(ready);
      const response = await request("/onnx/ort.min.mjs", {}, method);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe(
        "text/javascript; charset=utf-8",
      );
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.body).toBe(method === "GET" ? source : "");
    },
  );

  it("bounds both declared and chunked uploads", async () => {
    await gateway.promote(ready);
    const headers = { origin: gateway.origin.origin, "x-animama-csrf": "1" };
    expect(
      (
        await request(
          "/v1/write",
          { ...headers, "content-length": "65" },
          "POST",
          "x".repeat(65),
        )
      ).status,
    ).toBe(413);
    expect(captured).toHaveLength(0);
    expect(
      (
        await request(
          "/v1/write",
          { ...headers, "transfer-encoding": "chunked" },
          "POST",
          "x".repeat(65),
        )
      ).status,
    ).toBe(413);
  });

  it("forwards renderer cancellation through the embedded listener to SSE", async () => {
    await gateway.promote(ready);
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        new URL("/v1/stream", gateway.origin),
        { headers: { cookie, "sec-fetch-site": "same-origin" } },
        (response) => {
          expect(response.headers["content-type"]).toBe("text/event-stream");
          response.once("data", () => {
            response.destroy();
            resolve();
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
    await expect.poll(() => upstreamCancelled).toBe(true);
  });

  it("authenticates WebSocket upgrades and closes both peers during drain", async () => {
    await gateway.promote(ready);
    const socket = await new Promise<Socket>((resolve, reject) => {
      const req = httpRequest(new URL("/v1/logs", gateway.origin), {
        headers: {
          cookie,
          origin: gateway.origin.origin,
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-key": "YW5pbWFtYS10ZXN0LWtleQ==",
          "sec-websocket-version": "13",
        },
      });
      req.once("upgrade", (_response, socket) => resolve(socket));
      req.once("error", reject);
      req.end();
    });
    expect(captured.at(-1)?.["x-animama-principal-id"]).toBe("durable-owner");
    let closed = false;
    socket.once("close", () => {
      closed = true;
    });
    socket.resume();
    await gateway.drain(0);
    await expect.poll(() => closed && sockets.size === 0).toBe(true);
  });

  it("cannot promote after a drain or change the held authority", async () => {
    await expect(
      gateway.promote({
        ...ready,
        publicOrigin: new URL("http://127.0.0.1:1"),
      }),
    ).rejects.toThrow("promotion_rejected");
    let release!: (value: string) => void;
    const principal = new Promise<string>((resolve) => {
      release = resolve;
    });
    const pending = gateway.promote({
      ...ready,
      principalProvider: { getInstallationPrincipalId: () => principal },
    });
    await gateway.drain(0);
    release("durable-owner");
    await expect(pending).rejects.toThrow("promotion_cancelled");
    expect((await request("/v1/echo")).status).toBe(503);
  });
});
