import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build } from "vite";

import viteConfig from "../vite.config";

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

  // Runtime cache, conditional GET/HEAD, immutable inventory and missing-chunk
  // behavior now live in tests/test_local_http_assets.py and the real Uvicorn
  // transport suite, which exercise the production FastAPI asset responder.
});
