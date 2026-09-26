import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import viteConfig from "../vite.config";
import {
  localParakeetModelPlugin,
  resolveLocalParakeetModelDir,
  resolveLocalParakeetWebgpuModelDir,
} from "../vite-plugins/local-parakeet-models";
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
const roots: string[] = [];
const servers: Server[] = [];
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "animama-model-serving-"));
  roots.push(root);
  writeFileSync(path.join(root, "encoder.int8.onnx"), "0123456789");
  writeFileSync(path.join(root, "config.json"), '{"test":true}');
  return root;
}
async function listen(modelDir: string | null = fixture()): Promise<string> {
  const plugin = localParakeetModelPlugin({
    modelDir,
    routeBaseUrl: "/__client-parakeet-models",
  });
  let middleware: (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => void;
  if (typeof plugin.configureServer !== "function")
    throw new Error("Expected server hook");
  await plugin.configureServer.call(
    {} as never,
    {
      middlewares: {
        use(handler: typeof middleware) {
          middleware = handler;
        },
      },
    } as never,
  );
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected TCP address");
  return `http://127.0.0.1:${address.port}/__client-parakeet-models`;
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (!server.listening) continue;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("shared Parakeet model delivery", () => {
  it("resolves host models through the offline helper at server startup", () => {
    vi.stubEnv("VITE_CLIENT_PARAKEET_MODEL_DIR", "");
    vi.mocked(execFileSync).mockReturnValue("/shared/verified/model\n");
    expect(resolveLocalParakeetModelDir()).toBe("/shared/verified/model");
    expect(execFileSync).toHaveBeenCalledWith(
      "python3",
      [expect.stringMatching(/scripts\/models\/parakeet\.py$/), "path"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });
  it("accepts the read-only Compose mount without requiring Python in Node", () => {
    const root = fixture();
    vi.stubEnv("VITE_CLIENT_PARAKEET_MODEL_DIR", root);
    expect(resolveLocalParakeetModelDir()).toBe(root);
    expect(execFileSync).not.toHaveBeenCalled();
  });
  it("fails missing setup instead of falling back to removed tracked weights", () => {
    vi.stubEnv("VITE_CLIENT_PARAKEET_MODEL_DIR", "");
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("Run parakeet.py acquire");
    });
    expect(resolveLocalParakeetModelDir).toThrow("Run parakeet.py acquire");
  });
  it.each(["production", "embedded-desktop"])(
    "%s builds need no model setup",
    async (mode) => {
      vi.stubEnv("ANIMAMA_MODEL_ROOT", "/missing/model-store");
      const config =
        typeof viteConfig === "function"
          ? await viteConfig({ command: "build", mode })
          : viteConfig;
      expect(execFileSync).not.toHaveBeenCalled();
      // Built apps probe the optional encoder: desktop serves its active pack,
      // self-host an operator-provided mount; an absent encoder is a 404.
      expect(config.define?.__CLIENT_PARAKEET_WEBGPU_MODEL_BASE_URL__).toBe(
        JSON.stringify(
          mode === "embedded-desktop"
            ? "/onnx/models/parakeet-tdt-0.6b-v2-webgpu"
            : "/__client-parakeet-webgpu-models",
        ),
      );
      expect(config.define?.__CLIENT_PARAKEET_MODEL_BASE_URL__).toBe(
        JSON.stringify(
          mode === "embedded-desktop"
            ? "/onnx/models/parakeet-tdt-0.6b-v2"
            : "/__client-parakeet-models",
        ),
      );
    },
  );
  it("serves exact model/config bytes, MIME and HEAD metadata", async () => {
    const base = await listen();
    const model = await fetch(`${base}/encoder.int8.onnx`);
    expect(model.status).toBe(200);
    expect(model.headers.get("content-type")).toBe("application/octet-stream");
    expect(await model.text()).toBe("0123456789");
    const config = await fetch(`${base}/config.json`);
    expect(config.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await config.json()).toEqual({ test: true });
    const head = await fetch(`${base}/encoder.int8.onnx`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("10");
    expect(await head.text()).toBe("");
  });
  it.each([
    ["bytes=2-4", "234", "bytes 2-4/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-2", "89", "bytes 8-9/10"],
  ])("serves bounded model range %s", async (range, bytes, contentRange) => {
    const response = await fetch(`${await listen()}/encoder.int8.onnx`, {
      headers: { Range: range },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(await response.text()).toBe(bytes);
  });
  it.each(["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=0-1,4-5", "bytes=-"])(
    "rejects invalid range %s",
    async (range) => {
      const response = await fetch(`${await listen()}/encoder.int8.onnx`, {
        headers: { Range: range },
      });
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */10");
    },
  );
  it("answers 404 for an absent optional model set", async () => {
    const base = await listen(null);
    const response = await fetch(`${base}/encoder-model.fp16.onnx`, {
      method: "HEAD",
    });
    expect(response.status).toBe(404);
  });

  it("resolves a missing optional WebGPU set to null instead of failing", () => {
    vi.stubEnv("VITE_CLIENT_PARAKEET_WEBGPU_MODEL_DIR", "relative/path");
    expect(resolveLocalParakeetWebgpuModelDir()).toBeNull();
    vi.stubEnv("VITE_CLIENT_PARAKEET_WEBGPU_MODEL_DIR", "/missing/webgpu");
    expect(resolveLocalParakeetWebgpuModelDir()).toBeNull();
    vi.stubEnv("VITE_CLIENT_PARAKEET_WEBGPU_MODEL_DIR", "");
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("exit 2"), { status: 2 });
    });
    expect(resolveLocalParakeetWebgpuModelDir()).toBeNull();
  });

  it("rejects traversal and leaves unrelated routes alone", async () => {
    const base = await listen();
    expect((await fetch(`${base}/..%2foutside`)).status).toBe(403);
    expect((await fetch(`${base}/missing`)).status).toBe(404);
    expect(
      (await fetch(`${base}/config.json`, { method: "POST" })).status,
    ).toBe(405);
  });
});
