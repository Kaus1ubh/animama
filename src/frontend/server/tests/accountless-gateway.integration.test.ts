import { serve } from "@hono/node-server";
import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";

import { createAccountlessGatewayApp } from "../src/app.js";
import {
  installPreviewAssetCachePolicy,
  IMMUTABLE_APP_ASSET_CACHE,
} from "../src/gateway/app-asset-cache.js";

const PUBLIC_ORIGIN = "http://gateway.test";
const PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111";
const INTERNAL_TOKEN = "b".repeat(64);
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

type CapturedRequest = {
  chunks: string[];
  headers: IncomingHttpHeaders;
  method: string;
  url: string;
};

type GatewayResponse = {
  body: Buffer;
  chunks: Buffer[];
  headers: IncomingHttpHeaders;
  status: number;
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: Server | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

function requestGateway(
  port: number,
  path: string,
  options: {
    body?: string | Buffer;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): Promise<GatewayResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: { Host: "gateway.test", ...options.headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            chunks,
            headers: response.headers,
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

function streamUpload(port: number): Promise<GatewayResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: "/v1/upload",
        method: "POST",
        headers: {
          Host: "gateway.test",
          "Content-Type": "application/octet-stream",
          Origin: PUBLIC_ORIGIN,
          "Sec-Fetch-Site": "same-origin",
          "X-Animama-CSRF": "1",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            chunks,
            headers: response.headers,
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.on("error", reject);
    request.write("streamed-");
    setTimeout(() => request.end("upload"), 30);
  });
}

function websocketRoundTrip(
  port: number,
  path: string,
  options: { origin?: string; cookie?: string } = {},
): Promise<{ handshake: string; echoed: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let handshake = "";
    let upgraded = false;
    let echoed = "";
    socket.setTimeout(3_000, () =>
      socket.destroy(new Error("upgrade timed out")),
    );
    socket.on("error", reject);
    socket.on("connect", () => {
      const key = randomBytes(16).toString("base64");
      const headers = [
        `GET ${path} HTTP/1.1`,
        "Host: gateway.test",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        `Sec-WebSocket-Key: ${key}`,
        `Origin: ${options.origin ?? PUBLIC_ORIGIN}`,
        "Sec-Fetch-Site: same-origin",
        ...(options.cookie ? [`Cookie: ${options.cookie}`] : []),
        "",
        "",
      ];
      socket.write(headers.join("\r\n"));
    });
    socket.on("data", (chunk) => {
      if (!upgraded) {
        handshake += chunk.toString("utf8");
        const boundary = handshake.indexOf("\r\n\r\n");
        if (boundary < 0) return;
        if (!handshake.startsWith("HTTP/1.1 101")) {
          socket.end();
          resolve({ handshake, echoed: "" });
          return;
        }
        upgraded = true;
        const remainder = handshake.slice(boundary + 4);
        handshake = handshake.slice(0, boundary + 4);
        echoed += remainder;
        socket.write("ping");
        return;
      }
      echoed += chunk.toString("utf8");
      if (echoed.includes("ping")) {
        socket.end();
        resolve({ handshake, echoed });
      }
    });
  });
}

describe("accountless gateway transports and admission policy", () => {
  let upstream: Server | undefined;
  let gateway: Server | undefined;
  let gatewayPort = 0;
  let captured: CapturedRequest[];
  let upgradeHeaders: IncomingHttpHeaders[];
  let openSockets: Set<Duplex>;
  let cancelled: Promise<void>;
  let markCancelled: (() => void) | undefined;

  beforeEach(async () => {
    captured = [];
    upgradeHeaders = [];
    openSockets = new Set();
    cancelled = new Promise((resolve) => {
      markCancelled = resolve;
    });
    upstream = createServer((request, response) => {
      const chunks: string[] = [];
      const capture: CapturedRequest = {
        chunks,
        headers: request.headers,
        method: request.method ?? "GET",
        url: request.url ?? "/",
      };
      captured.push(capture);
      request.on("data", (chunk: Buffer) =>
        chunks.push(chunk.toString("utf8")),
      );

      if (request.url === "/assets/app-abcdefgh.js") {
        installPreviewAssetCachePolicy(
          request,
          response,
          new Set([request.url]),
        );
        const conditional = request.headers["if-none-match"] === '"build-hash"';
        response.writeHead(conditional ? 304 : 200, {
          "Content-Type": "text/javascript",
          ETag: '"build-hash"',
          "Cache-Control": "no-cache",
        });
        response.end(
          conditional || request.method === "HEAD"
            ? undefined
            : "export const app = true;",
        );
        return;
      }
      if (
        request.url === "/v1/runtime-manifest" ||
        request.url === "/v1/animas/anima/runtime/revisions/exact/json-bundle"
      ) {
        const bundle = request.url.endsWith("/json-bundle");
        const conditional =
          bundle && request.headers["if-none-match"] === '"encoded-body"';
        const body = gzipSync(
          JSON.stringify(
            bundle
              ? {
                  version: 1,
                  revision: "exact",
                  members: [{ file_ref: "json", text: "{}" }],
                }
              : {
                  lease_expires_at: "fresh",
                  effective_revision: "exact",
                  padding: "runtime".repeat(100),
                },
          ),
        );
        response.writeHead(conditional ? 304 : 200, {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          ...(!conditional ? { "Content-Length": String(body.length) } : {}),
          Vary: "Accept-Encoding",
          "Cache-Control": "private, no-cache",
          ETag: '"encoded-body"',
        });
        response.end(conditional ? undefined : body);
        return;
      }
      if (request.url?.startsWith("/v1/sse")) {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        response.write("data: first\n\n");
        setTimeout(() => response.end("data: second\n\n"), 30);
        return;
      }
      if (request.url?.startsWith("/v1/bytes")) {
        const bytes = Buffer.from("3456");
        response.writeHead(206, {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.length),
          "Content-Range": "bytes 3-6/10",
          "Accept-Ranges": "bytes",
          ETag: '"fixture-etag"',
          "Content-Disposition": 'attachment; filename="fixture.bin"',
        });
        response.end(bytes);
        return;
      }
      if (request.url?.startsWith("/v1/cancel")) {
        request.on("aborted", () => markCancelled?.());
        response.on("close", () => markCancelled?.());
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write("data: waiting\n\n");
        return;
      }
      request.on("end", () => {
        response.writeHead(200, {
          "Content-Type": request.url?.startsWith("/v1/")
            ? "application/json"
            : "text/html; charset=utf-8",
        });
        response.end(
          request.url?.startsWith("/v1/")
            ? JSON.stringify({
                ok: true,
                receivedBytes: chunks.join("").length,
              })
            : "<html><body>vite fixture</body></html>",
        );
      });
    });
    upstream.on("connection", (socket) => {
      openSockets.add(socket);
      socket.on("close", () => openSockets.delete(socket));
    });
    upstream.on("upgrade", (request, socket: Duplex, head) => {
      upgradeHeaders.push(request.headers);
      const key = String(request.headers["sec-websocket-key"] ?? "");
      const accept = createHash("sha1")
        .update(`${key}${WS_GUID}`)
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      if (head.length > 0) socket.write(head);
      socket.on("data", (chunk) => socket.write(chunk));
    });
    const upstreamPort = await listen(upstream);
    const runtime = await createAccountlessGatewayApp({
      publicOrigin: new URL(PUBLIC_ORIGIN),
      fastApiOrigin: new URL(`http://127.0.0.1:${upstreamPort}`),
      viteOrigin: new URL(`http://127.0.0.1:${upstreamPort}`),
      internalTokenSource: { kind: "value", value: INTERNAL_TOKEN },
      principalProvider: {
        getInstallationPrincipalId: async () => PRINCIPAL_ID,
      },
    });
    gateway = serve({
      fetch: runtime.app.fetch,
      hostname: "127.0.0.1",
      port: 0,
    }) as Server;
    gateway.on("connection", (socket) => {
      openSockets.add(socket);
      socket.on("close", () => openSockets.delete(socket));
    });
    gateway.on("upgrade", runtime.handleUpgrade);
    await new Promise<void>((resolve) => gateway!.once("listening", resolve));
    gatewayPort = (gateway.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const socket of openSockets) socket.destroy();
    await close(gateway);
    await close(upstream);
  });

  it("streams HTTP, SSE, ranged bytes, and uploads with trusted headers", async () => {
    const normal = await requestGateway(gatewayPort, "/v1/echo?value=1", {
      headers: {
        Authorization: "Bearer browser-token",
        Origin: PUBLIC_ORIGIN,
        "Sec-Fetch-Site": "same-origin",
        "X-Animama-Internal-Token": "spoofed",
        "X-Animama-Principal-Id": "spoofed",
      },
    });
    expect(normal.status).toBe(200);
    expect(JSON.parse(normal.body.toString("utf8"))).toEqual({
      ok: true,
      receivedBytes: 0,
    });
    expect(captured[0]?.headers["x-animama-principal-id"]).toBe(PRINCIPAL_ID);
    expect(captured[0]?.headers["x-animama-internal-token"]).toBe(
      INTERNAL_TOKEN,
    );
    expect(captured[0]?.headers.authorization).toBeUndefined();

    const sse = await requestGateway(gatewayPort, "/v1/sse", {
      headers: {
        Origin: PUBLIC_ORIGIN,
        "Sec-Fetch-Site": "same-origin",
        "Accept-Encoding": "gzip",
      },
    });
    expect(sse.status).toBe(200);
    expect(sse.headers["content-type"]).toBe("text/event-stream");
    expect(sse.headers["content-encoding"]).toBeUndefined();
    expect(sse.chunks.length).toBeGreaterThanOrEqual(2);
    expect(sse.body.toString("utf8")).toBe("data: first\n\ndata: second\n\n");

    const ranged = await requestGateway(gatewayPort, "/v1/bytes", {
      headers: {
        Origin: PUBLIC_ORIGIN,
        Range: "bytes=3-6",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.body.toString("utf8")).toBe("3456");
    expect(ranged.headers["content-range"]).toBe("bytes 3-6/10");
    expect(ranged.headers["accept-ranges"]).toBe("bytes");
    expect(ranged.headers.etag).toBe('"fixture-etag"');
    expect(ranged.headers["content-disposition"]).toContain("fixture.bin");

    const upload = await streamUpload(gatewayPort);
    expect(upload.status).toBe(200);
    expect(JSON.parse(upload.body.toString("utf8")).receivedBytes).toBe(15);
    expect(captured.at(-1)?.chunks.join("")).toBe("streamed-upload");
    expect(captured.at(-1)?.chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves preview cache headers and exact compressed manifest bytes", async () => {
    const js = await requestGateway(gatewayPort, "/assets/app-abcdefgh.js");
    expect(js.headers["cache-control"]).toBe(IMMUTABLE_APP_ASSET_CACHE);
    expect(js.body.toString()).toContain("export const app");
    const conditional = await requestGateway(
      gatewayPort,
      "/assets/app-abcdefgh.js",
      { headers: { "If-None-Match": '"build-hash"' } },
    );
    expect(conditional.status).toBe(304);
    expect(conditional.body.length).toBe(0);
    expect(conditional.headers["cache-control"]).toBe(
      IMMUTABLE_APP_ASSET_CACHE,
    );
    const head = await requestGateway(gatewayPort, "/assets/app-abcdefgh.js", {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    const manifest = await requestGateway(gatewayPort, "/v1/runtime-manifest", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(manifest.headers["content-encoding"]).toBe("gzip");
    expect(manifest.headers.vary).toBe("Accept-Encoding");
    expect(manifest.body.length).toBe(
      Number(manifest.headers["content-length"]),
    );
    expect(
      JSON.parse(gunzipSync(manifest.body).toString()).lease_expires_at,
    ).toBe("fresh");
    expect(manifest.headers["cache-control"]).toBe("private, no-cache");
    expect(manifest.headers.etag).toBe('"encoded-body"');
  });

  it("preserves bundle gzip bytes and authorized conditional responses", async () => {
    const path = "/v1/animas/anima/runtime/revisions/exact/json-bundle";
    const first = await requestGateway(gatewayPort, path, {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(first.status).toBe(200);
    expect(first.headers["content-encoding"]).toBe("gzip");
    expect(Number(first.headers["content-length"])).toBe(first.body.length);
    expect(JSON.parse(gunzipSync(first.body).toString()).members).toEqual([
      { file_ref: "json", text: "{}" },
    ]);
    const cached = await requestGateway(gatewayPort, path, {
      headers: {
        "Accept-Encoding": "gzip",
        "If-None-Match": first.headers.etag!,
      },
    });
    expect(cached.status).toBe(304);
    expect(cached.body.length).toBe(0);
    expect(cached.headers.etag).toBe(first.headers.etag);
    expect(cached.headers["cache-control"]).toBe("private, no-cache");
    expect(cached.headers.vary).toBe("Accept-Encoding");
    expect(captured.at(-1)?.headers["if-none-match"]).toBe(first.headers.etag);
    expect(captured.at(-1)?.headers["x-animama-principal-id"]).toBe(
      PRINCIPAL_ID,
    );
  });

  it("forwards cancellation to the upstream stream", async () => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: gatewayPort,
      path: "/v1/cancel",
      headers: {
        Host: "gateway.test",
        Origin: PUBLIC_ORIGIN,
        "Sec-Fetch-Site": "same-origin",
      },
    });
    request.on("response", (response) => {
      response.once("data", () => response.destroy());
    });
    request.end();

    await expect(
      Promise.race([
        cancelled,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("cancel was not forwarded")),
            2_000,
          ),
        ),
      ]),
    ).resolves.toBeUndefined();
  });

  it("tunnels FastAPI and Vite WebSocket upgrades without browser assertions", async () => {
    const product = await websocketRoundTrip(gatewayPort, "/v1/logs");
    expect(product.handshake).toContain("101 Switching Protocols");
    expect(product.echoed).toContain("ping");
    expect(upgradeHeaders[0]?.["x-animama-principal-id"]).toBe(PRINCIPAL_ID);
    expect(upgradeHeaders[0]?.["x-animama-internal-token"]).toBe(
      INTERNAL_TOKEN,
    );
    expect(upgradeHeaders[0]?.authorization).toBeUndefined();

    const hmr = await websocketRoundTrip(gatewayPort, "/?token=fixture");
    expect(hmr.handshake).toContain("101 Switching Protocols");
    expect(upgradeHeaders[1]?.["x-animama-principal-id"]).toBeUndefined();
    expect(upgradeHeaders[1]?.["x-animama-internal-token"]).toBeUndefined();
  });

  it("rejects hostile metadata and enforces CSRF while allowing safe omission", async () => {
    const safe = await requestGateway(gatewayPort, "/v1/echo");
    expect(safe.status).toBe(200);
    const forwardedBeforeRejections = captured.length;

    const hostileOrigin = await requestGateway(gatewayPort, "/v1/echo", {
      headers: {
        Origin: "https://hostile.example",
        "Sec-Fetch-Site": "cross-site",
      },
    });
    expect(hostileOrigin.status).toBe(403);
    expect(hostileOrigin.body.toString("utf8")).not.toContain(PRINCIPAL_ID);
    expect(hostileOrigin.body.toString("utf8")).not.toContain(INTERNAL_TOKEN);

    const wrongHost = await requestGateway(gatewayPort, "/v1/echo", {
      headers: { Host: "hostile.example" },
    });
    expect(wrongHost.status).toBe(421);

    const missingCsrf = await requestGateway(gatewayPort, "/v1/upload", {
      method: "POST",
      headers: {
        Origin: PUBLIC_ORIGIN,
        "Sec-Fetch-Site": "same-origin",
      },
    });
    expect(missingCsrf.status).toBe(403);

    const missingOrigin = await requestGateway(gatewayPort, "/v1/upload", {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        "X-Animama-CSRF": "1",
      },
    });
    expect(missingOrigin.status).toBe(403);
    expect(captured).toHaveLength(forwardedBeforeRejections);
    for (const rejected of [
      hostileOrigin,
      wrongHost,
      missingCsrf,
      missingOrigin,
    ]) {
      expect(rejected.body.toString("utf8")).not.toContain(PRINCIPAL_ID);
      expect(rejected.body.toString("utf8")).not.toContain(INTERNAL_TOKEN);
    }

    const tooling = await requestGateway(gatewayPort, "/v1/upload", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "none", "X-Animama-CSRF": "1" },
    });
    expect(tooling.status).toBe(200);
    expect(captured).toHaveLength(forwardedBeforeRejections + 1);

    const hostileUpgrade = await websocketRoundTrip(gatewayPort, "/v1/logs", {
      origin: "https://hostile.example",
    });
    expect(hostileUpgrade.handshake).toContain("403 Forbidden");
    expect(hostileUpgrade.echoed).toBe("");
    expect(upgradeHeaders).toHaveLength(0);
  });

  it("enforces the optional Electron renderer capability", async () => {
    const upstreamPort = (upstream!.address() as AddressInfo).port;
    const runtime = await createAccountlessGatewayApp({
      publicOrigin: new URL(PUBLIC_ORIGIN),
      fastApiOrigin: new URL(`http://127.0.0.1:${upstreamPort}`),
      viteOrigin: new URL(`http://127.0.0.1:${upstreamPort}`),
      internalTokenSource: { kind: "value", value: INTERNAL_TOKEN },
      principalProvider: {
        getInstallationPrincipalId: async () => PRINCIPAL_ID,
      },
      rendererCapability: { value: "renderer-secret" },
    });
    const headers = {
      Host: "gateway.test",
      Origin: PUBLIC_ORIGIN,
      "Sec-Fetch-Site": "same-origin",
    };
    const missing = await runtime.app.request(`${PUBLIC_ORIGIN}/v1/echo`, {
      headers,
    });
    expect(missing.status).toBe(401);

    const accepted = await runtime.app.request(`${PUBLIC_ORIGIN}/v1/echo`, {
      headers: {
        ...headers,
        Cookie: "animama_renderer_capability=renderer-secret",
      },
    });
    expect(accepted.status).toBe(200);
  });
});
