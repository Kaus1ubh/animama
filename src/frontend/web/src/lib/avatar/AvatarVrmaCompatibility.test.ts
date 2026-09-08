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

const CANONICAL_APP_VRMA = fileURLToPath(
  new URL(
    "../../../../../../content/included/gestures/posture_sad_custom/posture_sad_custom.vrma",
    import.meta.url,
  ),
);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Avatar canonical VRMA compatibility", () => {
  it("shares decoding within one mount but not across separate mount caches", async () => {
    const content = await readFile(CANONICAL_APP_VRMA);
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
      contentPath: CANONICAL_APP_VRMA,
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
      contentPath: CANONICAL_APP_VRMA,
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
});
