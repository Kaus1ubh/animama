import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";

import {
  buildWebSocketUpstreamHeaders,
  serializeWebSocketResponseHeaders,
  type TrustedGatewayAssertion,
} from "./headers.js";
import { buildUpstreamUrl } from "./upstream-url.js";
import {
  validateWebSocketRequest,
  type LocalRequestPolicy,
} from "../security/request-policy.js";

const FASTAPI_WEBSOCKET_PATHS = new Set(["/v1/logs"]);

export type GatewayUpgradeOptions = {
  fastApiOrigin: URL;
  viteOrigin?: URL;
  requestPolicy: LocalRequestPolicy;
  assertion: TrustedGatewayAssertion;
};

function rejectSocket(socket: Duplex, status: number): void {
  const phrase =
    status === 421
      ? "Misdirected Request"
      : status === 502
        ? "Bad Gateway"
        : "Forbidden";
  socket.end(
    `HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/** Build the single Node upgrade handler used by Docker and Electron Hono. */
export function createGatewayUpgradeHandler(
  options: GatewayUpgradeOptions,
): (request: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (request, socket, head) => {
    const failure = validateWebSocketRequest(request, options.requestPolicy);
    if (failure) {
      rejectSocket(socket, failure.status);
      return;
    }

    let incomingUrl: URL;
    try {
      incomingUrl = new URL(
        request.url ?? "/",
        options.requestPolicy.publicOrigin,
      );
    } catch {
      rejectSocket(socket, 403);
      return;
    }

    const isFastApi = incomingUrl.pathname.startsWith("/v1/");
    if (isFastApi && !FASTAPI_WEBSOCKET_PATHS.has(incomingUrl.pathname)) {
      rejectSocket(socket, 403);
      return;
    }
    const upstreamOrigin = isFastApi
      ? options.fastApiOrigin
      : options.viteOrigin;
    if (!upstreamOrigin) {
      rejectSocket(socket, 403);
      return;
    }

    const target = buildUpstreamUrl(incomingUrl, upstreamOrigin);
    const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
    const upstreamRequest = transport(target, {
      method: "GET",
      headers: buildWebSocketUpstreamHeaders(
        request.headers,
        isFastApi ? options.assertion : undefined,
      ),
    });

    let upgraded = false;
    upstreamRequest.on("upgrade", (response, upstreamSocket, upstreamHead) => {
      upgraded = true;
      socket.write(serializeWebSocketResponseHeaders(response));
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      if (head.length > 0) upstreamSocket.write(head);

      socket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.on("error", () => socket.destroy());
      socket.on("close", () => upstreamSocket.destroy());
      upstreamSocket.on("close", () => socket.destroy());
      socket.pipe(upstreamSocket);
      upstreamSocket.pipe(socket);
    });
    upstreamRequest.on("response", (response) => {
      response.resume();
      rejectSocket(socket, 403);
    });
    upstreamRequest.on("error", () => {
      if (!upgraded) rejectSocket(socket, 502);
      else socket.destroy();
    });
    socket.on("close", () => upstreamRequest.destroy());
    upstreamRequest.end();
  };
}
