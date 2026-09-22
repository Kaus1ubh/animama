import { describe, expect, it, vi } from "vitest";

import {
  fetchPrivateRuntimeContentResponse,
  fetchProtectedContentResponse,
  resolvePrivateRuntimeContentUrl,
  resolveRuntimeContentDeliveryReference,
  runtimeContentRequiresPrivateFetch,
  runtimeContentDownloadUrl,
} from "./runtimeContentDelivery";
import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";

const modelEntry = {
  slot: "primary_model",
  runtime_id: "primary",
  kind: "avatar_model",
  display_name: "Avatar",
  description: null,
  config_schema_version: 1,
  config: {},
  content_revision: "avatar-1",
  source: { type: "authorized_files", files: [] },
} satisfies RuntimeCatalogEntry;

describe("runtime Asset delivery", () => {
  it.each(["release", "abort"] as const)(
    "releases an owned URL exactly once through %s and later cleanup",
    async (firstCleanup) => {
      const controller = new AbortController();
      const revoke = vi.spyOn(URL, "revokeObjectURL");
      const download = await runtimeContentDownloadUrl(
        modelEntry,
        "/model.vrm",
        {
          fetcher: vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response("model")),
          signal: controller.signal,
        },
      );
      expect(download?.url).toMatch(/^blob:/);
      expect(revoke).not.toHaveBeenCalled();

      if (firstCleanup === "abort") controller.abort();
      else download?.release();
      download?.release();
      controller.abort();

      expect(revoke).toHaveBeenCalledExactlyOnceWith(download?.url);
    },
  );

  it.each([
    { type: "public_url", url: "https://example.test/model.vrm" },
    { type: "prepared_files", files: [] },
  ] satisfies RuntimeCatalogEntry["source"][])(
    "never revokes a borrowed $type URL, including an externally owned blob URL",
    async (source) => {
      const controller = new AbortController();
      const fetcher = vi.fn<typeof fetch>();
      const create = vi.spyOn(URL, "createObjectURL");
      const revoke = vi.spyOn(URL, "revokeObjectURL");
      const download = await runtimeContentDownloadUrl(
        { ...modelEntry, source },
        "blob:owned-by-preparation",
        { fetcher, signal: controller.signal },
      );

      expect(download?.url).toBe("blob:owned-by-preparation");
      download?.release();
      controller.abort();
      expect(fetcher).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
    },
  );

  it("does not fetch or allocate when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>();
    const create = vi.spyOn(URL, "createObjectURL");

    await expect(
      runtimeContentDownloadUrl(modelEntry, "/model.vrm", {
        fetcher,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("does not create a late URL when cancellation wins body decoding", async () => {
    const controller = new AbortController();
    let finishBody!: (blob: Blob) => void;
    const response = new Response();
    const readBody = vi.spyOn(response, "blob").mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          finishBody = resolve;
        }),
    );
    const create = vi.spyOn(URL, "createObjectURL");
    const pending = runtimeContentDownloadUrl(modelEntry, "/model.vrm", {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(readBody).toHaveBeenCalled());
    controller.abort();
    finishBody(new Blob(["model"]));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(create).not.toHaveBeenCalled();
  });

  it("resolves authorized logical paths against the configured API origin", () => {
    expect(
      resolvePrivateRuntimeContentUrl(
        "/v1/animas/anima-1/runtime/revisions/tr1/files/file-1",
        "http://localhost:8000/",
      ),
    ).toBe(
      "http://localhost:8000/v1/animas/anima-1/runtime/revisions/tr1/files/file-1",
    );
  });

  it("resolves exact-version preview paths through the same API origin", () => {
    expect(
      resolvePrivateRuntimeContentUrl(
        "/v1/content/previews/preview-3/revisions/revision-2/files/file-1",
        "http://localhost:8000/",
      ),
    ).toBe(
      "http://localhost:8000/v1/content/previews/preview-3/revisions/revision-2/files/file-1",
    );
  });

  it("does not rewrite an absolute authorized resource URL", () => {
    expect(
      resolvePrivateRuntimeContentUrl(
        "https://api.example.test/v1/runtime/file",
        "http://localhost:8000",
      ),
    ).toBe("https://api.example.test/v1/runtime/file");
  });

  it("resolves an explicitly selected private file before authorization", () => {
    const entry = {
      slot: "particle_vfx",
      runtime_id: "private-effect",
      kind: "particle_vfx",
      display_name: "Private effect",
      description: null,
      config_schema_version: 1,
      config: {},
      content_revision: "ac1_private",
      source: {
        type: "authorized_files",
        files: [],
      },
    } satisfies RuntimeCatalogEntry;

    expect(
      resolveRuntimeContentDeliveryReference(
        entry,
        "/v1/content/previews/preview-1/revisions/revision-1/files/file-1",
        "http://localhost:8000",
      ),
    ).toBe(
      resolvePrivateRuntimeContentUrl(
        "/v1/content/previews/preview-1/revisions/revision-1/files/file-1",
        "http://localhost:8000",
      ),
    );
  });

  it("identifies private files that require a same-origin gateway fetch", () => {
    const baseEntry = {
      slot: "primary_model",
      runtime_id: "primary",
      kind: "avatar_model",
      display_name: "Avatar",
      description: null,
      config_schema_version: 1,
      config: {},
      content_revision: "ac1_test",
    } as const;
    const appEntry = {
      ...baseEntry,
      source: { type: "public_url", url: "/vrm/test.vrm" },
    } satisfies RuntimeCatalogEntry;
    const userEntry = {
      ...baseEntry,
      source: {
        type: "authorized_files",
        files: [],
      },
    } satisfies RuntimeCatalogEntry;

    expect(runtimeContentRequiresPrivateFetch(appEntry)).toBe(false);
    expect(runtimeContentRequiresPrivateFetch(userEntry)).toBe(true);
  });

  it("fetches protected bytes through the gateway without a bearer", async () => {
    const userEntry = {
      slot: "profile_image",
      runtime_id: "profile",
      kind: "image",
      display_name: "Profile",
      description: null,
      config_schema_version: 1,
      config: {},
      content_revision: "ac1_profile",
      source: {
        type: "authorized_files",
        files: [],
      },
    } satisfies RuntimeCatalogEntry;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("image", { status: 200 }));

    const response = await fetchPrivateRuntimeContentResponse(
      userEntry,
      "http://localhost:8000/v1/animas/anima-1/profile",
      {
        fetcher,
      },
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "http://localhost:8000/v1/animas/anima-1/profile",
    );
    const init = fetcher.mock.calls[0]?.[1];
    expect(init).toEqual(
      expect.objectContaining({
        credentials: "same-origin",
        redirect: "error",
      }),
    );
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("preserves byte ranges while stripping obsolete browser credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("partial", { status: 206 }));

    await fetchProtectedContentResponse("/v1/content/files/file-1", {
      fetcher,
      headers: {
        Authorization: "Bearer obsolete",
        Range: "bytes=10-19",
      },
    });

    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Range")).toBe("bytes=10-19");
  });
});
