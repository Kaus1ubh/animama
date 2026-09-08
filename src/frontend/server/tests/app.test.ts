import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createAccountlessGatewayApp } from "../src/app.js";
import { IMMUTABLE_APP_ASSET_CACHE } from "../src/gateway/app-asset-cache.js";

const INTERNAL_TOKEN = "a".repeat(64);

async function createTestRuntime() {
  const principalProvider = {
    getInstallationPrincipalId: vi.fn(async () => "installation-owner"),
  };
  const runtime = await createAccountlessGatewayApp({
    publicOrigin: new URL("http://gateway.test"),
    fastApiOrigin: new URL("http://127.0.0.1:9"),
    viteOrigin: new URL("http://127.0.0.1:9"),
    internalTokenSource: { kind: "value", value: INTERNAL_TOKEN },
    principalProvider,
  });
  return { principalProvider, runtime };
}

describe("accountless local gateway factory", () => {
  it("caches only inventoried production code, revalidates HTML, and recovers changed fingerprints", async () => {
    const root = await mkdtemp(join(tmpdir(), "animama-built-cache-"));
    const js = "/assets/app-abcdefgh.js";
    const css = "/assets/app-abcdefgh.css";
    const headers = { Host: "gateway.test" };
    const makeRuntime = () =>
      createAccountlessGatewayApp({
        publicOrigin: new URL("http://gateway.test"),
        fastApiOrigin: new URL("http://127.0.0.1:9"),
        staticRoot: root,
        internalTokenSource: { kind: "value", value: INTERNAL_TOKEN },
        principalProvider: {
          getInstallationPrincipalId: async () => "installation-owner",
        },
      });
    try {
      await mkdir(join(root, "assets"));
      await mkdir(join(root, ".vite"));
      await writeFile(
        join(root, "index.html"),
        `<script src="${js}"></script>`,
      );
      const normalizedTime = new Date("2026-01-01T00:00:00Z");
      await utimes(join(root, "index.html"), normalizedTime, normalizedTime);
      await writeFile(join(root, js), "export const first = true;");
      await writeFile(join(root, css), "body { color: red; }");
      await writeFile(
        join(root, "assets/unlisted-abcdefgh.js"),
        "export const mutable = true;",
      );
      await writeFile(join(root, "assets/app-abcdefgh.js.map"), "{}");
      await writeFile(join(root, "config.json"), "{}");
      const manifest = join(root, ".vite/manifest.json");
      await writeFile(
        manifest,
        JSON.stringify({ main: { file: js.slice(1), css: [css.slice(1)] } }),
      );
      const runtime = await makeRuntime();
      const get = (path: string, extra: RequestInit = {}) =>
        runtime.app.request(`http://gateway.test${path}`, {
          headers,
          ...extra,
        });
      for (const path of [js, css]) {
        const first = await get(path);
        expect(first.status).toBe(200);
        expect(first.headers.get("cache-control")).toBe(
          IMMUTABLE_APP_ASSET_CACHE,
        );
        const bytes = await first.text();
        expect(bytes.length).toBeGreaterThan(0);
        const head = await get(path, { method: "HEAD" });
        expect(await head.text()).toBe("");
        expect(head.headers.get("content-length")).toBe(
          String(Buffer.byteLength(bytes)),
        );
        const conditional = await get(path, {
          headers: { ...headers, "If-None-Match": first.headers.get("etag")! },
        });
        expect(conditional.status).toBe(304);
        expect(await conditional.text()).toBe("");
        expect(conditional.headers.get("cache-control")).toBe(
          IMMUTABLE_APP_ASSET_CACHE,
        );
        const disabledCache = await get(path, {
          headers: { ...headers, "Cache-Control": "no-cache" },
        });
        expect(disabledCache.status).toBe(200);
        expect(await disabledCache.text()).toBe(bytes);
      }
      for (const path of [
        "/",
        "/a/anima",
        "/index.html",
        "/assets/unlisted-abcdefgh.js",
        "/assets/app-abcdefgh.js.map",
        "/config.json",
      ]) {
        const response = await get(path, {
          headers: { ...headers, Accept: "text/html" },
        });
        expect(response.status, path).toBe(200);
        expect(response.headers.get("cache-control"), path).toBe("no-cache");
      }
      const index = await get("/index.html");
      expect(index.headers.get("last-modified")).toBeNull();
      const conditionalIndex = await get("/index.html", {
        headers: { ...headers, "If-None-Match": index.headers.get("etag")! },
      });
      expect(conditionalIndex.status).toBe(304);
      expect(conditionalIndex.headers.get("cache-control")).toBe("no-cache");
      await writeFile(join(root, "config.json"), "[]");
      await utimes(join(root, "config.json"), normalizedTime, normalizedTime);
      const mutable = await get("/config.json", {
        headers: {
          ...headers,
          "If-Modified-Since": normalizedTime.toUTCString(),
        },
      });
      expect(mutable.status).toBe(200);
      expect(await mutable.text()).toBe("[]");
      expect(mutable.headers.get("etag")).toBeNull();
      for (const path of [
        "/assets/missing-abcdefgh.js",
        "/.vite/manifest.json",
        "/%2evite/manifest.json",
        "/assets%2f..%2f.vite%2fmanifest.json",
      ]) {
        const response = await get(path, {
          headers: { ...headers, Accept: "text/html" },
        });
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      const hostile = await get(js, {
        headers: {
          ...headers,
          Origin: "https://hostile.example",
          "Sec-Fetch-Site": "cross-site",
        },
      });
      expect(hostile.status).toBe(403);
      expect(hostile.headers.get("cache-control") ?? "").not.toContain(
        "immutable",
      );

      const next = "/assets/app-ijklmnop.js";
      await rm(join(root, js));
      await writeFile(join(root, next), "export const second = true;");
      await writeFile(
        join(root, "index.html"),
        `<script src="${next}"></script>`,
      );
      await utimes(join(root, "index.html"), normalizedTime, normalizedTime);
      await writeFile(
        manifest,
        JSON.stringify({ main: { file: next.slice(1) } }),
      );
      const updated = await makeRuntime();
      const html = await updated.app.request("http://gateway.test/index.html", {
        headers: { ...headers, "If-None-Match": index.headers.get("etag")! },
      });
      expect(html.status).toBe(200);
      expect(html.headers.get("etag")).not.toBe(index.headers.get("etag"));
      expect(await html.text()).toContain(next);
      const timestampOnly = await updated.app.request(
        "http://gateway.test/index.html",
        {
          headers: {
            ...headers,
            "If-Modified-Since": normalizedTime.toUTCString(),
          },
        },
      );
      expect(timestampOnly.status).toBe(200);
      const changed = await updated.app.request(`http://gateway.test${next}`, {
        headers,
      });
      expect(changed.headers.get("cache-control")).toBe(
        IMMUTABLE_APP_ASSET_CACHE,
      );
      expect(
        (
          await updated.app.request(`http://gateway.test${js}`, {
            headers: { ...headers, Accept: "*/*" },
          })
        ).status,
      ).toBe(404);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads the principal once and serves a bounded health response", async () => {
    const { principalProvider, runtime } = await createTestRuntime();
    const response = await runtime.app.request("http://gateway.test/health");

    expect(principalProvider.getInstallationPrincipalId).toHaveBeenCalledTimes(
      1,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "animama-local-gateway",
    });
  });

  it("does not expose identity-provider or FastAPI control routes", async () => {
    const { runtime } = await createTestRuntime();
    const headers = {
      Host: "gateway.test",
      Origin: "http://gateway.test",
      "Sec-Fetch-Site": "same-origin",
    };

    for (const path of [
      "/api/auth/sign-in/email",
      "/docs",
      "/openapi.json",
      "/_desktop/control",
    ]) {
      const response = await runtime.app.request(`http://gateway.test${path}`, {
        headers,
      });
      expect(response.status, path).toBe(404);
    }
  });

  it("returns a bounded error when a private upstream is unavailable", async () => {
    const { runtime } = await createTestRuntime();
    const response = await runtime.app.request(
      "http://gateway.test/v1/runtime-context",
      {
        headers: {
          Host: "gateway.test",
          Origin: "http://gateway.test",
          "Sec-Fetch-Site": "same-origin",
        },
      },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "gateway_upstream_unavailable",
    });
  });

  it("serves built assets with navigation-only SPA fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "animama-gateway-spa-"));
    const outsideRoot = await mkdtemp(
      join(tmpdir(), "animama-gateway-outside-"),
    );
    try {
      await mkdir(join(root, "assets"));
      await writeFile(join(root, "index.html"), "<html>accountless</html>");
      await writeFile(
        join(root, "assets", "app.js"),
        "export const ok = true;",
      );
      const runtime = await createAccountlessGatewayApp({
        publicOrigin: new URL("http://gateway.test"),
        fastApiOrigin: new URL("http://127.0.0.1:9"),
        staticRoot: root,
        internalTokenSource: { kind: "value", value: INTERNAL_TOKEN },
        principalProvider: {
          getInstallationPrincipalId: async () => "installation-owner",
        },
      });
      const headers = { Host: "gateway.test", Accept: "text/html" };

      const navigation = await runtime.app.request(
        "http://gateway.test/animas/example",
        { headers },
      );
      expect(navigation.status).toBe(200);
      expect(await navigation.text()).toContain("accountless");

      const asset = await runtime.app.request(
        "http://gateway.test/assets/app.js",
        { headers: { Host: "gateway.test" } },
      );
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("ok = true");

      const missingAsset = await runtime.app.request(
        "http://gateway.test/assets/missing.js",
        { headers },
      );
      expect(missingAsset.status).toBe(404);

      if (process.platform !== "win32") {
        const outside = join(outsideRoot, "private.txt");
        await writeFile(outside, "must not be served");
        await symlink(outside, join(root, "assets", "linked.txt"));
        const linked = await runtime.app.request(
          "http://gateway.test/assets/linked.txt",
          { headers: { Host: "gateway.test" } },
        );
        expect(linked.status).toBe(404);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outsideRoot, { force: true, recursive: true });
    }
  });
});
