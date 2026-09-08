import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build, preview } from "vite";

import viteConfig from "../vite.config";
import { appAssetCachePlugin } from "../vite-plugins/app-asset-cache";
import {
  appAssetCacheControl,
  IMMUTABLE_APP_ASSET_CACHE,
} from "../../server/src/gateway/app-asset-cache";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("production delivery contract", () => {
  it.each([
    { dev: true, flag: "true", mode: "development", expected: true },
    { dev: true, flag: "false", mode: "development", expected: false },
    { dev: true, flag: "1", mode: "development", expected: true },
    { dev: false, flag: "true", mode: "production", expected: false },
    { dev: false, flag: "true", mode: "embedded-desktop", expected: false },
    { dev: false, flag: "true", mode: "development", expected: false },
  ])(
    "debug opt-in cannot override the build: $mode / $dev / $flag",
    async ({ dev, flag, mode, expected }) => {
      vi.stubEnv("DEV", dev);
      vi.stubEnv("PROD", !dev);
      vi.stubEnv("MODE", mode);
      vi.stubEnv("VITE_ENABLE_DEBUG_PANEL", flag);
      const { DEBUG_ENABLED, env } = await import("../src/platform/env");
      expect(DEBUG_ENABLED).toBe(expected);
      expect(env.enableDebugPanel).toBe(expected);
    },
  );

  it.each(["production", "embedded-desktop"])(
    "removes debug imports in a real %s build even with inherited development flags",
    async (mode) => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("VITE_ENABLE_DEBUG_PANEL", "true");
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "animama-debug-build-")),
      );
      try {
        await writeFile(
          join(root, "index.html"),
          '<script type="module" src="/main.ts"></script>',
        );
        const envModule = fileURLToPath(
          new URL("../src/platform/env.ts", import.meta.url),
        );
        await writeFile(
          join(root, "main.ts"),
          `import { DEBUG_ENABLED } from ${JSON.stringify(envModule)}; if (__ANIMAMA_DEV_BUILD__ && DEBUG_ENABLED) import('./debug-only.ts'); console.log('app');`,
        );
        await writeFile(
          join(root, "debug-only.ts"),
          "console.log('FORBIDDEN_PRODUCTION_DEBUG_MODULE');",
        );
        const config =
          typeof viteConfig === "function"
            ? await viteConfig({ command: "build", mode })
            : viteConfig;
        const result = await build({
          configFile: false,
          root,
          mode,
          define: config.define,
          logLevel: "silent",
          build: { write: false, minify: false },
        });
        if (Array.isArray(result) || !("output" in result))
          throw new Error("expected one build output");
        const chunks = result.output.filter(
          (output) => output.type === "chunk",
        );
        expect(
          chunks.some((chunk) =>
            Object.keys(chunk.modules).some((id) =>
              id.endsWith("debug-only.ts"),
            ),
          ),
        ).toBe(false);
        expect(chunks.map((chunk) => chunk.code).join("\n")).not.toContain(
          "FORBIDDEN_PRODUCTION_DEBUG_MODULE",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("uses the shared policy in real private Vite preview and returns 404 for missing chunks", async () => {
    const root = await mkdtemp(join(tmpdir(), "animama-preview-cache-"));
    const dist = join(root, "dist");
    let server: Awaited<ReturnType<typeof preview>> | undefined;
    try {
      await mkdir(join(dist, "assets"), { recursive: true });
      await mkdir(join(dist, ".vite"));
      await writeFile(join(dist, "index.html"), "<html>app</html>");
      await writeFile(
        join(dist, "assets/app-abcdefgh.js"),
        "export const app = true;",
      );
      await writeFile(
        join(dist, "assets/app-abcdefgh.css"),
        "body { color: red; }",
      );
      await writeFile(
        join(dist, "assets/unlisted-abcdefgh.js"),
        "export const mutable = true;",
      );
      await writeFile(
        join(dist, ".vite/manifest.json"),
        JSON.stringify({
          main: {
            file: "assets/app-abcdefgh.js",
            css: ["assets/app-abcdefgh.css"],
          },
        }),
      );
      server = await preview({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [appAssetCachePlugin()],
        preview: { host: "127.0.0.1", port: 0 },
      });
      const origin = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
      for (const path of [
        "/assets/app-abcdefgh.js",
        "/assets/app-abcdefgh.css",
      ]) {
        const first = await fetch(origin + path);
        expect(first.headers.get("cache-control")).toBe(
          IMMUTABLE_APP_ASSET_CACHE,
        );
        const body = await first.text();
        const conditional = await fetch(origin + path, {
          headers: { "If-None-Match": first.headers.get("etag")! },
        });
        expect(conditional.status).toBe(304);
        expect(conditional.headers.get("cache-control")).toBe(
          IMMUTABLE_APP_ASSET_CACHE,
        );
        expect(
          (await fetch(origin + path, { method: "HEAD" })).headers.get(
            "content-length",
          ),
        ).toBe(String(Buffer.byteLength(body)));
        expect(
          await (
            await fetch(origin + path, {
              headers: { "Cache-Control": "no-cache" },
            })
          ).text(),
        ).toBe(body);
      }
      for (const path of ["/", "/a/anima", "/assets/unlisted-abcdefgh.js"])
        expect((await fetch(origin + path)).headers.get("cache-control")).toBe(
          "no-cache",
        );
      for (const path of [
        "/assets/missing-abcdefgh.js",
        "/.vite/manifest.json",
        "/%2evite/manifest.json",
        "/assets%2f..%2f.vite%2fmanifest.json",
      ]) {
        const response = await fetch(origin + path, {
          headers: { Accept: "*/*" },
        });
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    } finally {
      if (server) {
        server.httpServer.closeAllConnections();
        await new Promise<void>((resolve) =>
          server!.httpServer.close(() => resolve()),
        );
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["/assets/app-abcdefgh.js", 404, "text/javascript"],
    ["/assets/app-abcdefgh.js", 302, "text/javascript"],
    ["/assets/app-abcdefgh.js", 200, "text/html"],
    ["/assets/unlisted-abcdefgh.js", 200, "text/javascript"],
    ["/v1/owner-abcdefgh.js", 200, "text/javascript"],
    ["/assets/app-abcdefgh.js.map", 200, "application/json"],
  ])(
    "does not classify unsafe response %s / %s as immutable",
    (pathname, status, contentType) => {
      expect(
        appAssetCacheControl(
          new Set(["/assets/app-abcdefgh.js", "/v1/owner-abcdefgh.js"]),
          { pathname, method: "GET" },
          { status, contentType },
        ),
      ).not.toContain("immutable");
    },
  );
});
