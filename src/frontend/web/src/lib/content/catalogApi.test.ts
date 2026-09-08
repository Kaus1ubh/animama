import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentSaveApiError } from "./contentSaveErrors";

const clientMocks = vi.hoisted(() => ({
  saveGesture: vi.fn(),
}));

vi.mock("@animama/runtime-contracts/sdk", () => ({
  saveGesture: clientMocks.saveGesture,
}));

import { saveCatalogItem } from "./catalogApi";

describe("saveCatalogItem error boundary", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("unwraps the generated client's successful fields response", async () => {
    clientMocks.saveGesture.mockResolvedValue({
      data: {
        item_id: "gesture-item",
        source: "local",
        logical_key: "local:gesture:wave",
        name: "Wave",
        description: null,
        dependencies: [],
        files: [],
        revision_sha256: "gesture-revision",
        editable: true,
        semantic_key: "wave",
        implementation: { kind: "anima_clip" },
        config: {},
      },
      request: new Request("http://localhost/v1/gestures/wave"),
      response: new Response(null, { status: 200 }),
    });

    await expect(
      saveCatalogItem({
        kind: "gesture",
        entryName: "Wave",
        files: [],
        operationId: "save-operation",
      }),
    ).resolves.toMatchObject({
      item_id: "gesture-item",
      revision_sha256: "gesture-revision",
    });
  });

  it("retains HTTP status while normalizing a generated-client error body", async () => {
    clientMocks.saveGesture.mockResolvedValue({
      data: undefined,
      error: { detail: { code: "catalog_revision_conflict" } },
      request: new Request("http://localhost/v1/gestures/wave"),
      response: new Response(null, { status: 409 }),
    });

    const save = saveCatalogItem({
      kind: "gesture",
      entryName: "Wave",
      files: [],
      operationId: "save-operation",
    });

    await expect(save).rejects.toMatchObject({
      name: "ContentSaveApiError",
      status: 409,
      code: "catalog_revision_conflict",
      message:
        "This item changed since you opened it. Reload the latest version before saving. Your draft is preserved.",
    });
    expect(clientMocks.saveGesture).toHaveBeenCalledWith(
      expect.objectContaining({ throwOnError: false }),
    );
  });

  it("normalizes a browser fetch rejection at the same boundary", async () => {
    clientMocks.saveGesture.mockRejectedValue(new TypeError("Failed to fetch"));

    const save = saveCatalogItem({
      kind: "gesture",
      entryName: "Wave",
      files: [],
      operationId: "save-operation",
    });

    await expect(save).rejects.toEqual(
      expect.objectContaining<Partial<ContentSaveApiError>>({
        name: "ContentSaveApiError",
        status: null,
        message:
          "Animama could not be reached. Check that the local stack is running, then retry. Your draft is preserved.",
      }),
    );
  });
});
