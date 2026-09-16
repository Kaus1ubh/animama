import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "./Avatar";
import type { AvatarVrmaResource } from "./motion/AvatarMotionCatalog";

class TestProgressEvent extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;

  constructor(
    type: string,
    init: { lengthComputable?: boolean; loaded?: number; total?: number } = {},
  ) {
    super(type);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

const SYNTHETIC_VRMA = fileURLToPath(
  new URL("../../../tests/fixtures/vrma/synthetic-hips.vrma", import.meta.url),
);
afterEach(() => {
  Avatar.clearVrmaCache();
  vi.unstubAllGlobals();
});

describe("Avatar VRMA loader compatibility", () => {
  it("shares decoding within one mount but not across separate mount caches", async () => {
    const content = await readFile(SYNTHETIC_VRMA);
    const fetcher = vi.fn(async () => new Response(content));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("ProgressEvent", TestProgressEvent);
    const resource: AvatarVrmaResource = {
      runtimeId: "same-clip",
      url: "blob:first-mount",
      cacheKey: "same-content-revision",
      cache: new Map(),
      resourceUrls: {},
    };
    await Avatar.preloadVrma(resource);
    const decoded = await resource.cache!.get(resource.cacheKey);
    expect(decoded?.duration).toBe(1);
    const hips = decoded?.humanoidTracks.translation.get("hips");
    expect(Array.from(hips?.times ?? [])).toEqual([0, 1]);
    expect(Array.from(hips?.values ?? [])).toEqual([0, 1, 0, 0, 1.25, 0]);
    await Avatar.preloadVrma(resource);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await Avatar.preloadVrma({
      ...resource,
      url: "blob:second-mount",
      cache: new Map(),
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: "public App URL",
      source: {
        runtimeId: "compatibility-app",
        url: "https://assets.local/app-animation.vrma",
        cacheKey: "compatibility:app",
      } satisfies AvatarVrmaResource,
      expectedUrl: "https://assets.local/app-animation.vrma",
      contentPath: SYNTHETIC_VRMA,
    },
    {
      label: "authorized user Asset URL",
      source: {
        runtimeId: "compatibility-user",
        url: "https://api.local/user-animation.vrma",
        cacheKey: "compatibility:user",
        getDownloadUrl: async () =>
          "https://api.local/registered-animation.vrma",
      } satisfies AvatarVrmaResource,
      expectedUrl: "https://api.local/registered-animation.vrma",
      contentPath: SYNTHETIC_VRMA,
    },
  ])(
    "loads the exact source through the real loader for $label",
    async (testCase) => {
      const content = await readFile(testCase.contentPath);
      const nativeFetch = globalThis.fetch;
      let assetRequestCount = 0;
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        if (request.url.startsWith("data:")) {
          return nativeFetch(request);
        }
        assetRequestCount += 1;
        expect(request.url).toBe(testCase.expectedUrl);
        expect(request.headers.get("Authorization")).toBeNull();
        return new Response(content, {
          headers: {
            "Content-Length": String(content.byteLength),
            "Content-Type": "model/gltf-binary",
          },
        });
      });
      vi.stubGlobal("fetch", fetcher);
      vi.stubGlobal("ProgressEvent", TestProgressEvent);

      await expect(
        Avatar.preloadVrma(testCase.source),
      ).resolves.toBeUndefined();
      expect(assetRequestCount).toBe(1);
    },
  );

  it("rejects malformed bytes and permits retry after evicting the failed decode", async () => {
    const content = await readFile(SYNTHETIC_VRMA);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("not a glTF document"))
      .mockResolvedValueOnce(new Response(content));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("ProgressEvent", TestProgressEvent);
    const resource: AvatarVrmaResource = {
      runtimeId: "malformed-retry",
      url: "https://assets.local/retry.vrma",
      cacheKey: "malformed-retry",
      cache: new Map(),
    };
    await expect(Avatar.preloadVrma(resource)).rejects.toThrow();
    expect(resource.cache!.has(resource.cacheKey)).toBe(false);
    await Avatar.preloadVrma(resource);
    expect((await resource.cache!.get(resource.cacheKey))?.duration).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
