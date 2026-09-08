import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable, Transform } from "node:stream";

import type { Context } from "hono";

import {
  buildHttpResponseHeaders,
  buildHttpUpstreamHeaders,
  type TrustedGatewayAssertion,
} from "./headers.js";
import { buildUpstreamUrl } from "./upstream-url.js";

type HttpProxyOptions = {
  upstreamOrigin: URL;
  assertion?: TrustedGatewayAssertion;
  maxBodyBytes?: number;
};

function responseCanHaveBody(method: string, status: number): boolean {
  return (
    method.toUpperCase() !== "HEAD" &&
    status !== 204 &&
    status !== 205 &&
    status !== 304
  );
}

/** Stream one Fetch request through Node HTTP without buffering either side. */
export async function proxyHttpRequest(
  c: Context,
  options: HttpProxyOptions,
): Promise<Response> {
  const incoming = c.req.raw;
  const incomingUrl = new URL(incoming.url);
  const target = buildUpstreamUrl(incomingUrl, options.upstreamOrigin);
  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  const limit = options.maxBodyBytes ?? 128 * 1024 * 1024;
  if (Number(incoming.headers.get("content-length")) > limit) {
    return c.json({ error: "request_too_large" }, 413);
  }

  return await new Promise<Response>((resolve) => {
    let settled = false;
    let responseStream: import("node:http").IncomingMessage | undefined;
    const upstreamRequest = transport(
      target,
      {
        method: incoming.method,
        headers: buildHttpUpstreamHeaders(incoming, options.assertion),
      },
      (upstreamResponse) => {
        responseStream = upstreamResponse;
        settled = true;
        const status = upstreamResponse.statusCode ?? 502;
        const body = responseCanHaveBody(incoming.method, status)
          ? (Readable.toWeb(upstreamResponse) as ReadableStream<Uint8Array>)
          : null;
        resolve(
          new Response(body, {
            status,
            headers: buildHttpResponseHeaders(upstreamResponse),
          }),
        );
      },
    );

    const abort = () => {
      responseStream?.destroy();
      upstreamRequest.destroy();
    };
    if (incoming.signal.aborted) {
      abort();
    } else {
      incoming.signal.addEventListener("abort", abort, { once: true });
    }

    upstreamRequest.on("error", () => {
      incoming.signal.removeEventListener("abort", abort);
      if (!settled) {
        settled = true;
        resolve(c.json({ error: "gateway_upstream_unavailable" }, 502));
      }
    });
    upstreamRequest.on("close", () => {
      incoming.signal.removeEventListener("abort", abort);
    });

    if (incoming.body) {
      const requestBody = Readable.fromWeb(incoming.body as never);
      let bytes = 0;
      const bounded = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > limit) {
            if (!settled) {
              settled = true;
              resolve(c.json({ error: "request_too_large" }, 413));
            }
            callback(new Error("request_too_large"));
            return;
          }
          callback(null, chunk);
        },
      });
      bounded.on("error", () => {
        requestBody.destroy();
        abort();
      });
      requestBody.on("error", () => upstreamRequest.destroy());
      requestBody.pipe(bounded).pipe(upstreamRequest);
    } else {
      upstreamRequest.end();
    }
  });
}
